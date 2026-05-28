# Runbook: PostgreSQL Backup and Recovery

## Purpose
Install PostgreSQL 16 on the Havenhold app host, configure daily automated backups with 7-day local retention, and provide a tested restore procedure. This runbook covers two phases:

- **D0 phase (H-007):** PostgreSQL setup and cron configuration. Completed before app code is ever deployed. Steps A and C only.
- **Pre-launch phase (H-010):** First deployment of app code, schema migration, seed, and restore test. Completed during the H-010 initial deploy cycle, before the app process is started for the first time. Steps B, D, and E.

The restore test (Step E) can only be run after `prisma migrate deploy` has created the schema. Do not attempt it at D0 time on an empty database.

## Security Handling
- This runbook is git-tracked and must stay sanitized.
- Do not commit `DB_PASSWORD`, connection strings, `.pgpass` contents, or operator-only CIDRs.
- Store `DB_PASSWORD` in approved team secret storage (e.g. 1Password, AWS Secrets Manager).
- Backup files contain full database contents — `/var/backups/havenhold/` is restricted to `postgres:postgres` (mode 750). Do not scp backups over unencrypted channels.
- `.pgpass` files are mode 600; never commit them.

## Prerequisites
- Host hardening baseline complete (H-005) — admin user, UFW, and fail2ban active.
- Nginx/TLS setup complete (H-006) — HTTPS serving the app.
- Lightsail firewall has no inbound rule for port 5432 (PostgreSQL must not be externally reachable).
- Repo checked out locally with `infra/postgres-setup.sh`, `infra/postgres-backup.sh`, and `infra/postgres-restore.sh` present.
- A strong, randomly generated `DB_PASSWORD` stored in team secret storage.

## Deploy Steps

> **Phase label key**
> - `[D0]` — run during H-007, before any app code is deployed
> - `[H-010]` — run during H-010 initial deploy, with app code present but app process not yet started

### Step A `[D0]`: Install and configure PostgreSQL

Copy and run the setup script on the host:

```bash
KEY_PATH=/path/to/key.pem
STATIC_IP=203.0.113.10
ADMIN_USER=adminuser

scp -i "$KEY_PATH" infra/postgres-setup.sh "$ADMIN_USER"@"$STATIC_IP":/tmp/postgres-setup.sh
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "DB_PASSWORD='<strong-password>' sudo -E bash /tmp/postgres-setup.sh"
```

Replace `<strong-password>` with the password from team secret storage. The script is idempotent — safe to re-run after fixing any failed step.

### Step B `[H-010]`: Deploy app code, set DATABASE_URL, run migrations

This step is performed during the H-010 initial deploy cycle. App code must be on the server before running these commands. The app process is **not started** yet.

```bash
# On host — edit the app env file with the DB connection string
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP"
sudo nano /opt/havenhold/server/.env
# Set: DATABASE_URL="postgresql://havenhold:<DB_PASSWORD>@127.0.0.1:5432/havenhold"
```

Run Prisma migrations to create the schema (no app process required):

```bash
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "cd /opt/havenhold/server && npx prisma migrate deploy"
```

Seed demo data so the backup/restore test has rows to validate:

```bash
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "cd /opt/havenhold/server && npx prisma db seed"
```

### Step C `[D0]`: Install daily backup cron job

```bash
scp -i "$KEY_PATH" infra/postgres-backup.sh "$ADMIN_USER"@"$STATIC_IP":/tmp/postgres-backup.sh
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "INSTALL_CRON=true sudo -E bash /tmp/postgres-backup.sh"
```

Default schedule: **02:30 UTC daily**. Override with `CRON_HOUR` and `CRON_MINUTE` env vars.

### Step D `[H-010]`: Run first manual backup

Run after Step B (migrations + seed) so the backup captures a schema with real rows:

```bash
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "sudo -u postgres /usr/local/bin/postgres-backup.sh"
```

Expected: `Backup written: /var/backups/havenhold/havenhold_<timestamp>.sql`

### Step E `[H-010]`: Test restore (required AC — restore tested once)

The app process has not been started yet at this point, so there are no active connections to terminate. Run restore directly:

```bash
scp -i "$KEY_PATH" infra/postgres-restore.sh "$ADMIN_USER"@"$STATIC_IP":/tmp/postgres-restore.sh
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "sudo bash /tmp/postgres-restore.sh"
```

