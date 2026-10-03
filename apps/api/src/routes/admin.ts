import fs from 'node:fs';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  attendanceRulesSchema,
  createUserSchema,
  describeFormula,
  holidaySchema,
  isoDate,
  PERMISSION_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  systemSettingsSchema,
  updateUserSchema,
  uuid,
  APP_NAME,
} from '@nsut/shared';
import { config } from '../config';
import { one, query, tx } from '../db/pool';
import { audit } from '../lib/audit';
import { ah, badRequest, notFound } from '../lib/errors';
import { enqueueExternal } from '../lib/notify';
import { peopleScopeSql } from '../lib/scope';
import { loadSettings, saveSetting } from '../lib/settings';
import { likePattern, Params } from '../lib/sql';
import { MIME_BY_EXT, memoryUpload, resolveUpload, saveValidatedFile } from '../lib/upload';
import { randomToken, requireAuth, requirePerm, sha256 } from '../middleware/auth';
import { dashboard } from '../services/dashboard';
import { BCRYPT_ROUNDS, publicSettings } from './auth';

// ------------------------------------------------------------------ public (no auth)
export const publicRouter = Router();
publicRouter.get('/settings/public', ah(async (_req, res) => res.json(await publicSettings())));
publicRouter.get(
  '/settings/logo',
  ah(async (_req, res) => {
    const { system } = await loadSettings();
    if (!system.logoPath) throw notFound('Logo');
    const full = resolveUpload(system.logoPath);
    if (!fs.existsSync(full)) throw notFound('Logo');
    res.setHeader('Content-Type', MIME_BY_EXT[full.split('.').pop()!] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(full).pipe(res);
  }),
);

export const adminRouter = Router();

// ------------------------------------------------------------------ dashboard & search
adminRouter.get(
  '/dashboard',
  requirePerm('dashboard.view'),
  ah(async (req, res) => {
    const f = z.object({ type: z.enum(['GUEST_FACULTY', 'SPORTS_COACH']).optional() }).parse(req.query);
    res.json(await dashboard(req, f));
  }),
);

adminRouter.get(
  '/search',
  requirePerm('people.read'),
  ah(async (req, res) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(req.query);
    const p = new Params();
    const pat = p.add(likePattern(q));
    const rows = await query(
      `SELECT p.id, p.full_name AS "fullName", p.ref_id AS "refId", p.type, p.status, d.name AS "departmentName", a.name AS "activityName"
       FROM people p LEFT JOIN departments d ON d.id = p.department_id LEFT JOIN activities a ON a.id = p.activity_id
       WHERE p.deleted_at IS NULL AND ${peopleScopeSql(req, p)} AND (p.full_name ILIKE ${pat} OR p.ref_id ILIKE ${pat} OR d.name ILIKE ${pat} OR d.code ILIKE ${pat} OR a.name ILIKE ${pat} OR a.category ILIKE ${pat})
       ORDER BY (p.status = 'ACTIVE') DESC, p.full_name LIMIT 12`,
      p.values,
    );
    res.json(rows);
  }),
);

