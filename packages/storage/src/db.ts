/**
 * Database connection and query helpers
 */

import { Database, type Statement } from "bun:sqlite";
import { initializeSchema } from "./schema.ts";
import type {
  JobStatus,
  PipelineRunRecord,
  JobRecord,
  StepRecord,
  LogRecord,
  ProjectRecord,
} from "./schema.ts";

// Helper to run prepared statements with named parameters
function runWithParams(stmt: Statement, params: Record<string, unknown>): void {
  stmt.run(params as Record<string, string | number | null | boolean | Uint8Array>);
}

function getWithParams<T>(stmt: Statement, params: Record<string, unknown>): T {
  return stmt.get(params as Record<string, string | number | null | boolean | Uint8Array>) as T;
}

function allWithParams<T>(stmt: Statement, params: Record<string, unknown>): T[] {
  return stmt.all(params as Record<string, string | number | null | boolean | Uint8Array>) as T[];
}

export interface DatabaseOptions {
  /** Path to the SQLite database file */
  path: string;
  /** Create database if it doesn't exist */
  create?: boolean;
}

export class ZephyrDatabase {
  private db: Database;

  constructor(options: DatabaseOptions) {
    this.db = new Database(options.path, {
      create: options.create ?? true,
    });
    initializeSchema(this.db);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ===========================================================================
  // Projects
  // ===========================================================================

  createProject(project: {
    id: string;
    name: string;
    description?: string;
    configPath?: string;
  }): ProjectRecord {
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, description, config_path)
      VALUES ($id, $name, $description, $configPath)
      RETURNING *
    `);
    return stmt.get({
      $id: project.id,
      $name: project.name,
      $description: project.description ?? null,
      $configPath: project.configPath ?? null,
    }) as ProjectRecord;
  }

  getProject(id: string): ProjectRecord | null {
    const stmt = this.db.prepare("SELECT * FROM projects WHERE id = ?");
    return stmt.get(id) as ProjectRecord | null;
  }

  getProjectByName(name: string): ProjectRecord | null {
    const stmt = this.db.prepare("SELECT * FROM projects WHERE name = ?");
    return stmt.get(name) as ProjectRecord | null;
  }

  listProjects(): ProjectRecord[] {
    const stmt = this.db.prepare("SELECT * FROM projects ORDER BY name");
    return stmt.all() as ProjectRecord[];
  }

  // ===========================================================================
  // Pipeline Runs
  // ===========================================================================

  createPipelineRun(run: {
    id: string;
    projectId: string;
    pipelineName: string;
    triggerType: string;
    triggerData?: unknown;
    branch?: string;
    commitSha?: string;
  }): PipelineRunRecord {
    const stmt = this.db.prepare(`
      INSERT INTO pipeline_runs (id, project_id, pipeline_name, trigger_type, trigger_data, branch, commit_sha)
      VALUES ($id, $projectId, $pipelineName, $triggerType, $triggerData, $branch, $commitSha)
      RETURNING *
    `);
    return stmt.get({
      $id: run.id,
      $projectId: run.projectId,
      $pipelineName: run.pipelineName,
      $triggerType: run.triggerType,
      $triggerData: run.triggerData ? JSON.stringify(run.triggerData) : null,
      $branch: run.branch ?? null,
      $commitSha: run.commitSha ?? null,
    }) as PipelineRunRecord;
  }

  getPipelineRun(id: string): PipelineRunRecord | null {
    const stmt = this.db.prepare("SELECT * FROM pipeline_runs WHERE id = ?");
    return stmt.get(id) as PipelineRunRecord | null;
  }

  updatePipelineRunStatus(
    id: string,
    status: JobStatus,
    timestamps?: { startedAt?: number; finishedAt?: number }
  ): void {
    let sql = "UPDATE pipeline_runs SET status = $status";
    const params: Record<string, unknown> = { $id: id, $status: status };

    if (timestamps?.startedAt) {
      sql += ", started_at = $startedAt";
      params.$startedAt = timestamps.startedAt;
    }
    if (timestamps?.finishedAt) {
      sql += ", finished_at = $finishedAt";
      params.$finishedAt = timestamps.finishedAt;
    }

    sql += " WHERE id = $id";
    runWithParams(this.db.prepare(sql), params);
  }

  listPipelineRuns(options?: {
    projectId?: string;
    status?: JobStatus;
    limit?: number;
    offset?: number;
  }): PipelineRunRecord[] {
    let sql = "SELECT * FROM pipeline_runs WHERE 1=1";
    const params: Record<string, unknown> = {};

    if (options?.projectId) {
      sql += " AND project_id = $projectId";
      params.$projectId = options.projectId;
    }
    if (options?.status) {
      sql += " AND status = $status";
      params.$status = options.status;
    }

    sql += " ORDER BY created_at DESC";

    if (options?.limit) {
      sql += " LIMIT $limit";
      params.$limit = options.limit;
    }
    if (options?.offset) {
      sql += " OFFSET $offset";
      params.$offset = options.offset;
    }

    return allWithParams<PipelineRunRecord>(this.db.prepare(sql), params);
  }

  // ===========================================================================
  // Jobs
  // ===========================================================================

  createJob(job: {
    id: string;
    pipelineRunId: string;
    name: string;
    runnerImage?: string;
  }): JobRecord {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, pipeline_run_id, name, runner_image)
      VALUES ($id, $pipelineRunId, $name, $runnerImage)
      RETURNING *
    `);
    return stmt.get({
      $id: job.id,
      $pipelineRunId: job.pipelineRunId,
      $name: job.name,
      $runnerImage: job.runnerImage ?? null,
    }) as JobRecord;
  }

  getJob(id: string): JobRecord | null {
    const stmt = this.db.prepare("SELECT * FROM jobs WHERE id = ?");
    return stmt.get(id) as JobRecord | null;
  }

  updateJobStatus(
    id: string,
    status: JobStatus,
    options?: { startedAt?: number; finishedAt?: number; exitCode?: number }
  ): void {
    let sql = "UPDATE jobs SET status = $status";
    const params: Record<string, unknown> = { $id: id, $status: status };

    if (options?.startedAt) {
      sql += ", started_at = $startedAt";
      params.$startedAt = options.startedAt;
    }
    if (options?.finishedAt) {
      sql += ", finished_at = $finishedAt";
      params.$finishedAt = options.finishedAt;
    }
    if (options?.exitCode !== undefined) {
      sql += ", exit_code = $exitCode";
      params.$exitCode = options.exitCode;
    }

    sql += " WHERE id = $id";
    runWithParams(this.db.prepare(sql), params);
  }

  getJobsForPipelineRun(pipelineRunId: string): JobRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM jobs WHERE pipeline_run_id = ? ORDER BY created_at"
    );
    return stmt.all(pipelineRunId) as JobRecord[];
  }

  // ===========================================================================
  // Steps
  // ===========================================================================

  createStep(step: {
    id: string;
    jobId: string;
    name: string;
    stepOrder: number;
  }): StepRecord {
    const stmt = this.db.prepare(`
      INSERT INTO steps (id, job_id, name, step_order)
      VALUES ($id, $jobId, $name, $stepOrder)
      RETURNING *
    `);
    return stmt.get({
      $id: step.id,
      $jobId: step.jobId,
      $name: step.name,
      $stepOrder: step.stepOrder,
    }) as StepRecord;
  }

  updateStepStatus(
    id: string,
    status: JobStatus,
    options?: { startedAt?: number; finishedAt?: number; exitCode?: number }
  ): void {
    let sql = "UPDATE steps SET status = $status";
    const params: Record<string, unknown> = { $id: id, $status: status };

    if (options?.startedAt) {
      sql += ", started_at = $startedAt";
      params.$startedAt = options.startedAt;
    }
    if (options?.finishedAt) {
      sql += ", finished_at = $finishedAt";
      params.$finishedAt = options.finishedAt;
    }
    if (options?.exitCode !== undefined) {
      sql += ", exit_code = $exitCode";
      params.$exitCode = options.exitCode;
    }

    sql += " WHERE id = $id";
    runWithParams(this.db.prepare(sql), params);
  }

  getStepsForJob(jobId: string): StepRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM steps WHERE job_id = ? ORDER BY step_order"
    );
    return stmt.all(jobId) as StepRecord[];
  }

  // ===========================================================================
  // Logs
  // ===========================================================================

  appendLog(log: {
    jobId: string;
    stepId?: string;
    stream: "stdout" | "stderr";
    content: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO logs (job_id, step_id, stream, content)
      VALUES ($jobId, $stepId, $stream, $content)
    `);
    stmt.run({
      $jobId: log.jobId,
      $stepId: log.stepId ?? null,
      $stream: log.stream,
      $content: log.content,
    });
  }

  getLogsForJob(jobId: string, options?: { stepId?: string; since?: number }): LogRecord[] {
    let sql = "SELECT * FROM logs WHERE job_id = $jobId";
    const params: Record<string, unknown> = { $jobId: jobId };

    if (options?.stepId) {
      sql += " AND step_id = $stepId";
      params.$stepId = options.stepId;
    }
    if (options?.since) {
      sql += " AND id > $since";
      params.$since = options.since;
    }

    sql += " ORDER BY id";
    return allWithParams<LogRecord>(this.db.prepare(sql), params);
  }

  // ===========================================================================
  // Job Queue
  // ===========================================================================

  /**
   * Get the next pending job to run
   */
  getNextPendingJob(): JobRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT 1
    `);
    return stmt.get() as JobRecord | null;
  }

  /**
   * Get all queued/pending jobs
   */
  getPendingJobs(limit?: number): JobRecord[] {
    let sql = "SELECT * FROM jobs WHERE status IN ('pending', 'queued') ORDER BY created_at";
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    return this.db.prepare(sql).all() as JobRecord[];
  }

  /**
   * Count jobs by status
   */
  countJobsByStatus(): Record<JobStatus, number> {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `);
    const results = stmt.all() as { status: JobStatus; count: number }[];

    const counts: Record<JobStatus, number> = {
      pending: 0,
      queued: 0,
      running: 0,
      success: 0,
      failure: 0,
      cancelled: 0,
      skipped: 0,
    };

    for (const row of results) {
      counts[row.status] = row.count;
    }

    return counts;
  }

  // ===========================================================================
  // Webhook Deliveries
  // ===========================================================================

  saveWebhookDelivery(delivery: {
    id: string;
    provider: string;
    eventType: string;
    payload: unknown;
    signature?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO webhook_deliveries (id, provider, event_type, payload, signature)
      VALUES ($id, $provider, $eventType, $payload, $signature)
    `);
    stmt.run({
      $id: delivery.id,
      $provider: delivery.provider,
      $eventType: delivery.eventType,
      $payload: JSON.stringify(delivery.payload),
      $signature: delivery.signature ?? null,
    });
  }

  markWebhookProcessed(id: string, pipelineRunId?: string, error?: string): void {
    const stmt = this.db.prepare(`
      UPDATE webhook_deliveries
      SET processed = 1, pipeline_run_id = $pipelineRunId, error = $error
      WHERE id = $id
    `);
    stmt.run({
      $id: id,
      $pipelineRunId: pipelineRunId ?? null,
      $error: error ?? null,
    });
  }
}
