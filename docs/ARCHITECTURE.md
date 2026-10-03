# Architecture

## Overview

```
 Browser (React SPA)  ──HTTPS──▶  Nginx (TLS, optional)  ──▶  Node.js API (Express)  ──▶  PostgreSQL 16
        │                                                        │
        │  same-origin cookies + CSRF header                     ├── stored_files table (photos, leave documents, logo)
        │                                                        └── notification_outbox (email/SMS later)
        └── static assets served by the API in production
```

A single deployable container serves both the REST API (`/api/*`) and the built web app. In development, Vite serves the web app on :5173 and proxies `/api` to the API on :4000.

## Technology choices

| Concern | Choice | Why |
|---|---|---|
| Frontend | React 18 + TypeScript, Vite | Spec-preferred; fast builds; typed |
| UI | Tailwind CSS + Radix UI primitives (dialog, dropdown) | Accessible, unstyled primitives with a small custom design system; no proprietary component kit |
| Data fetching | TanStack Query | Caching, background refresh (live views), request dedupe |
| Charts | Recharts | Open source, sufficient for line charts |
| Backend | Node.js 22 + Express + TypeScript | Spec-preferred; widely known by student developers |
| Validation | Zod, shared between client and server | One schema, enforced on the server |
| Database | PostgreSQL 16 | Relational integrity, exclusion constraints, JSONB for audit snapshots |
| Data access | `pg` with parameterised SQL (no ORM) | **Deviation from "Prisma or equivalent", explained below** |
| PDF / XLSX | PDFKit / ExcelJS | Open source, server-side, deterministic |
| Auth | Server-side sessions in PostgreSQL + HttpOnly cookie + double-submit CSRF | Revocable, auditable, SSO-ready |
| Tests | Vitest, Supertest, Playwright | Unit, integration, and browser E2E |
| Packaging | Docker (multi-stage), docker compose | Self-hostable |

### Why no ORM

Prisma was the preferred choice, but its engine binaries are downloaded at install time. That fails in restricted networks such as the build environment used here, and is a supply-chain concern for an institutional system. Instead:

- The schema is written as **versioned SQL migrations** (`database/migrations`). That makes the key integrity rules explicit database constraints: one record per person per day, no check-out without a check-in, no overlapping active leave (a GiST exclusion constraint), and an append-only audit log (a trigger). Several of these can't be expressed in Prisma's schema language at all.
- Queries use `pg` with **parameterised statements only**. A tiny `Params` helper builds placeholders, and user input is never interpolated into SQL.
- Types come from the shared domain package and Zod schemas.

Moving to Kysely or Drizzle later would mean swapping the query layer. The migrations would stay the same.

## Code organisation

```
packages/shared/src
  domain.ts        Enums + labels (roles, statuses, leave types, report types, audit actions)
  permissions.ts   Permission catalogue and role → permission matrix (single source of truth)
  rules.ts         Attendance rule engine (pure functions): late, early, half-day, % calculation
  time.ts          Timezone-aware date helpers (luxon), month/leap-year/range utilities
  schemas.ts       Zod request schemas shared by API (authoritative) and web (UX)

apps/api/src
  app.ts           Middleware stack: helmet/CSP → logging → rate limit → JSON → cookies → session → CSRF → routes
  config.ts        Environment configuration
  db/              pool, migration runner, seed
  middleware/auth  Sessions, CSRF, requireAuth / requirePerm
  lib/             errors (safe messages), audit, notify, settings (cached), scope (row-level visibility), upload validation
  services/        attendance, leave, reports, export (CSV/XLSX/PDF), dashboard
  routes/          auth, attendance, people (+ org), leave, reports, admin (users, settings, audit, notifications, search)

apps/web/src
  lib/             api client, auth context, formatting, URL-synced filter state
  components/      Layout (sidebar/drawer/search/notifications), ui kit, status badges, calendar, dialogs, filters
  pages/           Dashboard, attendance views, people, leave, reports, admin, audit, profile, auth
```

## Key flows

