import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { ADMIN, app, COORD_FIELD, login, OFFICER, PRESENT_GF, PW, reseed } from './helpers';

beforeAll(async () => {
  await reseed();
});

describe('health', () => {
  it('reports database status', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', database: 'ok' });
  });
});

describe('authentication', () => {
  it('logs in, returns permissions and never exposes the password hash', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: ADMIN, password: PW });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('SUPER_ADMIN');
    expect(r.body.user.permissions).toContain('audit.read');
    expect(JSON.stringify(r.body)).not.toMatch(/password_hash|\$2[aby]\$/);
    const cookies = String(r.headers['set-cookie']);
    expect(cookies).toMatch(/nsut_sid=.*HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Lax/i);
  });

  it('rejects bad credentials with a generic message', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: ADMIN, password: 'wrong-password-1' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('Invalid email or password.');
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@demo.invalid', password: 'whatever123' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe('Invalid email or password.');
  });

  it('validates input server-side', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
  });

  it('locks an account after repeated failures (brute-force protection)', async () => {
    const email = 'coach02.pooja@demo.invalid';
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email, password: 'bad-password-9' });
    const r = await request(app).post('/api/auth/login').send({ email, password: PW });
    expect(r.status).toBe(423);
    const a = await login(ADMIN);
    const u = (await a.get('/api/users?q=pooja')).body[0];
    expect(u.locked).toBe(true);
    expect((await a.post(`/api/users/${u.id}/unlock`)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email, password: PW })).status).toBe(200);
  });

  it('requires a session for protected routes', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
    expect((await request(app).get('/api/people')).status).toBe(401);
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const s = await login(OFFICER);
    const r = await s.agent.post('/api/attendance/manual').send({});
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/security token/);
  });

  it('logs out and invalidates the session', async () => {
    const s = await login(OFFICER);
    expect((await s.get('/api/auth/me')).status).toBe(200);
    expect((await s.post('/api/auth/logout')).status).toBe(200);
    expect((await s.get('/api/auth/me')).status).toBe(401);
  });

  it('expires idle sessions', async () => {
    const s = await login(OFFICER);
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '5 hours' WHERE user_id = $1`, [s.user.id]);
    expect((await s.get('/api/dashboard')).status).toBe(401);
  });

  it('resets a password with a single-use token and revokes sessions', async () => {
    const s = await login(PRESENT_GF);
    const f = await request(app).post('/api/auth/password/forgot').send({ email: PRESENT_GF });
    expect(f.status).toBe(200);
    const token = new URL(f.body.devResetUrl).searchParams.get('token')!;
    // Unknown emails get the same response (no account enumeration)
    const unk = await request(app).post('/api/auth/password/forgot').send({ email: 'ghost@demo.invalid' });
    expect(unk.body.message).toBe(f.body.message);
    expect((await request(app).post('/api/auth/password/reset').send({ token, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/password/reset').send({ token, password: 'NewPassw0rd2026' })).status).toBe(200);
    expect((await request(app).post('/api/auth/password/reset').send({ token, password: 'NewPassw0rd2027' })).status).toBe(400);
    expect((await s.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: PRESENT_GF, password: 'NewPassw0rd2026' })).status).toBe(200);
  });

  it('writes login and logout to the audit log', async () => {
    const { rows } = await pool.query(`SELECT action FROM audit_logs WHERE action IN ('AUTH_LOGIN','AUTH_LOGOUT','AUTH_LOGIN_FAILED')`);
    const actions = new Set(rows.map((r) => r.action));
    expect(actions).toEqual(new Set(['AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_LOGIN_FAILED']));
  });
});

describe('role-based access control', () => {
  it('blocks staff from administrative endpoints', async () => {
    const s = await login('coach01.rajesh@demo.invalid');
    for (const url of ['/api/dashboard', '/api/people', '/api/attendance/today', '/api/reports/daily', '/api/audit-logs', '/api/users']) {
      expect((await s.get(url)).status, url).toBe(403);
    }
  });

  it('blocks officers from system configuration and audit logs', async () => {
    const s = await login(OFFICER);
    expect((await s.get('/api/audit-logs')).status).toBe(403);
    expect((await s.put('/api/settings/rules', {})).status).toBe(403);
    expect((await s.get('/api/users')).status).toBe(403);
    expect((await s.get('/api/dashboard')).status).toBe(200);
  });

  it('limits coordinators to their assigned sports / activities', async () => {
    const s = await login(COORD_FIELD);
    const people = await s.get('/api/people?pageSize=200');
    expect(people.status).toBe(200);
    const units = new Set(people.body.rows.map((p: any) => p.activityName));
    expect([...units].sort()).toEqual(['Athletics', 'Football']);
    const other = await pool.query(`SELECT p.id FROM people p JOIN activities a ON a.id = p.activity_id WHERE a.name = 'Cricket' LIMIT 1`);
    expect((await s.get(`/api/people/${other.rows[0].id}`)).status).toBe(403);
    expect((await s.get(`/api/attendance/person/${other.rows[0].id}`)).status).toBe(403);
    const daily = await s.get('/api/attendance/today');
    expect(daily.body.rows.every((r: any) => ['Athletics', 'Football'].includes(r.person.activityName))).toBe(true);
    // Coordinators cannot mark attendance manually
    expect((await s.post('/api/attendance/manual', {})).status).toBe(403);
  });

  it('lets staff read only their own profile', async () => {
    const s = await login('coach01.rajesh@demo.invalid');
    expect((await s.get(`/api/people/${s.user.personId}`)).status).toBe(200);
    const other = await pool.query(`SELECT id FROM people WHERE id <> $1 LIMIT 1`, [s.user.personId]);
    expect((await s.get(`/api/people/${other.rows[0].id}`)).status).toBe(403);
  });
});
