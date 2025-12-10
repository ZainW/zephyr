/**
 * Client-side JavaScript for Zephyr CI Web UI
 */

export function getClientScript(apiUrl: string): string {
  return `
// Zephyr CI Web UI Client

const API_URL = '${apiUrl}';

// WebSocket connection for live updates
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  const wsUrl = API_URL.replace('http', 'ws') + '/ws';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    // Subscribe to current job if on job page
    const jobId = window.location.pathname.match(/\\/jobs\\/([^/]+)/)?.[1];
    if (jobId) {
      ws.send(JSON.stringify({ type: 'subscribe', jobId }));
    }
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    // Reconnect after 3 seconds
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function handleWebSocketMessage(data) {
  if (data.type === 'job_update') {
    updateJobStatus(data.jobId, data.status);
    if (data.logs) {
      appendLogs(data.logs);
    }
  }
}

function updateJobStatus(jobId, status) {
  const statusEl = document.querySelector(\`[data-job-id="\${jobId}"] .status\`);
  if (statusEl) {
    statusEl.className = \`status status-\${status}\`;
    statusEl.innerHTML = \`<span class="status-dot"></span>\${status}\`;
  }
}

function appendLogs(logs) {
  const logContent = document.querySelector('.log-content');
  if (logContent && logs) {
    logContent.textContent += logs;
    logContent.scrollTop = logContent.scrollHeight;
  }
}

// Auto-refresh for running pipelines
function setupAutoRefresh() {
  const hasRunning = document.querySelector('.status-running');
  if (hasRunning) {
    setTimeout(() => {
      window.location.reload();
    }, 5000);
  }
}

// Form handling
function setupForms() {
  const triggerForm = document.getElementById('trigger-form');
  if (triggerForm) {
    triggerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(triggerForm);
      const data = Object.fromEntries(formData);

      try {
        const res = await fetch('/api/v1/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (res.ok) {
          const result = await res.json();
          window.location.href = '/runs/' + result.id;
        } else {
          const error = await res.json();
          alert('Error: ' + (error.error || 'Failed to trigger pipeline'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }
}

// Copy log button
function setupCopyLog() {
  const copyBtn = document.getElementById('copy-log');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const logContent = document.querySelector('.log-content');
      if (logContent) {
        navigator.clipboard.writeText(logContent.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      }
    });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  setupAutoRefresh();
  setupForms();
  setupCopyLog();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  if (ws) {
    ws.close();
  }
});

// Format duration helper
function formatDuration(ms) {
  if (!ms) return '-';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return minutes + 'm ' + remainingSeconds + 's';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours + 'h ' + remainingMinutes + 'm';
}

// Format relative time helper
function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
  return Math.floor(seconds / 86400) + ' days ago';
}
`;
}
