/**
 * Trigger a pipeline run via the API
 */

export interface TriggerOptions {
  /** Server URL */
  server?: string;
  /** API key */
  apiKey?: string;
  /** Project ID or name */
  project: string;
  /** Pipeline name */
  pipeline: string;
  /** Branch name */
  branch?: string;
  /** Commit SHA */
  sha?: string;
  /** Wait for completion */
  wait?: boolean;
}

export async function trigger(options: TriggerOptions): Promise<void> {
  const serverUrl = options.server ?? "http://localhost:3000";

  console.log(`Triggering pipeline '${options.pipeline}' for project '${options.project}'...`);

  // Build request
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.apiKey) {
    headers["X-API-Key"] = options.apiKey;
  }

  // Trigger the pipeline
  const response = await fetch(`${serverUrl}/api/v1/trigger`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId: options.project,
      pipeline: options.pipeline,
      branch: options.branch,
      sha: options.sha,
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    console.error(`\x1b[31mError:\x1b[0m ${error.error || "Failed to trigger pipeline"}`);
    process.exit(1);
  }

  const result = (await response.json()) as { id: string };
  console.log(`\x1b[32m✓\x1b[0m Pipeline triggered: ${result.id}`);

  if (options.wait) {
    console.log("Waiting for completion...");
    await waitForCompletion(serverUrl, result.id, headers);
  }
}

async function waitForCompletion(
  serverUrl: string,
  runId: string,
  headers: Record<string, string>
): Promise<void> {
  const startTime = Date.now();
  const maxWait = 30 * 60 * 1000; // 30 minutes

  while (Date.now() - startTime < maxWait) {
    const response = await fetch(`${serverUrl}/api/v1/runs?id=${runId}`, { headers });

    if (response.ok) {
      const runs = await response.json();
      const run = Array.isArray(runs) ? runs[0] : runs;

      if (run?.status === "success") {
        console.log(`\x1b[32m✓\x1b[0m Pipeline completed successfully`);
        return;
      }

      if (run?.status === "failure") {
        console.log(`\x1b[31m✗\x1b[0m Pipeline failed`);
        process.exit(1);
      }

      if (run?.status === "cancelled") {
        console.log(`\x1b[33m⊘\x1b[0m Pipeline was cancelled`);
        process.exit(1);
      }
    }

    // Wait before polling again
    await Bun.sleep(2000);
    process.stdout.write(".");
  }

  console.log("\n\x1b[33mWarning:\x1b[0m Timeout waiting for pipeline completion");
  process.exit(1);
}
