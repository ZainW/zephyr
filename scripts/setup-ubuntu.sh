#!/bin/bash
#
# Zephyr CI - Ubuntu Setup Script (Idempotent)
#
# This script installs and configures Zephyr CI on Ubuntu (20.04, 22.04, 24.04).
# Zephyr uses Firecracker microVMs for secure, isolated job execution.
#
# IDEMPOTENT: Safe to run multiple times. Will skip already-completed steps
# and preserve existing configuration.
#
# REQUIREMENTS:
#   - Linux with KVM support (bare metal or nested virtualization)
#   - Intel VT-x or AMD-V enabled in BIOS/UEFI
#   - Minimum 4 CPU cores, 8GB RAM
#
# Usage:
#   Interactive:     ./setup-ubuntu.sh
#   Non-interactive: ZEPHYR_AUTO=1 ./setup-ubuntu.sh
#   Via curl:        curl -fsSL https://raw.githubusercontent.com/.../setup-ubuntu.sh | bash
#
# Environment Variables:
#   ZEPHYR_AUTO=1              - Run without prompts (use defaults or env vars)
#   ZEPHYR_DOMAIN=ci.example.com - Domain for HTTPS setup
#   ZEPHYR_API_KEY=xxx         - Pre-set API key (uses existing or generates new)
#   GITHUB_WEBHOOK_SECRET=xxx  - Pre-set webhook secret (uses existing or generates new)
#   ZEPHYR_MAX_JOBS=4          - Maximum concurrent jobs
#   ZEPHYR_SKIP_FIREWALL=1     - Skip UFW configuration
#   ZEPHYR_SKIP_NGINX=1        - Skip Nginx installation
#   ZEPHYR_SKIP_SYSTEMD=1      - Skip systemd service setup
#   ZEPHYR_REPO_URL=...        - Git repo URL to clone (default: github.com/...)
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_skip() { echo -e "${GREEN}[SKIP]${NC} $1 (already done)"; }

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    log_error "This script should not be run as root. Run as a regular user with sudo access."
    exit 1
fi

# Check if Ubuntu
if [[ ! -f /etc/lsb-release ]] || ! grep -q "Ubuntu" /etc/lsb-release; then
    log_error "This script is designed for Ubuntu. Use setup-arch.sh for Arch Linux."
    exit 1
fi

# Get Ubuntu version
UBUNTU_VERSION=$(lsb_release -rs)
log_info "Detected Ubuntu ${UBUNTU_VERSION}"

# Directories
ZEPHYR_HOME="/opt/zephyr"
ZEPHYR_DATA="/var/lib/zephyr"
ZEPHYR_USER="zephyr"
ENV_FILE="$ZEPHYR_DATA/.env"

# Load existing config if present (for idempotency)
if [[ -f "$ENV_FILE" ]]; then
    log_info "Loading existing configuration from $ENV_FILE"
    # Source existing env file to preserve values
    set +u  # Allow unbound variables temporarily
    source <(sudo grep -E '^[A-Z_]+=' "$ENV_FILE" 2>/dev/null || true)
    set -u
fi

# Configuration with defaults (existing values take precedence)
ZEPHYR_AUTO=${ZEPHYR_AUTO:-0}
ZEPHYR_DOMAIN=${ZEPHYR_DOMAIN:-""}
ZEPHYR_API_KEY=${ZEPHYR_API_KEY:-""}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET:-""}
ZEPHYR_MAX_JOBS=${ZEPHYR_MAX_JOBS:-4}
ZEPHYR_PORT=${ZEPHYR_PORT:-3000}
ZEPHYR_UI_PORT=${ZEPHYR_UI_PORT:-8080}
ZEPHYR_SKIP_FIREWALL=${ZEPHYR_SKIP_FIREWALL:-0}
ZEPHYR_SKIP_NGINX=${ZEPHYR_SKIP_NGINX:-0}
ZEPHYR_SKIP_SYSTEMD=${ZEPHYR_SKIP_SYSTEMD:-0}
ZEPHYR_REPO_URL=${ZEPHYR_REPO_URL:-"https://github.com/yourusername/zephyr.git"}

