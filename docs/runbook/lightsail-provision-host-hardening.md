# Runbook: Lightsail Provision + Host Hardening

## Purpose
Provision a single Havenhold MVP Lightsail host and apply baseline hardening to satisfy deploy gate `D0`.

## Security Handling
- This runbook is git-tracked and must stay sanitized.
- Do not commit secrets, private keys, account tokens, or operator-only CIDRs if sensitive.
- Store key material in approved team secret storage.

## Prerequisites
- AWS account access to Lightsail in `us-east-1`
- Existing Lightsail-compatible SSH key pair name (public key registered)
- Local tools if using helper script: `aws` CLI configured
- Repo checked out locally

## Resource Naming
- Instance: `havenhold-app-01`
- Static IP: `havenhold-app-ip`
- Admin user: `adminuser` (example; choose your own)

## Provision Path A: AWS Dashboard UI
1. In Lightsail (`us-east-1`), create instance:
- Platform: Linux/Unix
- Blueprint: Ubuntu `24.04 LTS`
- Plan: `small_3_0`
- Name: `havenhold-app-01`
- SSH key pair: select existing team key pair

2. Allocate and attach static IP:
- Name: `havenhold-app-ip`
- Attach to `havenhold-app-01`

3. Configure Lightsail firewall inbound rules:
- SSH: `22/tcp` (prefer operator CIDR allowlist)
- HTTP: `80/tcp` from internet
- HTTPS: `443/tcp` from internet

## Provision Path B (Optional helper script)
From repo root:

```bash
KEY_PAIR_NAME=<lightsail-key-name> ./infra/create-instance.sh
```

Optional custom SSH port:

```bash
KEY_PAIR_NAME=<lightsail-key-name> SSH_PORT=2222 ./infra/create-instance.sh
```

## Hardening Step (Remote)
Copy and execute once on the VM:

```bash
KEY_PATH=/path/to/key.pem
STATIC_IP=203.0.113.10
scp -i "$KEY_PATH" ./infra/provision.sh ubuntu@"$STATIC_IP":/tmp/provision.sh
ssh -i "$KEY_PATH" ubuntu@"$STATIC_IP" 'DEPLOY_USER=adminuser bash /tmp/provision.sh'
```

After script completion, set a local sudo password for the hardened admin user:

```bash
ssh -t -i "$KEY_PATH" ubuntu@"$STATIC_IP" 'sudo passwd adminuser'
```

Optional custom SSH port on host:

```bash
ssh -i "$KEY_PATH" ubuntu@"$STATIC_IP" 'DEPLOY_USER=adminuser SSH_PORT=2222 bash /tmp/provision.sh'
```

## Critical Safety Sequence (Avoid Lockout)
1. Keep current SSH session open.
2. If SSH port changed, confirm Lightsail firewall includes new port first.
3. From local machine, open a second SSH session with hardened user:

```bash
SSH_PORT=22
ssh -i "$KEY_PATH" -p "$SSH_PORT" adminuser@"$STATIC_IP"
```

4. Only close original session after second session succeeds.

## D0 Verification Checklist
- [ ] Lightsail instance exists in `us-east-1` with static IP attached.
- [ ] Lightsail inbound rules expose only required ports (`22/80/443` or `2222/80/443`).
- [ ] `ssh -p "$SSH_PORT" adminuser@"$STATIC_IP"` works with key auth.
- [ ] Root SSH login is rejected.
- [ ] Password SSH auth is rejected.
- [ ] UFW enabled with default deny inbound and only required ports allowed.
- [ ] `fail2ban` active with `sshd` jail loaded.
- [ ] `unattended-upgrades` enabled and healthy.
- [ ] This runbook + ticket plan are committed.

## Evidence Commands
Run on host unless noted:

```bash
# Firewall and listening state
sudo ufw status verbose
sudo ss -tulpen

# SSH hardening
sudo sshd -T | egrep 'port|permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers'

# Update posture
sudo unattended-upgrade --dry-run --debug
systemctl status unattended-upgrades --no-pager

# Abuse protection
sudo fail2ban-client status sshd
```

Optional from local machine:

```bash
nmap -p "$SSH_PORT",80,443 "$STATIC_IP"
```

## Rollback / Recovery
- Take a Lightsail snapshot before major SSH/firewall changes.
- If locked out, use Lightsail browser-based access (if available) to restore SSH/UFW config.
- Re-open `22/tcp` temporarily in Lightsail firewall if custom port migration fails.

## Notes
- Non-default SSH port reduces scan noise but does not replace strong key-only auth.
- Dual-layer controls are required: Lightsail firewall and UFW.
