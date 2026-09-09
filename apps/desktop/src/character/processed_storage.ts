/**
 * PixelPal — Processed Image Temporary Storage & Lifecycle Management
 * Sprint 6 Phase 2 Foundation
 *
 * Implements safe, isolated application-owned temporary storage for intermediate
 * processed character image assets. Enforces unique storage IDs, path traversal
 * protection, owner-restricted permissions, and automated cleanup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type { ProcessedStorageAdapter, ProcessedStorageRecord } from "./types.ts";

/**
 * Generates a collision-resistant unique ID for processed assets.
 * Example: 'processed_char_1725888000000_a1b2c3d4e5f67890'
 */
export function generateProcessedStorageId(): string {
  const timestamp = Date.now();
  let randomHex: string;

  if (typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    randomHex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } else {
    randomHex = crypto.randomBytes(8).toString("hex");
  }

  return `processed_char_${timestamp}_${randomHex}`;
}

/**
 * Validates that a processed storage ID matches the strict safe format.
 */
export function isValidProcessedStorageId(id: string): boolean {
  return typeof id === "string" && /^processed_char_\d+_[a-f0-9]{8,32}$/.test(id);
}

/**
 * Production FileSystem Processed Storage Adapter.
 * Manages an isolated folder (<tempDir>/pixelpal_processed) with owner-only access.
 */
export class FileSystemProcessedStorageAdapter implements ProcessedStorageAdapter {
  private readonly baseDir: string;
  private readonly metadataRegistry: Map<string, ProcessedStorageRecord> = new Map();

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = path.resolve(customBaseDir);
    } else {
      this.baseDir = path.resolve(os.tmpdir(), "pixelpal_processed");
    }

    this.ensureBaseDirectory();
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  private ensureBaseDirectory(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
  }

  private resolveSecurePath(processedStorageId: string): string {
    if (!isValidProcessedStorageId(processedStorageId)) {
      throw new Error(`Invalid processed storage ID format: '${processedStorageId}'`);
    }

    const fileName = `${processedStorageId}.png`;
    const resolvedPath = path.resolve(this.baseDir, fileName);

    // Path Traversal Defense: Must reside strictly inside baseDir
    const relative = path.relative(this.baseDir, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path traversal attempt detected for storage ID: ${processedStorageId}`);
    }

    return resolvedPath;
  }

  public async save(processedStorageId: string, data: Uint8Array): Promise<string> {
    this.ensureBaseDirectory();
    const filePath = this.resolveSecurePath(processedStorageId);

    // Write file with owner-restricted permissions (mode 0o600)
    await fs.promises.writeFile(filePath, data, { mode: 0o600 });

    const record: ProcessedStorageRecord = {
      processedStorageId,
      processedFilePath: filePath,
      sizeBytes: data.length,
      createdAt: Date.now(),
    };

    this.metadataRegistry.set(processedStorageId, record);
    return filePath;
  }

  public async get(
    processedStorageId: string
  ): Promise<{ record: ProcessedStorageRecord; data: Uint8Array } | null> {
    const record = this.metadataRegistry.get(processedStorageId);
    if (!record) {
      return null;
    }

    if (!fs.existsSync(record.processedFilePath)) {
      this.metadataRegistry.delete(processedStorageId);
      return null;
    }

    const buffer = await fs.promises.readFile(record.processedFilePath);
    return {
      record,
      data: new Uint8Array(buffer),
    };
  }

  public async delete(processedStorageId: string): Promise<boolean> {
    const record = this.metadataRegistry.get(processedStorageId);
    let deleted = false;

    if (record && fs.existsSync(record.processedFilePath)) {
      try {
        await fs.promises.unlink(record.processedFilePath);
        deleted = true;
      } catch {
        // Ignore file removal errors if already gone
      }
    }

    this.metadataRegistry.delete(processedStorageId);
    return deleted;
  }

  public async cleanupExpired(maxAgeMs: number): Promise<number> {
    const now = Date.now();
    const expiryCutoff = now - maxAgeMs;
    let purgedCount = 0;

    for (const [id, record] of Array.from(this.metadataRegistry.entries())) {
      if (record.createdAt <= expiryCutoff) {
        if (await this.delete(id)) {
          purgedCount++;
        }
      }
    }

    try {
      if (fs.existsSync(this.baseDir)) {
        const files = await fs.promises.readdir(this.baseDir);
        for (const file of files) {
          if (!file.startsWith("processed_char_")) {
            continue;
          }
          const fullPath = path.join(this.baseDir, file);
          try {
            const stats = await fs.promises.stat(fullPath);
            if (stats.isFile() && stats.mtimeMs <= expiryCutoff) {
              await fs.promises.unlink(fullPath);
              purgedCount++;
            }
          } catch {
            // Ignore transient lock errors
          }
        }
      }
    } catch {
      // Ignore scan failures
    }

    return purgedCount;
  }

  public async cleanupAll(): Promise<number> {
    let purgedCount = 0;

    for (const id of Array.from(this.metadataRegistry.keys())) {
      if (await this.delete(id)) {
        purgedCount++;
      }
    }

    try {
      if (fs.existsSync(this.baseDir)) {
        const files = await fs.promises.readdir(this.baseDir);
        for (const file of files) {
          if (!file.startsWith("processed_char_")) {
            continue;
          }
          const fullPath = path.join(this.baseDir, file);
          try {
            await fs.promises.unlink(fullPath);
            purgedCount++;
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }

    this.metadataRegistry.clear();
    return purgedCount;
  }

  public async list(): Promise<readonly ProcessedStorageRecord[]> {
    return Array.from(this.metadataRegistry.values());
  }
}

/**
 * In-Memory Processed Storage Adapter for isolated testing and virtual execution.
 */
export class InMemoryProcessedStorageAdapter implements ProcessedStorageAdapter {
  private readonly store: Map<string, { record: ProcessedStorageRecord; data: Uint8Array }> =
    new Map();

  public async save(processedStorageId: string, data: Uint8Array): Promise<string> {
    if (!isValidProcessedStorageId(processedStorageId)) {
      throw new Error(`Invalid processed storage ID format: '${processedStorageId}'`);
    }

    const virtualPath = `/virtual/processed/${processedStorageId}.png`;
    const record: ProcessedStorageRecord = {
      processedStorageId,
      processedFilePath: virtualPath,
      sizeBytes: data.length,
      createdAt: Date.now(),
    };

    this.store.set(processedStorageId, { record, data: new Uint8Array(data) });
    return virtualPath;
  }

  public async get(
    processedStorageId: string
  ): Promise<{ record: ProcessedStorageRecord; data: Uint8Array } | null> {
    const item = this.store.get(processedStorageId);
    if (!item) return null;
    return { record: item.record, data: new Uint8Array(item.data) };
  }

  public async delete(processedStorageId: string): Promise<boolean> {
    return this.store.delete(processedStorageId);
  }

  public async cleanupExpired(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;
    for (const [id, item] of Array.from(this.store.entries())) {
      if (item.record.createdAt <= cutoff) {
        this.store.delete(id);
        count++;
      }
    }
    return count;
  }

  public async cleanupAll(): Promise<number> {
    const count = this.store.size;
    this.store.clear();
    return count;
  }

  public async list(): Promise<readonly ProcessedStorageRecord[]> {
    return Array.from(this.store.values()).map((v) => v.record);
  }
}
