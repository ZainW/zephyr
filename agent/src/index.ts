#!/usr/bin/env bun
/**
 * Zephyr CI Agent
 *
 * Runs inside Firecracker VMs to execute jobs.
 * Listens for commands via HTTP and executes them.
 */

import type {
  AgentRequest,
  AgentResponse,
  ExecuteRequest,
  ExecuteResponse,
  FileWriteRequest,
  FileReadRequest,
  PingRequest,
  OutputChunk,
  Job,
  JobResult,
  StepResult,
} from "./protocol.ts";

const PORT = Number(Bun.env.AGENT_PORT) || 8080;
const HOST = Bun.env.AGENT_HOST || "0.0.0.0";
const startTime = Date.now();

/**
 * Execute a shell command
 */
async function executeCommand(
  request: ExecuteRequest,
  onOutput?: (chunk: OutputChunk) => void
): Promise<ExecuteResponse> {
  const startTime = Date.now();
  const { id, command, args = [], cwd, env, timeout } = request;

  const proc = Bun.spawn(args.length > 0 ? [command, ...args] : ["sh", "-c", command], {
    cwd: cwd ?? "/workspace",
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdout = "";
  let stderr = "";

  // Handle streaming output
  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    target: "stdout" | "stderr"
  ) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }

      if (onOutput) {
        onOutput({
          type: "output",
          id,
          stream: target,
          data: text,
        });
      }
    }
  };

  // Handle timeout
  let killed = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (timeout) {
    timeoutId = setTimeout(() => {
      killed = true;
      proc.kill();
    }, timeout * 1000);
  }

  // Read both streams
  await Promise.all([
    readStream(proc.stdout, "stdout"),
    readStream(proc.stderr, "stderr"),
  ]);

  const exitCode = await proc.exited;

  if (timeoutId) clearTimeout(timeoutId);

  return {
    type: "execute",
    id,
    exitCode: killed ? 124 : exitCode,
    stdout,
    stderr,
    duration: Date.now() - startTime,
  };
}

/**
 * Write a file
 */
async function writeFile(request: FileWriteRequest): Promise<AgentResponse> {
  const { id, path, content, encoding = "utf8", mode } = request;

  try {
    const data = encoding === "base64"
      ? Buffer.from(content, "base64")
      : content;

    await Bun.write(path, data, { mode });

    return {
      type: "file_write",
      id,
      success: true,
    };
  } catch (err) {
    return {
      type: "error",
      id,
      message: err instanceof Error ? err.message : "Unknown error",
      code: "FILE_WRITE_ERROR",
    };
  }
}

/**
 * Read a file
 */
async function readFile(request: FileReadRequest): Promise<AgentResponse> {
  const { id, path, encoding = "utf8" } = request;

  try {
    const file = Bun.file(path);
    const exists = await file.exists();

    if (!exists) {
      return {
        type: "error",
        id,
        message: `File not found: ${path}`,
        code: "FILE_NOT_FOUND",
      };
    }

    if (encoding === "base64") {
      const buffer = await file.arrayBuffer();
      return {
        type: "file_read",
        id,
        content: Buffer.from(buffer).toString("base64"),
        encoding: "base64",
      };
    }

    return {
      type: "file_read",
      id,
      content: await file.text(),
      encoding: "utf8",
    };
  } catch (err) {
    return {
      type: "error",
      id,
      message: err instanceof Error ? err.message : "Unknown error",
      code: "FILE_READ_ERROR",
    };
  }
}

/**
 * Handle a ping request
 */
function handlePing(request: PingRequest): AgentResponse {
  return {
    type: "ping",
    id: request.id,
    timestamp: Date.now(),
    uptime: Date.now() - startTime,
  };
}

/**
 * Handle a shutdown request
 */
async function handleShutdown(request: { id: string; timeout?: number }): Promise<AgentResponse> {
  // Schedule shutdown
  setTimeout(async () => {
    // Try graceful shutdown
    try {
      await Bun.$`poweroff`.quiet();
    } catch {
      // Force shutdown
      process.exit(0);
    }
  }, (request.timeout ?? 1) * 1000);

  return {
    type: "shutdown",
    id: request.id,
    success: true,
  };
}

/**
 * Execute a full job
 */
async function executeJob(
  job: Job,
  onOutput?: (chunk: OutputChunk) => void
): Promise<JobResult> {
  const startTime = Date.now();
  const results: StepResult[] = [];
  let failed = false;

  for (const step of job.steps) {
    if (failed && !step.continueOnError) {
      results.push({
        id: step.id,
        name: step.name,
        status: "skipped",
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 0,
      });
      continue;
    }

    const response = await executeCommand(
      {
        type: "execute",
        id: step.id ?? `step-${results.length}`,
        command: step.command,
        cwd: step.workdir ?? job.workdir ?? "/workspace",
        env: { ...job.env, ...step.env },
        timeout: step.timeout ?? job.timeout,
        stream: true,
      },
      onOutput
    );

    const success = response.exitCode === 0;

    results.push({
      id: step.id,
      name: step.name,
      status: success ? "success" : "failure",
      exitCode: response.exitCode,
      stdout: response.stdout,
      stderr: response.stderr,
      duration: response.duration,
    });

    if (!success && !step.continueOnError) {
      failed = true;
    }
  }

  return {
    id: job.id,
    status: failed ? "failure" : "success",
    steps: results,
    duration: Date.now() - startTime,
  };
}

/**
 * Handle incoming requests
 */
async function handleRequest(request: AgentRequest): Promise<AgentResponse> {
  switch (request.type) {
    case "execute":
      return executeCommand(request);

    case "file_write":
      return writeFile(request);

    case "file_read":
      return readFile(request);

    case "ping":
      return handlePing(request);

    case "shutdown":
      return handleShutdown(request);

    default:
      return {
        type: "error",
        id: (request as { id?: string }).id ?? "unknown",
        message: `Unknown request type: ${(request as { type: string }).type}`,
        code: "UNKNOWN_REQUEST",
      };
  }
}

/**
 * Start the HTTP server
 */
const server = Bun.serve({
  port: PORT,
  hostname: HOST,

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({
        status: "ok",
        uptime: Date.now() - startTime,
      });
    }

    // Execute job
    if (url.pathname === "/job" && req.method === "POST") {
      const job = (await req.json()) as Job;
      const result = await executeJob(job);
      return Response.json(result);
    }

    // Generic request handler
    if (url.pathname === "/request" && req.method === "POST") {
      const request = (await req.json()) as AgentRequest;
      const response = await handleRequest(request);
      return Response.json(response);
    }

    // Execute command directly
    if (url.pathname === "/exec" && req.method === "POST") {
      const body = (await req.json()) as {
        command: string;
        cwd?: string;
        env?: Record<string, string>;
        timeout?: number;
      };

      const response = await executeCommand({
        type: "execute",
        id: crypto.randomUUID(),
        command: body.command,
        cwd: body.cwd,
        env: body.env,
        timeout: body.timeout,
      });

      return Response.json(response);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Zephyr Agent listening on ${HOST}:${PORT}`);

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  server.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down...");
  server.stop();
  process.exit(0);
});
