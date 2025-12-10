/**
 * SQLite Database Schema for Zephyr CI
 *
 * Uses Bun's native SQLite support (bun:sqlite)
 */

import { Database } from "bun:sqlite";

/**
 * Initialize the database schema
 */
export function initializeSchema(db: Database): void {
  // Enable WAL mode for better concurrent access
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // Projects table
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      config_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Pipelines table (pipeline runs)
  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pipeline_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      trigger_type TEXT NOT NULL,
      trigger_data TEXT,
      branch TEXT,
      commit_sha TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Jobs table
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      pipeline_run_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      runner_image TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      exit_code INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id)
    )
  `);

  // Steps table
  db.run(`
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      step_order INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      exit_code INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  // Logs table (chunked log storage)
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      step_id TEXT,
      stream TEXT NOT NULL DEFAULT 'stdout',
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  // Artifacts table
  db.run(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER,
      checksum TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  // Secrets table (encrypted)
  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      UNIQUE(project_id, name)
    )
  `);

  // Webhook deliveries table (for debugging/replay)
  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      signature TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      pipeline_run_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id)
    )
  `);

  // Create indexes for common queries
  db.run("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project ON pipeline_runs(project_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_jobs_pipeline ON jobs(pipeline_run_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_steps_job ON steps(job_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_logs_job ON logs(job_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id)");
}

/**
 * Job status enum
 */
export type JobStatus = "pending" | "queued" | "running" | "success" | "failure" | "cancelled" | "skipped";

/**
 * Pipeline run record
 */
export interface PipelineRunRecord {
  id: string;
  project_id: string;
  pipeline_name: string;
  status: JobStatus;
  trigger_type: string;
  trigger_data: string | null;
  branch: string | null;
  commit_sha: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
}

/**
 * Job record
 */
export interface JobRecord {
  id: string;
  pipeline_run_id: string;
  name: string;
  status: JobStatus;
  runner_image: string | null;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  created_at: number;
}

/**
 * Step record
 */
export interface StepRecord {
  id: string;
  job_id: string;
  name: string;
  status: JobStatus;
  step_order: number;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  created_at: number;
}

/**
 * Log record
 */
export interface LogRecord {
  id: number;
  job_id: string;
  step_id: string | null;
  stream: "stdout" | "stderr";
  content: string;
  timestamp: number;
}

/**
 * Project record
 */
export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  config_path: string | null;
  created_at: number;
  updated_at: number;
}
