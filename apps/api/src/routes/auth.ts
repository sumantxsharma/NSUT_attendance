import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema, ROLE_PERMISSIONS, APP_NAME } from '@nsut/shared';
import { config } from '../config';
import { one, pool, tx } from '../db/pool';
import { audit } from '../lib/audit';
import { ah, AppError, badRequest, unauthorized } from '../lib/errors';
import { enqueueExternal } from '../lib/notify';
import { loadSettings } from '../lib/settings';
import { clearSessionCookies, createSession, randomToken, requireAuth, setSessionCookies, sha256 } from '../middleware/auth';

export const BCRYPT_ROUNDS = config.isTest ? 4 : 12;
// Used to keep response timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait a few minutes and try again.' } },
});
const resetLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: config.isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
});

export const authRouter = Router();

async function mePayload(userId: string, csrf: string) {
  const u = await one(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.person_id AS "personId", u.last_login AS "lastLogin",
            p.full_name AS "personName", p.type AS "personType", p.ref_id AS "refId"
     FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.id = $1`,
    [userId],
  );
  const scopes = await pool.query(
    `SELECT s.department_id AS "departmentId", d.name AS "departmentName", s.activity_id AS "activityId", a.name AS "activityName"
     FROM user_scopes s LEFT JOIN departments d ON d.id = s.department_id LEFT JOIN activities a ON a.id = s.activity_id WHERE s.user_id = $1`,
    [userId],
  );
  return { user: { ...u, permissions: ROLE_PERMISSIONS[u.role as keyof typeof ROLE_PERMISSIONS], scopes: scopes.rows }, csrfToken: csrf };
}

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await one('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
    const generic = new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

    if (!user || user.auth_provider !== 'local') {
      await bcrypt.compare(password, DUMMY_HASH);
      await audit({ action: 'AUTH_LOGIN_FAILED', entityType: 'user', summary: `Failed sign-in for unknown account`, newValue: { email } }, req);
      throw generic;
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new AppError(423, 'LOCKED', `Too many failed attempts. This account is temporarily locked. Try again after ${config.lockoutMinutes} minutes or reset your password.`);
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const attempts = user.failed_login_count + 1;
      const lock = attempts >= config.maxLoginAttempts;
      await pool.query(
        `UPDATE users SET failed_login_count = $2, locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END WHERE id = $1`,
        [user.id, lock ? 0 : attempts, lock, String(config.lockoutMinutes)],
      );
      await audit({ action: 'AUTH_LOGIN_FAILED', entityType: 'user', entityId: user.id, userId: user.id, userName: user.name, summary: lock ? 'Account locked after repeated failures' : 'Failed sign-in' }, req);
      throw generic;
    }
    if (user.status !== 'ACTIVE') throw new AppError(403, 'INACTIVE', 'This account has been deactivated. Please contact the administration.');

    const session = await tx(async (c) => {
      await c.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login = now() WHERE id = $1', [user.id]);
      const s = await createSession(user.id, req, c);
      await audit({ action: 'AUTH_LOGIN', entityType: 'user', entityId: user.id, userId: user.id, userName: user.name, summary: 'Signed in' }, req, c);
      return s;
    });
    setSessionCookies(res, session.token, session.csrf, session.expires);
    res.json(await mePayload(user.id, session.csrf));
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    if (req.auth) {
      await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.auth.sessionId]);
      await audit({ action: 'AUTH_LOGOUT', entityType: 'user', entityId: req.auth.user.id, summary: 'Signed out' }, req);
    }
    clearSessionCookies(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  ah(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json(await mePayload(req.auth.user.id, req.auth.csrf));
  }),
);

authRouter.post(
  '/password/forgot',
  resetLimiter,
  ah(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await one(`SELECT id, name, email FROM users WHERE email = $1 AND status = 'ACTIVE' AND deleted_at IS NULL AND auth_provider = 'local'`, [email]);
    let devResetUrl: string | undefined;
    if (user) {
      const token = randomToken(32);
      await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [user.id, sha256(token)]);
      const url = `${config.appBaseUrl}/reset-password?token=${token}`;
      await enqueueExternal('email', user.email, `${APP_NAME}: password reset`, `A password reset was requested for your account. This link is valid for 1 hour:\n${url}\n\nIf you did not request this, you can ignore this message.`);
      await audit({ action: 'AUTH_PASSWORD_RESET_REQUESTED', entityType: 'user', entityId: user.id, userId: user.id, userName: user.name, summary: 'Password reset requested' }, req);
      if (!config.isProd) devResetUrl = url;
    }
    // Same response whether or not the account exists (prevents account enumeration).
    res.json({
      ok: true,
      message: 'If an account exists for this email, a password reset link has been sent. The link is valid for 1 hour.',
      ...(devResetUrl ? { devResetUrl } : {}),
    });
  }),
);

authRouter.post(
  '/password/reset',
  resetLimiter,
  ah(async (req, res) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await tx(async (c) => {
      const row = await one(
        `SELECT t.id, t.user_id, u.name FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.status = 'ACTIVE' FOR UPDATE OF t`,
        [sha256(token)],
        c,
      );
      if (!row) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await c.query('UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1', [row.user_id, hash]);
      await c.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
      await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
      await audit({ action: 'AUTH_PASSWORD_RESET', entityType: 'user', entityId: row.user_id, userId: row.user_id, userName: row.name, summary: 'Password reset via link' }, req, c);
    });
    res.json({ ok: true, message: 'Your password has been reset. Please sign in with your new password.' });
  }),
);

authRouter.post(
  '/password/change',
  requireAuth,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await one('SELECT id, password_hash FROM users WHERE id = $1', [req.auth!.user.id]);
    if (!user?.password_hash || !(await bcrypt.compare(currentPassword, user.password_hash)))
      throw new AppError(400, 'INVALID_CREDENTIALS', 'Your current password is incorrect.');
    if (currentPassword === newPassword) throw badRequest('The new password must be different from the current one.');
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await tx(async (c) => {
      await c.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [user.id, hash]);
      await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [user.id, req.auth!.sessionId]);
      await audit({ action: 'AUTH_PASSWORD_CHANGED', entityType: 'user', entityId: user.id, summary: 'Password changed; other sessions signed out' }, req, c);
    });
    res.json({ ok: true, message: 'Password changed. Other sessions have been signed out.' });
  }),
);

/** Extension point for institutional SSO (SAML/OIDC). See SECURITY.md → SSO. */
authRouter.get('/sso/login', (_req, res) => {
  res.status(501).json({ error: { code: 'SSO_NOT_CONFIGURED', message: 'Institutional single sign-on is not configured on this server.' } });
});

export async function publicSettings() {
  const { system } = await loadSettings();
  return {
    universityName: system.universityName,
    unitName: system.unitName,
    timezone: system.timezone,
    dateFormat: system.dateFormat,
    hasLogo: !!system.logoPath,
    logoVersion: system.logoPath ? sha256(system.logoPath).slice(0, 8) : null,
    demoMode: config.demoMode,
  };
}
