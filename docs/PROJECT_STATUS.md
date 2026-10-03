# Project Status: R1

**Verdict: feature-complete and ready for an internal pilot with demo or real data. No critical acceptance item fails.** Before a production go-live, the items under *Required before production* must be done. They are institutional decisions and infrastructure tasks, not code defects.

## Verification summary

Last full run, from clean build outputs:

| Check | Result |
|---|---|
| ESLint (all workspaces, zero warnings allowed) | ✅ pass |
| TypeScript (shared, API, web) | ✅ pass |
| Unit tests: rule engine, dates, validation | ✅ 32 / 32 |
| Integration tests: API against PostgreSQL 16 | ✅ 42 / 42 |
| Production build (Vite + esbuild bundle) | ✅ pass |
| End-to-end tests: Playwright/Chromium, including axe accessibility and print | ✅ 19 / 19 (two consecutive runs of the workflow suite) |
| Production runtime simulated (clean `npm ci --omit=dev -w @nsut/api`, bundled server, entrypoint migrations, `NODE_ENV=production`) | ✅ health, login (Secure/HttpOnly cookies, HSTS, CSP), dashboard, PDF export; empty database + `create-admin` bootstrap; demo hints and dev reset links off |
| Backup → restore round-trip (`docker/backup.sh` → `pg_restore` into a new database) | ✅ 1,650 attendance rows restored |
| `docker compose config` | ✅ valid |
| `docker build` | ⚠️ **not executed.** Docker Hub was unreachable from the build environment (HTTP 403 on base images). The Dockerfile's runtime steps were reproduced outside Docker, as in the row above. Run `docker compose up -d --build` once on the target server to confirm. |

## Acceptance checklist

| Item | Status | Evidence |
|---|---|---|
| Admin can log in | ✅ | auth.test, E2E step 1 |
| Role permissions work | ✅ | RBAC tests (staff, officer, coordinator, scope), E2E staff 403 page |
| Guest Faculty can log in | ✅ | E2E steps 3–5 (newly created Guest Faculty) |
| Sports Coach can log in | ✅ | auth/RBAC tests and E2E with `coach01.rajesh` |
| Profiles can be created | ✅ | people test, E2E step 2 |
| Profiles can be edited | ✅ | people test (PATCH + audit) |
| Profiles can be deactivated | ✅ | people test (login disabled, hidden from active lists) |
| Attendance can be marked | ✅ | self check-in + manual marking tests |
| Duplicate attendance is prevented | ✅ | 409 tests, concurrent triple check-in → 1 row, DB unique constraint |
| Check-in works | ✅ | attendance test, E2E step 4 |
| Check-out works | ✅ | attendance test, E2E step 5 |
| Duration is calculated | ✅ | unit + correction test (7h 38m) |
| Late arrival is calculated | ✅ | unit (grace boundary, IST vs UTC) + correction test `isLate` |
| Monthly attendance works | ✅ | monthly test, UI |
| Attendance percentage works | ✅ | unit (9 cases) + monthly credits/eligible check + three leave-rule settings |
| Calendar works | ✅ | calendar test (all days, holidays), E2E step 10 |
| Leave submission works | ✅ | leave test (overlap, dates, upload validation), E2E step 8 |
| Leave approval works | ✅ | leave test (scope, remarks, re-approve 409), E2E step 9 |
| Approved leave affects attendance | ✅ | leave test (LEAVE_SYNC rows, cancellation reverts), E2E step 10 |
| Dashboard is dynamic | ✅ | test changes data and sees the counts change |
| Live presence works | ✅ | UI (30 s refresh), daily sheet API test |
| Search works | ✅ | search test (ref ID, sport, department, literal `%`) |
| Filters work | ✅ | monthly/daily filters, URL-synced in the UI |
| Department filtering works | ✅ | people/coordinator scope tests |
| Sport/activity filtering works | ✅ | monthly `type` filter, coordinator (sports) report test |
| Reports work | ✅ | all 10 report types via API |
| CSV export works | ✅ | API test (formula-injection guard), E2E download |
| XLSX export works | ✅ | API test (zip signature), E2E download |
| PDF export works | ✅ | API test (`%PDF-`), E2E download, visually reviewed |
| Print view works | ✅ | E2E print-media test (navigation hidden, letterhead and signature shown) |
| Audit logs work | ✅ | audit entries asserted across flows; E2E audit page |
| Attendance corrections are tracked | ✅ | correction test (before/after, reason, history, approval mode) |
| Authentication is secure | ✅ | bcrypt, hashed session tokens, HttpOnly/SameSite/Secure, lockout, idle expiry, single-use reset |
| Unauthorized routes are protected | ✅ | 401/403 tests, E2E redirect to sign-in |
| Input validation works | ✅ | Zod on every endpoint; validation tests |
| Error handling works | ✅ | specified messages asserted; no stack/SQL leaks |
| Mobile layout works | ✅ | E2E mobile (drawer, cards), mobile screenshot |
| Accessibility basics work | ✅ | axe WCAG 2 A/AA (serious/critical) clean on 8 pages; keyboard skip link; non-colour status indicators |
| Tests pass | ✅ | 32 + 42 + 19 |
| Production build succeeds | ✅ | |
| Docker setup works | ⚠️ | Compose validated and runtime reproduced; **image build not run here** (see above) |
| Database migration works | ✅ | fresh-database migrate in test, E2E and production simulation; checksum guard |
| Seed data works | ✅ | 26 people (25 active), 30 users, about 1,650 attendance records, 11 leave requests |
| Documentation is complete | ✅ | README + 9 documents in `docs/` |

