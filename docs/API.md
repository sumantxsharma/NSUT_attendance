# API Reference

Base path: `/api`. JSON in and out, except uploads (multipart) and exports (files).

## Conventions

- **Authentication.** Sign in with `POST /api/auth/login`. The server sets an HttpOnly session cookie (`nsut_sid`) and a readable CSRF cookie (`nsut_csrf`).
- **CSRF.** Every non-GET request made with a session must send `X-CSRF-Token: <value of nsut_csrf>`. Otherwise the server returns `403`.
- **Validation.** All inputs are validated server-side with Zod. Invalid input returns `400`.
- **Dates** are `YYYY-MM-DD` institutional calendar dates. **Times** in requests are `HH:MM` in the institutional timezone. **Instants** in responses are ISO-8601 UTC strings.
- **Errors** always have this shape (never stack traces or SQL):

```json
{ "error": { "code": "VALIDATION", "message": "Out-time must be after in-time.", "fields": { "checkOut": "Out-time must be after in-time." } } }
```

| Status | Meaning |
|---|---|
| 200 / 201 | OK / created |
| 400 | Validation or business-rule error ("You cannot check out before checking in.") |
| 401 | Not signed in or session expired |
| 403 | Permission denied, out of scope, or CSRF failure |
| 404 | Not found (also returned for records outside a coordinator's scope in some lookups) |
| 409 | Conflict: duplicate attendance, overlapping leave, already reviewed, stale version |
| 413 | Upload too large |
| 423 | Account temporarily locked |
| 429 | Rate limited |
| 500 | Unexpected error (generic message; details in server logs) |
| 503 | `/health` when the database is unreachable |

## Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health`, `/api/health` | none | `{status, version, database, dbLatencyMs, uptimeSeconds}` |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/login` | `{email, password}` | Returns `{user, csrfToken}`; rate-limited; locks after 5 failures for 15 min |
| POST | `/auth/logout` | – | Revokes the session |
| GET | `/auth/me` | – | Current user, permissions, coordinator scopes |
| POST | `/auth/password/forgot` | `{email}` | Same response whether or not the account exists; in non-production returns `devResetUrl` |
| POST | `/auth/password/reset` | `{token, password}` | Single-use token; revokes all sessions |
| POST | `/auth/password/change` | `{currentPassword, newPassword}` | Revokes other sessions |
| GET | `/auth/sso/login` | – | `501` until SSO is configured (extension point) |
| GET | `/settings/public` | – | University name, unit, timezone, date format, logo flag (no auth) |
| GET | `/settings/logo` | – | Uploaded logo image (no auth) |

## Attendance

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/attendance/me/today` | attendance.self | Today's record, presence, rules, `canCheckIn`, `canCheckOut`, `serverTime` |
| GET | `/attendance/me/month?year&month` | attendance.self | Own calendar and summary |
| POST | `/attendance/check-in` | attendance.self | `201 {message:"Attendance marked successfully", record}`; `409` if already marked, on leave, or after check-out |
| POST | `/attendance/check-out` | attendance.self | `400` before check-in; `409` if already checked out |
| GET | `/attendance/today?type&departmentId&activityId&status&q` | attendance.read | Daily sheet for today |
| GET | `/attendance/daily?date&…filters` | attendance.read | Daily sheet for any past date. `status` accepts attendance statuses and presence states (`CURRENTLY_PRESENT`) |
| GET | `/attendance/monthly?year&month&type&departmentId&activityId&personId&q` | attendance.read | Per-person monthly summary |
| GET | `/attendance/person/:id?year&month` | attendance.read (or own) | Calendar days with evaluation and summary |
| POST | `/attendance/manual` | attendance.mark | `{personId, date, status, checkIn?, checkOut?, remarks?}`; `409` if a record exists |
| PATCH | `/attendance/:id` | attendance.correct | `{status, checkIn?, checkOut?, remarks?, reason, version?}` → `{pendingApproval, record}` |
| DELETE | `/attendance/:id` | attendance.delete | `{reason}`; audited |
| GET | `/attendance/corrections/list?status&personId` | attendance.read | Correction history |
| PATCH | `/attendance/corrections/:id/approve` \| `/reject` | attendance.correction.review | `{remarks?}`; you cannot approve your own request |

### Daily sheet row

```json
{
  "person": { "id": "…", "refId": "DEMO-GF-001", "fullName": "…", "type": "GUEST_FACULTY", "departmentName": "…", "activityName": null, "status": "ACTIVE" },
  "record": { "id": "…", "status": "PRESENT", "checkInAt": "2026-09-28T03:44:00.000Z", "checkOutAt": null, "durationMinutes": null,
              "lateMinutes": 0, "isLate": false, "earlyMinutes": 0, "isEarlyDeparture": false, "isIncomplete": false,
              "markingMethod": "SELF", "remarks": null, "version": 1 },
  "status": "PRESENT",
  "presence": "CURRENTLY_PRESENT",
  "isWorkingDay": true,
  "expectedHours": "09:00–17:00",
  "currentMinutes": 94
}
```

## People and organisation

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/people?q&type&departmentId&activityId&status(ACTIVE\|INACTIVE\|ALL)&page&pageSize&sort` | people.read | Scoped for coordinators |
| GET | `/people/:id` | people.read (or own) | Includes login summary |
| POST | `/people` | people.write | Person fields + optional `{createLogin, initialPassword}` |
| PATCH | `/people/:id` | people.write | Full person object |
| POST | `/people/:id/deactivate` \| `/activate` | people.write | `{reason?}`; deactivation also disables the login and ends sessions |
| POST | `/people/:id/photo` | people.write | multipart `photo` (PNG/JPEG ≤ 2 MB, validated by content) |
| GET | `/people/:id/photo` | people.read (or own) | Streams the image |
| GET | `/search?q` | people.read | Global search: name, ref ID, department, sport/activity |
| GET | `/departments?all=true` | signed in | |
| POST / PATCH | `/departments`, `/departments/:id` | org.manage | `{name, code, status?}` |
| GET | `/activities?all=true` | signed in | |
| POST / PATCH | `/activities`, `/activities/:id` | org.manage | `{name, category, departmentId?, status?}` |

## Leave

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/leave` | leave.self or leave.review | multipart: `fromDate, toDate, leaveType, reason, personId?` (reviewers), `document?` (PDF/PNG/JPEG ≤ 5 MB) |
| GET | `/leave?status&personId&from&to&q&type&departmentId&activityId` | leave.self (own) / leave.review (scoped) | |
| GET | `/leave/:id` | same | |
| PATCH | `/leave/:id/approve` | leave.review | `{remarks?}` → `{leave, sync:{applied:[dates], skipped:[{date,reason}]}}` |
| PATCH | `/leave/:id/reject` | leave.review | `{remarks}` (required) |
| PATCH | `/leave/:id/cancel` | owner (pending) / reviewer (pending or approved) | Reverts leave-created attendance |
| GET | `/leave/:id/document` | same as view | Streams the supporting document |

## Reports

`GET /reports/:type?format=json|csv|xlsx|pdf&…`

| Type | Period parameters | Other filters |
|---|---|---|
| `daily` | `date` | type, departmentId, activityId, status, q |
| `monthly` | `year`, `month` | type, departmentId, activityId, personId, q |
| `individual` | `year`, `month` | **personId (required)** |
| `department` | `year`, `month` | departmentId |
| `activity` | `year`, `month` | activityId |
| `absence`, `late`, `early`, `incomplete` | `from`, `to` (default: current month to today; max 1 year) | type, departmentId, activityId, personId |
| `leave` | `from`, `to` (may extend into the future) | status, type, departmentId, activityId, personId |

JSON response: `{type, title, period, filters[], columns[], rows[], summary[], notes[], meta{university, unit, generatedAt, generatedBy, timezone, footer}}`. File exports need `reports.export` and are audited (`REPORT_EXPORT`).

## Administration

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard?type` | dashboard.view |
| GET / POST / PATCH | `/users`, `/users/:id` | users.manage |
| POST | `/users/:id/deactivate` \| `/activate` \| `/unlock` \| `/reset-link` | users.manage |
| GET | `/roles` | signed in |
| GET | `/settings` | signed in (rules, system, holidays, formula) |
| PUT | `/settings/rules` | rules.manage |
| PUT | `/settings/system` | settings.manage |
| POST / DELETE | `/settings/logo` | settings.manage |
| POST / DELETE | `/holidays`, `/holidays/:id` | settings.manage |
| GET | `/audit-logs?q&action&entityType&entityId&userId&from&to&page&pageSize` | audit.read |
| GET | `/audit-logs/actions` | audit.read |
| GET | `/notifications`; POST `/notifications/read-all`; PATCH `/notifications/:id/read` | signed in (own) |

## Example

```bash
# sign in (stores cookies), then call an endpoint with the CSRF header
curl -c jar -H 'content-type: application/json' -d '{"email":"officer@demo.invalid","password":"Demo@12345"}' http://localhost:4000/api/auth/login
CSRF=$(awk '/nsut_csrf/{print $7}' jar)
curl -b jar -H "X-CSRF-Token: $CSRF" -H 'content-type: application/json' \
  -d '{"personId":"<uuid>","date":"2026-09-28","status":"PRESENT","checkIn":"09:05","checkOut":"17:00","remarks":"From register"}' \
  http://localhost:4000/api/attendance/manual
curl -b jar -o monthly.pdf 'http://localhost:4000/api/reports/monthly?year=2026&month=9&format=pdf'
```