// ------------------------------------------------------------------ notifications (any signed-in user)
adminRouter.get(
  '/notifications',
  requireAuth,
  ah(async (req, res) => {
    const rows = await query(
      `SELECT id, type, title, body, link, read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.auth!.user.id],
    );
    const unread = await one<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.auth!.user.id]);
    res.json({ unread: unread!.n, rows });
  }),
);
adminRouter.post(
  '/notifications/read-all',
  requireAuth,
  ah(async (req, res) => {
    await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.auth!.user.id]);
    res.json({ ok: true });
  }),
);
adminRouter.patch(
  '/notifications/:id/read',
  requireAuth,
  ah(async (req, res) => {
    await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2', [uuid.parse(req.params.id), req.auth!.user.id]);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ users & roles
const USER_SELECT = `u.id, u.name, u.email, u.phone, u.role, u.status, u.person_id AS "personId", p.full_name AS "personName",
  u.last_login AS "lastLogin", u.created_at AS "createdAt", (u.locked_until > now()) AS "locked",
  COALESCE((SELECT json_agg(json_build_object('departmentId', s.department_id, 'departmentName', d.name, 'activityId', s.activity_id, 'activityName', a.name))
     FROM user_scopes s LEFT JOIN departments d ON d.id = s.department_id LEFT JOIN activities a ON a.id = s.activity_id WHERE s.user_id = u.id), '[]') AS scopes`;

adminRouter.get(
  '/users',
  requirePerm('users.manage'),
  ah(async (req, res) => {
    const f = z.object({ q: z.string().trim().max(100).optional(), role: z.enum(ROLES).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).parse(req.query);
    const p = new Params();
    const where = ['u.deleted_at IS NULL'];
    if (f.role) where.push(`u.role = ${p.add(f.role)}`);
    if (f.status) where.push(`u.status = ${p.add(f.status)}`);
    if (f.q) {
      const q = p.add(likePattern(f.q));
      where.push(`(u.name ILIKE ${q} OR u.email::text ILIKE ${q})`);
    }
    res.json(await query(`SELECT ${USER_SELECT} FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE ${where.join(' AND ')} ORDER BY u.role, u.name`, p.values));
  }),
);

adminRouter.get('/roles', requireAuth, (_req, res) => {
  res.json({
    roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r], permissions: ROLE_PERMISSIONS[r] })),
    permissions: PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS[p] })),
  });
});

async function setScopes(c: any, userId: string, role: string, deptIds: string[] = [], actIds: string[] = []) {
  await c.query('DELETE FROM user_scopes WHERE user_id = $1', [userId]);
  if (role !== 'COORDINATOR') return;
  for (const d of [...new Set(deptIds)]) await c.query('INSERT INTO user_scopes (user_id, department_id) VALUES ($1,$2)', [userId, d]);
  for (const a of [...new Set(actIds)]) await c.query('INSERT INTO user_scopes (user_id, activity_id) VALUES ($1,$2)', [userId, a]);
}

adminRouter.post(
  '/users',
  requirePerm('users.manage'),
  ah(async (req, res) => {
    const b = createUserSchema.parse(req.body);
    if (b.role === 'STAFF' && !b.personId) throw badRequest('A staff account must be linked to a Guest Faculty / Coach profile.');
    if (b.role === 'COORDINATOR' && b.scopeDepartmentIds.length + b.scopeActivityIds.length === 0)
      throw badRequest('Assign at least one department or sport/activity to a coordinator.');
    const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
    const row = await tx(async (c) => {
      const u = await one(
        `INSERT INTO users (name, email, phone, password_hash, role, person_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, person_id`,
        [b.name, b.email, b.phone ?? null, hash, b.role, b.role === 'STAFF' ? b.personId : null],
        c,
      );
      await setScopes(c, u.id, b.role, b.scopeDepartmentIds, b.scopeActivityIds);
      await audit({ action: 'USER_CREATE', entityType: 'user', entityId: u.id, summary: `Created ${ROLE_LABELS[b.role]} account for ${b.name}`, newValue: { ...u, scopes: { departments: b.scopeDepartmentIds, activities: b.scopeActivityIds } } }, req, c);
      return u;
    });
    res.status(201).json(row);
  }),
);

adminRouter.patch(
  '/users/:id',
  requirePerm('users.manage'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = updateUserSchema.parse(req.body);
    await tx(async (c) => {
      const before = await one(`SELECT ${USER_SELECT} FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.id = $1 AND u.deleted_at IS NULL`, [id], c);
      if (!before) throw notFound('User');
      if (id === req.auth!.user.id && b.role && b.role !== before.role) throw badRequest('You cannot change your own role.');
      const role = b.role ?? before.role;
      const personId = role === 'STAFF' ? (b.personId !== undefined ? b.personId : before.personId) : null;
      if (role === 'STAFF' && !personId) throw badRequest('A staff account must be linked to a Guest Faculty / Coach profile.');
      await c.query('UPDATE users SET name = $2, phone = $3, role = $4, person_id = $5 WHERE id = $1', [id, b.name ?? before.name, b.phone !== undefined ? b.phone : before.phone, role, personId]);
      if (b.scopeDepartmentIds !== undefined || b.scopeActivityIds !== undefined || b.role) {
        const deptIds = b.scopeDepartmentIds ?? before.scopes.map((s: any) => s.departmentId).filter(Boolean);
        const actIds = b.scopeActivityIds ?? before.scopes.map((s: any) => s.activityId).filter(Boolean);
        if (role === 'COORDINATOR' && deptIds.length + actIds.length === 0) throw badRequest('Assign at least one department or sport/activity to a coordinator.');
        await setScopes(c, id, role, deptIds, actIds);
      }
      if (b.role && b.role !== before.role) await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      const after = await one(`SELECT ${USER_SELECT} FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.id = $1`, [id], c);
      await audit({ action: 'USER_UPDATE', entityType: 'user', entityId: id, summary: `Updated account ${after.email}`, oldValue: before, newValue: after }, req, c);
    });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/users/:id/:action(deactivate|activate|unlock)',
  requirePerm('users.manage'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const action = req.params.action;
    if (id === req.auth!.user.id && action === 'deactivate') throw badRequest('You cannot deactivate your own account.');
    await tx(async (c) => {
      const u = await one('SELECT id, email, status, role FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id], c);
      if (!u) throw notFound('User');
      if (action === 'unlock') {
        await c.query('UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE id = $1', [id]);
        await audit({ action: 'USER_UPDATE', entityType: 'user', entityId: id, summary: `Unlocked ${u.email}` }, req, c);
        return;
      }
      if (action === 'deactivate' && u.role === 'SUPER_ADMIN') {
        const others = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> $1 AND deleted_at IS NULL`, [id], c);
        if (!others!.n) throw badRequest('At least one active Super Admin must remain.');
      }
      const status = action === 'activate' ? 'ACTIVE' : 'INACTIVE';
      await c.query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);
      if (status === 'INACTIVE') await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      await audit({ action: status === 'ACTIVE' ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', entityType: 'user', entityId: id, summary: `${status === 'ACTIVE' ? 'Activated' : 'Deactivated'} ${u.email}`, oldValue: { status: u.status }, newValue: { status } }, req, c);
    });
    res.json({ ok: true });
  }),
);

