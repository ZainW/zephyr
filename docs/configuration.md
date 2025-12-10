# Configuration Reference

Zephyr uses TypeScript configuration files (`zephyr.config.ts`) for full type safety and IDE support.

## Basic Structure

```typescript
import { defineConfig } from '@zephyr-ci/config';

export default defineConfig({
  project: {
    name: 'my-project',
    env: {
      NODE_ENV: 'ci',
    },
  },

  pipelines: [
    {
      name: 'ci',
      triggers: [/* ... */],
      jobs: [/* ... */],
    },
  ],
});
```

## Project Configuration

```typescript
project: {
  // Required: Project name
  name: string;

  // Optional: Global environment variables for all jobs
  env?: Record<string, string>;
}
```

## Pipelines

Pipelines are collections of jobs that run together.

```typescript
pipelines: [
  {
    // Required: Pipeline name
    name: string;

    // Optional: When to trigger this pipeline
    triggers?: TriggerDefinition[];

    // Optional: Pipeline-level environment variables
    env?: Record<string, string>;

    // Required: Jobs to run
    jobs: JobDefinition[];
  },
];
```

### Dynamic Pipelines

Pipelines can be defined as a function for dynamic configuration:

```typescript
pipelines: (ctx) => [
  {
    name: 'ci',
    jobs: ctx.isPullRequest
      ? [testJob, lintJob]
      : [testJob, lintJob, deployJob],
  },
];
```

## Triggers

### Push Trigger

```typescript
{
  type: 'push',
  branches?: string[];      // e.g., ['main', 'develop']
  tags?: string[];          // e.g., ['v*']
  paths?: string[];         // e.g., ['src/**', 'package.json']
  pathsIgnore?: string[];   // e.g., ['docs/**', '*.md']
}
```

### Pull Request Trigger

```typescript
{
  type: 'pull_request',
  branches?: string[];      // Target branches
  types?: string[];         // e.g., ['opened', 'synchronize']
  paths?: string[];
  pathsIgnore?: string[];
}
```

### Schedule Trigger (Cron)

```typescript
{
  type: 'schedule',
  cron: string;  // e.g., '0 0 * * *' (daily at midnight)
}
```

### Manual Trigger

```typescript
{
  type: 'manual',
  inputs?: {
    [name: string]: {
      description?: string;
      required?: boolean;
      default?: string;
      type?: 'string' | 'boolean' | 'choice';
      options?: string[];  // For type: 'choice'
    };
  };
}
```

## Jobs

```typescript
{
  // Required: Job name (unique within pipeline)
  name: string;

  // Required: Runner configuration
  runner: {
    image: string;       // e.g., 'ubuntu-22.04', 'alpine'
    cpu?: number;        // CPU cores (default: 1)
    memory?: number;     // Memory in MB (default: 1024)
  };

  // Required: Steps to execute
  steps: StepDefinition[];

  // Optional: Job dependencies
  dependsOn?: string[];

  // Optional: Job-level environment variables
  env?: Record<string, string>;

  // Optional: Condition to run this job
  condition?: 'always' | 'on_failure' | ((ctx) => boolean | Promise<boolean>);

  // Optional: Matrix for multiple configurations
  matrix?: MatrixConfig;

  // Optional: Services to run alongside
  services?: ServiceDefinition[];
}
```

### Job Dependencies

```typescript
jobs: [
  { name: 'build', steps: [/* ... */] },
  { name: 'test', dependsOn: ['build'], steps: [/* ... */] },
  { name: 'deploy', dependsOn: ['test'], steps: [/* ... */] },
];
```

### Matrix Builds

```typescript
{
  name: 'test',
  matrix: {
    node: ['18', '20', '22'],
    os: ['ubuntu-22.04', 'alpine'],
    exclude: [
      { node: '18', os: 'alpine' },
    ],
    include: [
      { node: '22', os: 'ubuntu-22.04', experimental: true },
    ],
  },
  runner: { image: '${{ matrix.os }}' },
  steps: [
    { type: 'setup', runtime: 'node', version: '${{ matrix.node }}' },
    { type: 'run', name: 'Test', run: 'npm test' },
  ],
}
```

### Conditional Jobs

```typescript
{
  name: 'deploy',
  condition: (ctx) => ctx.branch === 'main' && !ctx.isPullRequest,
  steps: [/* ... */],
}

// Or use built-in conditions
{
  name: 'notify-failure',
  condition: 'on_failure',
  steps: [/* ... */],
}
```

## Steps

### Run Step

Execute a shell command:

```typescript
{
  type: 'run',
  name: string;           // Step name
  run: string;            // Command to run
  shell?: string;         // Shell to use (default: 'bash')
  workdir?: string;       // Working directory
  env?: Record<string, string>;
  timeout?: number;       // Timeout in seconds
  continueOnError?: boolean;
  if?: string | ((ctx) => boolean);
}
```

### Setup Step

Install a runtime:

```typescript
{
  type: 'setup',
  name?: string;
  runtime: 'node' | 'bun' | 'go' | 'rust' | 'python';
  version: string;
}
```

