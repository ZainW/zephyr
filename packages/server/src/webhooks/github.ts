/**
 * GitHub Webhook Handler
 *
 * Handles incoming webhooks from GitHub and triggers pipeline runs.
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * GitHub webhook event types we handle
 */
export type GitHubEventType =
  | "push"
  | "pull_request"
  | "create"
  | "delete"
  | "workflow_dispatch";

/**
 * Parsed GitHub webhook payload
 */
export interface GitHubWebhookPayload {
  eventType: GitHubEventType;
  action?: string;
  repository: {
    id: number;
    name: string;
    fullName: string;
    cloneUrl: string;
    sshUrl: string;
    defaultBranch: string;
    private: boolean;
  };
  sender: {
    id: number;
    login: string;
    avatarUrl: string;
  };
  // Push event fields
  ref?: string;
  before?: string;
  after?: string;
  commits?: Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  headCommit?: {
    id: string;
    message: string;
    author: { name: string; email: string };
  };
  // Pull request fields
  pullRequest?: {
    id: number;
    number: number;
    title: string;
    state: string;
    draft: boolean;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    user: {
      id: number;
      login: string;
    };
  };
  // Create/delete event fields
  refType?: "branch" | "tag";
}

/**
 * Verify GitHub webhook signature
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  // GitHub sends signature as "sha256=<signature>"
  const [algorithm, providedSignature] = signature.split("=");
  if (algorithm !== "sha256" || !providedSignature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(providedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Parse GitHub webhook payload
 */
export function parseGitHubWebhook(
  eventType: string,
  payload: unknown
): GitHubWebhookPayload | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = payload as any;

  if (!data?.repository) {
    return null;
  }

  const base: GitHubWebhookPayload = {
    eventType: eventType as GitHubEventType,
    action: data.action,
    repository: {
      id: data.repository.id,
      name: data.repository.name,
      fullName: data.repository.full_name,
      cloneUrl: data.repository.clone_url,
      sshUrl: data.repository.ssh_url,
      defaultBranch: data.repository.default_branch,
      private: data.repository.private,
    },
    sender: {
      id: data.sender?.id,
      login: data.sender?.login,
      avatarUrl: data.sender?.avatar_url,
    },
  };

  // Add event-specific fields
  switch (eventType) {
    case "push":
      base.ref = data.ref;
      base.before = data.before;
      base.after = data.after;
      base.commits = data.commits?.map((c: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commit = c as any;
        return {
          id: commit.id,
          message: commit.message,
          author: commit.author,
          added: commit.added ?? [],
          modified: commit.modified ?? [],
          removed: commit.removed ?? [],
        };
      });
      base.headCommit = data.head_commit
        ? {
            id: data.head_commit.id,
            message: data.head_commit.message,
            author: data.head_commit.author,
          }
        : undefined;
      break;

    case "pull_request":
      if (data.pull_request) {
        base.pullRequest = {
          id: data.pull_request.id,
          number: data.pull_request.number,
          title: data.pull_request.title,
          state: data.pull_request.state,
          draft: data.pull_request.draft,
          head: {
            ref: data.pull_request.head.ref,
            sha: data.pull_request.head.sha,
          },
          base: {
            ref: data.pull_request.base.ref,
            sha: data.pull_request.base.sha,
          },
          user: {
            id: data.pull_request.user.id,
            login: data.pull_request.user.login,
          },
        };
      }
      break;

    case "create":
    case "delete":
      base.ref = data.ref;
      base.refType = data.ref_type;
      break;
  }

  return base;
}

/**
 * Extract branch name from a ref (e.g., "refs/heads/main" -> "main")
 */
export function extractBranchFromRef(ref: string): string | null {
  if (ref.startsWith("refs/heads/")) {
    return ref.slice("refs/heads/".length);
  }
  return null;
}

/**
 * Extract tag name from a ref (e.g., "refs/tags/v1.0.0" -> "v1.0.0")
 */
export function extractTagFromRef(ref: string): string | null {
  if (ref.startsWith("refs/tags/")) {
    return ref.slice("refs/tags/".length);
  }
  return null;
}

/**
 * Get changed files from a push event
 */
export function getChangedFiles(payload: GitHubWebhookPayload): string[] {
  if (!payload.commits) {
    return [];
  }

  const files = new Set<string>();
  for (const commit of payload.commits) {
    for (const file of commit.added) files.add(file);
    for (const file of commit.modified) files.add(file);
    for (const file of commit.removed) files.add(file);
  }

  return Array.from(files);
}

/**
 * Determine if a webhook event should trigger a pipeline
 */
export function shouldTriggerPipeline(
  payload: GitHubWebhookPayload,
  triggers: Array<{
    type: string;
    branches?: string[];
    branchesIgnore?: string[];
    paths?: string[];
    pathsIgnore?: string[];
    prEvents?: string[];
  }>
): boolean {
  for (const trigger of triggers) {
    if (matchesTrigger(payload, trigger)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a payload matches a specific trigger
 */
function matchesTrigger(
  payload: GitHubWebhookPayload,
  trigger: {
    type: string;
    branches?: string[];
    branchesIgnore?: string[];
    paths?: string[];
    pathsIgnore?: string[];
    prEvents?: string[];
  }
): boolean {
  // Check event type
  if (trigger.type === "push" && payload.eventType !== "push") {
    return false;
  }
  if (trigger.type === "pull_request" && payload.eventType !== "pull_request") {
    return false;
  }
  if (trigger.type === "tag" && payload.eventType !== "create") {
    return false;
  }

  // For push events, check branch patterns
  if (payload.eventType === "push" && payload.ref) {
    const branch = extractBranchFromRef(payload.ref);
    if (branch) {
      // Check branchesIgnore first
      if (trigger.branchesIgnore?.some((pattern) => matchesGlob(branch, pattern))) {
        return false;
      }
      // Check branches whitelist
      if (trigger.branches && !trigger.branches.some((pattern) => matchesGlob(branch, pattern))) {
        return false;
      }
    }

    // Check path patterns
    if (trigger.paths || trigger.pathsIgnore) {
      const changedFiles = getChangedFiles(payload);

      if (trigger.pathsIgnore?.some((pattern) =>
        changedFiles.some((file) => matchesGlob(file, pattern))
      )) {
        return false;
      }

      if (trigger.paths && !trigger.paths.some((pattern) =>
        changedFiles.some((file) => matchesGlob(file, pattern))
      )) {
        return false;
      }
    }
  }

  // For pull request events, check action
  if (payload.eventType === "pull_request" && payload.action) {
    const prEvents = trigger.prEvents ?? ["opened", "synchronize", "reopened"];
    if (!prEvents.includes(payload.action)) {
      return false;
    }
  }

  // For tag events, check if it's a tag creation
  if (trigger.type === "tag") {
    if (payload.eventType !== "create" || payload.refType !== "tag") {
      return false;
    }
  }

  return true;
}

/**
 * Simple glob pattern matching
 */
function matchesGlob(text: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$"
  );
  return regex.test(text);
}