# Generate secrets only if not already set
[[ -z "$ZEPHYR_API_KEY" ]] && ZEPHYR_API_KEY=$(openssl rand -hex 32)
[[ -z "$GITHUB_WEBHOOK_SECRET" ]] && GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Interactive prompts
prompt_yes_no() {
    local prompt="$1"
    local default="${2:-n}"

    if [[ $ZEPHYR_AUTO -eq 1 ]]; then
        [[ "$default" == "y" ]] && return 0 || return 1
    fi

    local yn
    read -r -p "$prompt [y/N]: " yn
    case $yn in
        [Yy]*) return 0 ;;
        *) return 1 ;;
    esac
}

prompt_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"

    if [[ $ZEPHYR_AUTO -eq 1 ]]; then
        eval "$var_name=\"$default\""
        return
    fi

    local input
    read -r -p "$prompt [$default]: " input
    eval "$var_name=\"${input:-$default}\""
}

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                                                           ║"
    echo "║          ZEPHYR CI - Ubuntu Setup (Idempotent)            ║"
    echo "║                                                           ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Check system requirements
check_requirements() {
    log_info "Checking system requirements..."

    # Check sudo access
    if ! sudo -n true 2>/dev/null; then
        log_info "This script requires sudo access. You may be prompted for your password."
        sudo true
    fi

    # Check CPU virtualization - REQUIRED for Zephyr
    if ! grep -qE '(vmx|svm)' /proc/cpuinfo; then
        log_error "CPU virtualization (VT-x/AMD-V) not detected!"
        log_error "Zephyr requires KVM for Firecracker microVM execution."
        log_error ""
        log_error "Possible causes:"
        log_error "  1. Virtualization not enabled in BIOS/UEFI"
        log_error "  2. Running on a VPS without nested virtualization support"
        log_error "  3. Running inside a VM without virtualization passthrough"
        log_error ""
        log_error "Check your BIOS settings or choose a VPS provider that supports KVM."
        exit 1
    fi

    # Check available memory
    local mem_total
    mem_total=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
    if [[ $mem_total -lt 4096 ]]; then
        log_warn "Less than 4GB RAM detected (${mem_total}MB)."
        log_warn "Recommended: 8GB+ for running multiple concurrent VM jobs."
    fi

    # Check CPU cores
    local cpu_cores
    cpu_cores=$(nproc)
    if [[ $cpu_cores -lt 4 ]]; then
        log_warn "Only ${cpu_cores} CPU cores detected."
        log_warn "Recommended: 4+ cores for running concurrent VM jobs."
    fi

    log_success "System requirements check passed"
    log_info "  CPU virtualization: Supported"
    log_info "  Memory: ${mem_total}MB"
    log_info "  CPU cores: ${cpu_cores}"
}

# Install system packages (idempotent via apt)
install_packages() {
    log_info "Checking system packages..."

    # Update package lists
    sudo apt-get update -qq

    # Base packages (including VM/KVM requirements)
    local packages=(
        build-essential
        git
        curl
        wget
        unzip
        jq
        openssl
        libssl-dev
        sqlite3
        libsqlite3-dev
        ca-certificates
        gnupg
        iproute2
        iptables
        e2fsprogs
        apt-transport-https
        software-properties-common
        # KVM/Virtualization
        qemu-system-x86
        libvirt-daemon-system
        libvirt-clients
        bridge-utils
        cpu-checker
    )

    # Add Nginx if not skipped
    if [[ $ZEPHYR_SKIP_NGINX -eq 0 ]]; then
        packages+=(
            nginx
            certbot
            python3-certbot-nginx
        )
    fi

    # Install packages (apt handles idempotency)
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${packages[@]}"

    log_success "System packages installed"
}

