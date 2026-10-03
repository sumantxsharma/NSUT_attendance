# Security

This is an institutional information system handling personal and attendance data. This document describes the controls implemented and the steps needed before production.

## Authentication

- **Passwords** are hashed with bcrypt (cost 12). Plaintext passwords are never stored or logged. Policy: at least 10 characters, with letters and numbers.
- **Sessions** are stored server-side in `sessions`. The browser holds a random 256-bit token in an **HttpOnly, SameSite=Lax** cookie (`Secure` when `COOKIE_SECURE=true`, which is the default in production). Only the SHA-256 hash of the token is stored, so a database leak does not expose live sessions.
- **Expiry.** Sessions expire absolutely after `SESSION_TTL_HOURS` (default 8) and after `SESSION_IDLE_MINUTES` of inactivity (default 60). They are revoked on logout, on password change (other sessions), on password reset (all sessions), on role change, and on user or person deactivation.
- **Brute-force protection:**
  - per-IP rate limit on `/auth/login` (20 per 15 minutes)
  - per-account lockout after `MAX_LOGIN_ATTEMPTS` failures (default 5) for `LOCKOUT_MINUTES` (default 15); Super Admins can unlock an account
  - constant-time comparison against a dummy hash for unknown accounts
- **Secure error messages.** Login always says "Invalid email or password." Password-reset requests give an identical response whether or not the account exists.
- **Password reset.** Tokens are 256-bit, stored hashed, single-use, and expire after 1 hour (24 hours for admin-issued links). Email delivery is queued in `notification_outbox`. Until an email worker exists, a Super Admin can issue a one-time link from *Users*. In non-production mode, the forgot-password response includes the link for testing. **This is disabled when `NODE_ENV=production`.**

### Institutional SSO (future)

The authentication layer is ready for SSO:

- `users.auth_provider` (`local` | `sso`) and `users.external_id` columns exist; local-password checks are skipped for SSO users.
- `GET /api/auth/sso/login` is a stub returning `501`.

To integrate SAML or OIDC:

1. Add a callback route that validates the IdP assertion.
2. Map it to `users.external_id`.
3. Call the existing `createSession()` and `setSessionCookies()`.

Roles and scopes stay managed in this application.

## Authorization

- **Permissions, not roles, are checked on every route** (`requirePerm`). The role → permission matrix lives in one file (`packages/shared/src/permissions.ts`) and is shown read-only under *Administration → Roles*.
- **Row-level scope:**
  - Coordinators see only people in their assigned sports / activities (`peopleScopeSql`, `assertPersonVisible`). This is enforced on lists, profiles, calendars, leave, reports, dashboard and search.
  - Staff can access only their own profile and records.
- **Segregation of duties:**
  - reviewers cannot approve their own leave or their own correction requests
  - Super Admins cannot deactivate themselves or the last active Super Admin
- The frontend hides what a user cannot do, but **the server is authoritative**.

## Request protection

| Threat | Control |
|---|---|
| CSRF | Double-submit token: `nsut_csrf` cookie must equal the `X-CSRF-Token` header on every state-changing request with a session (timing-safe compare), plus SameSite=Lax cookies |
| SQL injection | Parameterised queries only; `LIKE` input escaped; no dynamic identifiers from user input |
| XSS | React escapes output; strict Content-Security-Policy (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`, `object-src 'none'`) |
| Clickjacking | CSP `frame-ancestors 'none'` + `X-Frame-Options` |
| Secure headers | Helmet: HSTS (when Secure cookies), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cross-Origin-*` policies; `X-Powered-By` removed |
| Rate limiting | 600 requests/min per IP on `/api`, stricter limits on login and password reset |
| Body size | JSON limited to 200 KB; uploads 1–5 MB depending on type |
| Spreadsheet formula injection | CSV cells starting with `= + - @` are prefixed with `'` |
| Caching of personal data | `Cache-Control: no-store` on all API responses |

## File uploads

- Files are held in memory, then **validated by magic bytes** (PNG, JPEG, PDF). The client-declared type and extension are ignored.
- Files are stored in the `stored_files` table under random UUID keys and are **never served from a public static path**. They are sent through authorised endpoints with `nosniff`.
- The sanitised original filename is stored only for display.

## Audit logging

`audit_logs` is **append-only**: a database trigger rejects UPDATE and DELETE. Entries are written in the same transaction as the change they describe, so a change cannot commit without its audit entry. Recorded events:

- login, failed login, lockout, logout
- password reset requested / completed / changed
- attendance check-in, check-out, create, update, delete, correction requested / approved / rejected
- leave submit, approve, reject, cancel
- person create, update, deactivate, activate
- user create, update, deactivate, activate, reset link issued
- sport / activity changes
- rules, system settings, logo and holiday changes
- report exports

Each entry stores the actor, timestamp, action, record, before and after JSON snapshots (secrets stripped), the reason, and the IP address and user agent.

## Privacy

- Only data needed for attendance is collected: name, reference ID, role and sport / activity, contact details, contract dates, attendance times, leave details and an optional photograph.
- **No GPS location, device fingerprinting or biometrics are collected.** These would need separate institutional approval (see *Future-ready architecture* in ARCHITECTURE.md).
- **IP address and browser user agent** are recorded on self check-ins and audit entries so disputed entries can be investigated. Set `RECORD_CLIENT_META=false` to disable this. This should be disclosed to staff in the institution's privacy notice.
- Staff see only their own data. Contact details are visible only to officers, coordinators (in scope) and admins.
- Demo data uses the reserved `.invalid` domain and obviously fictional names.

## Secrets and configuration

- All secrets come from environment variables (`.env`, never committed). The app refuses to start in production without `DATABASE_URL` and `SESSION_SECRET`.
- Password hashes, tokens, session IDs, database credentials and stack traces are never returned by the API. Logs redact cookies, authorization headers and password or token fields.

## Production hardening checklist

- [ ] Serve only over HTTPS (Nginx profile or University load balancer); set `COOKIE_SECURE=true`
- [ ] Set a long random `SESSION_SECRET` and database password; restrict `.env` file permissions (`chmod 600`)
- [ ] Keep PostgreSQL unreachable from outside the host or VLAN (compose does not publish port 5432)
- [ ] Confirm `TRUST_PROXY` matches the number of proxies, so rate limits and audit IPs are correct
- [ ] Keep `DEMO_MODE=false` (hides demo-account hints on the sign-in page)
- [ ] Remove demo data (`npm run db:reset` is refused in production; start from an empty database and create the first Super Admin; see DEPLOYMENT.md)
- [ ] Change all initial passwords; issue reset links instead of sharing passwords
- [ ] Configure off-host backups and test a restore
- [ ] Review the role matrix and coordinator scopes with the Establishment Section
- [ ] Publish a privacy notice covering attendance data and IP/user-agent logging
- [ ] Apply OS and container updates regularly; run `npm audit` before each release
