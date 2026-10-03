import request from 'supertest';
import { createApp } from '../src/app';
import { seed } from '../src/db/seed';
import { invalidateSettings } from '../src/lib/settings';

export const app = createApp();
export const PW = 'Demo@12345';

export async function reseed() {
  invalidateSettings();
  return seed({ log: false });
}

/** Log in and return an agent that keeps cookies + a helper that adds the CSRF header. */
export async function login(email: string, password = PW) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf: string = res.body.csrfToken;
  const withCsrf = (r: request.Test) => r.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    user: res.body.user,
    get: (url: string) => agent.get(url),
    post: (url: string, body: object = {}) => withCsrf(agent.post(url)).send(body),
    patch: (url: string, body: object = {}) => withCsrf(agent.patch(url)).send(body),
    put: (url: string, body: object = {}) => withCsrf(agent.put(url)).send(body),
    del: (url: string, body: object = {}) => withCsrf(agent.delete(url)).send(body),
  };
}

export const ADMIN = 'superadmin@demo.invalid';
export const OFFICER = 'officer@demo.invalid';
export const COORD_CSE = 'coordinator.cse@demo.invalid';
export const COORD_SPORTS = 'coordinator.sports@demo.invalid';
// Seed scenario for "today": index 11 (Ananya, HSS) and coach index 3 (Deepak) are NOT MARKED,
// index 6 (Sanjay) is on approved leave, index 5 (Farhan) is marked ABSENT.
export const NOT_MARKED_GF = 'gf12.ananya@demo.invalid';
export const NOT_MARKED_COACH = 'coach04.deepak@demo.invalid';
export const ON_LEAVE_GF = 'gf07.sanjay@demo.invalid';
export const ABSENT_GF = 'gf06.farhan@demo.invalid';
export const PRESENT_GF = 'gf01.kavya@demo.invalid';
