#!/usr/bin/env bash
# infra/nginx-tls.sh — idempotent Nginx + Certbot TLS setup
# Operator invocation (from repo root):
#   KEY_PATH=/path/to/key.pem
#   STATIC_IP=203.0.113.10
#   ADMIN_USER=adminuser
#   HOSTNAME=app.example.com
#   EMAIL=ops@example.com
#   scp -i "$KEY_PATH" infra/nginx/havenhold "$ADMIN_USER"@"$STATIC_IP":/tmp/havenhold-nginx
#   scp -i "$KEY_PATH" infra/nginx-tls.sh   "$ADMIN_USER"@"$STATIC_IP":/tmp/nginx-tls.sh
#   ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
#     "HOSTNAME=$HOSTNAME EMAIL=$EMAIL STATIC_IP=$STATIC_IP sudo -E bash /tmp/nginx-tls.sh"

set -euo pipefail

HOSTNAME="${HOSTNAME:?HOSTNAME env var required (e.g. app.example.com)}"
EMAIL="${EMAIL:?EMAIL env var required for certificate registration}"
STATIC_IP="${STATIC_IP:?STATIC_IP env var required}"
NGINX_SRC="${NGINX_SRC:-/tmp/havenhold-nginx}"

# ---------------------------------------------------------------------------
# Pre-step: ensure dig is available (not present on all Ubuntu images)
# ---------------------------------------------------------------------------
if ! command -v dig &>/dev/null; then
  echo "[nginx-tls] dig not found — installing dnsutils"
  apt-get update -q
  apt-get install -y dnsutils
fi

# ---------------------------------------------------------------------------
# Step 1: DNS precheck — abort if hostname does not resolve to static IP
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 1: DNS precheck for ${HOSTNAME} → ${STATIC_IP}"
RESOLVED=$(dig +short "${HOSTNAME}" | tail -n1)
if [ "${RESOLVED}" != "${STATIC_IP}" ]; then
  echo "[nginx-tls] ERROR: ${HOSTNAME} resolves to '${RESOLVED}', expected '${STATIC_IP}'. Aborting." >&2
  exit 1
fi
echo "[nginx-tls] DNS OK: ${HOSTNAME} → ${RESOLVED}"

# ---------------------------------------------------------------------------
# Step 2: Upstream binding check — warn if port 3001 is not loopback-only
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 2: Upstream binding check (port 3001)"
if ss -tulpen 2>/dev/null | grep ':3001' | grep -qv '127.0.0.1'; then
  echo "[nginx-tls] WARNING: port 3001 appears to be bound to a non-loopback address." >&2
fi

# ---------------------------------------------------------------------------
# Step 3: Install Nginx + Certbot
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 3: Installing nginx and certbot"
apt-get update -q
apt-get install -y nginx python3-certbot-nginx

# ---------------------------------------------------------------------------
# Step 4: Deploy site config, remove default site
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 4: Deploying site config"
if [ ! -f "${NGINX_SRC}" ]; then
  echo "[nginx-tls] ERROR: site config not found at ${NGINX_SRC}" >&2
  exit 1
fi
cp "${NGINX_SRC}" /etc/nginx/sites-available/havenhold
sed -i "s|<HOSTNAME>|${HOSTNAME}|g" /etc/nginx/sites-available/havenhold
ln -sf /etc/nginx/sites-available/havenhold /etc/nginx/sites-enabled/havenhold
rm -f /etc/nginx/sites-enabled/default

# ---------------------------------------------------------------------------
# Step 5: Validate config and start Nginx
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 5: nginx -t + enable and start"
nginx -t
systemctl enable --now nginx

# ---------------------------------------------------------------------------
# Step 6: Issue certificate, configure HTTPS + redirect via Certbot
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 6: Certbot certificate issuance and HTTPS configuration"
certbot --nginx \
  -d "${HOSTNAME}" \
  --non-interactive \
  --agree-tos \
  -m "${EMAIL}" \
  --redirect

# ---------------------------------------------------------------------------
# Step 7: Second validation + reload after Certbot edits
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 7: Second nginx -t + reload"
nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
# Step 8: Enable certbot auto-renewal timer
# ---------------------------------------------------------------------------
echo "[nginx-tls] Step 8: Enable certbot.timer"
systemctl enable certbot.timer
systemctl start certbot.timer

echo "[nginx-tls] Done. Run 'sudo certbot renew --dry-run' to verify renewal posture."
