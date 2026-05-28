#!/usr/bin/env bash
# infra/postgres-backup.sh — pg_dump daily backup for Havenhold
#
# BACKUP MODE (default — run as postgres OS user or via sudo -u postgres):
#   sudo -u postgres DB_NAME=havenhold BACKUP_DIR=/var/backups/havenhold \
#     /usr/local/bin/postgres-backup.sh
#
# CRON INSTALL MODE (run once as root to schedule daily backups):
#   Operator invocation (from repo root):
#     KEY_PATH=/path/to/key.pem
#     STATIC_IP=203.0.113.10
#     ADMIN_USER=adminuser
#     scp -i "$KEY_PATH" infra/postgres-backup.sh "$ADMIN_USER"@"$STATIC_IP":/tmp/postgres-backup.sh
#     ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
#       "INSTALL_CRON=true sudo -E bash /tmp/postgres-backup.sh"

set -euo pipefail

DB_NAME="${DB_NAME:-havenhold}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/havenhold}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
INSTALL_CRON="${INSTALL_CRON:-false}"
CRON_HOUR="${CRON_HOUR:-2}"
CRON_MINUTE="${CRON_MINUTE:-30}"

# Validate inputs before any value is written into the cron file.
# A newline in DB_NAME or BACKUP_DIR would inject additional cron lines
# (executed by the cron daemon as separate commands, potentially as root).
[[ "${DB_NAME}" =~ ^[a-zA-Z0-9_]+$ ]] \
  || { echo "ERROR: DB_NAME '${DB_NAME}' contains invalid characters"; exit 1; }
[[ "${BACKUP_DIR}" =~ ^[a-zA-Z0-9/_-]+$ ]] \
  || { echo "ERROR: BACKUP_DIR '${BACKUP_DIR}' contains invalid characters"; exit 1; }
[[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]] \
  || { echo "ERROR: RETENTION_DAYS '${RETENTION_DAYS}' must be a number"; exit 1; }
[[ "${CRON_HOUR}" =~ ^([0-9]|1[0-9]|2[0-3])$ ]] \
  || { echo "ERROR: CRON_HOUR '${CRON_HOUR}' must be 0-23"; exit 1; }
[[ "${CRON_MINUTE}" =~ ^([0-9]|[1-5][0-9])$ ]] \
  || { echo "ERROR: CRON_MINUTE '${CRON_MINUTE}' must be 0-59"; exit 1; }

log() { echo "[postgres-backup] $(date -u +'%H:%M:%S') $*"; }

# ---------------------------------------------------------------------------
# CRON INSTALL MODE
# ---------------------------------------------------------------------------
if [[ "${INSTALL_CRON}" == "true" ]]; then
  if [[ "$(id -u)" -ne 0 ]]; then
    exec sudo -E bash "$0" "$@"
  fi

  SCRIPT_DEST="/usr/local/bin/postgres-backup.sh"
  log "Installing backup script to ${SCRIPT_DEST}"
  cp "$(realpath "$0")" "${SCRIPT_DEST}"
  chmod 750 "${SCRIPT_DEST}"
  chown root:postgres "${SCRIPT_DEST}"

  CRON_FILE="/etc/cron.d/havenhold-backup"
  # Build the desired content first so we can compare and only write on change.
  # Path-presence check alone is not enough — CRON_HOUR, CRON_MINUTE, RETENTION_DAYS
  # etc. may have changed since the last install.
  NEW_CRON_CONTENT="$(cat <<EOF
# Havenhold daily PostgreSQL backup — managed by postgres-backup.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=UTC
${CRON_MINUTE} ${CRON_HOUR} * * * postgres DB_NAME=${DB_NAME} BACKUP_DIR=${BACKUP_DIR} RETENTION_DAYS=${RETENTION_DAYS} ${SCRIPT_DEST} >> /var/log/havenhold-backup.log 2>&1
EOF
  )"

  if [[ -f "${CRON_FILE}" ]] && [[ "$(cat "${CRON_FILE}")" == "${NEW_CRON_CONTENT}" ]]; then
    log "Cron job already up to date — skipping"
  else
    printf '%s\n' "${NEW_CRON_CONTENT}" > "${CRON_FILE}"
    chmod 644 "${CRON_FILE}"
    log "Cron job written: ${CRON_FILE} (schedule: ${CRON_HOUR}:$(printf '%02d' "${CRON_MINUTE}") UTC daily)"
  fi

  log "Cron install complete."
  log "Test with: sudo -u postgres ${SCRIPT_DEST}"
  log "Logs at:   sudo tail -f /var/log/havenhold-backup.log"
  exit 0
fi

# ---------------------------------------------------------------------------
# BACKUP MODE
# ---------------------------------------------------------------------------
log "Step 1/4: Verify backup directory"
if [[ ! -d "${BACKUP_DIR}" ]]; then
  log "ERROR: ${BACKUP_DIR} does not exist. Run postgres-setup.sh first." >&2
  exit 1
fi

log "Step 2/4: Running pg_dump for '${DB_NAME}'"
TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql"

# Peer auth: script runs as postgres OS user — no password or PGPASSWORD needed.
# --no-password ensures we fail fast rather than hang if auth is misconfigured.
pg_dump \
  --format=plain \
  --no-password \
  --file="${BACKUP_FILE}" \
  "${DB_NAME}"

log "Step 3/4: Verify backup is non-empty"
if [[ ! -s "${BACKUP_FILE}" ]]; then
  log "ERROR: Backup file is empty — removing and aborting." >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi
BACKUP_SIZE="$(du -sh "${BACKUP_FILE}" | cut -f1)"
log "Backup written: ${BACKUP_FILE} (${BACKUP_SIZE})"

log "Step 4/4: Pruning backups older than ${RETENTION_DAYS} days"
PRUNED=0
while IFS= read -r -d '' OLD_FILE; do
  rm -f "${OLD_FILE}"
  log "Pruned: ${OLD_FILE}"
  PRUNED=$((PRUNED + 1))
done < <(find "${BACKUP_DIR}" -maxdepth 1 -name "${DB_NAME}_*.sql" \
          -mtime "+${RETENTION_DAYS}" -print0)
log "Pruned ${PRUNED} old backup(s)"

log "Backup complete: ${BACKUP_FILE}"
