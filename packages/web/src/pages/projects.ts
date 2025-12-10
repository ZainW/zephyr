/**
 * Projects Management Page
 */

import type { ApiData } from "../server.ts";
import { layout, escapeHtml } from "../components/layout.ts";

export function renderProjects(data: ApiData): string {
  const { projects } = data;

  const content = `
    <div class="page-header">
      <h1>Projects</h1>
      <button onclick="showCreateModal()" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Project
      </button>
    </div>

    ${projects.length > 0 ? renderProjectList(projects) : renderEmptyState()}

    <!-- Create Project Modal -->
    <div id="create-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000;">
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 24px; width: 400px; max-width: 90vw;">
        <h2 style="margin-bottom: 16px;">Create Project</h2>
        <form id="create-project-form">
          <div class="form-group">
            <label class="form-label" for="name">Project Name</label>
            <input
              type="text"
              class="form-input"
              id="name"
              name="name"
              placeholder="my-project"
              required
            >
          </div>

          <div class="form-group">
            <label class="form-label" for="description">Description (optional)</label>
            <input
              type="text"
              class="form-input"
              id="description"
              name="description"
              placeholder="A brief description"
            >
          </div>

          <div class="form-group">
            <label class="form-label" for="configPath">Config Path</label>
            <input
              type="text"
              class="form-input"
              id="configPath"
              name="configPath"
              placeholder="/path/to/project/zephyr.config.ts"
              required
            >
          </div>

          <div style="display: flex; gap: 12px; margin-top: 24px;">
            <button type="submit" class="btn btn-primary">Create</button>
            <button type="button" onclick="hideCreateModal()" class="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      function showCreateModal() {
        document.getElementById('create-modal').style.display = 'block';
      }

      function hideCreateModal() {
        document.getElementById('create-modal').style.display = 'none';
      }

      document.getElementById('create-modal').addEventListener('click', (e) => {
        if (e.target.id === 'create-modal') {
          hideCreateModal();
        }
      });

      document.getElementById('create-project-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData);

        try {
          const res = await fetch('/api/v1/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });

          if (res.ok) {
            window.location.reload();
          } else {
            const error = await res.json();
            alert('Error: ' + (error.error || 'Failed to create project'));
          }
        } catch (err) {
          alert('Error: ' + err.message);
        }
      });
    </script>
  `;

  return layout({ title: "Projects", activePage: "projects" }, content);
}

function renderProjectList(projects: ApiData["projects"]): string {
  return `
    <div style="display: grid; gap: 16px;">
      ${projects.map(project => `
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h3 style="font-size: 18px; margin-bottom: 4px;">${escapeHtml(project.name)}</h3>
              ${project.description ? `
                <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 8px;">
                  ${escapeHtml(project.description)}
                </p>
              ` : ''}
              ${project.config_path ? `
                <div style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">
                  ${escapeHtml(project.config_path)}
                </div>
              ` : ''}
            </div>
            <div style="display: flex; gap: 8px;">
              <a href="/trigger?project=${project.id}" class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;">
                Trigger
              </a>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderEmptyState(): string {
  return `
    <div class="empty-state">
      <h3>No projects yet</h3>
      <p>Create your first project to start running pipelines.</p>
      <button onclick="showCreateModal()" class="btn btn-primary" style="margin-top: 16px;">
        Create Project
      </button>
    </div>
  `;
}
