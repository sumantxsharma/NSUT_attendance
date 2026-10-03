import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { REPORT_TYPES } from '@nsut/shared';
import { pool } from '../src/db/pool';
import { ADMIN, app, COORD_SPORTS, login, OFFICER, reseed } from './helpers';

const TZ = 'Asia/Kolkata';
let seeded: Awaited<ReturnType<typeof reseed>>;
// Next Monday..Wednesday (always working days for both types, never today)
const nextMon = DateTime.now().setZone(TZ).plus({ weeks: 1 }).startOf('week');
const MON = nextMon.toISODate()!;
const WED = nextMon.plus({ days: 2 }).toISODate()!;

beforeAll(async () => {
  seeded = await reseed();
  await pool.query(`DELETE FROM holidays WHERE date BETWEEN $1 AND $2`, [MON, WED]);
});

describe('leave workflow', () => {
  let leaveId: string;
  it('staff submit leave; overlapping requests are rejected', async () => {
    const s = await login('coach07.neha@demo.invalid');
    const r = await s.agent.post('/api/leave').set('X-CSRF-Token', s.csrf).field('fromDate', MON).field('toDate', WED).field('leaveType', 'CASUAL').field('reason', 'Family function out of town');
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING');
    expect(r.body.days).toBe(3);
    leaveId = r.body.id;
    const overlap = await s.agent.post('/api/leave').set('X-CSRF-Token', s.csrf).field('fromDate', WED).field('toDate', WED).field('leaveType', 'PERSONAL').field('reason', 'Another request');
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.message).toMatch(/overlaps/);
    const backwards = await s.agent.post('/api/leave').set('X-CSRF-Token', s.csrf).field('fromDate', WED).field('toDate', MON).field('leaveType', 'PERSONAL').field('reason', 'Backwards dates');
    expect(backwards.status).toBe(400);
    // Reviewers were notified
    const n = await pool.query(`SELECT count(*)::int n FROM notifications WHERE type = 'LEAVE_SUBMITTED' AND body LIKE '%3 days%'`);
    expect(n.rows[0].n).toBeGreaterThan(0);
  });

  it('rejects disguised uploads by content, not extension', async () => {
    const s = await login('coach07.neha@demo.invalid');
    const r = await s.agent
      .post('/api/leave')
      .set('X-CSRF-Token', s.csrf)
      .field('fromDate', nextMon.plus({ days: 7 }).toISODate()!)
      .field('toDate', nextMon.plus({ days: 7 }).toISODate()!)
      .field('leaveType', 'MEDICAL')
      .field('reason', 'Medical appointment')
      .attach('document', Buffer.from('<script>alert(1)</script>'), { filename: 'cert.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Unsupported file/);
  });

  it('only reviewers in scope can approve; rejection needs remarks', async () => {
    const staff = await login('coach07.neha@demo.invalid');
    expect((await staff.patch(`/api/leave/${leaveId}/approve`)).status).toBe(403);
    const coordCse = await login('coordinator.cse@demo.invalid');
    expect((await coordCse.patch(`/api/leave/${leaveId}/approve`)).status).toBe(404);
    const coord = await login(COORD_SPORTS);
    expect((await coord.patch(`/api/leave/${leaveId}/reject`, { remarks: '' })).status).toBe(400);
  });

  it('approval reflects in attendance; cancellation reverts it', async () => {
    const coord = await login(COORD_SPORTS);
    const r = await coord.patch(`/api/leave/${leaveId}/approve`, { remarks: 'Approved' });
    expect(r.status).toBe(200);
    expect(r.body.leave.status).toBe('APPROVED');
    expect(r.body.sync.applied).toEqual([MON, nextMon.plus({ days: 1 }).toISODate(), WED]);
    const personId = (await pool.query(`SELECT person_id FROM users WHERE email = 'coach07.neha@demo.invalid'`)).rows[0].person_id;
    const att = await pool.query(`SELECT date, status, marking_method FROM attendance WHERE person_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`, [personId, MON, WED]);
    expect(att.rows.map((x) => x.status)).toEqual(['LEAVE', 'LEAVE', 'LEAVE']);
    expect(att.rows.every((x) => x.marking_method === 'LEAVE_SYNC')).toBe(true);
    expect((await coord.patch(`/api/leave/${leaveId}/approve`)).status).toBe(409);
    const note = await pool.query(`SELECT count(*)::int n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'coach07.neha@demo.invalid' AND n.type = 'LEAVE_APPROVED'`);
    expect(note.rows[0].n).toBe(1);
    // Staff cannot cancel an approved leave; reviewers can, and attendance is reverted
    const staff = await login('coach07.neha@demo.invalid');
    expect((await staff.patch(`/api/leave/${leaveId}/cancel`)).status).toBe(403);
    expect((await coord.patch(`/api/leave/${leaveId}/cancel`, { remarks: 'Event postponed' })).status).toBe(200);
    const after = await pool.query(`SELECT count(*)::int n FROM attendance WHERE person_id = $1 AND date BETWEEN $2 AND $3`, [personId, MON, WED]);
    expect(after.rows[0].n).toBe(0);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [leaveId]);
    expect(audit.rows.map((x) => x.action)).toEqual(['LEAVE_SUBMIT', 'LEAVE_APPROVE', 'LEAVE_CANCEL']);
  });

  it('does not overwrite a day the person actually attended', async () => {
    const admin = await login(ADMIN);
    const p = seeded.people[2];
    const presentDay = (await pool.query(`SELECT date FROM attendance WHERE person_id = $1 AND status = 'PRESENT' AND date < now()::date ORDER BY date DESC LIMIT 1`, [p.id])).rows[0].date;
    const lr = await admin.agent.post('/api/leave').set('X-CSRF-Token', admin.csrf).field('personId', p.id).field('fromDate', presentDay).field('toDate', presentDay).field('leaveType', 'DUTY').field('reason', 'Retroactive duty leave');
    expect(lr.status).toBe(201);
    const ap = await admin.patch(`/api/leave/${lr.body.id}/approve`);
    expect(ap.body.sync.applied).toEqual([]);
    expect(ap.body.sync.skipped[0].reason).toMatch(/already recorded/);
  });
});

