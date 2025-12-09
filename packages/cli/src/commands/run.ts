/**
 * Run a pipeline locally
 */
import {
  loadConfig,
  findConfigFile,
  resolvePipelines,
  createDefaultContext,
  runJob,
  createLogger,
} from "@zephyr-ci/core";
import type { JobDefinition, JobResult } from "@zephyr-ci/types";

export interface RunOptions {
  /** Working directory */
  cwd?: string;
  /** Pipeline name to run (defaults to first pipeline) */
  pipeline?: string;
  /** Specific job to run (defaults to all jobs) */
  job?: string;
  /** Config file path */
  config?: string;
  /** Log level */
  logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Topologically sort jobs based on dependencies
 */
function sortJobsByDependencies(jobs: JobDefinition[]): JobDefinition[] {
  const sorted: JobDefinition[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const jobMap = new Map(jobs.map((j) => [j.name, j]));

  function visit(job: JobDefinition): void {
    if (visited.has(job.name)) return;
    if (visiting.has(job.name)) {
      throw new Error(`Circular dependency detected involving job '${job.name}'`);
    }

    visiting.add(job.name);

    for (const depName of job.dependsOn ?? []) {
      const dep = jobMap.get(depName);
      if (dep) {
        visit(dep);
      }
    }

    visiting.delete(job.name);
    visited.add(job.name);
    sorted.push(job);
  }

  for (const job of jobs) {
    visit(job);
  }

  return sorted;
}

export async function run(options: RunOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const logger = createLogger({ level: options.logLevel ?? "info" });

  // Find config file
  const configPath = options.config ?? findConfigFile(cwd);
  if (!configPath) {
    logger.error("No zephyr.config.ts found. Run 'zephyr init' to create one.");
    process.exit(1);
  }

  logger.info(`Loading config from ${configPath}`);

  // Load config
  const { config } = await loadConfig(configPath);

  // Create context
  const context = createDefaultContext();

  // Resolve pipelines
  const pipelines = resolvePipelines(config, context);

  if (pipelines.length === 0) {
    logger.error("No pipelines defined in config");
    process.exit(1);
  }

  // Select pipeline
  let pipeline = pipelines[0]!;
  if (options.pipeline) {
    const found = pipelines.find((p) => p.name === options.pipeline);
    if (!found) {
      logger.error(`Pipeline '${options.pipeline}' not found`);
      logger.info(`Available pipelines: ${pipelines.map((p) => p.name).join(", ")}`);
      process.exit(1);
    }
    pipeline = found;
  }

  logger.info(`Running pipeline: ${pipeline.name}`);
  logger.info("");

  // Get jobs to run
  let jobsToRun = pipeline.jobs;
  if (options.job) {
    const found = pipeline.jobs.find((j) => j.name === options.job);
    if (!found) {
      logger.error(`Job '${options.job}' not found in pipeline '${pipeline.name}'`);
      logger.info(`Available jobs: ${pipeline.jobs.map((j) => j.name).join(", ")}`);
      process.exit(1);
    }
    jobsToRun = [found];
  }

  // Sort jobs by dependencies
  const sortedJobs = sortJobsByDependencies(jobsToRun);

  // Get config directory as working directory
  const configDir = configPath.split("/").slice(0, -1).join("/");

  // Run jobs
  const results: Record<string, JobResult> = {};
  let failed = false;

  for (const job of sortedJobs) {
    // Check if dependencies succeeded
    if (job.dependsOn) {
      const failedDep = job.dependsOn.find(
        (dep) => results[dep]?.status !== "success"
      );
      if (failedDep) {
        logger.info(`\x1b[33m⊘ Skipping job '${job.name}'\x1b[0m (dependency '${failedDep}' failed)`);
        results[job.name] = {
          status: "skipped",
          outputs: {},
        };
        continue;
      }
    }

    // Check condition
    if (job.condition) {
      if (typeof job.condition === "string") {
        if (job.condition === "on_failure" && !failed) {
          logger.info(`\x1b[33m⊘ Skipping job '${job.name}'\x1b[0m (condition: on_failure)`);
          results[job.name] = { status: "skipped", outputs: {} };
          continue;
        }
      } else if (typeof job.condition === "function") {
        const shouldRun = await job.condition({
          ...context,
          needs: results,
        });
        if (!shouldRun) {
          logger.info(`\x1b[33m⊘ Skipping job '${job.name}'\x1b[0m (condition not met)`);
          results[job.name] = { status: "skipped", outputs: {} };
          continue;
        }
      }
    }

    const result = await runJob(job, {
      cwd: configDir,
      context,
      logger,
      needs: results,
      env: {
        ...config.project.env,
        ...pipeline.env,
      },
    });

    results[job.name] = {
      status: result.status,
      outputs: result.outputs,
    };

    if (result.status === "failure") {
      failed = true;
    }

    logger.info("");
  }

  // Summary
  logger.info("─".repeat(50));
  logger.info("Pipeline Summary:");

  for (const [name, result] of Object.entries(results)) {
    const icon =
      result.status === "success"
        ? "\x1b[32m✓\x1b[0m"
        : result.status === "failure"
          ? "\x1b[31m✗\x1b[0m"
          : "\x1b[33m⊘\x1b[0m";
    logger.info(`  ${icon} ${name}: ${result.status}`);
  }

  if (failed) {
    logger.info("");
    logger.error("Pipeline failed");
    process.exit(1);
  }

  logger.info("");
  logger.info("\x1b[32mPipeline completed successfully\x1b[0m");
}
