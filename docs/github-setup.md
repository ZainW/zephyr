# GitHub Integration Setup Guide

This guide covers setting up GitHub integration for Zephyr CI, including webhook configuration and optional GitHub App creation.

## Table of Contents

- [Overview](#overview)
- [Option 1: Repository Webhooks (Simple)](#option-1-repository-webhooks-simple)
- [Option 2: GitHub App (Recommended)](#option-2-github-app-recommended)
- [Webhook Events Reference](#webhook-events-reference)
- [Testing the Integration](#testing-the-integration)
- [Troubleshooting](#troubleshooting)

---

## Overview

Zephyr CI integrates with GitHub through webhooks. When events occur in your repository (pushes, pull requests, etc.), GitHub sends a notification to your Zephyr server, which then triggers the appropriate pipeline.

**Two integration options:**

| Option | Best For | Features |
|--------|----------|----------|
| Repository Webhooks | Simple setups, single repos | Quick setup, no app required |
| GitHub App | Organizations, multiple repos | Centralized management, status checks, better security |

---

## Option 1: Repository Webhooks (Simple)

For each repository you want to connect to Zephyr CI:

### Step 1: Get Your Webhook Secret

Your webhook secret was generated during setup and is stored in `/var/lib/zephyr/.env`:

```bash
# View your webhook secret
grep GITHUB_WEBHOOK_SECRET /var/lib/zephyr/.env

# Or generate a new one if needed
openssl rand -hex 32
```

### Step 2: Configure the Webhook

1. Go to your GitHub repository
2. Navigate to **Settings** > **Webhooks** > **Add webhook**

3. Fill in the webhook details:

   | Field | Value |
   |-------|-------|
   | **Payload URL** | `https://ci.yourdomain.com/webhooks/github` |
   | **Content type** | `application/json` |
   | **Secret** | Your `GITHUB_WEBHOOK_SECRET` value |

4. Select events to trigger the webhook:
   - Click **"Let me select individual events"**
   - Check the following:
     - ✅ **Pushes**
     - ✅ **Pull requests**
     - ✅ **Create** (for tag triggers)
     - ✅ **Delete** (optional, for cleanup)

5. Ensure **"Active"** is checked

6. Click **Add webhook**

### Step 3: Verify the Webhook

After adding the webhook, GitHub will send a `ping` event:

1. Go to the webhook you just created
2. Click on the **"Recent Deliveries"** tab
3. Look for a delivery with a green checkmark ✓
4. If you see a red X, click on it to see the error details

### Repeat for Each Repository

You'll need to add a webhook to each repository you want to integrate with Zephyr CI.

---

## Option 2: GitHub App (Recommended)

A GitHub App provides better security, centralized management, and additional features like commit status updates.

### Step 1: Create the GitHub App

1. Go to **GitHub Settings** > **Developer settings** > **GitHub Apps** > **New GitHub App**

2. Fill in the basic information:

   | Field | Value |
   |-------|-------|
   | **GitHub App name** | `Zephyr CI` (or your preferred name) |
   | **Description** | CI/CD pipeline runner |
   | **Homepage URL** | `https://ci.yourdomain.com` |

3. Configure the webhook:

   | Field | Value |
   |-------|-------|
   | **Webhook URL** | `https://ci.yourdomain.com/webhooks/github` |
   | **Webhook secret** | Your `GITHUB_WEBHOOK_SECRET` value |
   | **Active** | ✅ Checked |

### Step 2: Set Repository Permissions

Under **"Repository permissions"**, set:

| Permission | Access Level | Purpose |
|------------|--------------|---------|
| **Contents** | Read-only | Clone repositories, read files |
| **Metadata** | Read-only | Repository information |
| **Pull requests** | Read-only | PR information for triggers |
| **Commit statuses** | Read & write | Report build status back to GitHub |
| **Checks** | Read & write | (Optional) Create check runs |

### Step 3: Subscribe to Events

Under **"Subscribe to events"**, check:

- ✅ **Push**
- ✅ **Pull request**
- ✅ **Create** (for tags)
- ✅ **Delete** (optional)

### Step 4: Configure Access

Under **"Where can this GitHub App be installed?"**, choose:
- **Only on this account** (for personal use)
- **Any account** (for organization-wide or public use)

### Step 5: Create the App

Click **Create GitHub App**

### Step 6: Generate a Private Key

After creating the app:

1. Scroll down to **"Private keys"**
2. Click **Generate a private key**
3. Save the downloaded `.pem` file securely

### Step 7: Note the App ID

At the top of the app settings page, note the **App ID** (you'll need this for configuration).

### Step 8: Install the App

1. Go to the app's page
2. Click **"Install App"** in the left sidebar
3. Choose the account where you want to install
4. Select repositories:
   - **All repositories** - Access all current and future repos
   - **Only select repositories** - Choose specific repos

### Step 9: Configure Zephyr (Optional)

If you want Zephyr to report status back to GitHub, add to `/var/lib/zephyr/.env`:

```bash
# GitHub App Configuration (optional, for status updates)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/var/lib/zephyr/github-app-private-key.pem

# Or inline the key (base64 encoded)
GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi...
```

---

## Webhook Events Reference

### Supported Events

| Event | Trigger Type | Description |
|-------|--------------|-------------|
| `push` | `push` | Code pushed to branch |
| `pull_request.opened` | `pull_request` | New PR opened |
| `pull_request.synchronize` | `pull_request` | PR updated with new commits |
| `pull_request.reopened` | `pull_request` | Closed PR reopened |
| `create` (tag) | `tag` | New tag created |
| `workflow_dispatch` | `manual` | Manual trigger via API |

### Payload Information

Zephyr extracts the following from webhook payloads:

```typescript
{
  // Event type
  event: 'push' | 'pull_request' | 'create' | 'delete',
  action: string,  // For PR: 'opened', 'synchronize', 'closed'

  // Repository
  repository: {
    name: string,
    fullName: string,  // e.g., 'owner/repo'
    url: string,
    sshUrl: string,
    defaultBranch: string,
    private: boolean,
  },

  // Commit/Branch
  ref: string,        // e.g., 'refs/heads/main'
  branch: string,     // e.g., 'main'
  sha: string,        // Full commit SHA

  // For pull requests
  pullRequest?: {
    number: number,
    title: string,
    draft: boolean,
    head: { ref: string, sha: string },
    base: { ref: string },
  },

  // Commit details
  commit: {
    message: string,
    author: { name: string, email: string },
  },

  // Changed files (push events)
  changes: {
    added: string[],
    modified: string[],
    removed: string[],
  },
}
```

### Trigger Filtering in zephyr.config.ts

Use the extracted data in your pipeline triggers:

```typescript
pipelines: [
  {
    name: 'ci',
    triggers: [
      // Push to main or develop branches
      {
        type: 'push',
        branches: ['main', 'develop'],
      },

      // Push with path filtering
      {
        type: 'push',
        branches: ['main'],
        paths: ['src/**', 'package.json'],
        pathsIgnore: ['**/*.md', 'docs/**'],
      },

      // All pull requests
      {
        type: 'pull_request',
      },

      // PRs targeting specific branches
      {
        type: 'pull_request',
        branches: ['main'],  // Target branch
        types: ['opened', 'synchronize'],
      },

      // Tag creation (semantic versioning)
      {
        type: 'tag',
        tags: ['v*'],
      },
    ],
    jobs: [/* ... */],
  },
],
```

---

## Testing the Integration

### 1. Test Health Endpoint

```bash
curl -s https://ci.yourdomain.com/health | jq .
```

Expected output:
```json
{
  "status": "ok",
  "running": true
}
```

### 2. Test Webhook Manually

Simulate a GitHub ping event:

```bash
curl -X POST https://ci.yourdomain.com/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-Hub-Signature-256: sha256=$(echo -n '{"zen":"test"}' | openssl dgst -sha256 -hmac 'YOUR_WEBHOOK_SECRET' | cut -d' ' -f2)" \
  -d '{"zen":"test"}'
```

### 3. Trigger a Real Event

1. Make a small commit to a connected repository
2. Push to a branch that matches your trigger configuration
3. Check the Zephyr logs:
   ```bash
   sudo journalctl -u zephyr -f
   ```
4. Check the GitHub webhook deliveries for success/failure

### 4. Verify Pipeline Run

```bash
# List recent pipeline runs
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  https://ci.yourdomain.com/api/v1/runs | jq .
```

---

## Troubleshooting

### Webhook Delivery Failed

**Check GitHub's delivery logs:**
1. Go to your repository/app webhook settings
2. Click on **"Recent Deliveries"**
3. Click on the failed delivery to see:
   - Request headers and payload
   - Response status and body

**Common issues:**

| Error | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` | Invalid or missing signature | Check webhook secret matches |
| `404 Not Found` | Wrong URL | Verify webhook URL is correct |
| `500 Internal Server Error` | Server error | Check Zephyr logs |
| Connection refused | Server not running | Start Zephyr service |
| SSL certificate error | Invalid/expired cert | Renew SSL certificate |

### Signature Verification Failed

The webhook secret must match exactly:

```bash
# Check the secret in Zephyr config
sudo grep GITHUB_WEBHOOK_SECRET /var/lib/zephyr/.env

# In GitHub webhook settings, regenerate the secret if needed
# Then update both places
```

### Pipeline Not Triggering

1. **Check trigger configuration** in `zephyr.config.ts`:
   ```typescript
   triggers: [
     { type: 'push', branches: ['main'] },  // Does your branch match?
   ]
   ```

2. **Check webhook events** - ensure the correct events are selected in GitHub

3. **Check logs** for matching:
   ```bash
   sudo journalctl -u zephyr | grep -i "trigger\|webhook\|match"
   ```

### No Status Updates on PRs

For GitHub App installations:

1. Verify the app has **Commit statuses: Read & write** permission
2. Check that `GITHUB_APP_ID` and private key are configured
3. Verify the app is installed on the repository

### Rate Limiting

If you're hitting GitHub API rate limits:

```bash
# Check current rate limit status
curl -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/rate_limit
```

Solutions:
- Use a GitHub App (higher limits)
- Implement caching for API calls
- Reduce webhook frequency if possible

---

## Security Best Practices

1. **Always use HTTPS** for webhook URLs
2. **Rotate secrets periodically**:
   ```bash
   # Generate new secret
   NEW_SECRET=$(openssl rand -hex 32)

   # Update Zephyr config
   sudo sed -i "s/GITHUB_WEBHOOK_SECRET=.*/GITHUB_WEBHOOK_SECRET=${NEW_SECRET}/" /var/lib/zephyr/.env
   sudo systemctl restart zephyr

   # Update GitHub webhook settings
   ```

3. **Limit repository access** - only install the GitHub App on repos that need CI

4. **Use IP allowlisting** if possible (GitHub webhook IPs are published)

5. **Monitor webhook deliveries** for suspicious activity

---

## Next Steps

- [Configuration Reference](configuration.md) - Learn about pipeline configuration
- [Self-Hosting Guide](self-hosting.md) - Complete setup instructions
- [Deployment Guide](deployment.md) - Production deployment options
