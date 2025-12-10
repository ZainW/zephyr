/**
 * DAG (Directed Acyclic Graph) Scheduler
 *
 * Handles job dependency resolution and execution ordering.
 * Determines which jobs can run in parallel and which must wait.
 */

export interface DagNode {
  id: string;
  name: string;
  dependsOn: string[];
}

export interface DagJob extends DagNode {
  status: "pending" | "ready" | "running" | "success" | "failure" | "skipped" | "cancelled";
}

export interface DagResult {
  /** Jobs that are ready to run (no pending dependencies) */
  ready: string[];
  /** Jobs that are waiting for dependencies */
  pending: string[];
  /** Jobs that are currently running */
  running: string[];
  /** Jobs that completed successfully */
  completed: string[];
  /** Jobs that failed */
  failed: string[];
  /** Jobs that were skipped due to failed dependencies */
  skipped: string[];
}

/**
 * Build a DAG from job definitions
 */
export function buildDag(jobs: DagNode[]): Map<string, DagJob> {
  const dag = new Map<string, DagJob>();

  for (const job of jobs) {
    dag.set(job.id, {
      ...job,
      status: "pending",
    });
  }

  // Validate the DAG
  validateDag(dag);

  // Mark jobs with no dependencies as ready
  for (const job of dag.values()) {
    if (job.dependsOn.length === 0) {
      job.status = "ready";
    }
  }

  return dag;
}

/**
 * Validate the DAG for cycles and missing dependencies
 */
export function validateDag(dag: Map<string, DagJob>): void {
  const jobIds = new Set(dag.keys());

  // Check for missing dependencies
  for (const job of dag.values()) {
    for (const dep of job.dependsOn) {
      if (!jobIds.has(dep)) {
        throw new Error(`Job '${job.name}' depends on unknown job '${dep}'`);
      }
    }
  }

  // Check for cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(jobId: string): boolean {
    if (recursionStack.has(jobId)) {
      return true;
    }

    if (visited.has(jobId)) {
      return false;
    }

    visited.add(jobId);
    recursionStack.add(jobId);

    const job = dag.get(jobId)!;
    for (const dep of job.dependsOn) {
      if (hasCycle(dep)) {
        return true;
      }
    }

    recursionStack.delete(jobId);
    return false;
  }

  for (const jobId of dag.keys()) {
    if (hasCycle(jobId)) {
      throw new Error("Circular dependency detected in job graph");
    }
  }
}

/**
 * Get the current state of the DAG
 */
export function getDagState(dag: Map<string, DagJob>): DagResult {
  const result: DagResult = {
    ready: [],
    pending: [],
    running: [],
    completed: [],
    failed: [],
    skipped: [],
  };

  for (const job of dag.values()) {
    switch (job.status) {
      case "ready":
        result.ready.push(job.id);
        break;
      case "pending":
        result.pending.push(job.id);
        break;
      case "running":
        result.running.push(job.id);
        break;
      case "success":
        result.completed.push(job.id);
        break;
      case "failure":
        result.failed.push(job.id);
        break;
      case "skipped":
      case "cancelled":
        result.skipped.push(job.id);
        break;
    }
  }

  return result;
}

/**
 * Mark a job as started
 */
export function markJobRunning(dag: Map<string, DagJob>, jobId: string): void {
  const job = dag.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (job.status !== "ready") {
    throw new Error(`Job '${job.name}' is not ready to run (status: ${job.status})`);
  }

  job.status = "running";
}

/**
 * Mark a job as completed and update dependent jobs
 */
export function markJobCompleted(
  dag: Map<string, DagJob>,
  jobId: string,
  success: boolean
): string[] {
  const job = dag.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  job.status = success ? "success" : "failure";

  const newlyReady: string[] = [];

  if (success) {
    // Check if any pending jobs can now run
    for (const otherJob of dag.values()) {
      if (otherJob.status === "pending") {
        const allDepsComplete = otherJob.dependsOn.every((depId) => {
          const dep = dag.get(depId)!;
          return dep.status === "success";
        });

        if (allDepsComplete) {
          otherJob.status = "ready";
          newlyReady.push(otherJob.id);
        }
      }
    }
  } else {
    // Skip dependent jobs
    skipDependentJobs(dag, jobId);
  }

  return newlyReady;
}

/**
 * Skip all jobs that depend on a failed job
 */
function skipDependentJobs(dag: Map<string, DagJob>, failedJobId: string): void {
  const toSkip = new Set<string>();

  // Find all jobs that transitively depend on the failed job
  function findDependents(jobId: string): void {
    for (const job of dag.values()) {
      if (job.dependsOn.includes(jobId) && !toSkip.has(job.id)) {
        toSkip.add(job.id);
        findDependents(job.id);
      }
    }
  }

  findDependents(failedJobId);

  // Mark all dependents as skipped
  for (const jobId of toSkip) {
    const job = dag.get(jobId)!;
    if (job.status === "pending" || job.status === "ready") {
      job.status = "skipped";
    }
  }
}

/**
 * Cancel all remaining jobs
 */
export function cancelAllJobs(dag: Map<string, DagJob>): void {
  for (const job of dag.values()) {
    if (job.status === "pending" || job.status === "ready") {
      job.status = "cancelled";
    }
  }
}

/**
 * Check if the DAG is complete (all jobs finished)
 */
export function isDagComplete(dag: Map<string, DagJob>): boolean {
  for (const job of dag.values()) {
    if (job.status === "pending" || job.status === "ready" || job.status === "running") {
      return false;
    }
  }
  return true;
}

/**
 * Check if the DAG has any failures
 */
export function hasDagFailures(dag: Map<string, DagJob>): boolean {
  for (const job of dag.values()) {
    if (job.status === "failure") {
      return true;
    }
  }
  return false;
}

/**
 * Get topological order of jobs
 */
export function getTopologicalOrder(dag: Map<string, DagJob>): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  function visit(jobId: string): void {
    if (visited.has(jobId)) return;
    visited.add(jobId);

    const job = dag.get(jobId)!;
    for (const dep of job.dependsOn) {
      visit(dep);
    }

    order.push(jobId);
  }

  for (const jobId of dag.keys()) {
    visit(jobId);
  }

  return order;
}

/**
 * Get parallel execution layers (jobs that can run together)
 */
export function getParallelLayers(dag: Map<string, DagJob>): string[][] {
  const layers: string[][] = [];
  const assigned = new Set<string>();

  while (assigned.size < dag.size) {
    const layer: string[] = [];

    for (const [jobId, job] of dag) {
      if (assigned.has(jobId)) continue;

      // Check if all dependencies are in previous layers
      const canRun = job.dependsOn.every((dep) => assigned.has(dep));
      if (canRun) {
        layer.push(jobId);
      }
    }

    if (layer.length === 0) {
      throw new Error("Unable to make progress - possible cycle detected");
    }

    for (const jobId of layer) {
      assigned.add(jobId);
    }

    layers.push(layer);
  }

  return layers;
}
