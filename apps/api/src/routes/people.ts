import fs from 'node:fs';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { activitySchema, createPersonSchema, departmentSchema, personSchema, PERSON_TYPES, RECORD_STATUSES, uuid } from '@nsut/shared';
import { one, query, tx } from '../db/pool';
import { audit } from '../lib/audit';
import { ah, badRequest, notFound } from '../lib/errors';
import { assertPersonVisible, peopleScopeSql } from '../lib/scope';
import { likePattern, Params } from '../lib/sql';
import { MIME_BY_EXT, memoryUpload, resolveUpload, saveValidatedFile } from '../lib/upload';
import { requirePerm } from '../middleware/auth';
import { PERSON_JOINS, PERSON_SELECT, serializePerson, type PersonLite } from '../services/attendance';
import { BCRYPT_ROUNDS } from './auth';

export const peopleRouter = Router();

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(PERSON_TYPES).optional(),
  departmentId: uuid.optional(),
  activityId: uuid.optional(),
  status: z.enum([...RECORD_STATUSES, 'ALL'] as const).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  sort: z.enum(['name', 'refId', 'joining', 'contractEnd']).optional().default('name'),
});

peopleRouter.get(
  '/',
  requirePerm('people.read'),
  ah(async (req, res) => {
    const f = listQuery.parse(req.query);
    const p = new Params();
    const where = ['p.deleted_at IS NULL', peopleScopeSql(req, p)];
    if (f.type) where.push(`p.type = ${p.add(f.type)}`);
    if (f.departmentId) where.push(`p.department_id = ${p.add(f.departmentId)}`);
    if (f.activityId) where.push(`p.activity_id = ${p.add(f.activityId)}`);
    if (f.status !== 'ALL') where.push(`p.status = ${p.add(f.status ?? 'ACTIVE')}`);
    if (f.q) {
      const q = p.add(likePattern(f.q));
      where.push(`(p.full_name ILIKE ${q} OR p.ref_id ILIKE ${q} OR d.name ILIKE ${q} OR d.code ILIKE ${q} OR a.name ILIKE ${q} OR p.designation ILIKE ${q} OR p.specialization ILIKE ${q})`);
    }
    const order = { name: 'p.full_name', refId: 'p.ref_id', joining: 'p.joining_date DESC NULLS LAST', contractEnd: 'p.contract_end NULLS LAST' }[f.sort];
    const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM people p ${PERSON_JOINS} WHERE ${where.join(' AND ')}`, p.values);
    const rows = await query<PersonLite & { specialization: string; email: string; phone: string; has_login: boolean }>(
      `SELECT ${PERSON_SELECT}, p.specialization, p.email, p.phone, EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id AND u.deleted_at IS NULL) AS has_login
       FROM people p ${PERSON_JOINS} WHERE ${where.join(' AND ')} ORDER BY ${order}, p.id LIMIT ${p.add(f.pageSize)} OFFSET ${p.add((f.page - 1) * f.pageSize)}`,
      p.values,
    );
    res.json({
      total: total!.n,
      page: f.page,
      pageSize: f.pageSize,
      rows: rows.map((r) => ({ ...serializePerson(r), specialization: r.specialization, email: r.email, phone: r.phone, hasLogin: r.has_login })),
    });
  }),
);

peopleRouter.get(
  '/:id',
  requirePerm('people.read', 'attendance.self'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await assertPersonVisible(req, id);
    const row = await one(
      `SELECT ${PERSON_SELECT}, p.specialization, p.email, p.phone, p.created_at, p.updated_at,
         (SELECT json_build_object('id', u.id, 'email', u.email, 'status', u.status, 'lastLogin', u.last_login) FROM users u WHERE u.person_id = p.id AND u.deleted_at IS NULL) AS login
       FROM people p ${PERSON_JOINS} WHERE p.id = $1`,
      [id],
    );
    if (!row) throw notFound('Person');
    res.json({ ...serializePerson(row), specialization: row.specialization, email: row.email, phone: row.phone, createdAt: row.created_at, updatedAt: row.updated_at, login: row.login });
  }),
);

function personValues(b: z.infer<typeof personSchema>) {
  return [
    b.refId,
    b.fullName,
    b.type,
    b.type === 'GUEST_FACULTY' ? b.departmentId : (b.departmentId ?? null),
    b.type === 'SPORTS_COACH' ? b.activityId : (b.activityId ?? null),
    b.designation ?? null,
    b.specialization ?? null,
    b.email ?? null,
    b.phone ?? null,
    b.joiningDate ?? null,
    b.contractStart ?? null,
    b.contractEnd ?? null,
    b.assignedHours ?? null,
  ];
}

peopleRouter.post(
  '/',
  requirePerm('people.write'),
  ah(async (req, res) => {
    const b = createPersonSchema.parse(req.body);
    if (b.createLogin && !b.email) throw badRequest('An email address is required to create a login account.');
    if (b.createLogin && !b.initialPassword) throw badRequest('An initial password is required to create a login account.');
    const out = await tx(async (c) => {
      const row = await one(
        `INSERT INTO people (ref_id, full_name, type, department_id, activity_id, designation, specialization, email, phone, joining_date, contract_start, contract_end, assigned_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        personValues(b),
        c,
      );
      await audit({ action: 'PERSON_CREATE', entityType: 'person', entityId: row.id, summary: `Created ${b.fullName} (${b.refId})`, newValue: row }, req, c);
      let userId: string | null = null;
      if (b.createLogin) {
        const hash = await bcrypt.hash(b.initialPassword!, BCRYPT_ROUNDS);
        const u = await one(`INSERT INTO users (name, email, phone, password_hash, role, person_id) VALUES ($1,$2,$3,$4,'STAFF',$5) RETURNING id, email, role`, [b.fullName, b.email, b.phone ?? null, hash, row.id], c);
        userId = u.id;
        await audit({ action: 'USER_CREATE', entityType: 'user', entityId: u.id, summary: `Created staff login for ${b.fullName}`, newValue: u }, req, c);
      }
      return { id: row.id, userId };
    });
    res.status(201).json(out);
  }),
);

