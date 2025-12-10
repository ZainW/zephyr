/**
 * Pipeline Run Detail Page
 */

import type { ApiData } from "../server.ts";
import { layout, escapeHtml, statusBadge, formatRelativeTime, formatDuration } from "../components/layout.ts";

export function renderPipelineRun(runId: string, data: ApiData): string {
  const { currentRun: run, jobs } = data;

  if (!run) {
    return layout({ title: "Run Not Found" }, `
      <div class="empty-state">
        <h3>Pipeline run not found</h3>
        <p>The requested pipeline run does not exist.</p>
        <a href="/" class="btn btn-secondary" style="margin-top: 16px">Back to Dashboard</a>
      </div>
    `);
  }

  const duration = run.started_at && run.finished_at
    ? run.finished_at - run.started_at
    : run.started_at
      ? Date.now() - run.started_at
      : null;

  const content = `
    <div class="page-header">
      <div>
        <a href="/" style="color: var(--text-secondary); font-size: 14px; display: flex; align-items: center; gap: 4px; margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
          Back to Dashboard
        </a>
        <h1 style="display: flex; align-items: center; gap: 12px;">
          ${escapeHtml(run.pipeline_name)}
          ${statusBadge(run.status)}
        </h1>
      </div>
    </div>

    <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 24px;">
      <div class="stat-card">
        <div class="stat-label">Trigger</div>
        <div style="font-size: 16px; margin-top: 4px;">${escapeHtml(run.trigger_type)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Branch</div>
        <div style="font-size: 16px; margin-top: 4px;">${run.branch ? escapeHtml(run.branch) : '-'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Commit</div>
        <div style="font-size: 16px; margin-top: 4px; font-family: var(--font-mono);">
          ${run.commit_sha ? escapeHtml(run.commit_sha.slice(0, 7)) : '-'}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Duration</div>
        <div style="font-size: 16px; margin-top: 4px;">${formatDuration(duration)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Jobs</span>
      </div>
      ${renderJobTimeline(runId, jobs)}
    </div>
  `;

  return layout({ title: run.pipeline_name }, content);
}

function renderJobTimeline(runId: string, jobs: ApiData["jobs"]): string {
  // Filter jobs for this run
  const runJobs = jobs.filter(j => j.pipeline_run_id === runId);

  if (runJobs.length === 0) {
    return `
      <div class="empty-state" style="padding: 24px;">
        <p>No jobs yet</p>
      </div>
    `;
  }

  return `
    <div class="timeline" style="padding: 16px;">
      ${runJobs.map(job => {
        const duration = job.started_at && job.finished_at
          ? job.finished_at - job.started_at
          : job.started_at
            ? Date.now() - job.started_at
            : null;

        return `
          <div class="timeline-item ${job.status}" data-job-id="${job.id}">
            <a href="/jobs/${job.id}" style="display: block; text-decoration: none;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong style="color: var(--text-primary);">${escapeHtml(job.name)}</strong>
                  <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                    ${job.runner_image ? `Image: ${escapeHtml(job.runner_image)}` : ''}
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                  <span style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">
                    ${formatDuration(duration)}
                  </span>
                  ${statusBadge(job.status)}
                </div>
              </div>
            </a>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
