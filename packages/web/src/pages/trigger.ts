/**
 * Manual Pipeline Trigger Page
 */

import type { ApiData } from "../server.ts";
import { layout, escapeHtml } from "../components/layout.ts";

export function renderTrigger(data: ApiData): string {
  const { projects } = data;

  const content = `
    <div class="page-header">
      <h1>Trigger Pipeline</h1>
    </div>

    <div class="card" style="max-width: 600px;">
      <form id="trigger-form">
        <div class="form-group">
          <label class="form-label" for="projectId">Project</label>
          <select class="form-select" id="projectId" name="projectId" required>
            <option value="">Select a project...</option>
            ${projects.map(p => `
              <option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="pipeline">Pipeline Name</label>
          <input
            type="text"
            class="form-input"
            id="pipeline"
            name="pipeline"
            placeholder="e.g., ci, deploy, test"
            required
          >
        </div>

        <div class="form-group">
          <label class="form-label" for="branch">Branch (optional)</label>
          <input
            type="text"
            class="form-input"
            id="branch"
            name="branch"
            placeholder="e.g., main, develop"
          >
        </div>

        <div class="form-group">
          <label class="form-label" for="sha">Commit SHA (optional)</label>
          <input
            type="text"
            class="form-input"
            id="sha"
            name="sha"
            placeholder="e.g., abc123..."
            style="font-family: var(--font-mono);"
          >
        </div>

        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button type="submit" class="btn btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Trigger Pipeline
          </button>
          <a href="/" class="btn btn-secondary">Cancel</a>
        </div>
      </form>
    </div>

    ${projects.length === 0 ? `
      <div class="card" style="max-width: 600px; margin-top: 16px; background: rgba(210, 153, 34, 0.1); border-color: var(--accent-yellow);">
        <p style="color: var(--accent-yellow); margin: 0;">
          <strong>No projects found.</strong> Create a project first before triggering a pipeline.
        </p>
        <a href="/projects" class="btn btn-secondary" style="margin-top: 12px;">Manage Projects</a>
      </div>
    ` : ''}
  `;

  return layout({ title: "Trigger Pipeline", activePage: "trigger" }, content);
}
