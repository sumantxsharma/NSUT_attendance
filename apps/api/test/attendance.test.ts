import { beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { pool } from '../src/db/pool';
import { ABSENT_GF, ADMIN, login, NOT_MARKED_COACH, NOT_MARKED_GF, OFFICER, ON_LEAVE_GF, reseed } from './helpers';

const TZ = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(TZ).toISODate()!;
let seeded: Awaited<ReturnType<typeof reseed>>;

beforeAll(async () => {
  seeded = await reseed();
});

describe('dashboard is calculated from the database', () => {
  it('matches the seeded scenario for today', async () => {
    const s = await login(ADMIN);
    const r = await s.get('/api/dashboard');
    expect(r.status).toBe(200);
    expect(r.body.counts).toMatchObject({ total: 25, guestFaculty: 15, sportsCoaches: 10, present: 19, absent: 2, onLeave: 2, notMarked: 2 });
    expect(r.body.percentages.month.overall).toBeGreaterThan(50);
    expect(r.body.trend).toHaveLength(30);
    // Counts change when data changes — nothing is hard-coded
    await pool.query(`DELETE FROM attendance WHERE date = $1 AND status = 'ABSENT'`, [today()]);
    const r2 = await s.get('/api/dashboard');
    expect(r2.body.counts.absent).toBe(0);
    expect(r2.body.counts.notMarked).toBe(4);
    seeded = await reseed();
  });
});

describe('self check-in / check-out', () => {
  it('checks in once, blocks duplicates, checks out with duration', async () => {
    const s = await login(NOT_MARKED_GF);
    const before = await s.get('/api/attendance/me/today');
    expect(before.body.canCheckIn).toBe(true);
    const ci = await s.post('/api/attendance/check-in');
    expect(ci.status).toBe(201);
    expect(ci.body.message).toBe('Attendance marked successfully');
    expect(ci.body.record.checkInAt).toBeTruthy();
    const dup = await s.post('/api/attendance/check-in');
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('Attendance has already been marked for today.');
    const co = await s.post('/api/attendance/check-out');
    expect(co.status).toBe(200);
    expect(co.body.record.durationMinutes).toBeGreaterThanOrEqual(0);
    // Duration < half-day minimum -> auto-classified ABSENT under default rules
    expect(co.body.record.status).toBe('ABSENT');
    expect((await s.post('/api/attendance/check-out')).status).toBe(409);
    const again = await s.post('/api/attendance/check-in');
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already checked out/);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [ci.body.record.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['ATTENDANCE_CHECK_IN', 'ATTENDANCE_CHECK_OUT']);
  });

  it('handles concurrent double-clicks safely', async () => {
    const s = await login(NOT_MARKED_COACH);
    const results = await Promise.all([s.post('/api/attendance/check-in'), s.post('/api/attendance/check-in'), s.post('/api/attendance/check-in')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const rows = await pool.query(`SELECT count(*)::int n FROM attendance WHERE person_id = $1 AND date = $2`, [s.user.personId, today()]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('refuses check-out before check-in', async () => {
    await pool.query(`DELETE FROM attendance WHERE date = $1 AND person_id = (SELECT person_id FROM users WHERE email = $2)`, [today(), NOT_MARKED_COACH]);
    const s = await login(NOT_MARKED_COACH);
    const r = await s.post('/api/attendance/check-out');
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('You cannot check out before checking in.');
  });

  it('refuses check-in on approved leave and when already marked by an officer', async () => {
    const leave = await login(ON_LEAVE_GF);
    const r = await leave.post('/api/attendance/check-in');
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/approved leave/);
    const absent = await login(ABSENT_GF);
    expect((await absent.post('/api/attendance/check-in')).status).toBe(409);
  });
});

describe('manual attendance and corrections', () => {
  it('marks attendance manually with validation and audit', async () => {
    const s = await login(OFFICER);
    const person = seeded.people[11];
    await pool.query(`DELETE FROM attendance WHERE person_id = $1 AND date = $2`, [person.id, today()]);
    const bad = await s.post('/api/attendance/manual', { personId: person.id, date: today(), status: 'PRESENT', checkIn: '10:00', checkOut: '09:00' });
    expect(bad.status).toBe(400);
    const noIn = await s.post('/api/attendance/manual', { personId: person.id, date: today(), status: 'PRESENT', checkOut: '09:00' });
    expect(noIn.status).toBe(400);
    const future = await s.post('/api/attendance/manual', { personId: person.id, date: DateTime.now().plus({ days: 2 }).toISODate(), status: 'PRESENT' });
    expect(future.status).toBe(400);
    const ok = await s.post('/api/attendance/manual', { personId: person.id, date: today(), status: 'ABSENT', remarks: 'Did not report' });
    expect(ok.status).toBe(201);
    const dup = await s.post('/api/attendance/manual', { personId: person.id, date: today(), status: 'PRESENT' });
    expect(dup.status).toBe(409);
    const a = await pool.query(`SELECT action, new_value FROM audit_logs WHERE entity_id = $1`, [ok.body.record.id]);
    expect(a.rows[0].action).toBe('ATTENDANCE_CREATE');
  });

  it('corrects a record, requires a reason, and records old and new values', async () => {
    const s = await login(OFFICER);
    const rec = (await pool.query(`SELECT a.id, a.version, a.date FROM attendance a WHERE a.check_out_at IS NOT NULL AND a.date < $1 ORDER BY a.date DESC LIMIT 1`, [today()])).rows[0];
    const noReason = await s.patch(`/api/attendance/${rec.id}`, { status: 'PRESENT', checkIn: '09:24', checkOut: '17:02', reason: '' });
    expect(noReason.status).toBe(400);
    const stale = await s.patch(`/api/attendance/${rec.id}`, { status: 'PRESENT', checkIn: '09:24', checkOut: '17:02', reason: 'Gate register check', version: rec.version + 5 });
    expect(stale.status).toBe(409);
    const r = await s.patch(`/api/attendance/${rec.id}`, { status: 'PRESENT', checkIn: '09:24', checkOut: '17:02', reason: 'Times verified against gate register', version: rec.version });
    expect(r.status).toBe(200);
    expect(r.body.pendingApproval).toBe(false);
    expect(r.body.record.durationMinutes).toBe(7 * 60 + 38);
    expect(r.body.record.isLate).toBe(true);
    const audit = (await pool.query(`SELECT old_value, new_value, reason FROM audit_logs WHERE entity_id = $1 AND action = 'ATTENDANCE_UPDATE' ORDER BY id DESC LIMIT 1`, [rec.id])).rows[0];
    expect(audit.reason).toBe('Times verified against gate register');
    expect(audit.old_value.checkInAt).not.toBe(audit.new_value.checkInAt);
    const corr = await s.get(`/api/attendance/corrections/list`);
    expect(corr.body.some((c: any) => c.attendanceId === rec.id && c.status === 'APPLIED')).toBe(true);
  });

  it('routes officer corrections to approval when the rule is enabled', async () => {
    const admin = await login(ADMIN);
    const rules = (await admin.get('/api/settings')).body.rules;
    expect((await admin.put('/api/settings/rules', { ...rules, manualCorrectionRequiresApproval: true })).status).toBe(200);
    const s = await login(OFFICER);
    const rec = (await pool.query(`SELECT id, status, check_in_at FROM attendance WHERE check_out_at IS NOT NULL AND date < $1 ORDER BY date ASC LIMIT 1`, [today()])).rows[0];
    const r = await s.patch(`/api/attendance/${rec.id}`, { status: 'HALF_DAY', checkIn: '09:00', checkOut: '13:00', reason: 'Left at lunch per register' });
    expect(r.body.pendingApproval).toBe(true);
    const unchanged = (await pool.query(`SELECT status FROM attendance WHERE id = $1`, [rec.id])).rows[0];
    expect(unchanged.status).toBe(rec.status);
    const approve = await admin.patch(`/api/attendance/corrections/${r.body.correctionId}/approve`);
    expect(approve.status).toBe(200);
    const changed = (await pool.query(`SELECT status, duration_minutes FROM attendance WHERE id = $1`, [rec.id])).rows[0];
    expect(changed).toEqual({ status: 'HALF_DAY', duration_minutes: 240 });
    expect((await admin.patch(`/api/attendance/corrections/${r.body.correctionId}/approve`)).status).toBe(409);
    await admin.put('/api/settings/rules', rules);
  });

  it('deletes only with a reason and super admin rights', async () => {
    const rec = (await pool.query(`SELECT id FROM attendance WHERE marking_method = 'SELF' AND date < $1 LIMIT 1`, [today()])).rows[0];
    const officer = await login(OFFICER);
    expect((await officer.del(`/api/attendance/${rec.id}`, { reason: 'Duplicate entry' })).status).toBe(403);
    const admin = await login(ADMIN);
    expect((await admin.del(`/api/attendance/${rec.id}`, { reason: '' })).status).toBe(400);
    expect((await admin.del(`/api/attendance/${rec.id}`, { reason: 'Entered for wrong person' })).status).toBe(200);
    const a = await pool.query(`SELECT old_value FROM audit_logs WHERE entity_id = $1 AND action = 'ATTENDANCE_DELETE'`, [rec.id]);
    expect(a.rows[0].old_value.id).toBe(rec.id);
  });
});

describe('monthly attendance and calendar', () => {
  it('returns monthly rows whose percentage is derived from counts', async () => {
    const s = await login(ADMIN);
    const now = DateTime.now().setZone(TZ);
    const prev = now.minus({ months: 1 });
    const r = await s.get(`/api/attendance/monthly?year=${prev.year}&month=${prev.month}`);
    expect(r.status).toBe(200);
    for (const row of r.body.rows) {
      if (row.eligibleDays === 0) continue;
      expect(row.percentage).toBeCloseTo(Math.round((row.credits / row.eligibleDays) * 1000) / 10, 5);
      expect(row.credits).toBeCloseTo(row.present + row.halfDays * 0.5, 5);
    }
    const filtered = await s.get(`/api/attendance/monthly?year=${prev.year}&month=${prev.month}&type=SPORTS_COACH`);
    expect(filtered.body.rows.every((x: any) => x.person.type === 'SPORTS_COACH')).toBe(true);
  });

  it('applies the configurable leave rule to percentages', async () => {
    const s = await login(ADMIN);
    const rules = (await s.get('/api/settings')).body.rules;
    const person = seeded.people[0]; // has approved leave early in the period
    const start = DateTime.now().setZone(TZ).minus({ months: 2 });
    const url = `/api/attendance/person/${person.id}?year=${start.year}&month=${start.month}`;
    const excluded = (await s.get(url)).body.summary;
    await s.put('/api/settings/rules', { ...rules, excludeLeaveFromDenominator: false, leaveCountsAsPresent: true });
    const asPresent = (await s.get(url)).body.summary;
    expect(excluded.leave).toBeGreaterThan(0);
    expect(asPresent.eligibleDays).toBe(excluded.eligibleDays + excluded.leave);
    expect(asPresent.credits).toBe(excluded.credits + excluded.leave);
    await s.put('/api/settings/rules', { ...rules, excludeLeaveFromDenominator: false, leaveCountsAsPresent: false });
    const asAbsent = (await s.get(url)).body.summary;
    expect(asAbsent.eligibleDays).toBe(excluded.eligibleDays + excluded.leave);
    expect(asAbsent.credits).toBe(excluded.credits);
    await s.put('/api/settings/rules', rules);
  });

  it('builds a calendar for every day of the month with holidays marked', async () => {
    const s = await login(ADMIN);
    const r = await s.get(`/api/attendance/person/${seeded.people[1].id}?year=2026&month=8`);
    expect(r.body.days).toHaveLength(31);
    const ind = r.body.days.find((d: any) => d.date === '2026-08-15');
    expect(ind.isHoliday).toBe(true);
    expect(ind.holidayName).toBe('Independence Day');
  });
});

describe('database constraints', () => {
  it('enforces one record per person per day and check-out after check-in', async () => {
    const p = seeded.people[2].id;
    const d = '2020-01-06';
    await pool.query(`INSERT INTO attendance (person_id, date, status, marking_method) VALUES ($1, $2, 'ABSENT', 'MANUAL')`, [p, d]);
    await expect(pool.query(`INSERT INTO attendance (person_id, date, status, marking_method) VALUES ($1, $2, 'ABSENT', 'MANUAL')`, [p, d])).rejects.toThrow(/attendance_person_date_uq/);
    await expect(
      pool.query(`INSERT INTO attendance (person_id, date, status, marking_method, check_out_at, duration_minutes) VALUES ($1, '2020-01-07', 'PRESENT', 'MANUAL', now(), 0)`, [p]),
    ).rejects.toThrow(/attendance_checkout_ck/);
    await expect(
      pool.query(`INSERT INTO attendance (person_id, date, status, marking_method, check_in_at, check_out_at, duration_minutes) VALUES ($1, '2020-01-08', 'PRESENT', 'MANUAL', now(), now() - interval '1 hour', 0)`, [p]),
    ).rejects.toThrow(/attendance_order_ck|attendance_duration_ck/);
  });

  it('keeps the audit log append-only', async () => {
    await expect(pool.query(`UPDATE audit_logs SET summary = 'tampered' WHERE id = (SELECT min(id) FROM audit_logs)`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_logs WHERE id = (SELECT min(id) FROM audit_logs)`)).rejects.toThrow(/append-only/);
  });
});
