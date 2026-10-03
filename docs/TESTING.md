# Testing

| Suite | Tool | Location | Command | Count |
|---|---|---|---|---|
| Unit: rule engine, dates, validation | Vitest | `packages/shared/test` | `npm test -w @nsut/shared` | 32 |
| Integration: API + real PostgreSQL | Vitest + Supertest | `apps/api/test` | `npm test -w @nsut/api` | 42 |
| End-to-end: browser | Playwright (Chromium) + axe-core | `tests/e2e` | `npm run test:e2e` | 19 |
| Static analysis | ESLint, TypeScript | all workspaces | `npm run lint && npm run typecheck` | – |

`npm test` runs the unit and integration suites.

## Prerequisites

- PostgreSQL running locally with user `postgres` / password `postgres` (override with `DATABASE_URL`).
- Databases:
  - `nsut_attendance_test` for integration tests. It is **reset** by the suite; `globalSetup` drops and recreates the schema.
  - `nsut_attendance_e2e` for Playwright (override with `E2E_DATABASE_URL`). It is reset and seeded for each run.

```bash
createdb nsut_attendance_test
createdb nsut_attendance_e2e
npx playwright install chromium   # first time only, if browsers are not present
```

## Unit tests (`packages/shared/test/rules.test.ts`)

- **Duration:** minutes between instants, flooring, check-out before check-in rejected, spans across midnight, formatting.
- **Late / early:** grace boundary (09:15 on time, 09:16 late), **institutional time vs UTC**, early-departure threshold.
- **Half day:** full / half / absent thresholds.
- **Attendance %:**
  - leave excluded, counted as present, or counted as absent
  - weekend work counted but empty weekends not
  - weekends counted when configured
  - holidays excluded or counted
  - today, future and out-of-contract days excluded
  - no eligible days gives `null`
  - half-day weight
- **Leave and dates:**
  - ranges across month and year boundaries
  - inclusive overlap
  - **leap years** (Feb 2028 has 29 days)
  - instants near **midnight** mapped to the correct institutional date
  - local to UTC conversion
  - invalid dates such as `2026-02-30`
- **Validation:** check-out without check-in, out before in, times on absent status, required correction reason, leave with to-date before from-date.

## Integration tests (`apps/api/test`)

Each file re-seeds the demo data, then drives the real Express app over HTTP against PostgreSQL.

- **Auth** (`auth.test.ts`):
  - health check
  - login, with HttpOnly and SameSite cookies and no hash leaked
  - generic error on bad credentials and on unknown email
  - input validation
  - **lockout after 5 failures and admin unlock**
  - 401 without a session
  - **403 without the CSRF token**
  - logout revokes the session
  - **idle session expiry**
  - password reset: no account enumeration, weak password rejected, **token single-use**, sessions revoked
  - login, logout and failures written to the audit log
- **RBAC:**
  - staff blocked from 6 admin endpoints
  - officer blocked from audit, rules and users
  - **coordinator sees only CSE/IT** and gets 403 on other departments' people and calendars
  - staff see only their own profile
- **Attendance** (`attendance.test.ts`):
  - **dashboard numbers equal the seeded scenario and change when data changes** (nothing hard-coded)
  - check-in, duplicate 409, check-out with duration and auto-classification, re-check-in after check-out 409, audit entries
  - **three concurrent check-ins produce exactly one record**
  - check-out before check-in 400
  - check-in blocked on approved leave and when already marked
  - manual marking: invalid times, missing in-time, future date, duplicate 409, audit
  - **correction with required reason, optimistic-lock 409, before/after in audit, correction history**
  - **approval-required corrections:** record unchanged until approved, then applied, and cannot be approved twice
  - delete: officer 403, reason required, audited
  - monthly % equals credits ÷ eligible days, filters work
  - **all three leave-rule settings change the percentage as specified**
  - calendar has every day of the month and marks holidays
  - database constraints: duplicate per day, check-out without check-in, order
  - **audit log UPDATE/DELETE rejected by trigger**
- **Leave, people and reports** (`leave-people-reports.test.ts`):
  - submit, overlap 409, backwards dates 400, reviewers notified
  - **upload rejected by content (fake PDF)**
  - staff cannot approve; out-of-scope coordinator cannot see the request; rejection requires remarks
  - **approval creates LEAVE attendance for working days, the person is notified, cancellation reverts attendance, audit trail**
  - approved leave does not overwrite a day the person attended
  - people: create with login, duplicate ref ID 409, department required for Guest Faculty, edit, **deactivate disables login and hides from active lists**, audit trail
  - officers view-only; search by ref ID, sport and department; `%` treated literally
  - **all 10 report types**
  - **CSV (with formula-injection guard), XLSX (zip signature), PDF (`%PDF-`)**, exports audited
  - coordinator reports scoped
  - rules validation, before/after in audit, invalid timezone rejected
  - internal errors not leaked

## End-to-end tests (`tests/e2e`)

`workflow.spec.ts` covers the acceptance flow from the specification, in a real browser against a fresh database:

1. Admin login
2. Create a person (with login) through the form
3. Person logs in
4. Check-in (confirmation shows the time; the check-in button disappears)
5. Check-out
6. Admin views the attendance on the daily sheet
7. Admin generates the daily report and downloads **PDF, CSV and Excel**
8. Person submits leave
9. Admin approves the leave
10. **The calendar shows the approved days as On Leave**

Plus: the audit trail for the flow, staff blocked from admin pages, redirect to sign-in when unauthenticated, and **mobile layout** (drawer navigation, tables rendered as cards).

`quality.spec.ts` covers:

- **axe-core WCAG 2 A/AA scan** (serious and critical issues fail the test) on the login page, dashboard, daily sheet, monthly records, leave, reports, rules and the staff page
- keyboard skip link
- **print view** (navigation, buttons and filters hidden; letterhead, table and signature line shown; A4 PDF renders)

## Defects found by the tests and fixed

These are recorded for transparency:

- **Correction update SQL failed** with "inconsistent types deduced for parameter" (an enum parameter was compared to text). Found by integration tests; fixed with explicit casts.
- **Bundled server closed its own database pool.** After esbuild bundling, the migrate/seed "run as script" check matched the server. Found by running the production bundle; the guard now matches the script filename.
- **Future approved leave was hidden** in the calendar (shown as "upcoming"). Found by E2E; the calendar now shows scheduled leave.
- **Accessibility:**
  - invalid `<dl>` structure on the dashboard
  - low-contrast timestamps
  - calendar grid without rows
  - non-focusable scroll regions
  - links in text distinguished by colour only

  Found by axe; all fixed.
- **Demo-account hints appeared on the production sign-in page.** Found during screenshot review; now gated by `DEMO_MODE`, which is off in production.
