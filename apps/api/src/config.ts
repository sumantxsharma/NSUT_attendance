import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: the nearest ancestor containing database/migrations (works from src/, dist/ and dist/db/). */
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'database', 'migrations'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(start, '..', '..', '..');
}
export const ROOT_DIR = process.env.APP_ROOT ?? findRoot(here);

// Load <repo>/.env for local runs. Real environment variables always win (loadEnvFile never overrides).
// Skipped under tests so a developer's .env can never point the destructive test suite at a real database.
if (process.env.NODE_ENV !== 'test') {
  const envFile = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* malformed .env: fall back to process environment */
    }
  }
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const env = process.env.NODE_ENV ?? 'development';
const isProd = env === 'production';

export const config = {
  env,
  isProd,
  isTest: env === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required(
    'DATABASE_URL',
    env === 'test'
      ? 'postgres://postgres:postgres@localhost:5432/nsut_attendance_test'
      : isProd
        ? undefined
        : 'postgres://postgres:postgres@localhost:5432/nsut_attendance',
  ),
  /** Used to sign nothing secret-critical today, but required so prod deployments set one. */
  sessionSecret: required('SESSION_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 8),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 60),
  cookieSecure: (process.env.COOKIE_SECURE ?? (isProd ? 'true' : 'false')) === 'true',
  trustProxy: process.env.TRUST_PROXY ?? (isProd ? '1' : 'false'),
  webDistDir: process.env.WEB_DIST_DIR ?? path.join(ROOT_DIR, 'apps', 'web', 'dist'),
  migrationsDir: process.env.MIGRATIONS_DIR ?? path.join(ROOT_DIR, 'database', 'migrations'),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:5173',
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES ?? 15),
  /** Record client IP / user-agent against attendance + audit entries (documented in SECURITY.md). */
  recordClientMeta: (process.env.RECORD_CLIENT_META ?? 'true') === 'true',
  /** Show demo-account hints on the sign-in page. Off in production unless explicitly enabled. */
  demoMode: process.env.DEMO_MODE ? process.env.DEMO_MODE === 'true' : !isProd,
  logLevel: process.env.LOG_LEVEL ?? (env === 'test' ? 'silent' : 'info'),
};
