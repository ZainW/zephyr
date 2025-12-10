/**
 * Zephyr CI Web UI
 *
 * A lightweight dashboard for viewing and managing CI pipelines.
 */

export { WebUI, type WebUIOptions } from "./server.ts";
export { renderDashboard } from "./pages/dashboard.ts";
export { renderPipelineRun } from "./pages/pipeline-run.ts";
export { renderJob } from "./pages/job.ts";
