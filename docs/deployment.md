# Deployment Architecture

This document covers how Havenhold's deployment pipeline works, the decisions behind it, and how to operate it day-to-day. For the one-time setup steps, see `docs/tickets/feat-H-041-implementation-plan.md`.

---

## Architecture Overview

```
Push to main
     │
     ▼
GitHub Actions (ci.yml)
  ├─ frontend job: lint / test / build
  ├─ backend job:  test / build
  └─ deploy job (only on push, after CI passes)
       │
       ├─ Authenticate to AWS via OIDC
       │    └─ Assumes IAM role havenhold-github-actions
       │         (no static credentials stored anywhere)
       │
       ├─ Fetch secrets from SSM Parameter Store
       │    ├─ /havenhold/prod/server/*  → server.env
       │    └─ /havenhold/prod/frontend/* → frontend.env
       │
       ├─ Validate all required keys are present and non-empty
       │
       ├─ SCP .env files to Lightsail server
       │
       └─ SSH → sudo /usr/bin/bash /opt/havenhold/infra/deploy.sh
                  ├─ git pull
                  ├─ npm ci + build (frontend + backend)
                  ├─ prisma migrate deploy
                  ├─ prisma db seed
                  ├─ systemctl restart havenhold-api
                  └─ health check (30s poll)
```

**Key design decisions:**

- **OIDC, not static keys.** The GitHub Actions runner authenticates to AWS as a federated identity. AWS issues short-lived credentials per workflow run. No long-lived AWS key is stored in GitHub secrets or on the server. The IAM role trust policy is scoped to `repo:dashprotocol/Havenhold:ref:refs/heads/main` — other branches and forks cannot assume it.

- **SSM as the secrets source of truth.** All production env vars live in SSM Parameter Store under `/havenhold/prod/`. The `.env` files on the server are written at deploy time and treated as ephemeral build artifacts, not manually maintained files.

- **Why `.env` files, not app-fetches-at-startup.** Lightsail instances don't support EC2 instance profiles, so the running app has no IAM identity. Writing `.env` at deploy time is the correct pattern for this host type; systemd reads it once via `EnvironmentFile`.

---

## SSM Parameter Layout

All parameters live under `/havenhold/prod/`. SecureString is used for credentials; String for non-sensitive config.

### Server parameters (`/havenhold/prod/server/`)

| Parameter | Type | Notes |
|---|---|---|
| `DATABASE_URL` | SecureString | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | SecureString | Claude API key |
| `BETTER_AUTH_SECRET` | SecureString | Session signing secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | SecureString | Canonical API origin (`https://<hostname>`) |
| `CORS_ORIGIN` | SecureString | Allowed CORS origin (`https://<hostname>`) |
| `AWS_ACCESS_KEY_ID` | SecureString | havenhold-api IAM user key (S3 access) |
| `AWS_SECRET_ACCESS_KEY` | SecureString | havenhold-api IAM user secret |
| `AWS_S3_BUCKET` | String | From `terraform output bucket_name` |
| `AWS_REGION` | String | `us-east-1` |
| `NODE_ENV` | String | `production` |
| `PORT` | String | `3001` |
| `PIPELINE_ENABLED` | String | `true` / `false` |
| `INTEGRATIONS_ENABLED` | String | `true` / `false` |

### Frontend parameters (`/havenhold/prod/frontend/`)

| Parameter | Type | Notes |
|---|---|---|
| `VITE_AUTH_BASE_URL` | SecureString | `https://<hostname>` |
| `VITE_API_BASE_URL` | SecureString | `https://<hostname>/api` |

`VITE_PIPELINE_ENABLED` and `VITE_INTEGRATIONS_ENABLED` are not in SSM — the workflow appends safe defaults (`true` / `false`) if absent.

---

## GitHub Secrets and Variables

Stored in repo Settings → Secrets and variables → Actions.

