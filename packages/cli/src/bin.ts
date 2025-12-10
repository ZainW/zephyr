#!/usr/bin/env bun
/**
 * Zephyr CI - CLI Entry Point
 */

import { init } from "./commands/init.ts";
import { run } from "./commands/run.ts";
import { server } from "./commands/server.ts";
import { trigger } from "./commands/trigger.ts";
import { ui } from "./commands/ui.ts";

const VERSION = "0.1.0";

const HELP = `
\x1b[36mZephyr CI\x1b[0m - A fast CI runner powered by Bun

\x1b[1mUsage:\x1b[0m
  zephyr <command> [options]

\x1b[1mCommands:\x1b[0m
  init              Initialize a new zephyr.config.ts
  run [pipeline]    Run a pipeline locally
  server            Start the CI server
  trigger           Trigger a pipeline run via API
  ui                Start the web UI dashboard

\x1b[1mGlobal Options:\x1b[0m
  -h, --help        Show this help message
  -v, --version     Show version number
  --debug           Enable debug logging

\x1b[1mRun Options:\x1b[0m
  --config <path>   Path to config file
  --job <name>      Run a specific job only

\x1b[1mServer Options:\x1b[0m
  --port <number>   Port to listen on (default: 3000)
  --host <string>   Host to bind to (default: 0.0.0.0)
  --db <path>       Path to SQLite database (default: ./zephyr.db)
  --github-secret   GitHub webhook secret
  --api-key         API key for authentication
  --max-jobs        Maximum concurrent jobs (default: 4)

\x1b[1mTrigger Options:\x1b[0m
  --server <url>    Server URL (default: http://localhost:3000)
  --api-key         API key for authentication
  --project <id>    Project ID (required)
  --pipeline <name> Pipeline name (required)
  --branch <name>   Branch name
  --wait            Wait for pipeline completion

\x1b[1mUI Options:\x1b[0m
  --port <number>   Port to listen on (default: 8080)
  --api-url <url>   API server URL (default: http://localhost:3000)
  --api-key         API key for authentication

\x1b[1mExamples:\x1b[0m
  zephyr init                           # Create a new config file
  zephyr run                            # Run the default pipeline
  zephyr run ci --job test              # Run only the 'test' job
  zephyr server --port 8080             # Start server on port 8080
  zephyr trigger --project abc --pipeline ci  # Trigger pipeline
  zephyr ui                             # Start the web dashboard
`;

function parseArgs(args: string[]): {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i]!;

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];

      // Check if next arg is a value or another flag
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      flags[key] = true;
      i += 1;
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return {
    command: positional[0],
    positional: positional.slice(1),
    flags,
  };
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(Bun.argv.slice(2));

  // Handle global flags
  if (flags.h || flags.help) {
    console.log(HELP);
    return;
  }

  if (flags.v || flags.version) {
    console.log(`zephyr v${VERSION}`);
    return;
  }

  // Route to command
  switch (command) {
    case "init": {
      await init({
        force: flags.force === true,
      });
      break;
    }

    case "run": {
      await run({
        pipeline: positional[0],
        job: typeof flags.job === "string" ? flags.job : undefined,
        config: typeof flags.config === "string" ? flags.config : undefined,
        logLevel: flags.debug ? "debug" : "info",
      });
      break;
    }

    case "server": {
      await server({
        port: typeof flags.port === "string" ? parseInt(flags.port) : undefined,
        host: typeof flags.host === "string" ? flags.host : undefined,
        db: typeof flags.db === "string" ? flags.db : undefined,
        githubSecret: typeof flags["github-secret"] === "string" ? flags["github-secret"] : undefined,
        apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
        maxJobs: typeof flags["max-jobs"] === "string" ? parseInt(flags["max-jobs"]) : undefined,
      });
      break;
    }

    case "trigger": {
      const project = typeof flags.project === "string" ? flags.project : undefined;
      const pipeline = typeof flags.pipeline === "string" ? flags.pipeline : positional[0];

      if (!project) {
        console.error("\x1b[31mError:\x1b[0m --project is required");
        process.exit(1);
      }
      if (!pipeline) {
        console.error("\x1b[31mError:\x1b[0m --pipeline is required");
        process.exit(1);
      }

      await trigger({
        server: typeof flags.server === "string" ? flags.server : undefined,
        apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
        project,
        pipeline,
        branch: typeof flags.branch === "string" ? flags.branch : undefined,
        sha: typeof flags.sha === "string" ? flags.sha : undefined,
        wait: flags.wait === true,
      });
      break;
    }

    case "ui": {
      await ui({
        port: typeof flags.port === "string" ? parseInt(flags.port) : undefined,
        apiUrl: typeof flags["api-url"] === "string" ? flags["api-url"] : undefined,
        apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
      });
      break;
    }

    case undefined: {
      console.log(HELP);
      break;
    }

    default: {
      console.error(`\x1b[31mError:\x1b[0m Unknown command '${command}'`);
      console.log("Run 'zephyr --help' for usage information.");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("\x1b[31mError:\x1b[0m", err.message);
  if (Bun.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
