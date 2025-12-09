/**
 * Zephyr CI Configuration Types
 *
 * These types define the schema for zephyr.config.ts files.
 */

// ============================================================================
// CORE CONFIGURATION
// ============================================================================

/**
 * Main configuration object - users export this as default from zephyr.config.ts
 */
export interface ZephyrConfig {
  /**
   * Project metadata and global settings
   */
  project: ProjectConfig;

  /**
   * Pipeline definitions - can be static or dynamic based on context
   */
  pipelines: PipelineDefinition[] | ((ctx: ConfigContext) => PipelineDefinition[]);
}

/**
 * Project-level configuration
 */
export interface ProjectConfig {
  /** Unique project name */
  name: string;
  /** Project description */
  description?: string;
  /** Default environment variables for all jobs */
  env?: Record<string, string>;
  /** Default secrets references */
  secrets?: SecretRef[];
  /** Global cache configuration */
  cache?: CacheConfig;
}

/**
 * Context available when evaluating dynamic configuration
 */
export interface ConfigContext {
  /** Git branch name */
  branch: string;
  /** Git commit SHA */
  sha: string;
  /** Git tag if present */
  tag?: string;
  /** Event type that triggered the run */
  event: TriggerEvent;
  /** Environment variables from the trigger */
  env: Record<string, string>;
  /** Whether this is a pull request */
  isPullRequest: boolean;
  /** PR number if applicable */
  prNumber?: number;
  /** Repository information */
  repo: {
    owner: string;
    name: string;
    url: string;
  };
}

// ============================================================================
// PIPELINE DEFINITIONS
// ============================================================================

/**
 * A pipeline is a collection of jobs that run in response to triggers
 */
export interface PipelineDefinition {
  /** Pipeline name (unique within project) */
  name: string;
  /** When this pipeline should run */
  triggers: TriggerConfig[];
  /** Jobs in this pipeline */
  jobs: JobDefinition[];
  /** Pipeline-level environment variables */
  env?: Record<string, string>;
  /** Concurrency control */
  concurrency?: ConcurrencyConfig;
}

/**
 * Trigger configuration - defines when a pipeline runs
 */
export interface TriggerConfig {
  /** Trigger type */
  type: "push" | "pull_request" | "tag" | "schedule" | "manual";
  /** Branch patterns (glob) - for push/pull_request triggers */
  branches?: string[];
  /** Ignore patterns for branches */
  branchesIgnore?: string[];
  /** Path patterns that must change to trigger */
  paths?: string[];
  /** Path patterns to ignore */
  pathsIgnore?: string[];
  /** Tag patterns (for tag trigger) */
  tags?: string[];
  /** Cron expression (for schedule trigger) */
  cron?: string;
  /** PR events (for pull_request trigger) */
  prEvents?: ("opened" | "synchronize" | "reopened" | "closed")[];
  /** Manual trigger inputs */
  inputs?: InputDefinition[];
}

/**
 * Input definition for manual triggers
 */
export interface InputDefinition {
  name: string;
  description?: string;
  type: "string" | "boolean" | "choice";
  required?: boolean;
  default?: string | boolean;
  options?: string[]; // for choice type
}

// ============================================================================
// JOB DEFINITIONS
// ============================================================================

/**
 * A job is a unit of work that runs in an isolated environment
 */
export interface JobDefinition {
  /** Job name (unique within pipeline) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Jobs that must complete before this one */
  dependsOn?: string[];
  /** Condition for running this job */
  condition?: JobCondition;
  /** Execution environment */
  runner: RunnerConfig;
  /** Job steps */
  steps: StepDefinition[];
  /** Job-level environment variables */
  env?: Record<string, string>;
  /** Secrets to expose */
  secrets?: SecretRef[];
  /** Services to run alongside (databases, etc.) */
  services?: ServiceDefinition[];
  /** Timeout in seconds (default: 3600) */
  timeout?: number;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Artifacts to collect */
  artifacts?: ArtifactDefinition[];
  /** Cache configuration */
  cache?: CacheConfig;
  /** Matrix strategy for parallel job variants */
  matrix?: MatrixConfig;
}

/**
 * Condition for running a job
 */
export type JobCondition =
  | "always"
  | "on_success"
  | "on_failure"
  | ((ctx: JobContext) => boolean | Promise<boolean>);

/**
 * Context available within a job
 */
export interface JobContext extends ConfigContext {
  /** Results of dependent jobs */
  needs: Record<string, JobResult>;
  /** Matrix values for this job instance */
  matrix?: Record<string, string | number | boolean>;
}

/**
 * Result of a completed job
 */
export interface JobResult {
  status: "success" | "failure" | "cancelled" | "skipped";
  outputs: Record<string, string>;
}

// ============================================================================
// RUNNER CONFIGURATION
// ============================================================================

/**
 * Execution environment configuration
 */