peopleRouter.patch(
  '/:id',
  requirePerm('people.write'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = personSchema.parse(req.body);
    await tx(async (c) => {
      const before = await one('SELECT * FROM people WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id], c);
      if (!before) throw notFound('Person');
      const after = await one(
        `UPDATE people SET ref_id=$1, full_name=$2, type=$3, department_id=$4, activity_id=$5, designation=$6, specialization=$7, email=$8, phone=$9,
           joining_date=$10, contract_start=$11, contract_end=$12, assigned_hours=$13 WHERE id=$14 RETURNING *`,
        [...personValues(b), id],
        c,
      );
      await audit({ action: 'PERSON_UPDATE', entityType: 'person', entityId: id, summary: `Updated ${after.full_name}`, oldValue: before, newValue: after }, req, c);
    });
    res.json({ ok: true });
  }),
);

peopleRouter.post(
  '/:id/:action(deactivate|activate)',
  requirePerm('people.write'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const activate = req.params.action === 'activate';
    const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    await tx(async (c) => {
      const before = await one('SELECT id, full_name, status FROM people WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id], c);
      if (!before) throw notFound('Person');
      const status = activate ? 'ACTIVE' : 'INACTIVE';
      if (before.status === status) throw badRequest(`This profile is already ${status.toLowerCase()}.`);
      await c.query('UPDATE people SET status = $2 WHERE id = $1', [id, status]);
      // Deactivating a person also disables their login and ends their sessions.
      if (!activate) {
        await c.query(`UPDATE users SET status = 'INACTIVE' WHERE person_id = $1`, [id]);
        await c.query(`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE person_id = $1)`, [id]);
      } else {
        await c.query(`UPDATE users SET status = 'ACTIVE' WHERE person_id = $1`, [id]);
      }
      await audit(
        {
          action: activate ? 'PERSON_ACTIVATE' : 'PERSON_DEACTIVATE',
          entityType: 'person',
          entityId: id,
          summary: `${activate ? 'Reactivated' : 'Deactivated'} ${before.full_name}`,
          oldValue: { status: before.status },
          newValue: { status },
          reason: reason ?? null,
        },
        req,
        c,
      );
    });
    res.json({ ok: true });
  }),
);

peopleRouter.post(
  '/:id/photo',
  requirePerm('people.write'),
  memoryUpload(2).single('photo'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const saved = saveValidatedFile(req.file, ['image/png', 'image/jpeg'], 'photos');
    if (!saved) throw badRequest('Choose a photo to upload.');
    const before = await one('SELECT photo_path, full_name FROM people WHERE id = $1', [id]);
    if (!before) throw notFound('Person');
    await tx(async (c) => {
      await c.query('UPDATE people SET photo_path = $2 WHERE id = $1', [id, saved.path]);
      await audit({ action: 'PERSON_UPDATE', entityType: 'person', entityId: id, summary: `Updated photograph of ${before.full_name}`, oldValue: { photo: before.photo_path }, newValue: { photo: saved.path } }, req, c);
    });
    res.json({ ok: true });
  }),
);

