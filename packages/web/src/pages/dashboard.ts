/**
 * Dashboard Page
 */

import type { ApiData } from "../server.ts";
import { layout, escapeHtml, statusBadge, formatRelativeTime, formatDuration } from "../components/layout.ts";

export function renderDashboard(data: ApiData): string {
  const { runs, projects } = data;

  // Calculate stats
  const stats = {
    total: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    success: runs.filter((r) => r.status === "success").length,
    failed: runs.filter((r) => r.status === "failure").length,
  };

  const content = `
    <div class="page-header">
      <h1>Dashboard</h1>
      <a href="/trigger" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Trigger Pipeline
      </a>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Total Runs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--accent-blue)">${stats.running}</div>
        <div class="stat-label">Running</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--accent-green)">${stats.success}</div>
        <div class="stat-label">Successful</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--accent-red)">${stats.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Recent Pipeline Runs</span>
      </div>
      ${runs.length > 0 ? renderRunList(runs, projects) : renderEmptyState()}
    </div>
  `;

  return layout({ title: "Dashboard", activePage: "dashboard" }, content);
}

function renderRunList(runs: ApiData["runs"], projects: ApiData["projects"]): string {
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return `
    <div class="run-list">
      ${runs
        .map((run) => {
          const project = projectMap.get(run.project_id);
          const duration =
            run.started_at && run.finished_at ? run.finished_at - run.started_at : null;

          return `
          <a href="/runs/${run.id}" class="run-item">
            ${statusBadge(run.status)}
            <div class="run-info">
              <div class="run-title">
                <strong>${escapeHtml(run.pipeline_name)}</strong>
                ${project ? `<span style="color: var(--text-secondary)">in ${escapeHtml(project.name)}</span>` : ""}
              </div>
              <div class="run-meta">
                <span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  ${formatRelativeTime(run.created_at)}
                </span>
                ${
                  run.branch
                    ? `
                  <span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="6" y1="3" x2="6" y2="15"/>
                      <circle cx="18" cy="6" r="3"/>
                      <circle cx="6" cy="18" r="3"/>
                      <path d="M18 9a9 9 0 0 1-9 9"/>
                    </svg>
                    ${escapeHtml(run.branch)}
                  </span>
                `
                    : ""
                }
                ${
                  run.commit_sha
                    ? `
                  <span style="font-family: var(--font-mono); font-size: 11px;">
                    ${escapeHtml(run.commit_sha.slice(0, 7))}
                  </span>
                `
                    : ""
                }
                ${
                  duration
                    ? `
                  <span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${formatDuration(duration)}
                  </span>
                `
                    : ""
                }
              </div>
            </div>
          </a>
        `;
        })
        .join("")}
    </div>
  `;
}

function renderEmptyState(): string {
  return `
    <div class="empty-state">
      <h3>No pipeline runs yet</h3>
      <p>Trigger your first pipeline to see it here.</p>
      <a href="/trigger" class="btn btn-primary" style="margin-top: 16px">Trigger Pipeline</a>
    </div>
  `;
}
