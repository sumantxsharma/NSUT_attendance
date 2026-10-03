# Database

PostgreSQL 16. The schema lives in `database/migrations/*.sql` and is applied by `apps/api/src/db/migrate.ts`.

## Tables

| Table | Purpose |
|---|---|
| `departments` | Academic / administrative departments (`code` unique) |
| `activities` | Sports / activities, optionally owned by a department |
| `people` | Guest Faculty and Sports Coach profiles (soft-deletable via `deleted_at`; deactivated via `status`) |
| `users` | Login accounts; `role`, lockout counters, optional link to a `people` row |
| `user_scopes` | Coordinator scope: one row per department or activity |
| `sessions` | Server-side sessions (SHA-256 token hash, CSRF token, expiry, revocation) |
| `password_reset_tokens` | Single-use, hashed, expiring reset tokens |
| `attendance` | One row per person per date: status, check-in/out instants, duration, method, remarks, marker, version |
| `attendance_corrections` | Every correction (applied, pending, rejected) with previous and proposed snapshots and reason |
| `leaves` | Leave requests and review outcome |
| `holidays` | Institutional holidays |
| `settings` | JSON settings: `attendance_rules`, `system` |
| `notifications` | In-app notifications |
| `notification_outbox` | Queued email/SMS/WhatsApp messages for a future worker |
| `audit_logs` | Append-only audit trail with JSON before/after snapshots |
| `schema_migrations` | Applied migration names and checksums |

## Entity relationships

```
departments 1─* people *─1 activities *─0..1 departments
people 1─* attendance *─0..1 leaves
people 1─* leaves
people 1─0..1 users 1─* sessions
users 1─* user_scopes (department | activity)
people 1─* attendance_corrections *─0..1 attendance
users 1─* audit_logs
```

## Integrity rules enforced by the database

| Rule | Constraint |
|---|---|
| One attendance record per person per date | `attendance_person_date_uq UNIQUE (person_id, date)` |
| No check-out without check-in | `attendance_checkout_ck` |
| Check-out not before check-in | `attendance_order_ck` |
| Stored duration always matches timestamps | `attendance_duration_ck` |
| Times only on attended statuses | `attendance_times_status_ck` |
| Leave link only on LEAVE status | `attendance_leave_link_ck` |
| No overlapping pending/approved leave for a person | `leaves_no_overlap EXCLUDE USING gist (person_id =, daterange &&) WHERE status IN (PENDING, APPROVED)` |
| Leave date range valid | `leaves_range_ck` |
| Guest Faculty have a department; coaches have an activity | `people_gf_dept_ck`, `people_sc_activity_ck` |
| Contract end ≥ start | `people_contract_ck` |
| Unique reference ID / email / department code / activity name | unique constraints |
| Staff login must link to a profile | `users_staff_person_ck` |
| One pending correction per person-date | partial unique index |
| **Audit log is append-only** | `audit_logs_no_update` trigger raises on UPDATE/DELETE |

"NOT_MARKED" is never stored. It is derived when no record exists for a working day. That keeps unmarked days distinct from explicit absences.

Inactive people are excluded from active lists by `status = 'ACTIVE'` filters. Their history remains visible in reports for periods in which they have records.

## Indexes

- `attendance (date, status)`: daily sheets and dashboards
- `attendance (date) WHERE check_in_at IS NOT NULL AND check_out_at IS NULL`: live and incomplete views
- `people (type, status) WHERE deleted_at IS NULL`, `people (department_id)`, `people (activity_id)`, `people (lower(full_name))`
- `leaves (status, submitted_at DESC)`, `leaves (person_id, from_date)`
- `audit_logs (created_at DESC)`, `(entity_type, entity_id)`, `(user_id, created_at DESC)`, `(action)`
- `notifications (user_id, created_at DESC)`, `attendance_corrections (person_id, date DESC)`

## Settings JSON

`settings.attendance_rules` is validated by `attendanceRulesSchema` (packages/shared/src/rules.ts):

```jsonc
{
  "byType": {
    "GUEST_FACULTY": { "officeStart": "09:00", "officeEnd": "17:00", "graceMinutes": 15, "earlyDepartureGraceMinutes": 15,
                       "minHoursFullDay": 6, "minHoursHalfDay": 3, "workingDays": [1,2,3,4,5] },
    "SPORTS_COACH":  { "officeStart": "07:00", "officeEnd": "14:00", "graceMinutes": 15, "earlyDepartureGraceMinutes": 15,
                       "minHoursFullDay": 5, "minHoursHalfDay": 2.5, "workingDays": [1,2,3,4,5,6] }
  },
  "excludeLeaveFromDenominator": true,
  "leaveCountsAsPresent": false,
  "countHolidays": false,
  "countWeekends": false,
  "halfDayWeight": 0.5,
  "autoClassifyByHours": true,
  "manualCorrectionRequiresApproval": false
}
```

**These are demo defaults, not NSUT policy.** The Establishment Section must confirm actual timings and rules before go-live.

## Migration strategy

- Migrations are plain SQL files named `NNNN_description.sql` and applied in order, each in its own transaction.
- The runner stores a SHA-256 checksum per file and **refuses to start if an applied migration was edited**. To change the schema, add a new file.
- Use additive, backward-compatible changes where possible: add a nullable column, deploy the code, backfill, then tighten the constraint in a later migration.
- **Always take a backup before migrating production.** The Docker entrypoint applies pending migrations automatically on start (`MIGRATE_ON_START=true`). Set it to `false` if you prefer running `node apps/api/dist/db/migrate.js` manually during a maintenance window.
- `--reset` (drop and recreate the schema) is refused when `NODE_ENV=production` unless `ALLOW_PROD_RESET=yes` is set.

## Data retention

Attendance, leave and audit data are retained indefinitely by default. Retention periods should be set according to University records policy. Deleting audit rows requires a database superuser to disable the trigger, which is intentional.