describe('people management', () => {
  it('creates a person with a login, rejects duplicates, edits and deactivates', async () => {
    const admin = await login(ADMIN);
    const dept = (await admin.get('/api/departments')).body.find((d: any) => d.code === 'ME');
    const body = { refId: 'TEST-GF-900', fullName: 'Test Person Demo', type: 'GUEST_FACULTY', departmentId: dept.id, email: 'test.person@demo.invalid', createLogin: true, initialPassword: 'Welcome2026x' };
    const r = await admin.post('/api/people', body);
    expect(r.status).toBe(201);
    expect((await admin.post('/api/people', body)).status).toBe(409);
    expect((await admin.post('/api/people', { ...body, refId: 'TEST-GF-901', departmentId: null })).status).toBe(400);
    const edit = await admin.patch(`/api/people/${r.body.id}`, { ...body, fullName: 'Test Person Edited', designation: 'Visiting Lecturer' });
    expect(edit.status).toBe(200);
    const staff = await login('test.person@demo.invalid', 'Welcome2026x');
    expect((await staff.get('/api/attendance/me/today')).body.person.fullName).toBe('Test Person Edited');
    expect((await admin.post(`/api/people/${r.body.id}/deactivate`, { reason: 'Contract completed' })).status).toBe(200);
    expect((await staff.get('/api/attendance/me/today')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'test.person@demo.invalid', password: 'Welcome2026x' })).status).toBe(403);
    const daily = await admin.get('/api/attendance/today');
    expect(daily.body.rows.some((x: any) => x.person.id === r.body.id)).toBe(false);
    const actions = (await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [r.body.id])).rows.map((x) => x.action);
    expect(actions).toEqual(['PERSON_CREATE', 'PERSON_UPDATE', 'PERSON_DEACTIVATE']);
  });

  it('officers can view but not edit people', async () => {
    const s = await login(OFFICER);
    expect((await s.get('/api/people?type=SPORTS_COACH')).body.total).toBe(10);
    expect((await s.post('/api/people', {})).status).toBe(403);
  });

  it('searches across name, reference ID, department and sport', async () => {
    const s = await login(ADMIN);
    expect((await s.get('/api/search?q=DEMO-SC-003')).body[0].refId).toBe('DEMO-SC-003');
    expect((await s.get('/api/search?q=Badminton')).body.length).toBe(2);
    expect((await s.get('/api/people?q=mechanical')).body.total).toBe(3);
    // SQL wildcards in input are treated literally
    expect((await s.get('/api/people?q=%25')).body.total).toBe(0);
  });
});

