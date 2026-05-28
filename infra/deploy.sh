#!/usr/bin/env bash
# deploy.sh — build, migrate, seed, and start the Havenhold API.
# Run as a sudoer on the app host. Assumes app code is already checked out.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/havenhold}"
BRANCH="${BRANCH:-main}"
SERVER_DIR="$APP_DIR/server"
HEALTH_URL="http://127.0.0.1:3001/api/health"
SYSTEMD_UNIT="havenhold-api"
SERVICE_FILE="$APP_DIR/infra/systemd/havenhold-api.service"

log() { echo "[deploy] $*"; }

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
log "1/12 Checking prerequisites"
command -v node  >/dev/null 2>&1 || { echo "ERROR: node not found"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "ERROR: npm not found"; exit 1; }
command -v git   >/dev/null 2>&1 || { echo "ERROR: git not found"; exit 1; }
[[ -f "$SERVER_DIR/.env" ]]       || { echo "ERROR: $SERVER_DIR/.env not found — create it first"; exit 1; }

# Frontend env vars are baked in at build time — require the .env file and validate
# required vars before building.
FRONTEND_ENV="$APP_DIR/.env"
[[ -f "$FRONTEND_ENV" ]] \
  || { echo "ERROR: $FRONTEND_ENV not found — create it from .env.example before deploying"; exit 1; }
grep -qE '^VITE_AUTH_BASE_URL=.+' "$FRONTEND_ENV" \
  || { echo "ERROR: VITE_AUTH_BASE_URL not set in $FRONTEND_ENV — auth will silently target localhost in production browsers"; exit 1; }
grep -qE '^VITE_API_BASE_URL=.+' "$FRONTEND_ENV" \
  || { echo "ERROR: VITE_API_BASE_URL not set in $FRONTEND_ENV"; exit 1; }

# ── 2. Pull latest code ───────────────────────────────────────────────────────
log "2/12 Pulling $BRANCH"
git -C "$APP_DIR" pull --ff-only origin "$BRANCH"

# ── 3. Install frontend dependencies (needs devDeps for Vite build) ───────────
log "3/12 Installing frontend dependencies"
npm --prefix "$APP_DIR" ci

# ── 4. Build frontend ─────────────────────────────────────────────────────────
log "4/12 Building frontend"
npm --prefix "$APP_DIR" run build

# ── 5. Install backend dependencies (needs tsc, prisma CLI, tsx) ─────────────
log "5/12 Installing backend dependencies"
npm --prefix "$SERVER_DIR" ci

# ── 6. Build backend ──────────────────────────────────────────────────────────
log "6/12 Building backend"
npm --prefix "$SERVER_DIR" run build

# ── 7. Run Prisma migrations ──────────────────────────────────────────────────
log "7/12 Running Prisma migrations"
cd "$SERVER_DIR"
npx prisma migrate deploy || { echo "ERROR: Prisma migration failed — aborting deploy"; exit 1; }

# ── 8. Seed database ──────────────────────────────────────────────────────────
log "8/12 Seeding database (idempotent)"
npx prisma db seed

# ── 9. Restore evidence gate ──────────────────────────────────────────────────
log "9/12 Checking restore evidence gate"
RUNBOOK="$APP_DIR/docs/runbook/postgres-backup-and-recovery.md"
if grep -q '_________________' "$RUNBOOK" 2>/dev/null; then
  if [[ "${REQUIRE_RESTORE_EVIDENCE:-false}" == "true" ]]; then
    echo "ERROR: Restore Tested Once table in runbook has unfilled entries."
    echo "       Fill in the table and commit before deploying with REQUIRE_RESTORE_EVIDENCE=true."
    exit 1
  else
    echo "WARN:  Restore Tested Once table has unfilled entries."
    echo "       Complete Step E in the runbook and commit evidence before the first production deploy."
  fi
else
  log "  Restore evidence: OK"
fi

# ── 10. Install systemd unit ──────────────────────────────────────────────────
log "10/12 Installing systemd unit"
if [[ -f "$SERVICE_FILE" ]]; then
  cp "$SERVICE_FILE" "/etc/systemd/system/$SYSTEMD_UNIT.service"
  systemctl daemon-reload
  systemctl enable "$SYSTEMD_UNIT"
else
  echo "WARN: $SERVICE_FILE not found — skipping systemd unit install"
fi

# ── 11. Restart service ───────────────────────────────────────────────────────
log "11/12 Restarting $SYSTEMD_UNIT"
systemctl restart "$SYSTEMD_UNIT"

# ── 12. Health check ──────────────────────────────────────────────────────────
log "12/12 Polling health endpoint (30s timeout)"
DEADLINE=$(( $(date +%s) + 30 ))
until curl -sf "$HEALTH_URL" >/dev/null 2>&1; do
  if [[ $(date +%s) -ge $DEADLINE ]]; then
    echo "ERROR: Health check timed out after 30s — check: journalctl -u $SYSTEMD_UNIT -n 50"
    exit 1
  fi
  sleep 2
done

log "Deploy complete. $SYSTEMD_UNIT is healthy."
