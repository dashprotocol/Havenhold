#!/usr/bin/env bash
# Check disk usage on / and exit 1 if it exceeds the threshold.
# Intended to run via cron — pipe output through logger:
#   0 * * * * /opt/havenhold/scripts/check-disk.sh 2>&1 | logger -t havenhold-disk-check
set -euo pipefail

THRESHOLD=80
MOUNT="/"

USAGE=$(df "$MOUNT" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')

if [ "$USAGE" -ge "$THRESHOLD" ]; then
  echo "[check-disk] WARNING: $MOUNT at ${USAGE}% — threshold ${THRESHOLD}%"
  exit 1
else
  echo "[check-disk] OK: $MOUNT at ${USAGE}%"
fi
