# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Zephyr CI is a TypeScript-first CI runner built on Bun that uses Firecracker microVMs for secure, isolated job execution. It provides a standalone CI system with its own workflow format (not GitHub Actions compatible).

## Build & Test Commands

```bash
bun test                              # Run all tests across workspaces
bun test <file>                       # Run a single test file
bun test -t "test name"               # Run tests matching a pattern
bun run typecheck                     # Type check all packages
bun run build                         # Build CLI to dist/
bun run zephyr                        # Run CLI locally (development)
bun run zephyr run                    # Run pipeline locally (shell execution)
bun run zephyr server                 # Start API server (port 3000)
bun run zephyr ui                     # Start web UI (port 8080)
```

## Architecture

Monorepo with Bun workspaces containing 8 packages under `packages/*` plus the VM `agent/`:

- **@zephyrr-ci/types** - TypeScript type definitions for config schema
- **@zephyrr-ci/config** - Config helpers (`defineConfig`)
- **@zephyrr-ci/core** - Config loader, job executor, scheduler (DAG), matrix expansion, logger
- **@zephyrr-ci/storage** - SQLite database, caching, secrets, artifacts
- **@zephyrr-ci/server** - HTTP API, GitHub webhooks, WebSocket log streaming, Prometheus metrics
- **@zephyrr-ci/cli** - Command-line interface (init, run, server, ui, trigger)
- **@zephyrr-ci/vm** - Firecracker VM management, warm pool, network (TAP/bridge)
- **@zephyrr-ci/web** - Web dashboard UI (HTML rendering, no framework)
- **agent/** - Runs inside VMs, communicates via vsock

### Key Data Flow

1. Webhook/API → Server (`packages/server/src/server.ts`)
2. Server → JobScheduler (`packages/server/src/scheduler/index.ts`)
3. Scheduler → VmExecutor (`packages/vm/src/executor.ts`) or local Runner (`packages/core/src/executor/runner.ts`)
4. VmManager creates Firecracker VMs (`packages/vm/src/firecracker/manager.ts`)
5. Agent inside VM executes steps, communicates via vsock
6. Results stored in SQLite (`packages/storage/src/db.ts`)

## Code Style

- **Imports**: Always use `.ts` extension (e.g., `from "./loader.ts"`). Group: external → workspace (`@zephyrr-ci/*`) → relative
- **Types**: Import types with `type` keyword (e.g., `import type { ZephyrConfig } from "@zephyrr-ci/types"`)
- **Exports**: Re-export from package `index.ts` with explicit named exports and type exports
- **Naming**: camelCase for functions/variables, PascalCase for types/interfaces, SCREAMING_SNAKE_CASE for constants
- **Error Handling**: Use try-catch for async, return result objects `{ success: boolean, error?: string }` for functions
- **Strict Mode**: All tsconfig strict flags enabled (`noUncheckedIndexedAccess`, `noImplicitOverride`, etc.)

## Configuration Schema

User configs are TypeScript files (`zephyr.config.ts`) using `defineConfig()`. Main types in `packages/types/src/config.ts`:

- `ZephyrConfig` - Root config with project metadata and pipelines
- `PipelineDefinition` - Pipeline with triggers and jobs
- `JobDefinition` - Job with runner config, steps, matrix, artifacts
- `StepDefinition` - Run steps (shell commands) or Setup steps (runtime installation)
- `ConfigContext` - Runtime context (branch, sha, event, repo info)

## Server Deployment Requirements

- Linux with KVM support (`/dev/kvm`)
- Bare metal or nested virtualization VPS
- Firecracker binary installed
- 4+ CPU cores, 8GB+ RAM recommended
