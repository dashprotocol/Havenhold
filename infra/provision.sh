#!/usr/bin/env bash
set -euo pipefail

# H-005 one-time host baseline hardening script for Ubuntu Lightsail.
# Run as: bash /tmp/provision.sh (as ubuntu user with sudo access)

DEPLOY_USER="${DEPLOY_USER:-havenadmin}"
SSH_PORT="${SSH_PORT:-22}"
ALLOW_UBUNTU_USER="${ALLOW_UBUNTU_USER:-true}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "ERROR: sudo is required."
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
}

log "Step 1/7: Updating OS packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get full-upgrade -y

log "Step 2/7: Installing security baseline packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades fail2ban ufw apt-listchanges

log "Step 3/7: Enabling unattended upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'AUTOPATCH'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOPATCH
systemctl enable unattended-upgrades >/dev/null 2>&1 || true
systemctl restart unattended-upgrades

log "Step 4/7: Creating admin user ${DEPLOY_USER}"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG sudo "${DEPLOY_USER}"
log "NOTE: ${DEPLOY_USER} is key-only for SSH and has no local sudo password yet."
log "After this script, set one with: sudo passwd ${DEPLOY_USER}"

install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
if [[ -f /home/ubuntu/.ssh/authorized_keys ]]; then
  cp /home/ubuntu/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
else
  log "WARNING: /home/ubuntu/.ssh/authorized_keys not found; add keys manually for ${DEPLOY_USER}."
fi

log "Step 5/7: Hardening SSH config"
ALLOW_USERS="${DEPLOY_USER}"
if [[ "${ALLOW_UBUNTU_USER}" == "true" ]]; then
  ALLOW_USERS="${ALLOW_USERS} ubuntu"
fi

cat >/etc/ssh/sshd_config.d/99-havenhold.conf <<EOF_SSH
Port ${SSH_PORT}
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
AllowUsers ${ALLOW_USERS}
EOF_SSH

# Some fresh images can miss this runtime dir until ssh is restarted.
install -d -m 0755 /run/sshd
sshd -t
systemctl restart ssh

log "Step 6/7: Configuring UFW"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

log "Step 7/7: Configuring fail2ban"
cat >/etc/fail2ban/jail.d/sshd.conf <<EOF_JAIL
[sshd]
enabled  = true
port     = ${SSH_PORT}
maxretry = 3
bantime  = 1h
findtime = 10m
EOF_JAIL

systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban

log "Hardening complete."
log "Validation commands:"
cat <<EOF_VALIDATE
sudo ufw status verbose
sudo ss -tulpen
sudo sshd -T | egrep 'port|permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers'
systemctl status unattended-upgrades --no-pager
sudo fail2ban-client status sshd
EOF_VALIDATE

if [[ "${SSH_PORT}" != "22" ]]; then
  log "IMPORTANT: open Lightsail firewall ${SSH_PORT}/tcp before closing your current session."
fi

log "Manual safety step: from your local machine, verify a NEW SSH login works before ending current session."
log "Post-step: if sudo prompts fail for ${DEPLOY_USER}, set local password: sudo passwd ${DEPLOY_USER}"
