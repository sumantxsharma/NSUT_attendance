import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4100);
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nsut_attendance_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Fresh database per run: reset schema, seed demo data, start the API which also serves the built web app.
  webServer: {
    command: 'npm run build -w @nsut/web && npx tsx apps/api/src/db/migrate.ts --reset && npx tsx apps/api/src/db/seed.ts && npx tsx apps/api/src/server.ts',
    cwd: '..',
    url: `http://localhost:${PORT}/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: DB, PORT: String(PORT), LOG_LEVEL: 'warn', NODE_ENV: 'development', APP_BASE_URL: `http://localhost:${PORT}` },
  },
});
