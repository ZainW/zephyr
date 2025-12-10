/**
 * Cache Manager
 *
 * Provides key-based caching for build dependencies and artifacts.
 * Cache entries are stored on disk with metadata for efficient retrieval.
 */

import { Database } from "bun:sqlite";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

export interface CacheManagerOptions {
  /** Directory to store cache files */
  cacheDir: string;
  /** SQLite database for metadata */
  db?: Database;
  /** Maximum cache size in bytes (default: 10GB) */
  maxSize?: number;
  /** Default TTL in seconds (default: 7 days) */
  defaultTtl?: number;
}

export interface CacheEntry {
  key: string;
  hash: string;
  size: number;
  paths: string[];
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  hits: number;
}

export interface CacheResult {
  hit: boolean;
  key: string;
  path?: string;
}

export interface SaveCacheOptions {
  /** Cache key */
  key: string;
  /** Paths to cache (relative to working directory) */
  paths: string[];
  /** Working directory */
  workdir: string;
  /** TTL in seconds */
  ttl?: number;
}

export interface RestoreCacheOptions {
  /** Primary cache key */
  key: string;
  /** Fallback keys to try */
  restoreKeys?: string[];
  /** Working directory to restore to */
  workdir: string;
}

const CACHE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS cache_entries (
    key TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    paths TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    hits INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at);
  CREATE INDEX IF NOT EXISTS idx_cache_accessed ON cache_entries(last_accessed_at);