# Install Docker (idempotent)
install_docker() {
    if command -v docker &>/dev/null; then
        log_skip "Docker already installed: $(docker --version)"
    else
        log_info "Installing Docker..."

        # Add Docker's official GPG key
        sudo install -m 0755 -d /etc/apt/keyrings
        if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            sudo chmod a+r /etc/apt/keyrings/docker.gpg
        fi

        # Add the repository if not present
        if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
            echo \
                "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
                $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
                sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            sudo apt-get update -qq
        fi

        # Install Docker
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        log_success "Docker installed: $(docker --version)"
    fi

    # Enable and start Docker (idempotent)
    sudo systemctl enable docker 2>/dev/null || true
    sudo systemctl start docker 2>/dev/null || true

    # Add current user to docker group (idempotent)
    if ! groups "$USER" | grep -q docker; then
        sudo usermod -aG docker "$USER"
        log_warn "Added $USER to docker group. You may need to log out and back in."
    fi

    log_success "Docker configured"
}

# Install Bun (idempotent)
install_bun() {
    if command -v bun &>/dev/null; then
        log_skip "Bun already installed: $(bun --version)"
    else
        log_info "Installing Bun runtime..."
        curl -fsSL https://bun.sh/install | bash

        log_success "Bun installed"
    fi

    # Ensure Bun is in PATH for current session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    # Add to shell profile if not present (idempotent)
    local shell_profile="$HOME/.bashrc"
    [[ -f "$HOME/.zshrc" ]] && shell_profile="$HOME/.zshrc"

    if ! grep -q 'BUN_INSTALL' "$shell_profile" 2>/dev/null; then
        cat >> "$shell_profile" << 'EOF'

# Bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF
        log_info "Added Bun to $shell_profile"
    fi
}

# Setup KVM for Firecracker (idempotent)
setup_kvm() {
    log_info "Setting up KVM for Firecracker microVMs..."

    # Check KVM support using kvm-ok utility
    if command -v kvm-ok &>/dev/null; then
        if ! sudo kvm-ok; then
            log_error "KVM acceleration NOT available."
            log_error "Check BIOS/UEFI settings or VPS provider support."
            exit 1
        fi
    fi

    # Load KVM module (idempotent)
    if grep -q 'Intel' /proc/cpuinfo; then
        sudo modprobe kvm_intel 2>/dev/null || true
        # Make persistent (idempotent check)
        if ! grep -q '^kvm_intel$' /etc/modules 2>/dev/null; then
            echo "kvm_intel" | sudo tee -a /etc/modules > /dev/null
        fi
    elif grep -q 'AMD' /proc/cpuinfo; then
        sudo modprobe kvm_amd 2>/dev/null || true
        # Make persistent (idempotent check)
        if ! grep -q '^kvm_amd$' /etc/modules 2>/dev/null; then
            echo "kvm_amd" | sudo tee -a /etc/modules > /dev/null
        fi
    fi

    # Add user to kvm and libvirt groups (idempotent)
    if ! groups "$USER" | grep -q kvm; then
        sudo usermod -aG kvm "$USER"
        log_warn "Added $USER to kvm group. You may need to log out and back in."
    fi

    if ! groups "$USER" | grep -q libvirt; then
        sudo usermod -aG libvirt "$USER"
    fi

    # Verify KVM
    if [[ -e /dev/kvm ]]; then
        log_success "KVM is available at /dev/kvm"
    else
        log_error "KVM device not found after loading module."
        log_error "Check BIOS/UEFI settings or VPS provider support."
        exit 1
    fi
}

# Install Firecracker (idempotent)
install_firecracker() {
    local version="v1.10.1"

    if command -v firecracker &>/dev/null; then
        local installed_version
        installed_version=$(firecracker --version 2>&1 | head -1 || echo "unknown")
        log_skip "Firecracker already installed: $installed_version"
        return
    fi

    log_info "Installing Firecracker microVM hypervisor..."

    local arch
    arch=$(uname -m)
    local tmp_dir
    tmp_dir=$(mktemp -d)

    cd "$tmp_dir"
    curl -fsSL "https://github.com/firecracker-microvm/firecracker/releases/download/${version}/firecracker-${version}-${arch}.tgz" | tar xz

    sudo mv "release-${version}-${arch}/firecracker-${version}-${arch}" /usr/local/bin/firecracker
    sudo mv "release-${version}-${arch}/jailer-${version}-${arch}" /usr/local/bin/jailer
    sudo chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer

    cd - &>/dev/null
    rm -rf "$tmp_dir"

    log_success "Firecracker installed: $(firecracker --version 2>&1 | head -1)"
}

