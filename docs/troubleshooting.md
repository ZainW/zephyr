# Zephyr CI Troubleshooting Guide

This guide covers common issues and their solutions when running Zephyr CI.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Installation Issues](#installation-issues)
- [Server Issues](#server-issues)
- [Webhook Issues](#webhook-issues)
- [Job Execution Issues](#job-execution-issues)
- [VM Execution Issues](#vm-execution-issues)
- [Database Issues](#database-issues)
- [Network Issues](#network-issues)
- [Performance Issues](#performance-issues)
- [Logs and Debugging](#logs-and-debugging)

---

## Quick Diagnostics

Run these commands to quickly diagnose common issues:

```bash
# Check service status
sudo systemctl status zephyr
sudo systemctl status zephyr-ui

# Check if server is responding
curl -s http://localhost:3000/health | jq .

# Check logs for errors
sudo journalctl -u zephyr -n 50 --no-pager | grep -i error

# Check disk space
df -h /var/lib/zephyr

# Check memory usage
free -h

# Check if ports are in use
ss -tlnp | grep -E '3000|8080'

# Check database file
ls -la /var/lib/zephyr/db/zephyr.db

# Check environment file
sudo cat /var/lib/zephyr/.env
```

---

## Installation Issues

### Bun Not Found

**Symptom:**
```
command not found: bun
```

**Solution:**

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Add to PATH
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Add to shell profile for persistence
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# For the zephyr system user
sudo -u zephyr bash -c 'curl -fsSL https://bun.sh/install | bash'
```

### Permission Denied on /dev/kvm

**Symptom:**
```
Could not access KVM kernel module: Permission denied
```

**Solution:**

```bash
# Check KVM exists
ls -la /dev/kvm

# Add user to kvm group
sudo usermod -aG kvm $USER

# Also add zephyr user if running as service
sudo usermod -aG kvm zephyr

# Log out and back in for changes to take effect
# Or reload groups temporarily:
newgrp kvm
```

### Docker Permission Denied

**Symptom:**
```
Got permission denied while trying to connect to the Docker daemon socket
```

**Solution:**

```bash
# Add user to docker group
sudo usermod -aG docker $USER
sudo usermod -aG docker zephyr

# Restart Docker
sudo systemctl restart docker

# Log out and back in
```

### Package Installation Fails (Arch)

**Symptom:**
```
error: failed to prepare transaction (could not satisfy dependencies)
```

**Solution:**

```bash
# Update package databases
sudo pacman -Syy

# Force refresh and upgrade
sudo pacman -Syu

# Clear package cache if corrupted
sudo pacman -Sc
```

### Package Installation Fails (Ubuntu)

**Symptom:**
```
E: Unable to locate package
```

**Solution:**

```bash
# Update package lists
sudo apt update

# Fix broken packages
sudo apt --fix-broken install

# Clear apt cache
sudo apt clean
sudo apt autoclean
```

---

## Server Issues

### Server Won't Start

**Symptom:**
```
Failed to start zephyr.service: Unit zephyr.service not found.
```

**Solution:**

```bash
# Check if service file exists
ls -la /etc/systemd/system/zephyr.service

# Create if missing (see self-hosting.md)

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable zephyr
sudo systemctl start zephyr
```

### Server Crashes on Startup

**Symptom:**
```
Main process exited, code=exited, status=1/FAILURE
```

**Solution:**

```bash
# Check detailed logs
sudo journalctl -u zephyr -n 100 --no-pager

# Common causes:
# 1. Missing environment file
ls -la /var/lib/zephyr/.env

# 2. Invalid configuration
sudo -u zephyr bash -c 'source /var/lib/zephyr/.env && echo $ZEPHYR_API_KEY'

# 3. Port already in use
sudo ss -tlnp | grep 3000
# Kill the process using the port or change ZEPHYR_PORT

# 4. Database directory doesn't exist
sudo mkdir -p /var/lib/zephyr/db
sudo chown zephyr:zephyr /var/lib/zephyr/db

# 5. Bun path incorrect in service file
which bun  # Get correct path
sudo nano /etc/systemd/system/zephyr.service  # Update ExecStart
sudo systemctl daemon-reload
```

### Port Already in Use

**Symptom:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**

```bash
# Find what's using the port
sudo ss -tlnp | grep 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>

# Or change the port in /var/lib/zephyr/.env
ZEPHYR_PORT=3001

# Restart service
sudo systemctl restart zephyr
```

### Health Check Fails

**Symptom:**
```
curl: (7) Failed to connect to localhost port 3000: Connection refused
```

**Solution:**

```bash
# Check if service is running
sudo systemctl status zephyr

# Start if stopped
sudo systemctl start zephyr

# Check what's listening
ss -tlnp | grep 3000

# Check firewall
sudo iptables -L -n | grep 3000
sudo ufw status  # Ubuntu
```

---

## Webhook Issues

### Signature Verification Failed

**Symptom:**
GitHub shows webhook delivery failed with 401 status.

**Solution:**

```bash
# 1. Verify secret matches
sudo grep GITHUB_WEBHOOK_SECRET /var/lib/zephyr/.env

# 2. In GitHub webhook settings, check the secret matches exactly

# 3. Generate new secret if needed
NEW_SECRET=$(openssl rand -hex 32)
echo "New secret: $NEW_SECRET"

# 4. Update both places:
# - /var/lib/zephyr/.env
# - GitHub webhook settings

# 5. Restart Zephyr
sudo systemctl restart zephyr
```

### Webhook Not Reaching Server

**Symptom:**
GitHub shows "failed to connect" or timeout.

**Solution:**

```bash
# 1. Check server is accessible from internet
curl https://ci.yourdomain.com/health

# 2. Check DNS
dig ci.yourdomain.com

# 3. Check SSL certificate
openssl s_client -connect ci.yourdomain.com:443 -servername ci.yourdomain.com

# 4. Check Nginx is running
sudo systemctl status nginx
sudo nginx -t

# 5. Check firewall allows 80/443
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Or
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

### Pipeline Not Triggering

**Symptom:**
Webhook delivered successfully but no pipeline runs.

**Solution:**

```bash
# 1. Check Zephyr logs for webhook receipt
sudo journalctl -u zephyr | grep -i webhook

# 2. Verify trigger configuration matches event
cat zephyr.config.ts | grep -A 10 triggers

# 3. Check branch name matches
# If pushing to 'feature/test', trigger must include:
# branches: ['feature/*'] or branches: ['*']

# 4. Check path filters if using paths/pathsIgnore

# 5. Ensure project is registered
curl -H "Authorization: Bearer $ZEPHYR_API_KEY" \
  http://localhost:3000/api/v1/projects
```

---

## Job Execution Issues

### Job Stuck in Pending

**Symptom:**
Job shows "pending" status but never starts.

**Solution:**

```bash
# 1. Check max concurrent jobs
grep ZEPHYR_MAX_JOBS /var/lib/zephyr/.env

# 2. Check current running jobs
curl -H "Authorization: Bearer $ZEPHYR_API_KEY" \
  http://localhost:3000/api/v1/runs | jq '.[] | select(.status == "running")'

# 3. Increase max jobs if needed
# Edit /var/lib/zephyr/.env: ZEPHYR_MAX_JOBS=8
sudo systemctl restart zephyr
```

### Job Fails Immediately

**Symptom:**
Job starts but fails within seconds.

**Solution:**

```bash
# 1. Check job logs
curl -H "Authorization: Bearer $ZEPHYR_API_KEY" \
  "http://localhost:3000/api/v1/jobs/<JOB_ID>/logs"

# 2. Common causes:
# - Missing dependencies in runner image
# - Invalid step commands
# - Missing environment variables

# 3. Test locally
zephyr run --job <job_name>
```

### Step Command Not Found

**Symptom:**
```
bash: <command>: command not found
```

**Solution:**

```bash
# 1. Ensure command is installed in runner image
# For VM execution, check images/rootfs/Dockerfile.alpine

# 2. Use full path
steps:
  - type: run
    run: /usr/bin/npm install

# 3. Install in a setup step first
steps:
  - type: setup
    runtime: node
    version: '20'
  - type: run
    run: npm install
```

---

## VM Execution Issues

### KVM Not Available

**Symptom:**
```
KVM not available: No such file or directory
```

**Solution:**

```bash
# 1. Check CPU virtualization support
grep -E '(vmx|svm)' /proc/cpuinfo

# 2. If empty, enable in BIOS/UEFI:
#    - Intel: Enable "VT-x" or "Virtualization Technology"
#    - AMD: Enable "SVM" or "AMD-V"

# 3. Load KVM module
sudo modprobe kvm
sudo modprobe kvm_intel  # or kvm_amd

# 4. Make persistent
echo "kvm_intel" | sudo tee /etc/modules-load.d/kvm.conf
```

### Firecracker Won't Start

**Symptom:**
```
Error creating VM: Firecracker not found
```

**Solution:**

```bash
# 1. Check Firecracker is installed
which firecracker
firecracker --version

# 2. Install if missing
FIRECRACKER_VERSION="v1.10.1"
curl -L "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-x86_64.tgz" | tar xz
sudo mv release-*/firecracker-* /usr/local/bin/firecracker
sudo chmod +x /usr/local/bin/firecracker
```

### VM Images Not Found

**Symptom:**
```
Error: Kernel image not found
Error: Rootfs image not found
```

**Solution:**

```bash
# 1. Check images exist
ls -la /opt/zephyr/images/kernels/
ls -la /opt/zephyr/images/rootfs/

# 2. Build images if missing
cd /opt/zephyr
bun run build:images

# 3. Check permissions
sudo chown -R zephyr:zephyr /opt/zephyr/images
```

### VM Network Not Working

**Symptom:**
Jobs in VMs can't access the internet.

**Solution:**

```bash
# 1. Check IP forwarding
cat /proc/sys/net/ipv4/ip_forward
# Should be 1

# 2. Enable if not
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-zephyr.conf

# 3. Check NAT rules
sudo iptables -t nat -L -n

# 4. Check TAP device creation permissions
# Zephyr user needs sudo or CAP_NET_ADMIN
```

---

## Database Issues

### Database Locked

**Symptom:**
```
SQLITE_BUSY: database is locked
```

**Solution:**

```bash
# 1. Check for multiple processes
pgrep -f "zephyr server"

# 2. Kill stale processes
sudo systemctl stop zephyr
pkill -9 -f "zephyr server"

# 3. Remove lock file if exists
rm -f /var/lib/zephyr/db/zephyr.db-wal
rm -f /var/lib/zephyr/db/zephyr.db-shm

# 4. Restart
sudo systemctl start zephyr
```

### Database Corrupted

**Symptom:**
```
SQLITE_CORRUPT: database disk image is malformed
```

**Solution:**

```bash
# 1. Stop the service
sudo systemctl stop zephyr

# 2. Backup the corrupted database
cp /var/lib/zephyr/db/zephyr.db /var/lib/zephyr/db/zephyr.db.corrupted

# 3. Try to recover
sqlite3 /var/lib/zephyr/db/zephyr.db ".recover" | sqlite3 /var/lib/zephyr/db/zephyr-recovered.db

# 4. Replace if recovery worked
mv /var/lib/zephyr/db/zephyr-recovered.db /var/lib/zephyr/db/zephyr.db
chown zephyr:zephyr /var/lib/zephyr/db/zephyr.db

# 5. Or start fresh
rm /var/lib/zephyr/db/zephyr.db

# 6. Restart
sudo systemctl start zephyr
```

### Disk Space Full

**Symptom:**
```
SQLITE_FULL: database or disk is full
```

**Solution:**

```bash
# 1. Check disk space
df -h /var/lib/zephyr

# 2. Clean old data
# Remove old logs
find /var/lib/zephyr/logs -mtime +7 -delete

# Vacuum database
sqlite3 /var/lib/zephyr/db/zephyr.db "VACUUM;"

# 3. Increase disk space or move to larger partition
```

---

## Network Issues

### Nginx 502 Bad Gateway

**Symptom:**
Browser shows "502 Bad Gateway".

**Solution:**

```bash
# 1. Check if Zephyr is running
sudo systemctl status zephyr

# 2. Check Nginx can reach backend
curl http://localhost:3000/health

# 3. Check Nginx configuration
sudo nginx -t

# 4. Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# 5. Ensure upstream ports match
grep -E "server 127|proxy_pass" /etc/nginx/sites-available/zephyr
```

### SSL Certificate Errors

**Symptom:**
Browser shows certificate warning.

**Solution:**

```bash
# 1. Check certificate status
sudo certbot certificates

# 2. Renew if expired
sudo certbot renew

# 3. Test renewal
sudo certbot renew --dry-run

# 4. Check certificate files
ls -la /etc/letsencrypt/live/ci.yourdomain.com/

# 5. Restart Nginx
sudo systemctl restart nginx
```

### WebSocket Connection Failed

**Symptom:**
Real-time logs don't work in UI.

**Solution:**

```bash
# 1. Check Nginx WebSocket configuration
grep -A5 "location /ws" /etc/nginx/sites-available/zephyr

# Should include:
# proxy_http_version 1.1;
# proxy_set_header Upgrade $http_upgrade;
# proxy_set_header Connection "upgrade";

# 2. Test WebSocket directly
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  http://localhost:3000/ws

# 3. Check if firewall allows WebSocket
```

---

## Performance Issues

### High CPU Usage

**Symptom:**
Zephyr using 100% CPU.

**Solution:**

```bash
# 1. Check what's happening
top -p $(pgrep -f "zephyr server")

# 2. Check number of concurrent jobs
curl -H "Authorization: Bearer $ZEPHYR_API_KEY" \
  http://localhost:3000/health | jq '.activeJobs'

# 3. Reduce max concurrent jobs
# Edit /var/lib/zephyr/.env: ZEPHYR_MAX_JOBS=2
sudo systemctl restart zephyr
```

### High Memory Usage

**Symptom:**
System running out of memory.

**Solution:**

```bash
# 1. Check memory usage
ps aux | grep zephyr

# 2. Check for memory leaks (increasing over time)
watch -n 5 'ps aux | grep zephyr'

# 3. Reduce concurrent jobs
# Edit /var/lib/zephyr/.env: ZEPHYR_MAX_JOBS=2

# 4. Add swap if needed
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Slow Job Execution

**Symptom:**
Jobs take much longer than expected.

**Solution:**

```bash
# 1. Check system resources
htop

# 2. Check disk I/O
iostat -x 1

# 3. For VM execution, check VM boot time
sudo journalctl -u zephyr | grep -i "vm boot"

# 4. Enable warm pool for faster VM boot
# (Configuration varies based on implementation)

# 5. Use local execution for development
zephyr run --local
```

---

## Logs and Debugging

### View Service Logs

```bash
# Real-time logs
sudo journalctl -u zephyr -f

# Last 100 lines
sudo journalctl -u zephyr -n 100

# Logs from specific time
sudo journalctl -u zephyr --since "1 hour ago"

# Filter by priority (error and above)
sudo journalctl -u zephyr -p err

# Export to file
sudo journalctl -u zephyr > zephyr.log
```

### Enable Debug Mode

```bash
# Set debug environment variable
echo "DEBUG=1" | sudo tee -a /var/lib/zephyr/.env
sudo systemctl restart zephyr

# Or run manually with debug
DEBUG=1 zephyr server --port 3000
```

### Check Specific Job Logs

```bash
# Get job ID from runs list
JOB_ID=$(curl -s -H "Authorization: Bearer $ZEPHYR_API_KEY" \
  http://localhost:3000/api/v1/runs | jq -r '.[0].jobs[0].id')

# Get job logs
curl -H "Authorization: Bearer $ZEPHYR_API_KEY" \
  "http://localhost:3000/api/v1/jobs/${JOB_ID}/logs"
```

### Database Queries

```bash
# Open database
sqlite3 /var/lib/zephyr/db/zephyr.db

# List recent runs
SELECT id, status, created_at FROM pipeline_runs ORDER BY created_at DESC LIMIT 10;

# Check failed jobs
SELECT * FROM jobs WHERE status = 'failure' ORDER BY created_at DESC LIMIT 10;

# Count jobs by status
SELECT status, COUNT(*) FROM jobs GROUP BY status;
```

---

## Getting Help

If you can't resolve an issue:

1. **Gather diagnostics:**
   ```bash
   # Create diagnostic report
   echo "=== System Info ===" > diagnostic.txt
   uname -a >> diagnostic.txt
   echo "=== Service Status ===" >> diagnostic.txt
   sudo systemctl status zephyr >> diagnostic.txt 2>&1
   echo "=== Recent Logs ===" >> diagnostic.txt
   sudo journalctl -u zephyr -n 200 >> diagnostic.txt 2>&1
   echo "=== Config (sanitized) ===" >> diagnostic.txt
   sudo grep -v "KEY\|SECRET" /var/lib/zephyr/.env >> diagnostic.txt
   ```

2. **Check existing issues:**
   https://github.com/yourusername/zephyr/issues

3. **Open a new issue** with:
   - Description of the problem
   - Steps to reproduce
   - Diagnostic report (remove sensitive info)
   - Expected vs actual behavior
