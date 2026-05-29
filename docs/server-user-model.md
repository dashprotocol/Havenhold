# Server User Model: Why There Are Two Users

## The Core Idea

The server runs two distinct Linux users: `havenadmin` and `havenhold`. They are not interchangeable. Each exists for a specific purpose, and keeping them separate is a deliberate security design.

The principle behind it is called **least privilege**: every process should be able to access only what it strictly needs to do its job, and nothing more. If something goes wrong — a bug, a dependency vulnerability, a compromised session — the damage is limited to what that process was allowed to touch.

---

## The Two Users

### `havenadmin` — the operator

`havenadmin` is a real human-accessible account. It has a login shell, an SSH key, and `sudo` access. This is the account you use when you SSH into the server to do anything administrative: inspect logs, run migrations manually, troubleshoot, update configuration.

In the H-041 deployment pipeline, `havenadmin` is also the identity GitHub Actions uses via SSH to deploy. It SCPs the `.env` files onto the server and invokes `deploy.sh` via sudo.

**What `havenadmin` can do:**
- SSH into the server
- Run `sudo` (selectively, not full root)
- Write deployment artifacts (pull code, write `.env` files, build output)
- Restart the service via `deploy.sh`
- Read anything on the filesystem via `sudo`

### `havenhold` — the runtime

`havenhold` is a system account. It has no login shell, no SSH access, no sudo rights, and no home directory. You can never SSH in as `havenhold`. It exists for exactly one purpose: to be the identity the running Node.js application process runs under.

When systemd starts the API server (`havenhold-api.service`), it sets `User=havenhold`. Every HTTP request the app handles, every database query it runs, every file it reads or writes — all of that happens as `havenhold`.

**What `havenhold` can do:**
- Read its own configuration (`server/.env`)
- Write uploaded files to `uploads/`
- Connect to the database
- Handle incoming requests

**What `havenhold` cannot do:**
- SSH in
- Run sudo
- Read or write anything outside what it explicitly owns or has group access to
- Modify the application code or deployment scripts

---

## Why the Separation Matters

Imagine the app has a vulnerability — a dependency with a security flaw, or a bug that lets an attacker execute arbitrary code through an HTTP request. If the app runs as `havenadmin`, the attacker lands with an account that has sudo access, an SSH key, and write access to the entire codebase. They can modify `deploy.sh`, install backdoors, and escalate to root.

If the app runs as `havenhold`, the attacker lands with a locked-down service account that can only touch what the app itself touches — uploaded files and the database connection. The rest of the server is inaccessible to them.

This is the blast radius reduction the two-user model provides.

---

## File Ownership in Practice

The ownership pattern on the server follows directly from which user needs to interact with each file.

| Path | Owner | Permissions | Why |
|---|---|---|---|
| `/opt/havenhold/` (directory) | `havenadmin:havenadmin` | `755` | Deploy process manages the repo |
| `/opt/havenhold/server/node_modules/` | `havenadmin:havenadmin` | `755` | Written by `npm ci` during deploy |
| `/opt/havenhold/dist/` | `havenadmin:havenadmin` | `755` | Written by Vite build during deploy |
| `/opt/havenhold/server/.env` | `havenadmin:havenhold` | `640` | Written by deploy, read by service |
| `/opt/havenhold/server/uploads/` | `havenhold:havenhold` | `755` | Written at runtime by the app |

The `.env` file is the most interesting case. It sits at the boundary between the two users:

- The **deploy process** (`havenadmin`) writes it fresh on every deploy via SCP
- The **running service** (`havenhold`) reads it at startup via systemd's `EnvironmentFile=`

The `640` permission (owner read/write, group read, others nothing) with `havenadmin:havenhold` ownership is the exact solution to that dual-access requirement: `havenadmin` can write it, `havenhold` can read it via group membership, and no other user on the system can touch it.

---

## Understanding Linux Permission Notation

When you see `havenhold:havenhold 600` or `havenadmin:havenhold 640`, here is how to read it:

```
havenadmin : havenhold   640
 ^owner       ^group      ^permissions
```

The three-digit permission number maps to three groups of access:

```
6  4  0
^  ^  ^
|  |  └─ others (everyone else): no access
|  └──── group (havenhold):      read only
└─────── owner (havenadmin):     read + write
```

Each digit is a sum: read=4, write=2, execute=1. So `6` = read+write, `4` = read only, `0` = no access.

For `server/.env` with `havenadmin:havenhold 640`:
- `havenadmin` (the owner) can read and write it
- Any user in the `havenhold` group — which the `havenhold` service account is — can read it
- Everyone else gets nothing

For comparison, `havenhold:havenhold 600` (how it was set up in H-010):
- Only `havenhold` itself could read and write it
- The `havenhold` group had no access
- Everyone else got nothing

The shift from `600` to `640` was necessary when H-041 made `havenadmin` responsible for writing the file on every automated deploy. The `600` model worked when a human manually handed ownership to `havenhold` after writing it. Automation changed the ownership model.

---

## The Deploy Flow End to End

To make all of this concrete, here is what happens on every push to `main`:

1. GitHub Actions SSHes in as `havenadmin` and SCPs the fresh `.env` files onto the server. At this point the files are owned by `havenadmin:havenadmin`.
2. GitHub Actions SSHes in and runs `sudo /usr/bin/bash /opt/havenhold/infra/deploy.sh`.
3. `deploy.sh` runs as root (via sudo). It immediately runs `chown havenadmin:havenhold server/.env` and `chmod 640` — correcting the ownership so the service user can read it.
4. `deploy.sh` pulls the latest code, installs dependencies, builds, migrates, seeds.
5. `deploy.sh` restarts the `havenhold-api` systemd service.
6. systemd starts the Node.js process as `havenhold`. The process reads `server/.env` via group read access. The app is live.

At runtime, `havenadmin` is not involved at all. The running server is entirely `havenhold`'s domain.
