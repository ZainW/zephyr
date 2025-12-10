// Config loader
export {
  loadConfig,
  findConfigFile,
  resolvePipelines,
  createDefaultContext,
  type LoadedConfig,
} from "./config/loader.ts";

// Executor
export {
  runJob,
  type RunJobOptions,
  type JobRunResult,
} from "./executor/runner.ts";

// Utils
export {
  createLogger,
  type Logger,
  type LogLevel,
} from "./utils/logger.ts";

// DAG Scheduler
export {
  buildDag,
  validateDag,
  getDagState,
  markJobRunning,
  markJobCompleted,
  cancelAllJobs,
  isDagComplete,
  hasDagFailures,
  getTopologicalOrder,
  getParallelLayers,
  type DagNode,
  type DagJob,
  type DagResult,
} from "./scheduler/dag.ts";

// Matrix Expansion
export {
  expandMatrix,
  expandPipelineJobs,
  interpolateMatrix,
  applyMatrixToEnv,
  getMatrixParallelism,
  hasMatrix,
  type MatrixCombination,
  type ExpandedJob,
} from "./matrix/expand.ts";
