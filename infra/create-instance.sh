#!/usr/bin/env bash
set -euo pipefail

# Optional provisioning helper.
# This script uses AWS CLI to provision a Lightsail instance with a static IP and minimal public ports.
# Keep the provisioning runbook as the operational source of truth.

INSTANCE_NAME="${INSTANCE_NAME:-havenhold-app-01}"
STATIC_IP_NAME="${STATIC_IP_NAME:-havenhold-app-ip}"
REGION="${REGION:-us-east-1}"
AZ="${AZ:-us-east-1a}"
BLUEPRINT_ID="${BLUEPRINT_ID:-ubuntu_24_04}"
BUNDLE_ID="${BUNDLE_ID:-small_3_0}"
KEY_PAIR_NAME="${KEY_PAIR_NAME:-}"
SSH_PORT="${SSH_PORT:-22}"
SSH_CIDR="${SSH_CIDR:-0.0.0.0/0}"

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found. Install and configure it first."
  exit 1
fi

if [[ -z "${KEY_PAIR_NAME}" ]]; then
  echo "ERROR: KEY_PAIR_NAME is required."
  echo "Example: KEY_PAIR_NAME=havenhold-app-key ./infra/create-instance.sh"
  exit 1
fi

echo "[1/6] Creating instance ${INSTANCE_NAME} in ${AZ}..."
aws lightsail create-instances \
  --region "${REGION}" \
  --instance-names "${INSTANCE_NAME}" \
  --availability-zone "${AZ}" \
  --blueprint-id "${BLUEPRINT_ID}" \
  --bundle-id "${BUNDLE_ID}" \
  --key-pair-name "${KEY_PAIR_NAME}" >/dev/null

echo "[2/6] Waiting for instance state=running..."
for _ in $(seq 1 60); do
  state="$(aws lightsail get-instance-state \
    --region "${REGION}" \
    --instance-name "${INSTANCE_NAME}" \
    --query 'state.name' \
    --output text 2>/dev/null || true)"
  if [[ "${state}" == "running" ]]; then
    break
  fi
  sleep 5
done

if [[ "${state:-}" != "running" ]]; then
  echo "ERROR: instance did not reach running state in time."
  exit 1
fi

echo "[3/6] Allocating static IP ${STATIC_IP_NAME} (if needed)..."
if ! aws lightsail get-static-ip --region "${REGION}" --static-ip-name "${STATIC_IP_NAME}" >/dev/null 2>&1; then
  aws lightsail allocate-static-ip \
    --region "${REGION}" \
    --static-ip-name "${STATIC_IP_NAME}" >/dev/null
fi

echo "[4/6] Attaching static IP..."
aws lightsail attach-static-ip \
  --region "${REGION}" \
  --static-ip-name "${STATIC_IP_NAME}" \
  --instance-name "${INSTANCE_NAME}" >/dev/null

echo "[5/6] Configuring public ports (Lightsail firewall)..."
# Use put-instance-public-ports so we enforce an exact allowlist and close any stale open ports.
aws lightsail put-instance-public-ports \
  --region "${REGION}" \
  --instance-name "${INSTANCE_NAME}" \
  --port-infos \
    "fromPort=${SSH_PORT},toPort=${SSH_PORT},protocol=TCP,cidrs=${SSH_CIDR}" \
    "fromPort=80,toPort=80,protocol=TCP,cidrs=0.0.0.0/0" \
    "fromPort=443,toPort=443,protocol=TCP,cidrs=0.0.0.0/0" >/dev/null

STATIC_IP="$(aws lightsail get-static-ip \
  --region "${REGION}" \
  --static-ip-name "${STATIC_IP_NAME}" \
  --query 'staticIp.ipAddress' \
  --output text)"

echo "[6/6] Complete"
echo "Instance:   ${INSTANCE_NAME}"
echo "Static IP:  ${STATIC_IP}"
echo "SSH port:   ${SSH_PORT}"
echo

echo "Next steps:"
echo "1) Copy provision script: scp -i <key.pem> ./infra/provision.sh ubuntu@${STATIC_IP}:/tmp/provision.sh"
echo "2) Run it: ssh -i <key.pem> -p ${SSH_PORT} ubuntu@${STATIC_IP} 'bash /tmp/provision.sh'"
echo "Tip: lock SSH source CIDR via SSH_CIDR=203.0.113.10/32 when possible."
