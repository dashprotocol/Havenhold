#!/usr/bin/env bash
# infra/postgres-setup.sh — idempotent PostgreSQL 16 setup for Havenhold
# Operator invocation (from repo root):
#   KEY_PATH=/path/to/key.pem
#   STATIC_IP=203.0.113.10
#   ADMIN_USER=adminuser
#   scp -i "$KEY_PATH" infra/postgres-setup.sh "$ADMIN_USER"@"$STATIC_IP":/tmp/postgres-setup.sh
#   ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
#     "DB_PASSWORD='<strong-password>' sudo -E bash /tmp/postgres-setup.sh"

set -euo pipefail

DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD env var required}"
DB_NAME="${DB_NAME:-havenhold}"
DB_USER="${DB_USER:-havenhold}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/havenhold}"
PG_VERSION="${PG_VERSION:-16}"

# Validate identifiers before any value is written into config files.
# Newlines or shell metacharacters in DB_NAME/DB_USER would inject lines into
# pg_hba.conf; reject anything outside safe PostgreSQL identifier characters.
[[ "${DB_NAME}" =~ ^[a-zA-Z0-9_]+$ ]] \
  || { echo "ERROR: DB_NAME '${DB_NAME}' contains invalid characters"; exit 1; }
[[ "${DB_USER}" =~ ^[a-zA-Z0-9_]+$ ]] \
  || { echo "ERROR: DB_USER '${DB_USER}' contains invalid characters"; exit 1; }

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

log() { echo "[postgres-setup] $(date -u +'%H:%M:%S') $*"; }

# ---------------------------------------------------------------------------
# Step 1/7: Install PostgreSQL
# ---------------------------------------------------------------------------
log "Step 1/7: Install postgresql-${PG_VERSION}"
if dpkg -s "postgresql-${PG_VERSION}" &>/dev/null; then
  log "postgresql-${PG_VERSION} already installed — skipping"
else
  # Add pgdg repo if postgresql-16 is not available in default sources
  if ! apt-cache show "postgresql-${PG_VERSION}" &>/dev/null; then
    log "postgresql-${PG_VERSION} not in default sources — adding pgdg repo"
    apt-get install -y gnupg curl lsb-release
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    log "pgdg repo added"
  fi
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    "postgresql-${PG_VERSION}" \
    "postgresql-client-${PG_VERSION}"
fi

# ---------------------------------------------------------------------------
# Step 2/7: Ensure service is enabled and running
# ---------------------------------------------------------------------------
log "Step 2/7: Enable and start postgresql"
systemctl enable postgresql
systemctl start postgresql

# ---------------------------------------------------------------------------
# Step 3/7: Lock to localhost only
# ---------------------------------------------------------------------------
log "Step 3/7: Set listen_addresses = 'localhost'"
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
if grep -q "^listen_addresses = 'localhost'" "${PG_CONF}"; then
  log "listen_addresses already set to localhost — skipping"
else
  sed -i "s/^#\?listen_addresses\s*=.*/listen_addresses = 'localhost'/" "${PG_CONF}"
  log "listen_addresses set to localhost"
fi

# ---------------------------------------------------------------------------
# Step 4/7: Add pg_hba entries (IPv4 + IPv6 localhost)
# ---------------------------------------------------------------------------
log "Step 4/7: Configure pg_hba.conf for ${DB_USER}@127.0.0.1 and @::1"
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
# Always remove and rewrite the block so rerunning with changed DB_NAME/DB_USER
# takes effect. '/# havenhold-app/,+2d' deletes the marker plus the two host lines.
sed -i '/# havenhold-app/,+2d' "${PG_HBA}"
cat >> "${PG_HBA}" <<EOF

# havenhold-app — managed by postgres-setup.sh
host    ${DB_NAME}    ${DB_USER}    127.0.0.1/32    scram-sha-256
host    ${DB_NAME}    ${DB_USER}    ::1/128          scram-sha-256
EOF
log "pg_hba entries written (IPv4 + IPv6)"

# ---------------------------------------------------------------------------
# Step 5/7: Reload config
# ---------------------------------------------------------------------------
log "Step 5/7: Reload postgresql config"
systemctl reload postgresql

# ---------------------------------------------------------------------------
# Step 6/7: Create role and database
# ---------------------------------------------------------------------------
log "Step 6/7: Create role '${DB_USER}' and database '${DB_NAME}'"
# Pass values via -v and use format('%I'/'%L') so special chars in DB_PASSWORD
# (quotes, backslashes) cannot break the SQL syntax.
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -v "db_user=${DB_USER}" \
  -v "db_name=${DB_NAME}" \
  -v "db_password=${DB_PASSWORD}" \
  <<'ENDSQL'
SELECT CASE
  WHEN NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_user')
  THEN format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
  ELSE format('ALTER ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
END \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name')
\gexec
ENDSQL

# ---------------------------------------------------------------------------
# Step 7/7: Create backup directory and validate connectivity
# ---------------------------------------------------------------------------
log "Step 7/7: Create backup directory and validate"
install -d -m 750 -o postgres -g postgres "${BACKUP_DIR}"
log "Backup directory: ${BACKUP_DIR}"

PGPASSWORD="${DB_PASSWORD}" psql \
  -h 127.0.0.1 \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -c "SELECT version();" \
  -t \
  -q

log "Connectivity validated via 127.0.0.1 (IPv4)"

log "Setup complete. Validation commands:"
cat <<EOF

  # Service health
  systemctl status postgresql --no-pager

  # Database and user
  sudo -u postgres psql -c "\\l" | grep ${DB_NAME}
  sudo -u postgres psql -c "\\du" | grep ${DB_USER}

  # Localhost-only binding (expect 127.0.0.1:5432 only)
  sudo ss -tulpen | grep 5432

  # UFW has no 5432 rule
  sudo ufw status verbose | grep 5432 || echo "No 5432 rule — correct"

  # pg_hba entries
  sudo grep havenhold-app /etc/postgresql/${PG_VERSION}/main/pg_hba.conf

  # Backup directory
  ls -lad ${BACKUP_DIR}

EOF