`;

export class CacheManager {
  private cacheDir: string;
  private db: Database;
  private maxSize: number;
  private defaultTtl: number;
  private ownsDb: boolean;

  constructor(options: CacheManagerOptions) {
    this.cacheDir = options.cacheDir;
    this.maxSize = options.maxSize ?? 10 * 1024 * 1024 * 1024; // 10GB
    this.defaultTtl = options.defaultTtl ?? 7 * 24 * 60 * 60; // 7 days

    if (options.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else {
      this.db = new Database(join(this.cacheDir, "cache.db"), { create: true });
      this.ownsDb = true;
    }

    this.db.exec(CACHE_SCHEMA);
  }

  /**
   * Save paths to cache
   */
  async save(options: SaveCacheOptions): Promise<string> {
    const { key, paths, workdir, ttl = this.defaultTtl } = options;

    // Create archive of the paths
    const hash = this.generateHash(key, paths);
    const archivePath = this.getArchivePath(hash);

    // Ensure cache directory exists
    await Bun.$`mkdir -p ${dirname(archivePath)}`.quiet();

    // Create tar archive
    const pathArgs = paths.join(" ");
    await Bun.$`tar -czf ${archivePath} -C ${workdir} ${pathArgs}`.quiet();

    // Get archive size
    const stat = await Bun.file(archivePath).stat();
    const size = stat?.size ?? 0;

    // Save metadata
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO cache_entries
      (key, hash, size, paths, created_at, last_accessed_at, expires_at, hits)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `
      )
      .run(key, hash, size, JSON.stringify(paths), now, now, now + ttl * 1000);

    // Cleanup if needed
    await this.enforceMaxSize();

    return hash;
  }

  /**
   * Restore cache to working directory
   */
  async restore(options: RestoreCacheOptions): Promise<CacheResult> {
    const { key, restoreKeys = [], workdir } = options;

    // Try primary key first
    const entry = this.findEntry(key);
    if (entry) {
      const restored = await this.restoreEntry(entry, workdir);
      if (restored) {
        return { hit: true, key: entry.key, path: this.getArchivePath(entry.hash) };
      }
    }

    // Try restore keys (prefix matching)
    for (const restoreKey of restoreKeys) {
      const prefixEntry = this.findEntryByPrefix(restoreKey);
      if (prefixEntry) {
        const restored = await this.restoreEntry(prefixEntry, workdir);
        if (restored) {
          return { hit: true, key: prefixEntry.key, path: this.getArchivePath(prefixEntry.hash) };
        }
      }
    }

    return { hit: false, key };
  }

  /**
   * Check if a cache key exists
   */
  has(key: string): boolean {
    const entry = this.findEntry(key);
    return entry !== null && !this.isExpired(entry);
  }

  /**
   * Delete a cache entry
   */
  async delete(key: string): Promise<boolean> {
    const entry = this.findEntry(key);
    if (!entry) {
      return false;
    }

    const archivePath = this.getArchivePath(entry.hash);
    try {
      await Bun.$`rm -f ${archivePath}`.quiet();
    } catch {
      // Ignore errors
    }

    this.db.prepare("DELETE FROM cache_entries WHERE key = ?").run(key);
    return true;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    entries: number;
    totalSize: number;
    maxSize: number;
    hitRate: number;
  } {
    const result = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(size), 0) as total_size,
        COALESCE(SUM(hits), 0) as total_hits
      FROM cache_entries
      WHERE expires_at > ?
    `
      )
      .get(Date.now()) as { count: number; total_size: number; total_hits: number };

    return {
      entries: result.count,
      totalSize: result.total_size,
      maxSize: this.maxSize,
      hitRate: result.count > 0 ? result.total_hits / result.count : 0,
    };
  }

  /**
   * Clean up expired entries
   */
  async cleanup(): Promise<number> {
    const now = Date.now();

    // Get expired entries
    const expired = this.db
      .prepare("SELECT hash FROM cache_entries WHERE expires_at <= ?")
      .all(now) as { hash: string }[];

    // Delete archive files
    for (const entry of expired) {
      const archivePath = this.getArchivePath(entry.hash);
      try {
        await Bun.$`rm -f ${archivePath}`.quiet();
      } catch {
        // Ignore errors
      }
    }

    // Delete from database
    this.db.prepare("DELETE FROM cache_entries WHERE expires_at <= ?").run(now);

    return expired.length;
  }

  /**
   * Close the cache manager
   */
  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  private findEntry(key: string): CacheEntry | null {
    const row = this.db.prepare("SELECT * FROM cache_entries WHERE key = ?").get(key) as
      | (Omit<CacheEntry, "paths"> & { paths: string })
      | null;

    if (!row) {
      return null;
    }

    return {
      ...row,
      paths: JSON.parse(row.paths),
      createdAt: row.createdAt,
      lastAccessedAt: row.lastAccessedAt,
      expiresAt: row.expiresAt,
    };
  }

  private findEntryByPrefix(prefix: string): CacheEntry | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM cache_entries
      WHERE key LIKE ?
      AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `
      )
      .get(`${prefix}%`, Date.now()) as (Omit<CacheEntry, "paths"> & { paths: string }) | null;

    if (!row) {
      return null;
    }

    return {
      ...row,
      paths: JSON.parse(row.paths),
      createdAt: row.createdAt,
      lastAccessedAt: row.lastAccessedAt,
      expiresAt: row.expiresAt,
    };
  }

  private async restoreEntry(entry: CacheEntry, workdir: string): Promise<boolean> {
    if (this.isExpired(entry)) {
      return false;
    }

    const archivePath = this.getArchivePath(entry.hash);

    // Check if archive exists
    if (!(await Bun.file(archivePath).exists())) {
      // Archive missing, remove entry
      this.db.prepare("DELETE FROM cache_entries WHERE key = ?").run(entry.key);
      return false;
    }

    // Extract archive
    try {
      await Bun.$`tar -xzf ${archivePath} -C ${workdir}`.quiet();
    } catch {
      return false;
    }

    // Update access time and hit count
    this.db
      .prepare(
        `
      UPDATE cache_entries
      SET last_accessed_at = ?, hits = hits + 1
      WHERE key = ?
    `
      )
      .run(Date.now(), entry.key);

    return true;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  private generateHash(key: string, paths: string[]): string {
    const content = `${key}:${paths.sort().join(",")}:${Date.now()}`;
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private getArchivePath(hash: string): string {
    // Use first 2 chars as subdirectory for better filesystem distribution
    const subdir = hash.slice(0, 2);
    return join(this.cacheDir, "archives", subdir, `${hash}.tar.gz`);
  }

  private async enforceMaxSize(): Promise<void> {
    const stats = this.getStats();

    if (stats.totalSize <= this.maxSize) {
      return;
    }

    // Delete oldest entries until under limit
    const toDelete = this.db
      .prepare(
        `
      SELECT key, hash, size FROM cache_entries
      ORDER BY last_accessed_at ASC
    `
      )
      .all() as { key: string; hash: string; size: number }[];

    let currentSize = stats.totalSize;
    for (const entry of toDelete) {
      if (currentSize <= this.maxSize * 0.9) {
        // Keep 10% buffer
        break;
      }

      const archivePath = this.getArchivePath(entry.hash);
      try {
        await Bun.$`rm -f ${archivePath}`.quiet();
      } catch {
        // Ignore errors
      }

      this.db.prepare("DELETE FROM cache_entries WHERE key = ?").run(entry.key);
      currentSize -= entry.size;
    }
  }
}

/**
 * Interpolate cache key with context variables
 */
export function interpolateCacheKey(
  key: string,
  context: {
    sha?: string;
    branch?: string;
    runner?: string;
    os?: string;
    [key: string]: string | undefined;
  }
): string {
  return key.replace(/\$\{(\w+)\}/g, (_, name) => context[name] ?? "");
}
