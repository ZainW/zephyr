#!/usr/bin/env bun
/**
 * Zephyr CI - CLI Entry Point
 */

import { init } from "./commands/init.ts";
import { run } from "./commands/run.ts";

const VERSION = "0.1.0";

const HELP = `
\x1b[36mZephyr CI\x1b[0m - A fast CI runner powered by Bun

\x1b[1mUsage:\x1b[0m
  zephyr <command> [options]

\x1b[1mCommands:\x1b[0m
  init              Initialize a new zephyr.config.ts
  run [pipeline]    Run a pipeline locally

\x1b[1mOptions:\x1b[0m
  -h, --help        Show this help message
  -v, --version     Show version number
  --config <path>   Path to config file
  --job <name>      Run a specific job only
  --debug           Enable debug logging

\x1b[1mExamples:\x1b[0m
  zephyr init                    # Create a new config file
  zephyr run                     # Run the default pipeline
  zephyr run ci                  # Run the 'ci' pipeline
  zephyr run ci --job test       # Run only the 'test' job
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