/** Admin-issued reset link: for institutions without outbound email yet. Shown once to the admin. */
adminRouter.post(
  '/users/:id/reset-link',
  requirePerm('users.manage'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const u = await one(`SELECT id, email, name FROM users WHERE id = $1 AND deleted_at IS NULL AND auth_provider = 'local'`, [id]);
    if (!u) throw notFound('User');
    const token = randomToken(32);
    const url = `${config.appBaseUrl}/reset-password?token=${token}`;
    await tx(async (c) => {
      await c.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '24 hours')`, [id, sha256(token)]);
      await enqueueExternal('email', u.email, `${APP_NAME}: set your password`, `Use this link within 24 hours to set your password:\n${url}`, c);
      await audit({ action: 'USER_RESET_LINK_ISSUED', entityType: 'user', entityId: id, summary: `Issued password reset link for ${u.email}` }, req, c);
    });
    res.json({ url, expiresInHours: 24 });
  }),
);

// ------------------------------------------------------------------ settings
adminRouter.get(
  '/settings',
  requireAuth,
  ah(async (_req, res) => {
    const { rules, system } = await loadSettings();
    const holidays = await query('SELECT id, date, name FROM holidays ORDER BY date');
    res.json({ rules, system, holidays, formula: describeFormula(rules) });
  }),
);

adminRouter.put(
  '/settings/rules',
  requirePerm('rules.manage'),
  ah(async (req, res) => {
    const rules = attendanceRulesSchema.parse(req.body);
    const { rules: before } = await loadSettings();
    await tx(async (c) => {
      await saveSetting('attendance_rules', rules, req.auth!.user.id, c);
      await audit({ action: 'SETTINGS_RULES_UPDATE', entityType: 'settings', entityId: 'attendance_rules', summary: 'Updated attendance rules', oldValue: before, newValue: rules }, req, c);
    });
    res.json({ rules, formula: describeFormula(rules) });
  }),
);

adminRouter.put(
  '/settings/system',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const { system: before } = await loadSettings();
    const body = systemSettingsSchema.omit({ logoPath: true }).parse(req.body);
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone });
    } catch {
      throw badRequest('Unknown timezone. Use an IANA name such as Asia/Kolkata.');
    }
    const system = { ...body, logoPath: before.logoPath };
    await tx(async (c) => {
      await saveSetting('system', system, req.auth!.user.id, c);
      await audit({ action: 'SETTINGS_SYSTEM_UPDATE', entityType: 'settings', entityId: 'system', summary: 'Updated system settings', oldValue: before, newValue: system }, req, c);
    });
    res.json(system);
  }),
);

adminRouter.post(
  '/settings/logo',
  requirePerm('settings.manage'),
  memoryUpload(1).single('logo'),
  ah(async (req, res) => {
    const saved = saveValidatedFile(req.file, ['image/png', 'image/jpeg'], 'branding');
    if (!saved) throw badRequest('Choose a PNG or JPEG logo to upload.');
    const { system } = await loadSettings();
    await tx(async (c) => {
      await saveSetting('system', { ...system, logoPath: saved.path }, req.auth!.user.id, c);
      await audit({ action: 'SETTINGS_LOGO_UPDATE', entityType: 'settings', entityId: 'system', summary: 'Uploaded university logo', oldValue: { logoPath: system.logoPath }, newValue: { logoPath: saved.path } }, req, c);
    });
    res.json({ ok: true });
  }),
);

adminRouter.delete(
  '/settings/logo',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const { system } = await loadSettings();
    await tx(async (c) => {
      await saveSetting('system', { ...system, logoPath: null }, req.auth!.user.id, c);
      await audit({ action: 'SETTINGS_LOGO_UPDATE', entityType: 'settings', entityId: 'system', summary: 'Removed university logo', oldValue: { logoPath: system.logoPath }, newValue: { logoPath: null } }, req, c);
    });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/holidays',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const b = holidaySchema.parse(req.body);
    const row = await tx(async (c) => {
      const r = await one('INSERT INTO holidays (date, name) VALUES ($1,$2) RETURNING id, date, name', [b.date, b.name], c);
      await audit({ action: 'HOLIDAY_CREATE', entityType: 'holiday', entityId: r.id, summary: `Added holiday ${b.name} on ${b.date}`, newValue: r }, req, c);
      return r;
    });
    res.status(201).json(row);
  }),
);

adminRouter.delete(
  '/holidays/:id',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await tx(async (c) => {
      const r = await one('DELETE FROM holidays WHERE id = $1 RETURNING id, date, name', [id], c);
      if (!r) throw notFound('Holiday');
      await audit({ action: 'HOLIDAY_DELETE', entityType: 'holiday', entityId: id, summary: `Removed holiday ${r.name} (${r.date})`, oldValue: r }, req, c);
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ audit logs
adminRouter.get(
  '/audit-logs',
  requirePerm('audit.read'),
  ah(async (req, res) => {
    const f = z
      .object({
        q: z.string().trim().max(100).optional(),
        action: z.string().max(60).optional(),
        entityType: z.string().max(40).optional(),
        entityId: z.string().max(80).optional(),
        userId: uuid.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const { system } = await loadSettings();
    const p = new Params();
    const where = ['TRUE'];
    if (f.action) where.push(`l.action = ${p.add(f.action)}`);
    if (f.entityType) where.push(`l.entity_type = ${p.add(f.entityType)}`);
    if (f.entityId) where.push(`l.entity_id = ${p.add(f.entityId)}`);
    if (f.userId) where.push(`l.user_id = ${p.add(f.userId)}`);
    if (f.from) where.push(`l.created_at >= (${p.add(f.from)}::date::timestamp AT TIME ZONE ${p.add(system.timezone)})`);
    if (f.to) where.push(`l.created_at < ((${p.add(f.to)}::date + 1)::timestamp AT TIME ZONE ${p.add(system.timezone)})`);
    if (f.q) {
      const q = p.add(likePattern(f.q));
      where.push(`(l.summary ILIKE ${q} OR l.user_name ILIKE ${q} OR l.reason ILIKE ${q} OR l.entity_id ILIKE ${q})`);
    }
    const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs l WHERE ${where.join(' AND ')}`, p.values);
    const rows = await query(
      `SELECT l.id, l.created_at AS "createdAt", l.user_id AS "userId", l.user_name AS "userName", l.action, l.entity_type AS "entityType",
              l.entity_id AS "entityId", l.summary, l.old_value AS "oldValue", l.new_value AS "newValue", l.reason, host(l.ip) AS ip, l.user_agent AS "userAgent"
       FROM audit_logs l WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT ${p.add(f.pageSize)} OFFSET ${p.add((f.page - 1) * f.pageSize)}`,
      p.values,
    );
    res.json({ total: total!.n, page: f.page, pageSize: f.pageSize, rows });
  }),
);

adminRouter.get(
  '/audit-logs/actions',
  requirePerm('audit.read'),
  ah(async (_req, res) => {
    res.json((await query('SELECT DISTINCT action FROM audit_logs ORDER BY action')).map((r: any) => r.action));
  }),
);