The script auto-selects the most recent backup, prompts for confirmation, drops and recreates the database, restores, and prints row counts. Fill in the [Restore Tested Once](#restore-tested-once-h-010-pre-launch-confirmation) table below.

After the restore test passes, the app can be started for the first time:

```bash
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "sudo systemctl start havenhold-app"
```

## D0 Verification Checklist (H-007 — infra only)

Complete these before any app code is deployed:

- [ ] PostgreSQL 16 installed and active (`systemctl status postgresql`).
- [ ] Database `havenhold` exists and app user `havenhold` can connect from `127.0.0.1`.
- [ ] PostgreSQL binds to localhost only — no external port 5432 exposure.
- [ ] Lightsail firewall has no inbound 5432 rule; UFW has no 5432 rule.
- [ ] `/etc/cron.d/havenhold-backup` installed with `CRON_TZ=UTC` and `postgres` as the run user.

## Pre-Launch Checklist (H-010 — complete before starting the app process)

Complete these during the H-010 initial deploy, after app code is on the server but before the app process is started:

- [ ] `DATABASE_URL` set in `/opt/havenhold/server/.env`.
- [ ] `npx prisma migrate deploy` completed without errors.
- [ ] `npx prisma db seed` completed — demo patient/user rows exist.
- [ ] First manual backup written to `/var/backups/havenhold/` with non-zero size.
- [ ] `postgres-restore.sh` run against the most recent backup; row-count validation passed.
- [ ] [Restore Tested Once](#restore-tested-once-h-010-pre-launch-confirmation) table filled in and committed.

## Evidence Commands

Run on the host unless noted:

```bash
# PostgreSQL service health
systemctl status postgresql --no-pager

# Database and user exist
sudo -u postgres psql -c "\l" | grep havenhold
sudo -u postgres psql -c "\du" | grep havenhold

# Localhost-only binding (expect 127.0.0.1:5432 only, no 0.0.0.0)
sudo ss -tulpen | grep 5432

# UFW has no 5432 rule (no output = correct)
sudo ufw status verbose | grep 5432 || echo "No 5432 rule — correct"

# Lightsail firewall (run locally, not on host)
aws lightsail get-instance-port-states --instance-name havenhold-app-01 \
  | grep -i fromport | grep 5432 || echo "No 5432 Lightsail rule — correct"

# Backup directory and files
ls -lh /var/backups/havenhold/

# Cron job
sudo cat /etc/cron.d/havenhold-backup

# Backup log (after first run)
sudo tail -30 /var/log/havenhold-backup.log

# Quick pg_dump smoke test (dumps to /dev/null — non-destructive)
sudo -u postgres pg_dump --no-password havenhold > /dev/null && echo "pg_dump OK"
```

## Restore Tested Once (H-010 Pre-Launch Confirmation)

Fill in this table during the H-010 pre-launch restore test (Step E) and commit the change before starting the app process for the first time.

| Field | Value |
|---|---|
| Date of test | _________________ |
| Operator | _________________ |
| Backup file used | _________________ |
| Backup file size | _________________ |
| Restore duration (approx) | _________________ |
| `Patient` row count post-restore | _________________ |
| `User` row count post-restore | _________________ |
| `Medication` row count post-restore | _________________ |
| Script exit code | _________________ |
| Pass / Fail | _________________ |

## Operations: Periodic Backup Verification

### Check last backup ran successfully

```bash
sudo tail -20 /var/log/havenhold-backup.log
ls -lht /var/backups/havenhold/ | head -5
```

### Check cron job is active

```bash
sudo cat /etc/cron.d/havenhold-backup
systemctl status cron --no-pager
```

### Force a manual backup

```bash
sudo -u postgres DB_NAME=havenhold BACKUP_DIR=/var/backups/havenhold \
  /usr/local/bin/postgres-backup.sh
```

### List all backups with sizes

```bash
ls -lh /var/backups/havenhold/
```

### Check what would be pruned (backups older than 7 days)

```bash
find /var/backups/havenhold/ -name "havenhold_*.sql" -mtime +7 -ls
```

### Restore from a specific backup file

```bash
BACKUP_FILE=/var/backups/havenhold/havenhold_20260528T023001Z.sql \
  sudo -E bash /tmp/postgres-restore.sh
```

## Rollback / Recovery

- **`postgres-setup.sh` failed mid-way:** Re-run — the script is idempotent.
- **pg_dump fails in cron:** Check `/var/log/havenhold-backup.log`. Common causes: disk full (`df -h`), PostgreSQL service stopped (`systemctl status postgresql`). Resolve and run manually to verify.
- **`postgres-restore.sh` fails at DROP — active connections persist:** Stop the application first (`sudo systemctl stop havenhold-app`), then retry.
- **Restore SQL errors (`ON_ERROR_STOP` exits):** The backup may be corrupt or from an incompatible schema version. Try the previous day's backup from `/var/backups/havenhold/`.
- **`pg_hba.conf` conflict on a partially provisioned host:** The validation step at the end of `postgres-setup.sh` catches this. Inspect the file manually (`sudo cat /etc/postgresql/16/main/pg_hba.conf`) and remove duplicate or conflicting entries before re-running.
- **All local backups lost (disk failure):** No S3 offload exists at D0. Restore the Lightsail instance snapshot from the AWS console, then re-run `postgres-setup.sh` with the original `DB_PASSWORD`. Pending migrations can be replayed with `npx prisma migrate deploy`.
- **Disk pressure from backups:** Emergency prune: `find /var/backups/havenhold/ -name "*.sql" -mtime +2 -delete` (keeps last 2 days). Adjust `RETENTION_DAYS` in `/etc/cron.d/havenhold-backup` for the long term.

## Notes

- PostgreSQL is intentionally not exposed outside localhost. There is no pgAdmin or external connection. All DBA work is done via `sudo -u postgres psql` on the host.
- Backup files are plain SQL (`pg_dump -Fp`). They can be inspected with `less` or `grep`. To upgrade to compressed custom format (`-Fc`) in a future ticket, restore uses `pg_restore -d havenhold file.dump` instead of `psql -f file.sql`.
- S3 backup offload is deferred to a follow-up ticket. Until then, Lightsail instance snapshots are the only off-host recovery path.
- At typical Havenhold data volumes (< 10 MB/day), 7 days of backups costs under 100 MB of disk. Adjust via `RETENTION_DAYS` in `/etc/cron.d/havenhold-backup`.
- After any restore, run `npx prisma migrate deploy` to verify the schema migration state is current.
