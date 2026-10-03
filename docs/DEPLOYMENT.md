# Deployment

The application is one container (API + web) plus PostgreSQL. It does not depend on any particular cloud provider or proprietary service.

## Environment variables

See `.env.example`. Required in production: `DATABASE_URL` (or the `POSTGRES_*` variables under compose), `SESSION_SECRET`, `APP_BASE_URL`. Behind HTTPS, set `COOKIE_SECURE=true`.

Generate secrets with:

```bash
openssl rand -base64 48
```

## Option A: NSUT internal Linux server (recommended)

**Target:** Ubuntu 22.04/24.04 LTS or RHEL 9 VM. 2 vCPU, 4 GB RAM and 40 GB disk are ample for several hundred personnel. Add a **separate** disk or NFS mount for backups.

### 1. Install

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
sudo useradd -m -s /bin/bash nsutapp && sudo usermod -aG docker nsutapp
sudo -iu nsutapp
git clone <internal-repo-url> nsut-attendance && cd nsut-attendance
cp .env.example .env && chmod 600 .env
# edit .env: POSTGRES_PASSWORD, SESSION_SECRET, APP_BASE_URL=https://attendance.<campus-domain>, COOKIE_SECURE=true,
#            BACKUP_HOST_DIR=/mnt/backup/nsut-attendance
docker compose up -d --build
docker compose ps        # app should become "healthy"
curl -s http://localhost:4000/health
```

Migrations run automatically on container start.

### 2. Create the first Super Admin (empty database, no demo data)

```bash
docker compose exec -e ADMIN_EMAIL=it.admin@<domain> -e ADMIN_NAME="Establishment IT Admin" \
  -e ADMIN_PASSWORD='<strong password>' app node apps/api/dist/db/create-admin.js