## Completed features

- Authentication:
  - server-side sessions, CSRF, lockout, idle and absolute expiry
  - password reset and change
  - admin-issued reset links
  - first-admin bootstrap script
  - SSO extension point
- RBAC with 4 roles and 18 permissions; row-level scope for coordinators and staff.
- People: Guest Faculty and Sports Coaches with photos, contracts and assigned hours; departments; sports and activities; activation/deactivation.
- Attendance:
  - self check-in/out on server time
  - manual marking with a confirmation step
  - corrections with required reason, optional approval workflow and optimistic locking
  - super-admin deletion with reason
  - late, early and incomplete flags
  - auto half-day/absent classification
- Rule engine: per-type timings and working days; configurable leave, holiday and weekend handling; half-day weight; formula shown to users.
- Views: dashboard (overview, % vs last month, live table, 30-day trend chart, department/sport summary, recent activity, needs-attention), today's sheet, live presence, calendar, monthly records, corrections.
- Leave: request with document upload, approve/reject/cancel, automatic attendance sync and revert, overlap protection.
- Reports: 10 types with preview, print stylesheet, CSV/XLSX/PDF exports, logo placeholder or uploaded logo, page numbers and signature line.
- Audit log: append-only (database trigger), before/after snapshots, filters, detail view.
- In-app notifications, plus an outbox for email/SMS/WhatsApp.
- Accessibility pass, responsive and mobile layout, PWA manifest, health endpoint, structured logs.
- Docker, compose (app, database, backup, TLS proxy, demo seed), backup/restore scripts, documentation.

## Remaining limitations

These are deliberate for V1 and documented:

1. **No outbound email or SMS delivery.** Messages are queued in `notification_outbox`. Password reset relies on admin-issued links until a mail worker is added.
2. **No scheduled jobs.** "Attendance missing" and "contract expiring" are shown on the dashboard, but no push notifications are generated on a timer.
3. **No leave balances or quotas.** Leave rules are limited to maximum days per request and allowed backdating.
4. **Uploads are stored on local disk.** A multi-server deployment needs shared storage or an object-storage adapter.
5. **Light theme only**; no dark mode.
6. **Check-out must happen on the same institutional date as check-in.** Overnight shifts would need a rule change.
7. **Browser coverage.** E2E runs on Chromium only; Firefox and Safari were not automated.
8. **No load or performance testing.** Expected scale is small; queries are indexed.
9. **Attendance rule defaults are placeholders**, not NSUT policy.

## Known issues

- The dashboard's 30-day trend skips days with no expected personnel (weekends and holidays). This is intentional, but the x-axis therefore isn't evenly spaced in calendar time.
- Seeded "today" timestamps depend on when you seed. Seeding just after midnight creates check-ins in the early-morning hours so no timestamp is in the future. Re-seed during the day for a more realistic demo.
- **Dependency audit (at release):**
  - Production dependencies: 2 moderate advisories, both `uuid` < 11.1.1 pulled in by ExcelJS. The advisory concerns the v3/v5/v6 functions with a caller-supplied buffer, which this app never calls. Watch for an ExcelJS release that drops or updates it.
  - Development-only tooling: Vitest 2 and its bundled Vite 5 have high and critical advisories affecting the Vitest UI server and dev server. These are not part of the production image. Upgrading to Vitest 4 hit an npm resolver bug in the build environment and should be retried.
  - React Router and Vite were upgraded to patched versions (7.18 / 7.3).

## Required before production

1. Establishment Section confirms attendance rules, working days, holidays and the leave policy.
2. HTTPS in front of the app; `COOKIE_SECURE=true`; strong secrets.
3. Build the Docker image on the target server and run the compose stack. Confirm `/health`.
4. Create the first Super Admin with `create-admin`; **do not load demo data**; keep `DEMO_MODE=false`.
5. Upload the official logo supplied by the University.
6. Configure daily off-host backups and test a restore.
7. Publish a privacy notice (including IP/user-agent logging, or set `RECORD_CLIENT_META=false`).
8. Pilot with one department and one sport for 2–4 weeks before campus-wide rollout.

## Recommended next steps

1. Email worker for `notification_outbox` (SMTP through the University mail relay).
2. Nightly job: flag missing check-outs, notify coordinators of unmarked staff, contract-expiry reminders.
3. Institutional SSO (OIDC/SAML) using the existing `auth_provider` hook.
4. QR check-in at department offices or grounds, as a new `marking_method` with rotating codes. Avoid GPS or biometrics unless separately approved.
5. Leave balances per type and academic year.
6. Monthly honorarium/payroll export built on credits and hours.
7. Firefox and WebKit E2E projects in CI; GitHub Actions or GitLab CI pipeline running lint, typecheck, tests and the Docker build.
