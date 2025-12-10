# Zephyr CI Self-Hosting Guide

Complete guide for setting up a self-hosted Zephyr CI runner on Arch Linux or Ubuntu. This guide is designed to be followed step-by-step by both humans and automated agents.

Zephyr CI uses **Firecracker microVMs** for secure, isolated job execution. Each CI job runs in its own lightweight VM with ~125ms boot time, providing hardware-level isolation without the overhead of traditional VMs.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Automated)](#quick-start-automated)
- [Manual Installation](#manual-installation)
  - [1. System Dependencies](#1-system-dependencies)
  - [2. Install Bun Runtime](#2-install-bun-runtime)
  - [3. Install Zephyr CI](#3-install-zephyr-ci)
  - [4. KVM and Firecracker Setup](#4-kvm-and-firecracker-setup)
  - [5. Build VM Images](#5-build-vm-images)
  - [6. Configure the Server](#6-configure-the-server)
  - [7. Set Up GitHub Integration](#7-set-up-github-integration)
  - [8. Start the Server](#8-start-the-server)
  - [9. Configure as System Service](#9-configure-as-system-service)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Hardware Requirements

**Minimum:**
- 4 CPU cores
- 8GB RAM
- 50GB SSD
- CPU with virtualization support (Intel VT-x or AMD-V)

**Recommended:**
- 16+ CPU cores
- 64GB+ RAM
- 500GB+ SSD
- NVMe storage for faster VM boot

### Network Requirements

- Public IP or domain name (for GitHub webhooks)
- Ports: 3000 (API), 8080 (Web UI), 443 (HTTPS via reverse proxy)
- Outbound internet access for cloning repositories

### VPS Provider Compatibility

Zephyr requires **nested virtualization** or **bare metal** access for KVM. Compatible providers:

| Provider | Works | Notes |
|----------|-------|-------|
| Hetzner (Dedicated) | Yes | Full KVM support |
| Hetzner (Cloud) | Yes | Enable "Local SSD" for better I/O |
| DigitalOcean (Dedicated) | Yes | Premium CPU droplets |
| AWS (Bare Metal) | Yes | i3.metal, c5.metal instances |
| AWS (EC2) | Partial | Requires .metal instance types |
| GCP (Sole-tenant) | Yes | Enable nested virtualization |
| Vultr (Bare Metal) | Yes | Full KVM support |
| OVH (Dedicated) | Yes | Full KVM support |
| Linode | No | No nested virtualization |
| Standard VPS | No | Most don't support nested virt |

**Verify KVM support on your VPS:**
```bash
# Check for virtualization extensions
grep -E '(vmx|svm)' /proc/cpuinfo

# Check if /dev/kvm exists
ls -la /dev/kvm
```

---

## Quick Start (Automated)

For automated setup, use the provided scripts:

```bash
# Arch Linux
curl -fsSL https://raw.githubusercontent.com/yourusername/zephyr/main/scripts/setup-arch.sh | bash

# Ubuntu (20.04, 22.04, 24.04)
curl -fsSL https://raw.githubusercontent.com/yourusername/zephyr/main/scripts/setup-ubuntu.sh | bash
```

Or clone the repository and run locally:

```bash
git clone https://github.com/yourusername/zephyr.git
cd zephyr

# Arch Linux
./scripts/setup-arch.sh

# Ubuntu
./scripts/setup-ubuntu.sh
```

**Non-interactive mode** (for automation/agents):

```bash
# Set environment variables and run unattended
ZEPHYR_AUTO=1 \
ZEPHYR_DOMAIN=ci.yourdomain.com \
ZEPHYR_MAX_JOBS=8 \
./scripts/setup-ubuntu.sh
```

---

## Manual Installation

### 1. System Dependencies

#### Arch Linux

```bash
# Update system
sudo pacman -Syu

# Install base dependencies
sudo pacman -S --needed \
    base-devel \
    git \
    curl \
    wget \
    unzip \
    jq \
    openssl \
    sqlite \
    docker \
    iproute2 \
    iptables \
    e2fsprogs

# For VM execution (optional)
sudo pacman -S --needed \
    qemu-base \
    libvirt \
    bridge-utils

# Enable and start Docker
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

#### Ubuntu

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install base dependencies
sudo apt install -y \
    build-essential \
    git \
    curl \
    wget \
    unzip \
    jq \
    openssl \
    libssl-dev \
    sqlite3 \
    libsqlite3-dev \
    ca-certificates \
    gnupg \
    iproute2 \
    iptables \
    e2fsprogs

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# For VM execution (optional)
sudo apt install -y \
    qemu-system-x86 \
    libvirt-daemon-system \
    bridge-utils
```

**Important:** Log out and back in after adding yourself to the docker group.

### 2. Install Bun Runtime

Bun is required to run Zephyr CI.

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Add to PATH (add to ~/.bashrc or ~/.zshrc for persistence)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Verify installation
bun --version
# Should output: 1.x.x
```

### 3. Install Zephyr CI

#### Option A: From GitHub Packages (Recommended)

```bash
# Configure npm to use GitHub Packages for @zephyrr-ci scope
# You need a GitHub Personal Access Token with read:packages scope
export GITHUB_TOKEN="your_github_token"

# Create or update .npmrc
echo "@zephyrr-ci:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" >> ~/.npmrc

# Install CLI globally
bun add -g @zephyrr-ci/cli

# Verify installation
zephyr --help
```

#### Option B: From Source

```bash
# Clone the repository
git clone https://github.com/yourusername/zephyr.git
cd zephyr

# Install dependencies
bun install

# Build all packages
bun run build

# Link CLI globally (optional)
cd packages/cli
bun link
```

### 4. KVM and Firecracker Setup

Zephyr uses Firecracker microVMs for secure job isolation. This requires KVM support.

#### 4.1 Verify and Enable KVM

```bash
# Check if KVM is available
ls -la /dev/kvm

# If not available, load the kernel module
# For Intel CPUs:
sudo modprobe kvm_intel

# For AMD CPUs:
sudo modprobe kvm_amd

# Make persistent (Arch)
echo "kvm_intel" | sudo tee /etc/modules-load.d/kvm.conf
# OR for AMD:
echo "kvm_amd" | sudo tee /etc/modules-load.d/kvm.conf

# Make persistent (Ubuntu)
echo "kvm_intel" | sudo tee -a /etc/modules
# OR for AMD:
echo "kvm_amd" | sudo tee -a /etc/modules

# Add user to kvm group
sudo usermod -aG kvm $USER

# Verify (after logging out and back in)
ls -la /dev/kvm
# Should show: crw-rw----+ 1 root kvm 10, 232 ... /dev/kvm
```

#### 4.2 Install Firecracker

```bash
# Set version
FIRECRACKER_VERSION="v1.10.1"
ARCH=$(uname -m)

# Download and extract
curl -L "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-${ARCH}.tgz" | tar xz

# Install binaries
sudo mv release-${FIRECRACKER_VERSION}-${ARCH}/firecracker-${FIRECRACKER_VERSION}-${ARCH} /usr/local/bin/firecracker
sudo mv release-${FIRECRACKER_VERSION}-${ARCH}/jailer-${FIRECRACKER_VERSION}-${ARCH} /usr/local/bin/jailer
sudo chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer

# Cleanup
rm -rf release-${FIRECRACKER_VERSION}-${ARCH}

# Verify
firecracker --version
```

#### 4.3 Configure Network

```bash
# Enable IP forwarding
sudo sysctl -w net.ipv4.ip_forward=1

# Make persistent
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-zephyr.conf
sudo sysctl --system
```

### 5. Build VM Images

Build the kernel and rootfs images that Firecracker will use to run CI jobs.

```bash
cd /path/to/zephyr

# Build all images (kernel + rootfs)
# Requires Docker and sudo access
bun run build:images

# This creates:
# - images/kernels/vmlinux (Linux kernel)
# - images/rootfs/alpine-rootfs.ext4 (Alpine rootfs with Zephyr agent)

# Verify
ls -la images/kernels/
ls -la images/rootfs/
```

### 6. Configure the Server

#### 6.1 Create Runtime Directories

```bash
# Create directories
sudo mkdir -p /var/lib/zephyr/{db,vms,cache,logs}
sudo mkdir -p /opt/zephyr

# Set ownership
sudo chown -R $USER:$USER /var/lib/zephyr
sudo chown -R $USER:$USER /opt/zephyr
```

#### 6.2 Generate Secrets

```bash
# Generate API key
export ZEPHYR_API_KEY=$(openssl rand -hex 32)
echo "ZEPHYR_API_KEY=${ZEPHYR_API_KEY}"

# Generate GitHub webhook secret
export GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}"

# Save to environment file
cat > /var/lib/zephyr/.env << EOF
ZEPHYR_API_KEY=${ZEPHYR_API_KEY}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
ZEPHYR_PORT=3000
ZEPHYR_HOST=0.0.0.0
ZEPHYR_DB_PATH=/var/lib/zephyr/db/zephyr.db
ZEPHYR_MAX_JOBS=4
ZEPHYR_LOG_LEVEL=info
EOF

# Secure the file
chmod 600 /var/lib/zephyr/.env
```

### 7. Set Up GitHub Integration

#### 7.1 Create a GitHub App (Recommended)

1. Go to **GitHub Settings** > **Developer settings** > **GitHub Apps** > **New GitHub App**

2. Fill in the details:
   - **GitHub App name**: `Zephyr CI` (or your preferred name)
   - **Homepage URL**: `https://ci.yourdomain.com`
   - **Webhook URL**: `https://ci.yourdomain.com/webhooks/github`
   - **Webhook secret**: Use the `GITHUB_WEBHOOK_SECRET` generated above

3. Set permissions:
   - **Repository permissions**:
     - Contents: Read-only
     - Metadata: Read-only
     - Pull requests: Read-only
     - Commit statuses: Read and write (for status checks)
   - **Subscribe to events**:
     - Push
     - Pull request
     - Create (for tags)

4. Click **Create GitHub App**

5. After creation:
   - Note the **App ID**
   - Generate and download a **Private Key**
   - Install the app on your repositories

#### 7.2 Alternative: Repository Webhook

For simpler setups without a GitHub App:

1. Go to your repository **Settings** > **Webhooks** > **Add webhook**

2. Configure:
   - **Payload URL**: `https://ci.yourdomain.com/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: Use the `GITHUB_WEBHOOK_SECRET` generated above
   - **Events**: Select "Let me select individual events"
     - Push
     - Pull requests

3. Click **Add webhook**

### 8. Start the Server

#### 8.1 Quick Start (Development)

```bash
# Load environment
source /var/lib/zephyr/.env

# Start the API server
zephyr server \
  --port ${ZEPHYR_PORT} \
  --db ${ZEPHYR_DB_PATH} \
  --api-key ${ZEPHYR_API_KEY} \
  --github-secret ${GITHUB_WEBHOOK_SECRET} \
  --max-jobs ${ZEPHYR_MAX_JOBS}

# In another terminal, start the Web UI
zephyr ui --port 8080 --api-url http://localhost:3000
```

#### 8.2 Using Docker Compose

```bash
# Create docker-compose.yml
cat > /opt/zephyr/docker-compose.yml << 'EOF'
version: '3.8'

services:
  zephyr-server:
    image: oven/bun:1.0-alpine
    working_dir: /app
    command: ["bun", "run", "zephyr", "server"]
    ports:
      - "3000:3000"
    volumes:
      - /var/lib/zephyr:/var/lib/zephyr
      - ./:/app
    environment:
      - ZEPHYR_API_KEY=${ZEPHYR_API_KEY}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - ZEPHYR_DB_PATH=/var/lib/zephyr/db/zephyr.db
    restart: unless-stopped

  zephyr-ui:
    image: oven/bun:1.0-alpine
    working_dir: /app
    command: ["bun", "run", "zephyr", "ui", "--api-url", "http://zephyr-server:3000"]
    ports:
      - "8080:8080"
    depends_on:
      - zephyr-server
    restart: unless-stopped

volumes:
  zephyr-data:
EOF

# Start services
cd /opt/zephyr
docker-compose up -d

# Check logs
docker-compose logs -f
```

### 9. Configure as System Service

#### 9.1 Create Zephyr User

```bash
# Create system user
sudo useradd -r -m -s /bin/bash zephyr

# Add to required groups
sudo usermod -aG docker zephyr
sudo usermod -aG kvm zephyr  # If using VM execution

# Set directory ownership
sudo chown -R zephyr:zephyr /var/lib/zephyr
sudo chown -R zephyr:zephyr /opt/zephyr
```

#### 9.2 Create Systemd Service

```bash
# Create service file
sudo tee /etc/systemd/system/zephyr.service << 'EOF'
[Unit]
Description=Zephyr CI Server
Documentation=https://github.com/yourusername/zephyr
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=zephyr
Group=zephyr
WorkingDirectory=/opt/zephyr
EnvironmentFile=/var/lib/zephyr/.env
ExecStart=/home/zephyr/.bun/bin/bun run zephyr server --port ${ZEPHYR_PORT} --db ${ZEPHYR_DB_PATH} --api-key ${ZEPHYR_API_KEY} --github-secret ${GITHUB_WEBHOOK_SECRET} --max-jobs ${ZEPHYR_MAX_JOBS}
Restart=always
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zephyr

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/zephyr
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Create UI service (optional)
sudo tee /etc/systemd/system/zephyr-ui.service << 'EOF'
[Unit]
Description=Zephyr CI Web UI
After=zephyr.service
Requires=zephyr.service

[Service]
Type=simple
User=zephyr
Group=zephyr
WorkingDirectory=/opt/zephyr
ExecStart=/home/zephyr/.bun/bin/bun run zephyr ui --port 8080 --api-url http://localhost:3000
Restart=always
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=zephyr-ui

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
sudo systemctl daemon-reload

# Enable and start services
sudo systemctl enable zephyr zephyr-ui
sudo systemctl start zephyr zephyr-ui

# Check status
sudo systemctl status zephyr
sudo systemctl status zephyr-ui

# View logs
sudo journalctl -u zephyr -f
```

#### 9.3 Set Up Reverse Proxy (Nginx)

```bash
# Install Nginx (Arch)
sudo pacman -S nginx certbot certbot-nginx

# Install Nginx (Ubuntu)
sudo apt install -y nginx certbot python3-certbot-nginx

# Create configuration
sudo tee /etc/nginx/sites-available/zephyr << 'EOF'
upstream zephyr_api {
    server 127.0.0.1:3000;
    keepalive 32;
}

upstream zephyr_ui {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 80;
    server_name ci.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ci.yourdomain.com;

    # SSL certificates (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/ci.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ci.yourdomain.com/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    # API endpoints
    location /api/ {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # GitHub webhooks
    location /webhooks/ {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
    }

    # Prometheus metrics (restrict to internal networks)
    location /metrics {
        proxy_pass http://zephyr_api;
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        allow 127.0.0.1;
        deny all;
    }

    # WebSocket for real-time logs
    location /ws {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # Web UI (default)
    location / {
        proxy_pass http://zephyr_ui;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable site (Ubuntu)
sudo ln -sf /etc/nginx/sites-available/zephyr /etc/nginx/sites-enabled/

# For Arch, add include to nginx.conf or use sites-enabled pattern

# Test configuration
sudo nginx -t

# Get SSL certificate
sudo certbot --nginx -d ci.yourdomain.com

# Restart Nginx
sudo systemctl restart nginx
```

---

## Verification

### Test the Installation

```bash
# 1. Check health endpoint
curl -s http://localhost:3000/health | jq .

# Expected output:
# {
#   "status": "ok",
#   "running": true,
#   "activeJobs": 0,
#   "maxConcurrent": 4,
#   "queueStats": {...}
# }

# 2. Test API authentication
curl -s -H "Authorization: Bearer ${ZEPHYR_API_KEY}" \
  http://localhost:3000/api/v1/projects | jq .

# 3. Test webhook endpoint (simulate GitHub ping)
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  http://localhost:3000/webhooks/github

# 4. Check metrics endpoint
curl -s http://localhost:3000/metrics

# 5. If using HTTPS, verify external access
curl -s https://ci.yourdomain.com/health | jq .
```

### Create a Test Project

```bash
# Create a test directory
mkdir -p ~/zephyr-test
cd ~/zephyr-test

# Initialize a project
zephyr init

# Edit zephyr.config.ts as needed

# Run locally to test
zephyr run
```

### Verify GitHub Webhook

1. Go to your repository's webhook settings
2. Check the "Recent Deliveries" tab
3. Look for a successful ping event (green checkmark)
4. If failed, check the response body for error details

---

## Troubleshooting

### Common Issues

#### "KVM permission denied"

```bash
# Check if user is in kvm group
groups $USER

# Add to kvm group if missing
sudo usermod -aG kvm $USER

# Log out and back in, then verify
ls -la /dev/kvm
```

#### "Firecracker socket error"

```bash
# Ensure runtime directory exists
sudo mkdir -p /var/lib/zephyr/vms
sudo chown $USER:$USER /var/lib/zephyr/vms

# Check for stale sockets
rm -f /var/lib/zephyr/vms/*.sock
```

#### "Network issues in VMs"

```bash
# Verify IP forwarding is enabled
cat /proc/sys/net/ipv4/ip_forward
# Should output: 1

# Check iptables NAT rules
sudo iptables -t nat -L -n -v

# Manually enable if needed
sudo sysctl -w net.ipv4.ip_forward=1
```

#### "Database locked"

```bash
# Check for multiple processes
pgrep -f "zephyr server"

# Kill stale processes if needed
sudo systemctl stop zephyr
pkill -f "zephyr server"

# Restart
sudo systemctl start zephyr
```

#### "Webhook signature verification failed"

```bash
# Verify the secret matches
echo $GITHUB_WEBHOOK_SECRET

# Check GitHub webhook settings match
# Re-generate if necessary:
export GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)
echo $GITHUB_WEBHOOK_SECRET
# Update both .env file and GitHub webhook settings
```

#### "Bun not found"

```bash
# Ensure Bun is in PATH
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Add to shell profile
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc

# For zephyr user
sudo -u zephyr bash -c 'curl -fsSL https://bun.sh/install | bash'
```

### Logs and Debugging

```bash
# View Zephyr server logs
sudo journalctl -u zephyr -f

# View UI logs
sudo journalctl -u zephyr-ui -f

# Enable debug mode
export DEBUG=1
zephyr server --port 3000 ...

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Check Docker logs (if using Docker)
docker-compose logs -f zephyr-server
```

### Getting Help

- GitHub Issues: https://github.com/yourusername/zephyr/issues
- Documentation: https://github.com/yourusername/zephyr/tree/main/docs

---

## Next Steps

1. **Create your first pipeline**: See [Configuration Reference](configuration.md)
2. **Set up monitoring**: See [Deployment Guide - Monitoring](deployment.md#monitoring)
3. **Configure additional repositories**: Repeat GitHub webhook setup for each repo
4. **Scale with VM execution**: Enable Firecracker for production workloads
