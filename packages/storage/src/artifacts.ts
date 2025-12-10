/**
 * Artifacts Manager
 *
 * Handles collection, storage, and retrieval of build artifacts.
 * Artifacts are files produced by jobs that need to be preserved.
 */

import { Database } from "bun:sqlite";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";

export interface ArtifactManagerOptions {
  /** Directory to store artifacts */
  artifactsDir: string;
  /** SQLite database for metadata */
  db?: Database;
  /** Default retention period in days */
  defaultRetention?: number;
}

export interface ArtifactMetadata {
  id: string;
  name: string;
  jobId: string;
  pipelineRunId: string;
  size: number;
  hash: string;
  paths: string[];
  compression: "gzip" | "zstd" | "none";
  createdAt: number;
  expiresAt: number;
}

export interface UploadArtifactOptions {
  /** Artifact name */
  name: string;
  /** Job ID */
  jobId: string;
  /** Pipeline run ID */
  pipelineRunId: string;
  /** Paths to include (glob patterns supported) */
  paths: string[];
  /** Working directory */
  workdir: string;
  /** Compression method */
  compression?: "gzip" | "zstd" | "none";
  /** Retention in days */
  retention?: number;
}

export interface DownloadArtifactOptions {
  /** Artifact ID or name */
  id?: string;
  name?: string;
  jobId?: string;
  pipelineRunId?: string;
  /** Directory to extract to */
  destDir: string;
}

const ARTIFACTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    job_id TEXT NOT NULL,
    pipeline_run_id TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    paths TEXT NOT NULL,
    compression TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(pipeline_run_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_expires ON artifacts(expires_at);
  CREATE INDEX IF NOT EXISTS idx_artifacts_name_run ON artifacts(name, pipeline_run_id);
`;

export class ArtifactManager {
  private artifactsDir: string;
  private db: Database;
  private defaultRetention: number;
  private ownsDb: boolean;

  constructor(options: ArtifactManagerOptions) {
    this.artifactsDir = options.artifactsDir;
    this.defaultRetention = options.defaultRetention ?? 30; // 30 days

    if (options.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else {
      this.db = new Database(join(this.artifactsDir, "artifacts.db"), { create: true });
      this.ownsDb = true;
    }

    this.db.exec(ARTIFACTS_SCHEMA);
  }

  /**
   * Upload artifact files
   */
  async upload(options: UploadArtifactOptions): Promise<ArtifactMetadata> {
    const {
      name,
      jobId,
      pipelineRunId,
      paths,
      workdir,
      compression = "gzip",
      retention = this.defaultRetention,
    } = options;

    const id = crypto.randomUUID();
    const archivePath = this.getArchivePath(pipelineRunId, id, compression);

    // Ensure directory exists
    await Bun.$`mkdir -p ${dirname(archivePath)}`.quiet();

    // Expand glob patterns and collect files
    const expandedPaths = await this.expandPaths(paths, workdir);
    if (expandedPaths.length === 0) {
      throw new Error(`No files matched patterns: ${paths.join(", ")}`);
    }

    // Create archive based on compression type
    await this.createArchive(archivePath, expandedPaths, workdir, compression);

    // Get archive stats
    const stat = await Bun.file(archivePath).stat();
    const size = stat?.size ?? 0;
    const hash = await this.hashFile(archivePath);

    const now = Date.now();
    const expiresAt = now + retention * 24 * 60 * 60 * 1000;

    // Save metadata
    this.db
      .prepare(
        `
      INSERT INTO artifacts
      (id, name, job_id, pipeline_run_id, size, hash, paths, compression, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, name, jobId, pipelineRunId, size, hash, JSON.stringify(expandedPaths), compression, now, expiresAt);

    return {
      id,
      name,
      jobId,
      pipelineRunId,
      size,
      hash,
      paths: expandedPaths,
      compression,
      createdAt: now,
      expiresAt,
    };
  }

  /**
   * Download and extract artifact
   */
  async download(options: DownloadArtifactOptions): Promise<ArtifactMetadata | null> {
    const { id, name, jobId, pipelineRunId, destDir } = options;

    let artifact: ArtifactMetadata | null = null;

    if (id) {
      artifact = this.getById(id);
    } else if (name && pipelineRunId) {
      artifact = this.getByNameAndRun(name, pipelineRunId);
    } else if (name && jobId) {
      artifact = this.getByNameAndJob(name, jobId);
    }

    if (!artifact) {
      return null;
    }

    const archivePath = this.getArchivePath(artifact.pipelineRunId, artifact.id, artifact.compression);

    // Check if archive exists
    if (!(await Bun.file(archivePath).exists())) {
      return null;
    }

    // Ensure destination directory exists
    await Bun.$`mkdir -p ${destDir}`.quiet();

    // Extract archive based on compression type
    await this.extractArchive(archivePath, destDir, artifact.compression);

    return artifact;
  }

  /**
   * Get artifact metadata by ID
   */
  getById(id: string): ArtifactMetadata | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as DbArtifactRow | null;
    return row ? this.rowToMetadata(row) : null;
  }

  /**
   * Get artifact by name and pipeline run
   */
  getByNameAndRun(name: string, pipelineRunId: string): ArtifactMetadata | null {
    const row = this.db
      .prepare("SELECT * FROM artifacts WHERE name = ? AND pipeline_run_id = ?")
      .get(name, pipelineRunId) as DbArtifactRow | null;
    return row ? this.rowToMetadata(row) : null;
  }

  /**
   * Get artifact by name and job
   */
  getByNameAndJob(name: string, jobId: string): ArtifactMetadata | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE name = ? AND job_id = ?").get(name, jobId) as
      | DbArtifactRow
      | null;
    return row ? this.rowToMetadata(row) : null;
  }

  /**
   * List artifacts for a pipeline run
   */
  listForRun(pipelineRunId: string): ArtifactMetadata[] {
    const rows = this.db
      .prepare("SELECT * FROM artifacts WHERE pipeline_run_id = ? ORDER BY created_at")
      .all(pipelineRunId) as DbArtifactRow[];
    return rows.map((row) => this.rowToMetadata(row));
  }

  /**
   * List artifacts for a job
   */
  listForJob(jobId: string): ArtifactMetadata[] {
    const rows = this.db.prepare("SELECT * FROM artifacts WHERE job_id = ? ORDER BY created_at").all(jobId) as DbArtifactRow[];
    return rows.map((row) => this.rowToMetadata(row));
  }

  /**
   * Delete an artifact
   */
  async delete(id: string): Promise<boolean> {
    const artifact = this.getById(id);
    if (!artifact) {
      return false;
    }

    const archivePath = this.getArchivePath(artifact.pipelineRunId, id, artifact.compression);
    try {
      await Bun.$`rm -f ${archivePath}`.quiet();
    } catch {
      // Ignore errors
    }

    this.db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
    return true;
  }

  /**
   * Clean up expired artifacts
   */
  async cleanup(): Promise<number> {
    const now = Date.now();

    // Get expired artifacts
    const expired = this.db.prepare("SELECT * FROM artifacts WHERE expires_at <= ?").all(now) as DbArtifactRow[];

    // Delete archive files
    for (const row of expired) {
      const artifact = this.rowToMetadata(row);
      const archivePath = this.getArchivePath(artifact.pipelineRunId, artifact.id, artifact.compression);
      try {
        await Bun.$`rm -f ${archivePath}`.quiet();
      } catch {
        // Ignore errors
      }
    }

    // Delete from database
    this.db.prepare("DELETE FROM artifacts WHERE expires_at <= ?").run(now);

    return expired.length;
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    count: number;
    totalSize: number;
    byCompression: Record<string, number>;
  } {
    const result = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(size), 0) as total_size
      FROM artifacts
      WHERE expires_at > ?
    `
      )
      .get(Date.now()) as { count: number; total_size: number };

    const byCompression = this.db
      .prepare(
        `
      SELECT compression, COUNT(*) as count
      FROM artifacts
      WHERE expires_at > ?
      GROUP BY compression
    `
      )
      .all(Date.now()) as { compression: string; count: number }[];

    return {
      count: result.count,
      totalSize: result.total_size,
      byCompression: Object.fromEntries(byCompression.map((r) => [r.compression, r.count])),
    };
  }

  /**
   * Close the manager
   */
  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  private getArchivePath(runId: string, id: string, compression: string): string {
    const ext = compression === "gzip" ? ".tar.gz" : compression === "zstd" ? ".tar.zst" : ".tar";
    return join(this.artifactsDir, runId.slice(0, 8), `${id}${ext}`);
  }

  private async expandPaths(patterns: string[], workdir: string): Promise<string[]> {
    const results: string[] = [];

    for (const pattern of patterns) {
      // Use glob to expand patterns
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({ cwd: workdir })) {
        results.push(file);
      }
    }

    return [...new Set(results)]; // Deduplicate
  }

  private async createArchive(
    archivePath: string,
    files: string[],
    workdir: string,
    compression: "gzip" | "zstd" | "none"
  ): Promise<void> {
    // Write file list to temp file for tar
    const listFile = `${archivePath}.list`;
    await Bun.write(listFile, files.join("\n"));

    try {
      switch (compression) {
        case "gzip":
          await Bun.$`tar -czf ${archivePath} -C ${workdir} -T ${listFile}`.quiet();
          break;
        case "zstd":
          await Bun.$`tar -cf - -C ${workdir} -T ${listFile} | zstd -o ${archivePath}`.quiet();
          break;
        case "none":
          await Bun.$`tar -cf ${archivePath} -C ${workdir} -T ${listFile}`.quiet();
          break;
      }
    } finally {
      await Bun.$`rm -f ${listFile}`.quiet();
    }
  }

  private async extractArchive(
    archivePath: string,
    destDir: string,
    compression: "gzip" | "zstd" | "none"
  ): Promise<void> {
    switch (compression) {
      case "gzip":
        await Bun.$`tar -xzf ${archivePath} -C ${destDir}`.quiet();
        break;
      case "zstd":
        await Bun.$`zstd -d ${archivePath} -c | tar -xf - -C ${destDir}`.quiet();
        break;
      case "none":
        await Bun.$`tar -xf ${archivePath} -C ${destDir}`.quiet();
        break;
    }
  }

  private async hashFile(path: string): Promise<string> {
    const file = Bun.file(path);
    const buffer = await file.arrayBuffer();
    return createHash("sha256").update(Buffer.from(buffer)).digest("hex").slice(0, 16);
  }

  private rowToMetadata(row: DbArtifactRow): ArtifactMetadata {
    return {
      id: row.id,
      name: row.name,
      jobId: row.job_id,
      pipelineRunId: row.pipeline_run_id,
      size: row.size,
      hash: row.hash,
      paths: JSON.parse(row.paths),
      compression: row.compression as "gzip" | "zstd" | "none",
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }
}

interface DbArtifactRow {
  id: string;
  name: string;
  job_id: string;
  pipeline_run_id: string;
  size: number;
  hash: string;
  paths: string;
  compression: string;
  created_at: number;
  expires_at: number;
}