```

Then sign in, and work through these in order:

1. *System Settings*: university name, unit, logo, holidays.
2. *Attendance Rules*: confirm actual timings and policies with the Establishment Section.
3. Departments and sports.
4. People.
5. Users.

For a demo or training instance only, load the demo data with `docker compose --profile demo run --rm seed`.

### 3. Reverse proxy and HTTPS

Either use the University's existing load balancer or reverse proxy, or the bundled Nginx profile:

```bash
mkdir -p docker/certs  # place fullchain.pem and privkey.pem issued by University IT / CA
docker compose --profile proxy up -d
```

Set `APP_PORT=127.0.0.1:4000` in `.env` so the app port is not exposed directly. Keep `TRUST_PROXY=1` (one proxy hop). Open only ports 443 and 80 on the host firewall (`ufw allow 443/tcp; ufw allow 80/tcp`).

### 4. Backups

The backup job runs `pg_dump` in custom format, verifies the archive with `pg_restore --list`, writes a SHA-256 checksum and prunes files older than `BACKUP_RETENTION_DAYS`:

```bash
docker compose --profile backup run --rm backup
```

Schedule it daily with cron (as `nsutapp`):

```
30 1 * * * cd /home/nsutapp/nsut-attendance && docker compose --profile backup run --rm backup >> /var/log/nsut-backup.log 2>&1
```

**Rules:**

- `BACKUP_HOST_DIR` must be on different storage from the Docker volume holding `pgdata`: a separate disk, NFS or the University backup server.
- Replicate backups off-site weekly, for example with rsync to a second campus server.
- Back up the `uploads` volume too (photos, leave documents, logo):

  ```bash
  docker run --rm -v nsut-attendance_uploads:/u -v /mnt/backup/nsut-attendance:/b alpine tar czf /b/uploads-$(date +%F).tgz -C /u .
  ```

**Suggested retention:** 30 daily, 12 monthly (keep the 1st-of-month dump), 5 yearly. Align this with the University records policy.

### 5. Restore procedure

```bash
# 1. stop the app (keep db running)
docker compose stop app
# 2. verify checksum
sha256sum -c /mnt/backup/nsut-attendance/nsut_attendance-YYYYMMDD-HHMMSS.dump.sha256
# 3. restore into a clean database
docker compose exec -T db dropdb -U nsut nsut_attendance
docker compose exec -T db createdb -U nsut nsut_attendance
docker compose exec -T db pg_restore -U nsut -d nsut_attendance --no-owner < /mnt/backup/nsut-attendance/nsut_attendance-YYYYMMDD-HHMMSS.dump
# 4. restore uploads if needed, then start the app (pending migrations apply automatically)
docker compose start app && curl -s http://localhost:4000/health
```

`scripts/restore.sh` wraps these steps. **Test a restore to a scratch database every quarter.**

### 6. Disaster recovery

| Scenario | Action | RPO / RTO target |
|---|---|---|
| App container crash | Docker restarts it (`restart: unless-stopped`); health check marks it unhealthy | 0 / minutes |
| Bad deployment | `git checkout <previous tag> && docker compose up -d --build` (migrations are forward-only; restore a backup if a migration must be undone) | 0 / < 30 min |
| Database corruption / accidental deletion | Restore the latest daily dump (above) | ≤ 24 h / < 1 h |
| Server loss | Provision a new VM, install as in step 1, restore the latest off-site dump and uploads | ≤ 24 h / < 4 h |

For a tighter RPO, enable PostgreSQL WAL archiving (`archive_mode=on`, for example with pgBackRest) to the backup storage for point-in-time recovery.

### 7. Upgrades

```bash
docker compose --profile backup run --rm backup   # always back up first
git pull && docker compose up -d --build           # migrations apply on start
docker compose logs -f app                          # watch for errors; check /health
```

### 8. Monitoring

- **Health.** Poll `GET /health` from the University monitoring system (Nagios/Zabbix/Uptime Kuma). It returns `503` when the database is unreachable.
- **Logs.** `docker compose logs app` produces JSON lines. Ship them to a central log store (Loki/ELK/Graylog) using the Docker logging driver. Useful queries:
  - `status >= 500`: server errors
  - `status = 401 or 423` on `/api/auth/login`: login failures and lockouts
  - `ms > 1000`: slow endpoints
- **Database.** Watch disk space on the `pgdata` volume and backup target, connection count, and slow queries (`log_min_duration_statement=500`).
- **Security events.** Audit log actions `AUTH_LOGIN_FAILED`, `ATTENDANCE_DELETE` and `SETTINGS_*` can be reviewed under *Audit Logs* or queried directly.

### Running without Docker

```bash
npm ci && npm run build
NODE_ENV=production DATABASE_URL=… SESSION_SECRET=… node apps/api/dist/db/migrate.js
NODE_ENV=production DATABASE_URL=… SESSION_SECRET=… PORT=4000 node apps/api/dist/server.js
```

Run it under systemd with `Restart=always` behind Nginx.

## Option B: University-approved cloud infrastructure

No particular provider is assumed. The same architecture maps onto any provider the University approves (including government-empanelled ones):

| Component | Cloud equivalent |
|---|---|
| App container | Any container service or a VM running Docker (build the image from this repo; push to the provider's private registry) |
| PostgreSQL | Managed PostgreSQL 14+ with `btree_gist`, `citext` and `pgcrypto` enabled (all are standard extensions); private networking only |
| Uploads | Persistent volume mounted at `UPLOAD_DIR`. Object storage needs a small adapter in `lib/upload.ts`, because V1 writes to disk |
| HTTPS | Provider load balancer with the University certificate; set `COOKIE_SECURE=true`, `TRUST_PROXY=1` |
| Backups | Managed automated backups + point-in-time recovery, **plus** a periodic `pg_dump` exported to storage outside the provider account |
| Secrets | Provider secret manager injecting `DATABASE_URL` and `SESSION_SECRET` |
| Monitoring | Provider health checks on `/health`; forward container logs to the provider log service |

**Data residency.** Attendance data is personal data. Confirm the region, the University's data-protection obligations and contractual terms before choosing a provider.

## Pre-go-live checklist

- [ ] HTTPS with `COOKIE_SECURE=true`
- [ ] Strong secrets in `.env`, not committed
- [ ] First Super Admin created with `create-admin`; no demo data
- [ ] Rules and holidays confirmed by the Establishment Section
- [ ] Official logo uploaded (only the file supplied by the University)
- [ ] Daily backups running to separate storage; restore tested
- [ ] Health check wired into monitoring
- [ ] Staff informed of the privacy notice (IP/user-agent logging)