export interface RunnerConfig {
  /** Base image for the VM */
  image: RunnerImage;
  /** CPU cores (default: 1) */
  cpu?: number;
  /** Memory in MB (default: 1024) */
  memory?: number;
  /** Additional disk space in MB */
  disk?: number;
}

/**
 * Available runner images
 */
export type RunnerImage =
  | "ubuntu-22.04"
  | "ubuntu-24.04"
  | "alpine-3.19"
  | "debian-12"
  | `custom:${string}`;

// ============================================================================
// STEP DEFINITIONS
// ============================================================================

/**
 * A step is a single command or action within a job
 */
export type StepDefinition = RunStep | SetupStep;

/**
 * Base properties shared by all step types
 */
export interface BaseStep {
  /** Step name */
  name: string;
  /** Step ID for referencing outputs */
  id?: string;
  /** Condition for running this step */
  if?: string | ((ctx: StepContext) => boolean | Promise<boolean>);
  /** Step-level environment variables */
  env?: Record<string, string>;
  /** Working directory */
  workdir?: string;
  /** Continue on error */
  continueOnError?: boolean;
  /** Step timeout in seconds */
  timeout?: number;
}

/**
 * Step that runs shell commands
 */
export interface RunStep extends BaseStep {
  type: "run";
  /** Shell command(s) to execute */
  run: string;
  /** Shell to use */
  shell?: "bash" | "sh";
}

/**
 * Step that sets up a runtime environment
 */
export interface SetupStep extends BaseStep {
  type: "setup";
  /** Runtime to set up */
  runtime: "node" | "bun" | "go" | "rust" | "python";
  /** Version specification */
  version: string;
}

/**
 * Context available within a step
 */
export interface StepContext extends JobContext {
  /** Previous step outputs */
  steps: Record<string, StepResult>;
}

/**
 * Result of a completed step
 */
export interface StepResult {
  status: "success" | "failure" | "skipped";
  outputs: Record<string, string>;
  /** Outcome before continueOnError was applied */
  outcome: "success" | "failure" | "skipped";
}

// ============================================================================
// SERVICES
// ============================================================================

/**
 * Service definition for sidecar containers
 */
export interface ServiceDefinition {
  /** Service name (used as hostname) */
  name: string;
  /** Docker image */
  image: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Ports to expose */
  ports?: number[];
  /** Health check command */
  healthCheck?: string;
}

// ============================================================================
// ARTIFACTS
// ============================================================================

/**
 * Artifact collection configuration
 */
export interface ArtifactDefinition {
  /** Artifact name */
  name: string;
  /** Paths to include (glob patterns) */
  paths: string[];
  /** Retention period in days (default: 30) */
  retention?: number;
  /** Compression method */
  compression?: "gzip" | "zstd" | "none";
  /** Only upload on specific conditions */
  if?: "always" | "on_success" | "on_failure";
}

// ============================================================================
// CACHING
// ============================================================================

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Cache key pattern (can include variables like ${sha}) */
  key: string;
  /** Paths to cache */
  paths: string[];
  /** Restore keys (fallback) */
  restoreKeys?: string[];
}

// ============================================================================
// SECRETS
// ============================================================================

/**
 * Secret reference
 */
export interface SecretRef {
  /** Environment variable name to expose as */
  as: string;
  /** Secret name in the secret store */
  from: string;
}

// ============================================================================
// MATRIX
// ============================================================================

/**
 * Matrix strategy for running job variants in parallel
 */
export interface MatrixConfig {
  /** Matrix dimensions */
  values: Record<string, (string | number | boolean)[]>;
  /** Combinations to exclude */
  exclude?: Record<string, string | number | boolean>[];
  /** Additional combinations to include */
  include?: Record<string, string | number | boolean>[];
  /** Max parallel jobs */
  maxParallel?: number;
  /** Fail fast on first failure */
  failFast?: boolean;
}

// ============================================================================
// CONCURRENCY
// ============================================================================

/**
 * Concurrency control configuration
 */
export interface ConcurrencyConfig {
  /** Concurrency group name */
  group: string;
  /** Cancel in-progress jobs when new one starts */
  cancelInProgress?: boolean;
}

// ============================================================================
// RETRY
// ============================================================================

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Max retry attempts */
  maxAttempts: number;
  /** Delay between retries in seconds */
  delay?: number;
  /** Only retry on these exit codes */
  onExitCodes?: number[];
}

// ============================================================================
// TRIGGER EVENTS (runtime)
// ============================================================================

/**
 * Event that triggered the pipeline run
 */
export type TriggerEvent =
  | { type: "push"; branch: string; sha: string }
  | {
      type: "pull_request";
      action: string;
      number: number;
      base: string;
      head: string;
    }
  | { type: "tag"; tag: string; sha: string }
  | { type: "schedule"; cron: string }
  | { type: "manual"; inputs: Record<string, string> }
  | { type: "api"; triggeredBy?: string };
