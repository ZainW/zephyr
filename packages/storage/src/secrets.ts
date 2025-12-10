/**
 * Secrets Manager
 *
 * Provides encrypted storage for sensitive values like API keys, tokens, etc.
 * Secrets are encrypted at rest using AES-256-GCM.
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export interface SecretsManagerOptions {
  /** Directory for secrets storage */
  secretsDir: string;
  /** SQLite database for metadata */
  db?: Database;
  /** Master password for encryption (required) */
  masterPassword: string;
}

export interface SecretMetadata {
  name: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  description?: string;
}

export interface SecretValue {
  name: string;
  value: string;
}

const SECRETS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS secrets (
    name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    encrypted_value BLOB NOT NULL,
    iv BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (name, project_id)
  );

  CREATE INDEX IF NOT EXISTS idx_secrets_project ON secrets(project_id);
`;

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

export class SecretsManager {
  private secretsDir: string;
  private db: Database;
  private encryptionKey: Buffer;
  private ownsDb: boolean;

  constructor(options: SecretsManagerOptions) {
    this.secretsDir = options.secretsDir;

    // Derive encryption key from master password
    const salt = this.getSalt();
    this.encryptionKey = scryptSync(options.masterPassword, salt, KEY_LENGTH);

    if (options.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else {
      this.db = new Database(join(this.secretsDir, "secrets.db"), { create: true });
      this.ownsDb = true;
    }

    this.db.exec(SECRETS_SCHEMA);
  }

  /**
   * Set a secret value
   */
  set(projectId: string, name: string, value: string, description?: string): void {
    const { encrypted, iv, authTag } = this.encrypt(value);
    const now = Date.now();

    // Check if secret exists
    const existing = this.db
      .prepare("SELECT 1 FROM secrets WHERE name = ? AND project_id = ?")
      .get(name, projectId);

    if (existing) {
      this.db
        .prepare(
          `
        UPDATE secrets
        SET encrypted_value = ?, iv = ?, auth_tag = ?, description = ?, updated_at = ?
        WHERE name = ? AND project_id = ?
      `
        )
        .run(encrypted, iv, authTag, description ?? null, now, name, projectId);
    } else {
      this.db
        .prepare(
          `
        INSERT INTO secrets
        (name, project_id, encrypted_value, iv, auth_tag, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(name, projectId, encrypted, iv, authTag, description ?? null, now, now);
    }
  }

  /**
   * Get a secret value
   */
  get(projectId: string, name: string): string | null {
    const row = this.db
      .prepare("SELECT encrypted_value, iv, auth_tag FROM secrets WHERE name = ? AND project_id = ?")
      .get(name, projectId) as { encrypted_value: Buffer; iv: Buffer; auth_tag: Buffer } | null;

    if (!row) {
      return null;
    }

    return this.decrypt(row.encrypted_value, row.iv, row.auth_tag);
  }

  /**
   * Get multiple secrets for a project
   */
  getMany(projectId: string, names: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    for (const name of names) {
      const value = this.get(projectId, name);
      if (value !== null) {
        result[name] = value;
      }
    }

    return result;
  }

  /**
   * Get all secrets for a project (for injection into jobs)
   */
  getAllForProject(projectId: string): SecretValue[] {
    const rows = this.db
      .prepare("SELECT name, encrypted_value, iv, auth_tag FROM secrets WHERE project_id = ?")
      .all(projectId) as { name: string; encrypted_value: Buffer; iv: Buffer; auth_tag: Buffer }[];

    return rows.map((row) => ({
      name: row.name,
      value: this.decrypt(row.encrypted_value, row.iv, row.auth_tag),
    }));
  }

  /**
   * Delete a secret
   */
  delete(projectId: string, name: string): boolean {
    const result = this.db.prepare("DELETE FROM secrets WHERE name = ? AND project_id = ?").run(name, projectId);
    return result.changes > 0;
  }

  /**
   * List secret names for a project (without values)
   */
  list(projectId: string): SecretMetadata[] {
    const rows = this.db
      .prepare("SELECT name, project_id, description, created_at, updated_at FROM secrets WHERE project_id = ?")
      .all(projectId) as {
      name: string;
      project_id: string;
      description: string | null;
      created_at: number;
      updated_at: number;
    }[];

    return rows.map((row) => ({
      name: row.name,
      projectId: row.project_id,
      description: row.description ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Check if a secret exists
   */
  has(projectId: string, name: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM secrets WHERE name = ? AND project_id = ?")
      .get(name, projectId);
    return row !== null;
  }

  /**
   * Close the manager
   */
  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  private encrypt(plaintext: string): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    return {
      encrypted,
      iv,
      authTag: cipher.getAuthTag(),
    };
  }

  private decrypt(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final("utf8");
  }

  private getSalt(): Buffer {
    // Use a file-based salt that's created once
    const saltPath = join(this.secretsDir, ".salt");
    const saltFile = Bun.file(saltPath);

    // Check synchronously if file exists (using a workaround)
    try {
      const existing = require("fs").readFileSync(saltPath);
      return Buffer.from(existing);
    } catch {
      // Salt doesn't exist, create it
      const salt = randomBytes(32);
      require("fs").mkdirSync(this.secretsDir, { recursive: true });
      require("fs").writeFileSync(saltPath, salt);
      return salt;
    }
  }
}

/**
 * Mask secret values in log output
 */
export function maskSecrets(text: string, secrets: SecretValue[]): string {
  let masked = text;

  for (const secret of secrets) {
    if (secret.value.length > 3) {
      // Only mask secrets longer than 3 chars to avoid false positives
      masked = masked.replaceAll(secret.value, "***");
    }
  }

  return masked;
}

/**
 * Create environment variables from secrets
 */
export function secretsToEnv(
  secrets: SecretValue[],
  mapping: Array<{ from: string; as: string }>
): Record<string, string> {
  const env: Record<string, string> = {};
  const secretMap = new Map(secrets.map((s) => [s.name, s.value]));

  for (const { from, as } of mapping) {
    const value = secretMap.get(from);
    if (value !== undefined) {
      env[as] = value;
    }
  }

  return env;
}