describe('reports and exports', () => {
  it('generates every report type', async () => {
    const s = await login(OFFICER);
    for (const t of REPORT_TYPES) {
      const q = t === 'individual' ? `?personId=${seeded.people[0].id}` : '';
      const r = await s.get(`/api/reports/${t}${q}`);
      expect(r.status, t).toBe(200);
      expect(r.body.meta.university).toMatch(/Netaji Subhas/);
      expect(r.body.meta.generatedBy).toMatch(/Officer/);
      expect(Array.isArray(r.body.rows)).toBe(true);
    }
    expect((await s.get('/api/reports/individual')).status).toBe(400);
  });

  it('exports CSV, XLSX and PDF with correct types and guards formula injection', async () => {
    const s = await login(ADMIN);
    await pool.query(`UPDATE attendance SET remarks = '=HYPERLINK("http://x")' WHERE date = (now() at time zone 'Asia/Kolkata')::date AND status = 'ABSENT'`);
    const csv = await s.get('/api/reports/daily?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    const xlsx = await s.get('/api/reports/monthly?format=xlsx').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await s.get('/api/reports/monthly?format=pdf').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const a = await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'REPORT_EXPORT'`);
    expect(a.rows[0].n).toBe(3);
  });

  it('scopes coordinator reports', async () => {
    const s = await login(COORD_SPORTS);
    const r = await s.get('/api/reports/daily');
    expect(r.body.rows.length).toBe(10);
    expect(r.body.rows.every((x: any) => x.type === 'Sports Coach')).toBe(true);
  });
});

describe('settings and audit', () => {
  it('validates attendance rules and records configuration changes', async () => {
    const s = await login(ADMIN);
    const { rules } = (await s.get('/api/settings')).body;
    const bad = await s.put('/api/settings/rules', { ...rules, byType: { ...rules.byType, GUEST_FACULTY: { ...rules.byType.GUEST_FACULTY, officeEnd: '08:00' } } });
    expect(bad.status).toBe(400);
    const ok = await s.put('/api/settings/rules', { ...rules, byType: { ...rules.byType, GUEST_FACULTY: { ...rules.byType.GUEST_FACULTY, graceMinutes: 10 } } });
    expect(ok.status).toBe(200);
    const log = await s.get('/api/audit-logs?action=SETTINGS_RULES_UPDATE');
    expect(log.body.rows[0].oldValue.byType.GUEST_FACULTY.graceMinutes).toBe(15);
    expect(log.body.rows[0].newValue.byType.GUEST_FACULTY.graceMinutes).toBe(10);
    await s.put('/api/settings/rules', rules);
    expect((await s.put('/api/settings/system', { universityName: 'X', unitName: '', timezone: 'Mars/Olympus', dateFormat: 'dd MMM yyyy', reportFooter: '', leaveMaxDaysPerRequest: 30, leaveAllowBackdatedDays: 7 })).status).toBe(400);
  });

  it('does not leak internal errors', async () => {
    const s = await login(ADMIN);
    const r = await s.get('/api/people/not-a-uuid');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at .*\.ts|pg|syntax/i);
  });
});