**Check-in.** `POST /api/attendance/check-in` → session and permission check (`attendance.self`) → transaction: the person row is locked (`FOR UPDATE`), with checks for active profile, contract window, approved leave and an existing record. The server inserts with **server time**, converted to the institutional date in `Asia/Kolkata`, never browser time. It then writes an audit entry and, if the person is late, notifies reviewers. Concurrent double-clicks produce exactly one record: the row lock plus the unique constraint guarantee it, and a test covers it.

**Check-out.** This locks the day's record, calculates the duration from timestamps, and (if the rule is enabled) classifies the day as PRESENT, HALF_DAY or ABSENT from hours worked.

**Correction.** `PATCH /api/attendance/:id` needs a reason and an optional `version` for optimistic concurrency. When approval is required, it creates a PENDING correction and leaves the record unchanged. Otherwise it applies the change and writes the correction row and audit entry (with before and after values) in the same transaction.

**Leave.** On submission, overlap is checked in the app for a clear message and backed by the database exclusion constraint. On approval, each working, non-holiday day in the range becomes a `LEAVE` attendance row (`LEAVE_SYNC`). Days the person actually attended are left untouched and reported back. Cancelling approved leave removes those rows.

**Attendance percentage.** This is computed on request by `summarize()` in `packages/shared/src/rules.ts` from raw records, holidays, contract windows and the current rules. Nothing is stored or entered by hand. The formula, under the current rules, is shown in the UI (*Monthly Records → How % is calculated*) and printed on reports.

## Timezone handling

- Instants are stored as `timestamptz` in UTC. Calendar days are stored as `date`.
- The institutional timezone (default `Asia/Kolkata`) is a setting. "Today", late, early and duration are all computed on the server in that zone.
- The client displays times in the institutional zone and aligns its clock to the server's `serverTime`.
- `pg` is configured to return `date` columns as `yyyy-MM-dd` strings, so dates never shift through JavaScript `Date`.

## Scalability and extension points

| Future need | Extension point |
|---|---|
| More staff categories | Add a value to `person_type` (migration) and to `PERSON_TYPES`; rules are already per type |
| QR / NFC / biometric / geofence marking | `attendance.marking_method` enum (add values); implement a new endpoint that calls the same check-in service with a different method and verification step |
| Mobile app | The REST API is client-agnostic; the web app is PWA-ready (manifest present) |
| Institutional SSO (SAML/OIDC) | `users.auth_provider` / `external_id` columns and `GET /api/auth/sso/login` stub; see SECURITY.md |
| Email / SMS / WhatsApp | `notification_outbox` table + `enqueueExternal()`; a worker reads PENDING rows and delivers |
| Payroll / honorarium | Monthly summary service already returns credits, hours (`totalMinutes`) and eligible days per person |
| Contract management | Contract dates exist; dashboard flags contracts ending within 30 days |
| Work-hour analytics | `duration_minutes` stored per day; trend endpoint pattern in `dashboard.ts` |

At NSUT's expected scale (hundreds of personnel, about 250 working days a year), every view is a single-digit number of indexed queries. If data grows by orders of magnitude, add a monthly summary materialised view. The rule engine is pure and can run in SQL or a batch job unchanged.

## Notifications

In-app notifications are written in the same transaction as the event that causes them:

| Event | Recipients |
|---|---|
| Leave submitted | Reviewers in scope |
| Leave approved / rejected / cancelled | The person |
| Late arrival | Reviewers in scope |
| Correction pending approval | Super Admins |
| Attendance corrected | The person |
| Contract nearing expiry | Surfaced on the dashboard; seeded example notification |

Email is queued in `notification_outbox` for password resets. No outbound delivery is configured in V1.

## Observability

- `GET /health` (and `/api/health`) reports status, version, database reachability and latency, and uptime.
- Structured JSON logs (pino): every API request with method, path, status, latency and user id. 401/403/423 are logged at `warn` and 5xx at `error`. Secrets and cookies are redacted.
- Login failures and lockouts are written to the audit log (`AUTH_LOGIN_FAILED`).
- Attendance errors reach users as clear 4xx messages. Unexpected errors are logged with stack traces server-side, and clients receive only a generic message.