| Type | Name | Value |
|---|---|---|
| Variable | `AWS_ROLE_ARN` | IAM role ARN from `terraform output github_actions_role_arn` |
| Secret | `DEPLOY_HOST` | Lightsail static IP |
| Secret | `DEPLOY_USER` | `adminuser` |
| Secret | `DEPLOY_SSH_KEY` | Full PEM content of the deploy private key |
| Secret | `DEPLOY_KNOWN_HOST` | **All lines** from `ssh-keyscan -H <STATIC_IP>` — store the full output, not just one key type |

`AWS_ROLE_ARN` is a variable (not a secret) because the role ARN is an identifier, not a credential.

---

## Day-to-Day Operations

### Deploying

Push to `main` (or merge a PR). The deploy job runs automatically after `frontend` and `backend` CI jobs pass. Monitor progress in the Actions tab.

The deploy job is **skipped** on pull requests — this is expected behavior.

### Updating a secret

```bash
aws ssm put-parameter --region us-east-1 --overwrite \
  --type SecureString \
  --name /havenhold/prod/server/<VAR_NAME> \
  --value "<new-value>"
```

The updated value takes effect on the next push to `main` — no server-side action needed.

### Rotating the deploy SSH key

```bash
# Generate new key
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/havenhold-deploy-new -N ""

# Add new public key to server (before removing old one)
ssh adminuser@<STATIC_IP> \
  "echo '$(cat ~/.ssh/havenhold-deploy-new.pub)' >> ~/.ssh/authorized_keys"

# Update DEPLOY_SSH_KEY GitHub secret with new private key content
# Verify a deploy succeeds, then remove the old public key from authorized_keys
```

---

## Emergency Manual Deploy

If GitHub Actions is unavailable, deploy manually. Requires the `.env` files to already exist on the server (they persist between automated deploys). If they've been deleted, recreate them from SSM first:

```bash
# Fetch and write server .env (run locally, requires AWS CLI with SSM access)
aws ssm get-parameters-by-path \
  --region us-east-1 --path /havenhold/prod/server --with-decryption \
  --query "Parameters[*].{Name:Name,Value:Value}" --output json \
| python3 -c "
import json, sys, pathlib
params = json.load(sys.stdin)
lines = [p['Name'].rsplit('/',1)[-1] + '=' + repr(p['Value']) for p in params]
pathlib.Path('server.env').write_text('\n'.join(lines)+'\n')
"
scp server.env adminuser@<STATIC_IP>:/opt/havenhold/server/.env

# Then SSH and run deploy.sh
ssh adminuser@<STATIC_IP> "sudo /usr/bin/bash /opt/havenhold/infra/deploy.sh"
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy job skipped on push to main | CI job (`frontend` or `backend`) failed | Check CI job logs; fix the failing test or build |
| `ERROR: Missing or empty required parameters` | SSM parameter missing or blank | Add/fix the parameter with `aws ssm put-parameter --overwrite` |
| `ERROR: SSM parameter X contains a newline` | SSM value has embedded newline | Re-store the value without newlines; EnvironmentFile format doesn't support them |
| `Permission denied` on SCP step | `/opt/havenhold` not owned by `adminuser` | SSH to server: `sudo chown -R adminuser:adminuser /opt/havenhold` |
| `Host key verification failed` | `DEPLOY_KNOWN_HOST` secret has wrong/incomplete fingerprint | Re-run `ssh-keyscan -H <STATIC_IP>` and update the secret with all output lines |
| `sudo: /usr/bin/bash: command not found` or permission error | Sudoers entry missing or path mismatch | SSH to server and verify `/etc/sudoers.d/havenhold-deploy` |
| Health check times out after deploy | Service failed to start | SSH to server: `journalctl -u havenhold-api -n 50` |

---

## Related

- `infra/deploy.sh` — the deploy script run on the server
- `infra/terraform/iam.tf` — OIDC provider, IAM role, and SSM policy definitions
- `.github/workflows/ci.yml` — CI and deploy workflow
- `docs/runbook/s3-iam.md` — S3 and havenhold-api IAM user setup
- `docs/architecture.md` — overall system architecture
- `docs/tickets/feat-H-041-implementation-plan.md` — implementation decisions and one-time setup steps