peopleRouter.get(
  '/:id/photo',
  requirePerm('people.read', 'attendance.self'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await assertPersonVisible(req, id);
    const row = await one<{ photo_path: string | null }>('SELECT photo_path FROM people WHERE id = $1', [id]);
    if (!row?.photo_path) throw notFound('Photo');
    const full = resolveUpload(row.photo_path);
    if (!fs.existsSync(full)) throw notFound('Photo');
    res.setHeader('Content-Type', MIME_BY_EXT[full.split('.').pop()!] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(full).pipe(res);
  }),
);

// ------------------------------------------------------------------ departments & activities
export const orgRouter = Router();

orgRouter.get(
  '/departments',
  ah(async (req, res) => {
    const all = req.query.all === 'true';
    res.json(
      await query(
        `SELECT d.id, d.name, d.code, d.status,
          (SELECT count(*)::int FROM people p WHERE p.department_id = d.id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL) AS "activePeople"
         FROM departments d ${all ? '' : "WHERE d.status = 'ACTIVE'"} ORDER BY d.name`,
      ),
    );
  }),
);

orgRouter.post(
  '/departments',
  requirePerm('org.manage'),
  ah(async (req, res) => {
    const b = departmentSchema.parse(req.body);
    const row = await tx(async (c) => {
      const r = await one('INSERT INTO departments (name, code, status) VALUES ($1,$2,$3) RETURNING *', [b.name, b.code, b.status ?? 'ACTIVE'], c);
      await audit({ action: 'DEPARTMENT_CREATE', entityType: 'department', entityId: r.id, summary: `Created department ${b.name}`, newValue: r }, req, c);
      return r;
    });
    res.status(201).json(row);
  }),
);

orgRouter.patch(
  '/departments/:id',
  requirePerm('org.manage'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = departmentSchema.parse(req.body);
    const row = await tx(async (c) => {
      const before = await one('SELECT * FROM departments WHERE id = $1 FOR UPDATE', [id], c);
      if (!before) throw notFound('Department');
      const r = await one('UPDATE departments SET name=$2, code=$3, status=$4 WHERE id=$1 RETURNING *', [id, b.name, b.code, b.status ?? before.status], c);
      await audit({ action: 'DEPARTMENT_UPDATE', entityType: 'department', entityId: id, summary: `Updated department ${b.name}`, oldValue: before, newValue: r }, req, c);
      return r;
    });
    res.json(row);
  }),
);

orgRouter.get(
  '/activities',
  ah(async (req, res) => {
    const all = req.query.all === 'true';
    res.json(
      await query(
        `SELECT a.id, a.name, a.category, a.status, a.department_id AS "departmentId", d.name AS "departmentName",
          (SELECT count(*)::int FROM people p WHERE p.activity_id = a.id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL) AS "activePeople"
         FROM activities a LEFT JOIN departments d ON d.id = a.department_id ${all ? '' : "WHERE a.status = 'ACTIVE'"} ORDER BY a.category, a.name`,
      ),
    );
  }),
);

orgRouter.post(
  '/activities',
  requirePerm('org.manage'),
  ah(async (req, res) => {
    const b = activitySchema.parse(req.body);
    const row = await tx(async (c) => {
      const r = await one('INSERT INTO activities (name, category, department_id, status) VALUES ($1,$2,$3,$4) RETURNING *', [b.name, b.category, b.departmentId ?? null, b.status ?? 'ACTIVE'], c);
      await audit({ action: 'ACTIVITY_CREATE', entityType: 'activity', entityId: r.id, summary: `Created activity ${b.name}`, newValue: r }, req, c);
      return r;
    });
    res.status(201).json(row);
  }),
);

orgRouter.patch(
  '/activities/:id',
  requirePerm('org.manage'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = activitySchema.parse(req.body);
    const row = await tx(async (c) => {
      const before = await one('SELECT * FROM activities WHERE id = $1 FOR UPDATE', [id], c);
      if (!before) throw notFound('Activity');
      const r = await one('UPDATE activities SET name=$2, category=$3, department_id=$4, status=$5 WHERE id=$1 RETURNING *', [id, b.name, b.category, b.departmentId ?? null, b.status ?? before.status], c);
      await audit({ action: 'ACTIVITY_UPDATE', entityType: 'activity', entityId: id, summary: `Updated activity ${b.name}`, oldValue: before, newValue: r }, req, c);
      return r;
    });
    res.json(row);
  }),
);