# Enable IP forwarding for VM networking (idempotent)
setup_networking() {
    log_info "Configuring network settings for VM networking..."

    # Check if already enabled
    local current_value
    current_value=$(cat /proc/sys/net/ipv4/ip_forward)

    if [[ "$current_value" == "1" ]]; then
        log_skip "IP forwarding already enabled"
    else
        sudo sysctl -w net.ipv4.ip_forward=1 > /dev/null
    fi

    # Make persistent (idempotent)
    if [[ ! -f /etc/sysctl.d/99-zephyr.conf ]] || ! grep -q 'net.ipv4.ip_forward=1' /etc/sysctl.d/99-zephyr.conf 2>/dev/null; then
        echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-zephyr.conf > /dev/null
        sudo sysctl --system > /dev/null 2>&1
    fi

    log_success "Network configured"
}

# Setup UFW firewall (idempotent)
setup_firewall() {
    if [[ $ZEPHYR_SKIP_FIREWALL -eq 1 ]]; then
        return
    fi

    # Check if UFW is installed and active
    if ! command -v ufw &>/dev/null; then
        return
    fi

    if ! sudo ufw status | grep -q "Status: active"; then
        log_info "UFW is not active, skipping firewall configuration"
        return
    fi

    log_info "Configuring UFW firewall..."

    # These commands are idempotent - UFW handles duplicates gracefully
    sudo ufw allow ssh > /dev/null 2>&1 || true
    sudo ufw allow 80/tcp > /dev/null 2>&1 || true
    sudo ufw allow 443/tcp > /dev/null 2>&1 || true
    sudo ufw allow "${ZEPHYR_PORT}/tcp" > /dev/null 2>&1 || true
    sudo ufw allow "${ZEPHYR_UI_PORT}/tcp" > /dev/null 2>&1 || true

    log_success "Firewall configured"
}

# Create Zephyr user and directories (idempotent)
setup_directories() {
    log_info "Setting up directories and user..."

    # Create zephyr user if it doesn't exist (idempotent)
    if ! id "$ZEPHYR_USER" &>/dev/null; then
        sudo useradd -r -m -s /bin/bash "$ZEPHYR_USER"
        log_info "Created user: $ZEPHYR_USER"
    else
        log_skip "User $ZEPHYR_USER already exists"
    fi

    # Create directories (mkdir -p is idempotent)
    sudo mkdir -p "$ZEPHYR_DATA"/{db,vms,cache,logs}
    sudo mkdir -p "$ZEPHYR_HOME"

    # Set ownership
    sudo chown -R "$ZEPHYR_USER:$ZEPHYR_USER" "$ZEPHYR_DATA"
    sudo chown -R "$ZEPHYR_USER:$ZEPHYR_USER" "$ZEPHYR_HOME"

    # Add zephyr user to docker and kvm groups (idempotent via usermod)
    sudo usermod -aG docker "$ZEPHYR_USER" 2>/dev/null || true
    sudo usermod -aG kvm "$ZEPHYR_USER" 2>/dev/null || true

    log_success "Directories and user configured"
}

