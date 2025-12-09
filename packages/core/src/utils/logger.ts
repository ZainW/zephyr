/**
 * Simple logger for Zephyr CI
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  group(label: string): void;
  groupEnd(): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export function createLogger(options: { level?: LogLevel; prefix?: string } = {}): Logger {
  const minLevel = options.level ?? "info";
  const prefix = options.prefix ?? "zephyr";
  let indentLevel = 0;

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
  }

  function formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString().slice(11, 23);
    const color = LEVEL_COLORS[level];
    const indent = "  ".repeat(indentLevel);
    return `${DIM}${timestamp}${RESET} ${color}${BOLD}${prefix}${RESET} ${indent}${message}`;
  }

  return {
    debug(message: string, ...args: unknown[]) {
      if (shouldLog("debug")) {
        console.log(formatMessage("debug", message), ...args);
      }
    },

    info(message: string, ...args: unknown[]) {
      if (shouldLog("info")) {
        console.log(formatMessage("info", message), ...args);
      }
    },

    warn(message: string, ...args: unknown[]) {
      if (shouldLog("warn")) {
        console.warn(formatMessage("warn", message), ...args);
      }
    },

    error(message: string, ...args: unknown[]) {
      if (shouldLog("error")) {
        console.error(formatMessage("error", message), ...args);
      }
    },

    group(label: string) {
      if (shouldLog("info")) {
        console.log(formatMessage("info", `${BOLD}${label}${RESET}`));
        indentLevel++;
      }
    },

    groupEnd() {
      if (indentLevel > 0) {
        indentLevel--;
      }
    },
  };
}

// Default logger instance
export const logger = createLogger();
