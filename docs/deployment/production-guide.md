# GarrisonOS Production Deployment & Operator Runbook

This guide details the procedures for deploying, supervising, and securing **GarrisonOS** in single-server production environments. GarrisonOS is engineered as a zero-dependency, self-contained application requiring only Node.js 24 LTS or a standard container runtime.

---

## 1. System Requirements & Architecture

* **Operating System**: Linux (Ubuntu 22.04/24.04 LTS, Debian 12, RHEL 9, Rocky Linux, Alpine 3.20+).
* **Hardware**:
  * Minimum: 1 vCPU, 1 GB RAM, 10 GB SSD.
  * Recommended: 2 vCPU, 2 GB RAM, 25+ GB NVMe SSD.
* **Runtime**: Node.js `v24.0.0+` (native `node:sqlite`, `node:crypto`, `node:http`). Zero external npm packages required.
* **Network**: Loopback binding (`127.0.0.1:3000`) fronted by a reverse proxy (Caddy or Nginx) providing TLS termination and HSTS enforcement.

```text
                  [ Public Ingress: HTTPS / Port 443 ]
                                   │
                                   ▼
                  ┌─────────────────────────────────┐
                  │ Reverse Proxy (Caddy / Nginx)   │
                  │ TLS 1.3, Rate Limits, CSP/HSTS  │
                  └────────────────┬────────────────┘
                                   │  HTTP (127.0.0.1:3000)
                                   ▼
                  ┌─────────────────────────────────┐
                  │ GarrisonOS Application Process  │
                  │ (Systemd Daemon or Container)   │
                  │                                 │
                  │ ┌───────────────┐ ┌───────────┐ │
                  │ │ REST Engine   │ │ TS SSR UI │ │
                  │ └───────┬───────┘ └─────┬─────┘ │
                  │         │               │       │
                  │   ┌─────▼───────────────▼─────┐ │
                  │   │ Embedded SQLite (WAL)     │ │
                  │   │ /app/data/garrison.sqlite │ │
                  │   └───────────────────────────┘ │
                  └─────────────────────────────────┘
```

---

## 2. Option A: Native Systemd Deployment

### Step 1: Create System User & Directories

```bash
sudo useradd -r -s /bin/false -d /opt/garrison garrison
sudo mkdir -p /opt/garrison /opt/garrison/storage /opt/garrison/data /etc/garrison
sudo chown -R garrison:garrison /opt/garrison
```

### Step 2: Extract Application Assets & Build

```bash
cd /opt/garrison
# Extract release tarball (or clone repository)
# Verify cryptographic signatures:
sha256sum -c SHA256SUMS

# Compile TypeScript into dist/
sudo -u garrison npm run build
```

### Step 3: Configure Environment Variables

Create `/etc/garrison/garrison.env` with strict permissions (`600`):

```bash
sudo touch /etc/garrison/garrison.env
sudo chmod 600 /etc/garrison/garrison.env
```

Populate `/etc/garrison/garrison.env`:

```ini
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
# Generate using: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_SECRET=your-64-character-random-hex-secret-must-be-kept-safe
SQLITE_PATH=/opt/garrison/data/garrison.sqlite
STORAGE_PATH=/opt/garrison/storage
BACKUP_INTERVAL_MINUTES=360
BACKUP_RETENTION_COUNT=14
```

### Step 4: Install Systemd Service Unit

```bash
sudo cp deploy/systemd/garrison.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now garrison.service
```

### Step 5: Verify Service Status & Logs

```bash
sudo systemctl status garrison.service
sudo journalctl -u garrison.service -f
curl http://127.0.0.1:3000/health
```

---

## 3. Option B: Docker & Container Deployment

GarrisonOS provides a hardened, multi-stage Alpine Dockerfile with a non-root system user and minimal attack surface.

### Step 1: Configure Environment

```bash
cp .env.example .env
# Edit .env and supply a strong APP_SECRET:
sed -i "s/APP_SECRET=.*/APP_SECRET=$(openssl rand -hex 32)/" .env
```

### Step 2: Launch via Docker Compose

```bash
# Start GarrisonOS application container
docker compose up -d garrison

# Verify health status
docker compose ps
docker compose logs -f garrison
```

### Step 3: Turnkey Automated SSL with Caddy

If you do not have an existing host reverse proxy, launch GarrisonOS alongside the turnkey Caddy reverse proxy:

```bash
DOMAIN="properties.yourdomain.com" docker compose --profile caddy up -d
```

Caddy will automatically obtain a Let's Encrypt TLS certificate, renew it before expiration, and configure hardened security headers.

---

## 4. Reverse Proxy Setup (Host-Level)

If running native Systemd or using a host-level web server:

### Option A: Caddy (Recommended)

Copy [deploy/caddy/Caddyfile](../../deploy/caddy/Caddyfile) to `/etc/caddy/Caddyfile` and replace `{$DOMAIN}` with your domain name:

```bash
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Option B: Nginx

Copy [deploy/nginx/nginx.conf](../../deploy/nginx/nginx.conf) to `/etc/nginx/conf.d/garrison.conf`, configure your SSL certificates, and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5. Automated Backups & Disaster Recovery

GarrisonOS features an in-process, zero-dependency `BackupScheduler` daemon that executes periodic snapshots (default interval: 360 minutes / 6 hours, configured via `BACKUP_INTERVAL_MINUTES`), providing a recovery-point objective (RPO) based on the latest available snapshot.

### Operational Backup Behaviors

1. **WAL Checkpoints**: Flushes write-ahead log pages before every snapshot via `PRAGMA wal_checkpoint(TRUNCATE)`.
2. **Vacuum & Optimization**: Runs SQLite vacuum and index optimization routines automatically.
3. **Point-in-Time Retention**: Retains the configured number of snapshots (`BACKUP_RETENTION_COUNT`, default: 14) and prunes older archives safely.
4. **On-Demand Admin Snapshot**: Administrators can trigger instant snapshots via the Backup Dashboard at `/settings/backup` or via REST API (`POST /api/v1/backups/scheduler/trigger`).

### Disaster Recovery: Full Database Restore

To restore from a backup snapshot:

```bash
# 1. Stop the application service
sudo systemctl stop garrison.service

# 2. Back up the active database (if present)
sudo cp /opt/garrison/data/garrison.sqlite /opt/garrison/data/garrison.sqlite.bak.$(date +%s)

# 3. Restore snapshot file
sudo cp /opt/garrison/storage/backups/backup_YYYY-MM-DD_HHMMSS.sqlite /opt/garrison/data/garrison.sqlite
sudo chown garrison:garrison /opt/garrison/data/garrison.sqlite

# 4. Restart service
sudo systemctl start garrison.service
```

---

## 6. Pre-Flight Security Checklist

Before exposing the instance to production users, verify:

* [ ] `APP_SECRET` contains at least 64 hexadecimal characters (32 bytes) and is kept confidential.
* [ ] Direct network ingress to port 3000 is blocked by host firewall (`ufw` or `iptables`); only reverse proxy access on ports 80/443 is permitted.
* [ ] TLS certificate is active with strict HTTPS redirection enabled.
* [ ] System initial setup (`/setup`) is completed and owner account credentials are saved in a password manager.
* [ ] Automated backup scheduler is verified running via `/settings/backup`.
* [ ] Directory permissions on `/opt/garrison/storage` and `/opt/garrison/data` are restricted to the `garrison` user.
