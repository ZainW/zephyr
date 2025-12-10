/**
 * Host <-> Agent Communication Protocol
 *
 * Messages are JSON-encoded and sent over vsock or HTTP.
 */

/**
 * Request from host to agent
 */
export type AgentRequest =
  | ExecuteRequest
  | FileWriteRequest
  | FileReadRequest
  | PingRequest
  | ShutdownRequest;

/**
 * Response from agent to host
 */
export type AgentResponse =
  | ExecuteResponse
  | FileWriteResponse
  | FileReadResponse
  | PingResponse
  | ShutdownResponse
  | ErrorResponse;

// ============================================================================
// Execute Command
// ============================================================================

export interface ExecuteRequest {
  type: "execute";
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  /** Stream stdout/stderr back as they come */
  stream?: boolean;
}

export interface ExecuteResponse {
  type: "execute";
  id: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

/**
 * Streaming output chunk (sent when stream=true)
 */
export interface OutputChunk {
  type: "output";
  id: string;
  stream: "stdout" | "stderr";
  data: string;
}

// ============================================================================
// File Operations
// ============================================================================

export interface FileWriteRequest {
  type: "file_write";
  id: string;
  path: string;
  content: string;
  /** Base64 encoded for binary files */
  encoding?: "utf8" | "base64";
  mode?: number;
}

export interface FileWriteResponse {
  type: "file_write";
  id: string;
  success: boolean;
}

export interface FileReadRequest {
  type: "file_read";
  id: string;
  path: string;
  encoding?: "utf8" | "base64";
}

export interface FileReadResponse {
  type: "file_read";
  id: string;
  content: string;
  encoding: "utf8" | "base64";
}

// ============================================================================
// Ping (Health Check)
// ============================================================================

export interface PingRequest {
  type: "ping";
  id: string;
}

export interface PingResponse {
  type: "ping";
  id: string;
  timestamp: number;
  uptime: number;
}

// ============================================================================
// Shutdown
// ============================================================================

export interface ShutdownRequest {
  type: "shutdown";
  id: string;
  /** Graceful shutdown timeout in seconds */
  timeout?: number;
}

export interface ShutdownResponse {
  type: "shutdown";
  id: string;
  success: boolean;
}

// ============================================================================
// Error
// ============================================================================

export interface ErrorResponse {
  type: "error";
  id: string;
  message: string;
  code?: string;
}

// ============================================================================
// Job Execution Types
// ============================================================================

/**
 * A job to execute in the VM
 */
export interface Job {
  id: string;
  name: string;
  steps: JobStep[];
  env?: Record<string, string>;
  workdir?: string;
  timeout?: number;
}

export interface JobStep {
  id?: string;
  name: string;
  command: string;
  env?: Record<string, string>;
  workdir?: string;
  timeout?: number;
  continueOnError?: boolean;
}

export interface JobResult {
  id: string;
  status: "success" | "failure" | "cancelled";
  steps: StepResult[];
  duration: number;
}

export interface StepResult {
  id?: string;
  name: string;
  status: "success" | "failure" | "skipped";
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}
