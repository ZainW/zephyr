/**
 * Job Detail Page with Live Log Viewer
 */

import type { ApiData } from "../server.ts";
import { layout, escapeHtml, statusBadge, formatDuration } from "../components/layout.ts";

export function renderJob(jobId: string, data: ApiData): string {
  const { currentJob: job } = data;

  if (!job) {
    return layout({ title: "Job Not Found" }, `
      <div class="empty-state">
        <h3>Job not found</h3>
        <p>The requested job does not exist.</p>
        <a href="/" class="btn btn-secondary" style="margin-top: 16px">Back to Dashboard</a>
      </div>
    `);
  }

  const duration = job.started_at && job.finished_at
    ? job.finished_at - job.started_at
    : job.started_at
      ? Date.now() - job.started_at
      : null;

  const content = `
    <div class="page-header">
      <div>
        <a href="/runs/${job.pipeline_run_id}" style="color: var(--text-secondary); font-size: 14px; display: flex; align-items: center; gap: 4px; margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
          Back to Pipeline
        </a>
        <h1 style="display: flex; align-items: center; gap: 12px;">
          ${escapeHtml(job.name)}
          ${statusBadge(job.status)}
        </h1>
      </div>
    </div>

    <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 24px;">
      <div class="stat-card">
        <div class="stat-label">Status</div>
        <div style="margin-top: 8px;">${statusBadge(job.status)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Duration</div>
        <div style="font-size: 16px; margin-top: 4px;">${formatDuration(duration)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Exit Code</div>
        <div style="font-size: 16px; margin-top: 4px; font-family: var(--font-mono);">
          ${job.exit_code !== undefined && job.exit_code !== null ? job.exit_code : '-'}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Runner Image</div>
        <div style="font-size: 14px; margin-top: 4px;">
          ${job.runner_image ? escapeHtml(job.runner_image) : 'default'}
        </div>
      </div>
    </div>

    <div class="log-viewer">
      <div class="log-header">
        <span style="font-weight: 500;">Logs</span>
        <div style="display: flex; gap: 8px;">
          <button id="copy-log" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">
            Copy
          </button>
          ${job.status === 'running' ? `
            <span style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--accent-blue);">
              <span class="status-dot" style="animation: pulse 1.5s infinite;"></span>
              Live
            </span>
          ` : ''}
        </div>
      </div>
      <div class="log-content" id="log-content">
        <div class="log-loading" style="color: var(--text-muted);">Loading logs...</div>
      </div>
    </div>

    <script>
      // Fetch logs for this job
      async function fetchLogs() {
        try {
          const res = await fetch('/api/v1/jobs/${jobId}/logs');
          if (res.ok) {
            const logs = await res.json();
            renderLogs(logs);
          }
        } catch (err) {
          console.error('Failed to fetch logs:', err);
        }
      }

      function renderLogs(logs) {
        const container = document.getElementById('log-content');
        if (!logs || logs.length === 0) {
          container.innerHTML = '<span style="color: var(--text-muted);">No logs available</span>';
          return;
        }

        container.innerHTML = logs.map((log, i) => {
          const isStderr = log.stream === 'stderr';
          return '<div class="log-line' + (isStderr ? ' log-line-stderr' : '') + '">' +
            '<span class="log-line-number">' + (i + 1) + '</span>' +
            '<span class="log-line-content">' + escapeHtml(log.content) + '</span>' +
          '</div>';
        }).join('');

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
      }

      function escapeHtml(text) {
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      // Initial fetch
      fetchLogs();

      // Poll for updates if running
      ${job.status === 'running' ? `
        setInterval(fetchLogs, 2000);
      ` : ''}
    </script>
  `;

  return layout({ title: job.name }, content);
}
