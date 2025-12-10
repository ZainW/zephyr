/**
 * Start the Zephyr CI server
 */

import { ZephyrServer } from "@zephyr-ci/server";

export interface ServerCommandOptions {
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Path to SQLite database */
  db?: string;
  /** GitHub webhook secret */
  githubSecret?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Maximum concurrent jobs */
  maxJobs?: number;
}

export async function server(options: ServerCommandOptions = {}): Promise<void> {
  const srv = new ZephyrServer({
    port: options.port ?? 3000,
    host: options.host ?? "0.0.0.0",
    dbPath: options.db ?? "./zephyr.db",
    githubWebhookSecret: options.githubSecret,
    apiKey: options.apiKey,
    maxConcurrentJobs: options.maxJobs ?? 4,
  });

  // Handle shutdown signals
  const shutdown = async () => {
    console.log("\nShutting down...");
    await srv.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  srv.start();

  console.log(`
\x1b[36mZephyr CI Server\x1b[0m

Server running at http://${options.host ?? "0.0.0.0"}:${options.port ?? 3000}

Endpoints:
  GET  /health              - Health check
  POST /webhooks/github     - GitHub webhook endpoint
  GET  /api/v1/projects     - List projects
  POST /api/v1/projects     - Create project
  GET  /api/v1/runs         - List pipeline runs
  POST /api/v1/trigger      - Trigger a pipeline
  GET  /api/v1/jobs/:id     - Get job details
  GET  /api/v1/jobs/:id/logs - Get job logs
  WS   /ws                  - WebSocket for log streaming

Press Ctrl+C to stop
`);

  // Keep the process running
  await new Promise(() => {});
}
