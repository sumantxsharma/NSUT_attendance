import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { can, type Permission, type Role } from '@nsut/shared';
import { config } from '../config';
import { one, query, type Queryable, pool } from '../db/pool';
import { forbidden, unauthorized } from '../lib/errors';

export const SESSION_COOKIE = 'nsut_sid';
export const CSRF_COOKIE = 'nsut_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  personId: string | null;
}
export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  csrf: string;
  scope: { departmentIds: string[]; activityIds: string[] };
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export async function createSession(userId: string, req: Request, client: Queryable = pool) {
  const token = randomToken();
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  const ip = config.recordClientMeta ? (req.ip ?? '').replace(/^::ffff:/, '') || null : null;
  const ua = config.recordClientMeta ? (req.get('user-agent') ?? '').slice(0, 300) : null;
  await client.query(
    'INSERT INTO sessions (user_id, token_hash, csrf_token, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, sha256(token), csrf, ip, ua, expires],
  );
  return { token, csrf, expires };
}

export function setSessionCookies(res: Response, token: string, csrf: string, expires: Date) {
  const base = { secure: config.cookieSecure, sameSite: 'lax' as const, path: '/', expires };
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

async function loadScope(userId: string) {
  const rows = await query<{ department_id: string | null; activity_id: string | null }>(
    'SELECT department_id, activity_id FROM user_scopes WHERE user_id = $1',
    [userId],
  );
  return {
    departmentIds: rows.map((r) => r.department_id).filter(Boolean) as string[],
    activityIds: rows.map((r) => r.activity_id).filter(Boolean) as string[],
  };
}

/** Resolve the session cookie (if any) into req.auth. Never throws for missing/invalid sessions. */
export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== 'string' || token.length > 200) return next();
    const row = await one<any>(
      `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, s.expires_at,
              u.id, u.name, u.email, u.role, u.person_id, u.status, u.deleted_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
      [sha256(token)],
    );
    if (!row) return next();
    const now = Date.now();
    const idleExpired = now - new Date(row.last_seen_at).getTime() > config.sessionIdleMinutes * 60_000;
    if (new Date(row.expires_at).getTime() < now || idleExpired || row.status !== 'ACTIVE' || row.deleted_at) {
      await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [row.session_id]);
      clearSessionCookies(res);
      return next();
    }
    if (now - new Date(row.last_seen_at).getTime() > 60_000) {
      pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]).catch(() => undefined);
    }
    req.auth = {
      user: { id: row.id, name: row.name, email: row.email, role: row.role, personId: row.person_id },
      sessionId: row.session_id,
      csrf: row.csrf_token,
      scope: row.role === 'COORDINATOR' ? await loadScope(row.id) : { departmentIds: [], activityIds: [] },
    };
    next();
  } catch (e) {
    next(e);
  }
}

/** Double-submit CSRF check for state-changing requests made with a session cookie. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.auth) return next(); // unauthenticated endpoints (login, reset) carry no session to ride on
  const header = req.get(CSRF_HEADER);
  if (!header || header.length !== req.auth.csrf.length || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(req.auth.csrf))) {
    return next(forbidden('Your session security token is missing or expired. Please refresh the page and try again.'));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!perms.some((p) => can(req.auth!.user.role, p))) return next(forbidden());
    next();
  };
}
