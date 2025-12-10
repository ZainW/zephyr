# Deployment Guide

This guide covers deploying Zephyr CI on your own infrastructure.

## Table of Contents

- [Requirements](#requirements)
- [Quick Deploy (Local Execution)](#quick-deploy-local-execution)
- [Production Deploy (VM Execution)](#production-deploy-vm-execution)
- [Docker Deployment](#docker-deployment)
- [Systemd Service](#systemd-service)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Monitoring](#monitoring)

## Requirements

### Minimum (Local Execution)
- Linux, macOS, or Windows (WSL)
- [Bun](https://bun.sh) v1.0+
- 2 CPU cores, 4GB RAM

### Recommended (VM Execution)
- Linux with KVM support
- 16+ CPU cores, 64GB+ RAM
- 500GB+ SSD
- Firecracker v1.0+

## Quick Deploy (Local Execution)

For development or small workloads where VM isolation isn't required:

```bash
# 1. Clone and install
git clone https://github.com/yourusername/zephyr.git
cd zephyr
bun install

# 2. Start the server
bun run zephyr server --port 3000

# 3. (Optional) Start the web UI
bun run zephyr ui --port 8080
```

Jobs will execute directly on the host machine.

## Production Deploy (VM Execution)

For production with full isolation via Firecracker microVMs:

### 1. System Preparation

```bash
# Check KVM support
ls -la /dev/kvm
# Should show: crw-rw----+ 1 root kvm 10, 232 ... /dev/kvm

# If not available, enable KVM in BIOS and load module
sudo modprobe kvm
sudo modprobe kvm_intel  # or kvm_amd

# Add user to kvm group
sudo usermod -aG kvm $USER
```

### 2. Install Firecracker

```bash
# Download latest release
FIRECRACKER_VERSION="v1.10.1"
curl -L "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-x86_64.tgz" | tar xz

# Install binary
sudo mv release-${FIRECRACKER_VERSION}-x86_64/firecracker-${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/firecracker
sudo chmod +x /usr/local/bin/firecracker

# Verify
firecracker --version
```

### 3. Build VM Images

```bash
# Requires Docker and sudo access
bun run build:images

# This creates:
# - images/kernels/vmlinux (Linux kernel)
# - images/rootfs/alpine-rootfs.ext4 (Alpine rootfs with Zephyr agent)
```

### 4. Network Setup

```bash
# Enable IP forwarding
sudo sysctl -w net.ipv4.ip_forward=1

# Make persistent
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-zephyr.conf

# The VM manager will create TAP devices automatically
# NAT rules are also set up automatically per-VM
```

### 5. Create Runtime Directory

```bash
sudo mkdir -p /var/lib/zephyr
sudo chown $USER:$USER /var/lib/zephyr
```

### 6. Start the Server

```bash
bun run zephyr server \
  --port 3000 \
  --db /var/lib/zephyr/zephyr.db \
  --api-key "your-secret-api-key"
```

## Docker Deployment

### Build the Image

```dockerfile
# Dockerfile
FROM oven/bun:1.0-alpine

WORKDIR /app
COPY . .
RUN bun install --production

EXPOSE 3000
CMD ["bun", "run", "zephyr", "server"]
```

```bash
docker build -t zephyr-ci .
```

### Run with Docker

```bash
docker run -d \
  --name zephyr \
  -p 3000:3000 \
  -v zephyr-data:/app/data \
  -e ZEPHYR_API_KEY=your-secret \
  zephyr-ci
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  zephyr-server:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - zephyr-data:/app/data
    environment:
      - ZEPHYR_API_KEY=${ZEPHYR_API_KEY}
      - ZEPHYR_GITHUB_SECRET=${GITHUB_WEBHOOK_SECRET}
    restart: unless-stopped

  zephyr-ui:
    build: .
    command: ["bun", "run", "zephyr", "ui", "--api-url", "http://zephyr-server:3000"]
    ports:
      - "8080:8080"
    depends_on:
      - zephyr-server
    restart: unless-stopped

volumes:
  zephyr-data:
```

```bash
docker-compose up -d
```

## Systemd Service

### Create Service File

```ini
# /etc/systemd/system/zephyr.service
[Unit]
Description=Zephyr CI Server
After=network.target

[Service]
Type=simple
User=zephyr
Group=zephyr
WorkingDirectory=/opt/zephyr
ExecStart=/usr/local/bin/bun run zephyr server --port 3000 --db /var/lib/zephyr/zephyr.db
Restart=always
RestartSec=10

# Environment
Environment=ZEPHYR_API_KEY=your-secret-api-key
Environment=GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/zephyr

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
# Create user
sudo useradd -r -s /bin/false zephyr

# Set up directories
sudo mkdir -p /opt/zephyr /var/lib/zephyr
sudo chown zephyr:zephyr /var/lib/zephyr

# Copy files
sudo cp -r . /opt/zephyr
sudo chown -R zephyr:zephyr /opt/zephyr

# Enable service
sudo systemctl daemon-reload
sudo systemctl enable zephyr
sudo systemctl start zephyr

# Check status
sudo systemctl status zephyr
sudo journalctl -u zephyr -f
```

## Reverse Proxy Setup

### Nginx

```nginx
# /etc/nginx/sites-available/zephyr
upstream zephyr_api {
    server 127.0.0.1:3000;
}

upstream zephyr_ui {
    server 127.0.0.1:8080;
}

server {
    listen 80;
    server_name ci.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ci.example.com;

    ssl_certificate /etc/letsencrypt/live/ci.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ci.example.com/privkey.pem;

    # API endpoints
    location /api/ {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Webhooks
    location /webhooks/ {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /ws {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Metrics (restrict access)
    location /metrics {
        proxy_pass http://zephyr_api;
        allow 10.0.0.0/8;
        deny all;
    }

    # Web UI (everything else)
    location / {
        proxy_pass http://zephyr_ui;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Caddy

```caddyfile
# Caddyfile
ci.example.com {
    # API
    handle /api/* {
        reverse_proxy localhost:3000
    }

    # Webhooks
    handle /webhooks/* {
        reverse_proxy localhost:3000
    }

    # WebSocket
    handle /ws {
        reverse_proxy localhost:3000
    }

    # Metrics (internal only)
    handle /metrics {
        @internal remote_ip 10.0.0.0/8
        reverse_proxy @internal localhost:3000
        respond 403
    }

    # Web UI
    handle {
        reverse_proxy localhost:8080
    }
}
```

## Monitoring

### Prometheus

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'zephyr'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `zephyr_jobs_total` | Counter | Total jobs by status |
| `zephyr_jobs_active` | Gauge | Currently running jobs |
| `zephyr_job_duration_seconds` | Histogram | Job execution time |
| `zephyr_pipeline_runs_total` | Counter | Pipeline runs by trigger |
| `zephyr_queue_depth` | Gauge | Jobs waiting in queue |
| `zephyr_vm_pool_idle` | Gauge | Idle VMs in warm pool |
| `zephyr_vm_pool_active` | Gauge | Active VMs |
| `zephyr_vm_boot_seconds` | Histogram | VM boot time |
| `zephyr_http_requests_total` | Counter | HTTP requests |
| `zephyr_websocket_connections` | Gauge | Active WebSocket connections |

### Grafana Dashboard

Import the provided dashboard from `docs/grafana-dashboard.json` or create panels for:

- Job success rate
- Average job duration
- Queue depth over time
- VM pool utilization
- Request latency

### Health Check

```bash
curl http://localhost:3000/health
```

Returns:
```json
{
  "status": "ok",
  "running": true,
  "activeJobs": 2,
  "maxConcurrent": 4,
  "queueStats": {
    "pending": 5,
    "running": 2,
    "success": 142,
    "failure": 3
  }
}
```

## GitHub Webhook Setup

1. Go to your repository Settings → Webhooks → Add webhook
2. Set Payload URL: `https://ci.example.com/webhooks/github`
3. Content type: `application/json`
4. Secret: Your `GITHUB_WEBHOOK_SECRET`
5. Events: Select "Push" and "Pull requests"

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ZEPHYR_PORT` | Server port | `3000` |
| `ZEPHYR_HOST` | Bind address | `0.0.0.0` |
| `ZEPHYR_DB_PATH` | SQLite database path | `./zephyr.db` |
| `ZEPHYR_API_KEY` | API authentication key | (none) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook secret | (none) |
| `ZEPHYR_MAX_JOBS` | Max concurrent jobs | `4` |
| `ZEPHYR_LOG_LEVEL` | Log level | `info` |

## Troubleshooting

### KVM Permission Denied

```bash
sudo usermod -aG kvm $USER
# Log out and back in
```

### Firecracker Socket Error

```bash
# Ensure runtime directory exists and is writable
sudo mkdir -p /var/lib/zephyr/vms
sudo chown $USER:$USER /var/lib/zephyr/vms
```

### Network Issues in VMs

```bash
# Check IP forwarding
cat /proc/sys/net/ipv4/ip_forward  # Should be 1

# Check iptables NAT rules
sudo iptables -t nat -L -n
```

### Database Locked

```bash
# Only one process should access the database
# Check for stale processes
pgrep -f "zephyr server"
```