# Install Zephyr CI (idempotent)
install_zephyr() {
    log_info "Installing Zephyr CI..."

    # Install Bun for zephyr user if not present
    if ! sudo -u "$ZEPHYR_USER" bash -c 'command -v ~/.bun/bin/bun' &>/dev/null; then
        sudo -u "$ZEPHYR_USER" bash -c 'curl -fsSL https://bun.sh/install | bash'
        log_info "Installed Bun for $ZEPHYR_USER"
    else
        log_skip "Bun already installed for $ZEPHYR_USER"
    fi

    # Check if Zephyr is already installed
    if [[ -f "$ZEPHYR_HOME/package.json" ]]; then
        log_skip "Zephyr already installed in $ZEPHYR_HOME"
        # Update dependencies
        log_info "Updating dependencies..."
        cd "$ZEPHYR_HOME"
        sudo -u "$ZEPHYR_USER" bash -c 'cd /opt/zephyr && ~/.bun/bin/bun install' 2>/dev/null || true
    else
        # Clone or copy Zephyr
        if [[ -d "$PWD/packages" ]]; then
            # Running from Zephyr source directory
            log_info "Copying from source directory..."
            sudo cp -r "$PWD"/* "$ZEPHYR_HOME/"
            sudo chown -R "$ZEPHYR_USER:$ZEPHYR_USER" "$ZEPHYR_HOME"
        elif [[ -n "$ZEPHYR_REPO_URL" ]]; then
            # Clone from git
            log_info "Cloning from $ZEPHYR_REPO_URL..."
            sudo -u "$ZEPHYR_USER" git clone "$ZEPHYR_REPO_URL" "$ZEPHYR_HOME" 2>/dev/null || {
                log_warn "Git clone failed. You may need to install Zephyr manually to $ZEPHYR_HOME"
            }
        else
            log_warn "Not running from Zephyr source directory."
            log_info "Zephyr will need to be installed manually to $ZEPHYR_HOME"
        fi

        # Install dependencies
        if [[ -f "$ZEPHYR_HOME/package.json" ]]; then
            cd "$ZEPHYR_HOME"
            sudo -u "$ZEPHYR_USER" bash -c 'cd /opt/zephyr && ~/.bun/bin/bun install'
        fi
    fi

    log_success "Zephyr CI installed"
}

# Create environment file (idempotent - preserves existing values)
create_env_file() {
    log_info "Managing environment configuration..."

    if [[ -f "$ENV_FILE" ]]; then
        log_skip "Environment file already exists at $ENV_FILE"
        log_info "Existing API Key and Webhook Secret preserved"
        return
    fi

    log_info "Creating environment configuration..."

    sudo tee "$ENV_FILE" > /dev/null << EOF
# Zephyr CI Configuration
# Generated: $(date -Iseconds)

# API Configuration
ZEPHYR_API_KEY=${ZEPHYR_API_KEY}
ZEPHYR_PORT=${ZEPHYR_PORT}
ZEPHYR_HOST=0.0.0.0

# Database
ZEPHYR_DB_PATH=${ZEPHYR_DATA}/db/zephyr.db

# GitHub Integration
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}

# Job Configuration
ZEPHYR_MAX_JOBS=${ZEPHYR_MAX_JOBS}

# Logging
ZEPHYR_LOG_LEVEL=info
EOF

    sudo chmod 600 "$ENV_FILE"
    sudo chown "$ZEPHYR_USER:$ZEPHYR_USER" "$ENV_FILE"

    log_success "Environment file created"
}

# Setup systemd services (idempotent)
setup_systemd() {
    if [[ $ZEPHYR_SKIP_SYSTEMD -eq 1 ]]; then
        return
    fi

    log_info "Setting up systemd services..."

    local service_changed=0

    # Zephyr server service
    local server_service="/etc/systemd/system/zephyr.service"
    local server_content="[Unit]
Description=Zephyr CI Server
Documentation=https://github.com/yourusername/zephyr
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=${ZEPHYR_USER}
Group=${ZEPHYR_USER}
WorkingDirectory=${ZEPHYR_HOME}
EnvironmentFile=${ZEPHYR_DATA}/.env
ExecStart=/home/${ZEPHYR_USER}/.bun/bin/bun run zephyr server --port \${ZEPHYR_PORT} --db \${ZEPHYR_DB_PATH} --api-key \${ZEPHYR_API_KEY} --github-secret \${GITHUB_WEBHOOK_SECRET} --max-jobs \${ZEPHYR_MAX_JOBS}
Restart=always
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=zephyr

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${ZEPHYR_DATA}
PrivateTmp=true

[Install]
WantedBy=multi-user.target"

    if [[ ! -f "$server_service" ]] || [[ "$(sudo cat "$server_service")" != "$server_content" ]]; then
        echo "$server_content" | sudo tee "$server_service" > /dev/null
        service_changed=1
    fi

    # Zephyr UI service
    local ui_service="/etc/systemd/system/zephyr-ui.service"
    local ui_content="[Unit]
Description=Zephyr CI Web UI
After=zephyr.service
Requires=zephyr.service

[Service]
Type=simple
User=${ZEPHYR_USER}
Group=${ZEPHYR_USER}
WorkingDirectory=${ZEPHYR_HOME}
ExecStart=/home/${ZEPHYR_USER}/.bun/bin/bun run zephyr ui --port ${ZEPHYR_UI_PORT} --api-url http://localhost:${ZEPHYR_PORT}
Restart=always
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=zephyr-ui

[Install]
WantedBy=multi-user.target"

    if [[ ! -f "$ui_service" ]] || [[ "$(sudo cat "$ui_service")" != "$ui_content" ]]; then
        echo "$ui_content" | sudo tee "$ui_service" > /dev/null
        service_changed=1
    fi

    # Reload systemd only if services changed
    if [[ $service_changed -eq 1 ]]; then
        sudo systemctl daemon-reload
        log_success "Systemd services created/updated"
    else
        log_skip "Systemd services already configured"
    fi
}

# Setup Nginx (idempotent)
setup_nginx() {
    if [[ $ZEPHYR_SKIP_NGINX -eq 1 ]]; then
        return
    fi

    if [[ -z "$ZEPHYR_DOMAIN" ]]; then
        if [[ $ZEPHYR_AUTO -eq 0 ]]; then
            prompt_input "Enter domain for HTTPS (leave empty to skip)" "" ZEPHYR_DOMAIN
        fi
    fi

    if [[ -z "$ZEPHYR_DOMAIN" ]]; then
        log_info "Skipping Nginx setup (no domain specified)"
        return
    fi

    log_info "Setting up Nginx..."

    # Remove default site if it exists
    sudo rm -f /etc/nginx/sites-enabled/default

    # Create Nginx config
    local nginx_config="/etc/nginx/sites-available/zephyr"
    local nginx_content="upstream zephyr_api {
    server 127.0.0.1:${ZEPHYR_PORT};
    keepalive 32;
}

upstream zephyr_ui {
    server 127.0.0.1:${ZEPHYR_UI_PORT};
    keepalive 32;
}

server {
    listen 80;
    server_name ${ZEPHYR_DOMAIN};

    location /api/ {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /webhooks/ {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /health {
        proxy_pass http://zephyr_api;
    }

    location /metrics {
        proxy_pass http://zephyr_api;
        allow 127.0.0.1;
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
    }

    location /ws {
        proxy_pass http://zephyr_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://zephyr_ui;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}"

    # Only update if changed
    if [[ ! -f "$nginx_config" ]] || [[ "$(sudo cat "$nginx_config")" != "$nginx_content" ]]; then
        echo "$nginx_content" | sudo tee "$nginx_config" > /dev/null

        # Enable site (ln -sf is idempotent)
        sudo ln -sf "$nginx_config" /etc/nginx/sites-enabled/

        # Test and reload
        if sudo nginx -t 2>/dev/null; then
            sudo systemctl enable nginx 2>/dev/null || true
            sudo systemctl reload nginx 2>/dev/null || sudo systemctl start nginx
            log_success "Nginx configured"
        else
            log_error "Nginx configuration test failed"
        fi
    else
        log_skip "Nginx already configured for ${ZEPHYR_DOMAIN}"
    fi

    # Offer to setup SSL (only in interactive mode and if not already done)
    if [[ $ZEPHYR_AUTO -eq 0 ]] && [[ ! -f "/etc/letsencrypt/live/${ZEPHYR_DOMAIN}/fullchain.pem" ]]; then
        if prompt_yes_no "Setup SSL with Let's Encrypt?"; then
            sudo certbot --nginx -d "$ZEPHYR_DOMAIN"
        fi
    fi
}

# Build VM images (idempotent - checks for existing images)
build_vm_images() {
    local kernel_path="$ZEPHYR_HOME/images/kernels/vmlinux"
    local rootfs_path="$ZEPHYR_HOME/images/rootfs/alpine-rootfs.ext4"

    if [[ -f "$kernel_path" ]] && [[ -f "$rootfs_path" ]]; then
        log_skip "VM images already built"
        log_info "  Kernel: $kernel_path"
        log_info "  Rootfs: $rootfs_path"
        return
    fi

    log_info "Building Firecracker VM images (kernel + rootfs)..."
    log_info "This may take a few minutes..."

    cd "$ZEPHYR_HOME"

    # Need to run as current user for Docker access
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if [[ -f "images/build.ts" ]]; then
        # Use newgrp to get docker access without re-login, or run directly
        if groups | grep -q docker; then
            bun run build:images
        else
            sg docker -c "bun run build:images"
        fi
        sudo chown -R "$ZEPHYR_USER:$ZEPHYR_USER" "$ZEPHYR_HOME/images"
        log_success "VM images built successfully"
        log_info "  Kernel: $kernel_path"
        log_info "  Rootfs: $rootfs_path"
    else
        log_warn "VM image build script not found at images/build.ts"
        log_warn "You may need to build images manually after installing Zephyr"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              SETUP COMPLETE                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Configuration:"
    echo "  API Key:        ${ZEPHYR_API_KEY}"
    echo "  Webhook Secret: ${GITHUB_WEBHOOK_SECRET}"
    echo "  API Port:       ${ZEPHYR_PORT}"
    echo "  UI Port:        ${ZEPHYR_UI_PORT}"
    echo "  Max Jobs:       ${ZEPHYR_MAX_JOBS}"
    echo "  VM Execution:   Enabled (Firecracker microVMs)"
    echo ""
    echo "Directories:"
    echo "  Installation:   ${ZEPHYR_HOME}"
    echo "  Data:           ${ZEPHYR_DATA}"
    echo "  Config:         ${ZEPHYR_DATA}/.env"
    echo ""
    echo "Commands:"
    echo "  Start services: sudo systemctl start zephyr zephyr-ui"
    echo "  Stop services:  sudo systemctl stop zephyr zephyr-ui"
    echo "  View logs:      sudo journalctl -u zephyr -f"
    echo "  Health check:   curl http://localhost:${ZEPHYR_PORT}/health"
    echo ""

    if [[ -n "$ZEPHYR_DOMAIN" ]]; then
        echo "URL: https://${ZEPHYR_DOMAIN}"
        echo "Webhook URL: https://${ZEPHYR_DOMAIN}/webhooks/github"
    else
        echo "Local URL: http://localhost:${ZEPHYR_UI_PORT}"
        echo "Webhook URL: http://YOUR_IP:${ZEPHYR_PORT}/webhooks/github"
    fi

    echo ""
    echo -e "${YELLOW}IMPORTANT: Save the API Key and Webhook Secret shown above!${NC}"
    echo -e "${YELLOW}You'll need them for GitHub webhook configuration.${NC}"
    echo ""

    # Check if user needs to re-login
    local needs_relogin=0
    groups "$USER" 2>/dev/null | grep -q docker || needs_relogin=1
    groups "$USER" 2>/dev/null | grep -q kvm || needs_relogin=1

    if [[ $needs_relogin -eq 1 ]]; then
        echo -e "${YELLOW}Note: Log out and back in for group changes to take effect.${NC}"
        echo ""
    fi

    echo "This script is idempotent - safe to run again to fix issues or update."
}

# Main installation flow
main() {
    print_banner

    # Gather configuration if not in auto mode
    if [[ $ZEPHYR_AUTO -eq 0 ]]; then
        prompt_input "API port" "$ZEPHYR_PORT" ZEPHYR_PORT
        prompt_input "Max concurrent VM jobs" "$ZEPHYR_MAX_JOBS" ZEPHYR_MAX_JOBS
    fi

    check_requirements
    install_packages
    install_docker
    install_bun
    setup_kvm
    install_firecracker
    setup_networking
    setup_firewall
    setup_directories
    install_zephyr
    create_env_file
    setup_systemd
    setup_nginx
    build_vm_images
    print_summary
}

main "$@"
