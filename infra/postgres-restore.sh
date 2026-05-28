#!/usr/bin/env bash
# infra/postgres-restore.sh — restore Havenhold database from a pg_dump backup
#
# Operator invocation (from repo root):
#   KEY_PATH=/path/to/key.pem
#   STATIC_IP=203.0.113.10
#   ADMIN_USER=adminuser
#   scp -i "$KEY_PATH" infra/postgres-restore.sh "$ADMIN_USER"@"$STATIC_IP":/tmp/postgres-restore.sh
#
#   # Restore from most recent backup (auto-select):
#   ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
#     "sudo bash /tmp/postgres-restore.sh"
#
#   # Restore from a specific backup file:
#   ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
#     "BACKUP_FILE=/var/backups/havenhold/havenhold_20260528T023001Z.sql \
#      sudo -E bash /tmp/postgres-restore.sh"
#
# WARNING: This script DROPS and RECREATES the database. All current data is replaced.
# Stop the application before running: sudo systemctl stop havenhold-app

set -euo pipefail

DB_NAME="${DB_NAME:-havenhold}"
DB_USER="${DB_USER:-havenhold}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/havenhold}"
BACKUP_FILE="${BACKUP_FILE:-}"
SKIP_CONFIRM="${SKIP_CONFIRM:-false}"

# Validate identifiers: values with -- prefixes would be interpreted as flags by
# dropdb/createdb; newlines would break psql variable passing or config writes.
[[ "${DB_NAME}" =~ ^[a-zA-Z0-9_]+$ ]] \
  || { echo "ERROR: DB_NAME '${DB_NAME}' contains invalid characters"; exit 1; }
[[ "${DB_USER}" =~ ^[a-zA-Z0-9_]+$ ]] \
  || { echo "ERROR: DB_USER '${DB_USER}' contains invalid characters"; exit 1; }

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

log() { echo "[postgres-restore] $(date -u +'%H:%M:%S') $*"; }

# ---------------------------------------------------------------------------
# Step 1/6: Locate backup file
# ---------------------------------------------------------------------------
log "Step 1/6: Locate backup file"
if [[ -n "${BACKUP_FILE}" ]]; then
  if [[ ! -f "${BACKUP_FILE}" ]]; then
    log "ERROR: BACKUP_FILE='${BACKUP_FILE}' not found." >&2
    exit 1
  fi
  TARGET="${BACKUP_FILE}"
  log "Using specified backup: ${TARGET}"
else
  TARGET="$(find "${BACKUP_DIR}" -maxdepth 1 -name "${DB_NAME}_*.sql" \
             -printf '%T@ %p\n' 2>/dev/null \
             | sort -n | tail -1 | cut -d' ' -f2-)"
  if [[ -z "${TARGET}" ]]; then
    log "ERROR: No backups found in ${BACKUP_DIR} matching ${DB_NAME}_*.sql" >&2
    exit 1
  fi
  log "Auto-selected most recent backup: ${TARGET}"
fi

# ---------------------------------------------------------------------------
# Step 2/6: Verify backup is non-empty
# ---------------------------------------------------------------------------
log "Step 2/6: Verify backup file"
if [[ ! -s "${TARGET}" ]]; then
  log "ERROR: Backup file is empty or unreadable: ${TARGET}" >&2
  exit 1
fi
TARGET_SIZE="$(du -sh "${TARGET}" | cut -f1)"
log "Backup: ${TARGET} (${TARGET_SIZE})"

# ---------------------------------------------------------------------------
# Step 3/6: Confirmation prompt
# ---------------------------------------------------------------------------
log "Step 3/6: Confirm restore"
if [[ "${SKIP_CONFIRM}" != "true" ]]; then
  echo ""
  echo "  WARNING: This will DROP and RECREATE the '${DB_NAME}' database."
  echo "  All current data will be permanently replaced with the backup."
  echo "  Backup file: ${TARGET}"
  echo ""
  read -r -p "  Type 'yes' to confirm restore: " CONFIRM
  if [[ "${CONFIRM}" != "yes" ]]; then
    log "Restore aborted by operator."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Step 4/6: Terminate connections, drop and recreate database
# ---------------------------------------------------------------------------
log "Step 4/6: Terminate connections, drop and recreate '${DB_NAME}'"
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -v "db_name=${DB_NAME}" \
  -d postgres \
  <<'ENDSQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'db_name' AND pid <> pg_backend_pid();
ENDSQL

sudo -u postgres dropdb --if-exists -- "${DB_NAME}"
sudo -u postgres createdb -O "${DB_USER}" -- "${DB_NAME}"
log "Database '${DB_NAME}' recreated with owner '${DB_USER}'"

# ---------------------------------------------------------------------------
# Step 5/6: Restore from backup
# ---------------------------------------------------------------------------
log "Step 5/6: Restoring from ${TARGET}"
sudo -u postgres psql \
  --set ON_ERROR_STOP=on \
  -d "${DB_NAME}" \
  -f "${TARGET}"
log "Restore complete"

# ---------------------------------------------------------------------------
# Step 6/6: Post-restore row-count validation
# ---------------------------------------------------------------------------
log "Step 6/6: Post-restore validation"
sudo -u postgres psql -d "${DB_NAME}" -t -A <<'SQL'
SELECT 'Patient rows:    ' || COUNT(*) FROM "Patient";
SELECT 'User rows:       ' || COUNT(*) FROM "User";
SELECT 'Medication rows: ' || COUNT(*) FROM "Medication";
SQL

PATIENT_COUNT="$(sudo -u postgres psql -d "${DB_NAME}" -t -A \
  -c 'SELECT COUNT(*) FROM "Patient";' | tr -d '[:space:]')"

if [[ "${PATIENT_COUNT}" -lt 1 ]]; then
  log "ERROR: Post-restore validation failed — Patient table is empty." >&2
  exit 1
fi

log "Validation passed: ${PATIENT_COUNT} patient row(s) found."
log "Restore successful from: ${TARGET}"
log ""
log "Next steps:"
log "  1. Restart the application: sudo systemctl start havenhold-app"
log "  2. Verify migration state:  npx prisma migrate deploy"