### Step Conditions

```typescript
{
  type: 'run',
  name: 'Deploy',
  run: './deploy.sh',
  if: (ctx) => ctx.branch === 'main',
}

// Access previous step results
{
  type: 'run',
  name: 'Notify',
  run: 'curl -X POST ...',
  if: (ctx) => ctx.steps.test?.status === 'failure',
}
```

### Step Outputs

Steps can output values for use in later steps:

```typescript
// In your script, output values:
// echo "::set-output name=version::1.2.3"

{
  type: 'run',
  id: 'get-version',
  name: 'Get Version',
  run: 'echo "::set-output name=version::$(cat package.json | jq -r .version)"',
}

// Use in later step
{
  type: 'run',
  name: 'Tag Release',
  run: 'git tag v${{ steps.get-version.outputs.version }}',
}
```

## Services

Run containers alongside your job:

```typescript
{
  name: 'integration-test',
  services: [
    {
      name: 'postgres',
      image: 'postgres:15',
      env: {
        POSTGRES_PASSWORD: 'test',
      },
      ports: ['5432:5432'],
      healthCheck: {
        command: 'pg_isready',
        interval: 10,
        timeout: 5,
        retries: 5,
      },
    },
    {
      name: 'redis',
      image: 'redis:7',
      ports: ['6379:6379'],
    },
  ],
  steps: [
    {
      type: 'run',
      name: 'Run Tests',
      run: 'npm run test:integration',
      env: {
        DATABASE_URL: 'postgres://postgres:test@postgres:5432/test',
        REDIS_URL: 'redis://redis:6379',
      },
    },
  ],
}
```

## Context Object

The context object is available in dynamic configurations:

```typescript
interface ConfigContext {
  // Git information
  branch: string;
  sha: string;
  shortSha: string;

  // Repository
  repo: {
    owner: string;
    name: string;
    url: string;
  };

  // Trigger information
  isPullRequest: boolean;
  event: TriggerEvent;

  // Environment
  env: Record<string, string>;

  // Previous job results (in job conditions)
  needs?: Record<string, JobResult>;

  // Previous step results (in step conditions)
  steps?: Record<string, StepResult>;
}
```

## Environment Variables

### Built-in Variables

These are automatically set for all jobs:

| Variable | Description |
|----------|-------------|
| `CI` | Always `true` |
| `ZEPHYR` | Always `true` |
| `ZEPHYR_JOB` | Current job name |
| `ZEPHYR_PIPELINE` | Current pipeline name |
| `ZEPHYR_RUN_ID` | Unique run identifier |
| `ZEPHYR_BRANCH` | Git branch name |
| `ZEPHYR_SHA` | Git commit SHA |

### Setting Environment Variables

```typescript
// Project level (all jobs)
project: {
  env: {
    NODE_ENV: 'ci',
  },
}

// Pipeline level
pipelines: [{
  env: {
    DEPLOY_ENV: 'staging',
  },
}]

// Job level
jobs: [{
  env: {
    DATABASE_URL: 'postgres://...',
  },
}]

// Step level
steps: [{
  env: {
    DEBUG: 'true',
  },
}]
```

## Complete Example

```typescript
import { defineConfig } from '@zephyr-ci/config';

export default defineConfig({
  project: {
    name: 'my-app',
    env: {
      NODE_ENV: 'ci',
    },
  },

  pipelines: (ctx) => [
    {
      name: 'ci',
      triggers: [
        { type: 'push', branches: ['main', 'develop'] },
        { type: 'pull_request' },
      ],
      jobs: [
        {
          name: 'lint',
          runner: { image: 'ubuntu-22.04' },
          steps: [
            { type: 'setup', runtime: 'node', version: '20' },
            { type: 'run', name: 'Install', run: 'npm ci' },
            { type: 'run', name: 'Lint', run: 'npm run lint' },
          ],
        },
        {
          name: 'test',
          runner: { image: 'ubuntu-22.04', cpu: 2, memory: 4096 },
          matrix: {
            node: ['18', '20', '22'],
          },
          steps: [
            { type: 'setup', runtime: 'node', version: '${{ matrix.node }}' },
            { type: 'run', name: 'Install', run: 'npm ci' },
            { type: 'run', name: 'Test', run: 'npm test' },
          ],
        },
        {
          name: 'build',
          dependsOn: ['lint', 'test'],
          runner: { image: 'ubuntu-22.04' },
          steps: [
            { type: 'setup', runtime: 'node', version: '20' },
            { type: 'run', name: 'Install', run: 'npm ci' },
            { type: 'run', name: 'Build', run: 'npm run build' },
          ],
        },
        {
          name: 'deploy',
          dependsOn: ['build'],
          condition: (ctx) => ctx.branch === 'main' && !ctx.isPullRequest,
          runner: { image: 'ubuntu-22.04' },
          steps: [
            { type: 'run', name: 'Deploy', run: './scripts/deploy.sh' },
          ],
        },
      ],
    },
  ],
});
```
