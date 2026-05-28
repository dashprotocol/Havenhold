# Runbook: Nginx Reverse Proxy + TLS

## Purpose
Install and configure Nginx as a reverse proxy on the Havenhold app host, issue a Let's Encrypt TLS certificate for your production hostname, enforce HTTP → HTTPS redirect, and verify auto-renewal.

## Security Handling
- This runbook is git-tracked and must stay sanitized.
- Do not commit secrets, private keys, account tokens, or operator-only CIDRs if sensitive.
- Store key material in approved team secret storage.
- The `nginx-tls.sh` script is run under `sudo -E`; keep the Lightsail static IP and email address out of version control.

## Prerequisites
- Host hardening baseline is complete — admin user exists, UFW and fail2ban active.
- DNS `A` record for your hostname points to the Lightsail static IP (`havenhold-app-ip`).
- Cloudflare proxy status: **DNS only (grey cloud)** during initial cert issuance (HTTP-01 challenge must reach the host directly).
- Lightsail firewall inbound rules allow `80/tcp` and `443/tcp` from the internet.
- Repo checked out locally with `infra/nginx/havenhold` and `infra/nginx-tls.sh` present.

## Deploy Steps

Copy the site config and setup script to the host, then run the script remotely:

```bash
KEY_PATH=/path/to/key.pem
STATIC_IP=203.0.113.10
ADMIN_USER=adminuser
HOSTNAME=app.example.com
EMAIL=ops@example.com
scp -i "$KEY_PATH" infra/nginx/havenhold "$ADMIN_USER"@"$STATIC_IP":/tmp/havenhold-nginx
scp -i "$KEY_PATH" infra/nginx-tls.sh "$ADMIN_USER"@"$STATIC_IP":/tmp/nginx-tls.sh
ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP" \
  "HOSTNAME=$HOSTNAME EMAIL=$EMAIL STATIC_IP=$STATIC_IP sudo -E bash /tmp/nginx-tls.sh"
```

Replace the variable values with your real key path, host IP, admin username, hostname, and contact email before running.

The script is idempotent — it is safe to re-run if a step fails mid-way after fixing the underlying issue.

## D0 Verification Checklist
- [ ] DNS points hostname to correct static IP.
- [ ] Nginx active and healthy (`systemctl status nginx`).
- [ ] HTTPS endpoint responds with valid certificate for hostname.
- [ ] HTTP returns permanent redirect (301) to HTTPS.
- [ ] Renewal automation enabled (`certbot.timer` active).
- [ ] `certbot renew --dry-run` succeeds.
- [ ] Runbook updated with provisioning + renewal details.

## Evidence Commands
Run on host unless noted:

```bash
# Nginx health/config
sudo nginx -t
systemctl status nginx --no-pager

# Redirect behavior (expect 301)
curl -I http://app.example.com

# HTTPS response
curl -I https://app.example.com

# Certificate validity
echo | openssl s_client -servername app.example.com -connect app.example.com:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
sudo certbot certificates

# Renewal posture
systemctl status certbot.timer --no-pager
sudo certbot renew --dry-run
```

## Renewal Operations

### Check timer status
```bash
systemctl status certbot.timer --no-pager
systemctl list-timers certbot.timer
```

### Force manual renewal
```bash
sudo certbot renew --force-renewal
sudo nginx -t && sudo systemctl reload nginx
```

### Dry-run renewal (non-destructive verification)
```bash
sudo certbot renew --dry-run
```

### Troubleshoot renewal failures
```bash
# Check certbot logs
sudo journalctl -u certbot.timer --no-pager -n 50
sudo journalctl -u certbot.service --no-pager -n 50

# Verify nginx config after renewal attempt
sudo nginx -t
```

## Rollback / Recovery
- **Remove certificate and revert to HTTP-only:** `sudo certbot delete --cert-name app.example.com`, then restore the original `infra/nginx/havenhold` template to `/etc/nginx/sites-available/havenhold` and reload Nginx.
- **Stop Nginx entirely:** `sudo systemctl stop nginx` (takes site offline; use only in emergencies).
- **Restore from snapshot:** Take a Lightsail snapshot before running this script. If configuration is unrecoverable, restore the snapshot from the Lightsail console and re-run only the steps that failed.
- **Certbot-modified config is corrupt:** `sudo certbot rollback` reverts the last Certbot config checkpoint; then re-run from Step 6 of the script after resolving the underlying issue.

## Notes
- The committed `infra/nginx/havenhold` template is HTTP-only. Certbot modifies it in-place to add SSL directives and the redirect block. Do not pre-populate `ssl_` directives — they will conflict with Certbot's edits.
- HSTS (`Strict-Transport-Security`) is commented out in the template. Uncomment only after HTTPS is confirmed stable end-to-end, and be aware it is difficult to reverse once a browser caches the header.
- Add TLS expiry and uptime alerting in your observability workstream; until then, monitor `certbot.timer` via `journalctl`.
