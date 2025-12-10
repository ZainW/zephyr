/**
 * Web UI Server
 *
 * Serves the dashboard and proxies API requests.
 */

import { renderDashboard } from "./pages/dashboard.ts";
import { renderPipelineRun } from "./pages/pipeline-run.ts";
import { renderJob } from "./pages/job.ts";
import { renderProjects } from "./pages/projects.ts";
import { renderTrigger } from "./pages/trigger.ts";
import { getStyles } from "./styles.ts";
import { getClientScript } from "./client.ts";

export interface WebUIOptions {
  /** Port to listen on */
  port?: number;
  /** API server URL */
  apiUrl: string;
  /** API key for authentication */
  apiKey?: string;
}

export class WebUI {
  private options: WebUIOptions;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(options: WebUIOptions) {
    this.options = {
      port: options.port ?? 8080,
      ...options,
    };
  }

  /**
   * Start the web UI server
   */
  start(): void {
    const self = this;

    this.server = Bun.serve({
      port: this.options.port,

      async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        // Static assets
        if (path === "/styles.css") {
          return new Response(getStyles(), {
            headers: { "Content-Type": "text/css" },
          });
        }

        if (path === "/client.js") {
          return new Response(getClientScript(self.options.apiUrl), {
            headers: { "Content-Type": "application/javascript" },
          });
        }

        // API proxy
        if (path.startsWith("/api/")) {
          return self.proxyApi(req);
        }

        // Pages
        try {
          const html = await self.renderPage(path, url.searchParams);
          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        } catch (err) {
          return new Response(self.renderError(err), {
            status: 500,
            headers: { "Content-Type": "text/html" },
          });
        }
      },
    });

    console.log(`Web UI listening on http://localhost:${this.options.port}`);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /**
   * Render a page based on the path
   */
  private async renderPage(path: string, params: URLSearchParams): Promise<string> {
    const apiData = await this.fetchApiData(path, params);

    switch (true) {
      case path === "/" || path === "/dashboard":
        return renderDashboard(apiData);

      case path === "/projects":
        return renderProjects(apiData);

      case path === "/trigger":
        return renderTrigger(apiData);

      case path.startsWith("/runs/"): {
        const runId = path.split("/")[2];
        return renderPipelineRun(runId!, apiData);
      }

      case path.startsWith("/jobs/"): {
        const jobId = path.split("/")[2];
        return renderJob(jobId!, apiData);
      }

      default:
        return renderDashboard(apiData);
    }
  }

  /**
   * Fetch data from the API for rendering
   */
  private async fetchApiData(path: string, params: URLSearchParams): Promise<ApiData> {
    const headers: Record<string, string> = {};
    if (this.options.apiKey) {
      headers["X-API-Key"] = this.options.apiKey;
    }

    const data: ApiData = {
      projects: [],
      runs: [],
      jobs: [],
      currentRun: null,
      currentJob: null,
    };

    try {
      // Fetch projects
      const projectsRes = await fetch(`${this.options.apiUrl}/api/v1/projects`, { headers });
      if (projectsRes.ok) {
        data.projects = (await projectsRes.json()) as Project[];
      }

      // Fetch recent runs
      const runsRes = await fetch(`${this.options.apiUrl}/api/v1/runs?limit=20`, { headers });
      if (runsRes.ok) {
        data.runs = (await runsRes.json()) as PipelineRun[];
      }

      // Fetch specific run if viewing run page
      if (path.startsWith("/runs/")) {
        const runId = path.split("/")[2];
        const runRes = await fetch(`${this.options.apiUrl}/api/v1/runs?id=${runId}`, { headers });
        if (runRes.ok) {
          const runs = (await runRes.json()) as PipelineRun[];
          data.currentRun = Array.isArray(runs) ? runs[0] ?? null : runs;
        }
      }

      // Fetch specific job if viewing job page
      if (path.startsWith("/jobs/")) {
        const jobId = path.split("/")[2];
        const jobRes = await fetch(`${this.options.apiUrl}/api/v1/jobs/${jobId}`, { headers });
        if (jobRes.ok) {
          data.currentJob = (await jobRes.json()) as Job;
        }
      }
    } catch (err) {
      console.error("Failed to fetch API data:", err);
    }

    return data;
  }

  /**
   * Proxy API requests to the backend
   */
  private async proxyApi(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const apiPath = url.pathname;
    const targetUrl = `${this.options.apiUrl}${apiPath}${url.search}`;

    const headers = new Headers(req.headers);
    if (this.options.apiKey) {
      headers.set("X-API-Key", this.options.apiKey);
    }

    try {
      const res = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method !== "GET" ? await req.text() : undefined,
      });

      return new Response(res.body, {
        status: res.status,
        headers: res.headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "API unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Render error page
   */
  private renderError(err: unknown): string {
    const message = err instanceof Error ? err.message : "Unknown error";
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Error - Zephyr CI</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="error-page">
    <h1>Error</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">Back to Dashboard</a>
  </div>
</body>
</html>`;
  }
}

export interface ApiData {
  projects: Project[];
  runs: PipelineRun[];
  jobs: Job[];
  currentRun: PipelineRun | null;
  currentJob: Job | null;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  config_path?: string;
}

export interface PipelineRun {
  id: string;
  project_id: string;
  pipeline_name: string;
  status: string;
  trigger_type: string;
  branch?: string;
  commit_sha?: string;
  created_at: number;
  started_at?: number;
  finished_at?: number;
}

export interface Job {
  id: string;
  pipeline_run_id: string;
  name: string;
  status: string;
  runner_image?: string;
  created_at: number;
  started_at?: number;
  finished_at?: number;
  exit_code?: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
