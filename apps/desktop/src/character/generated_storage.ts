/**
 * PixelPal — Generated Character Asset Storage & Lifecycle Management
 * Sprint 6 Phase 3 Foundation
 *
 * Provides safe, isolated application-owned temporary storage for intermediate
 * generated base character assets. Enforces unique storage IDs, strict path
 * traversal defense, POSIX permissions, and automated cleanup routines.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

/**
 * Storage record for a generated character image asset.
 */
export interface GeneratedStorageRecord {
  readonly generatedStorageId: string;
  readonly generatedFilePath: string;
  readonly sizeBytes: number;
  readonly createdAt: number;
}

/**
 * Storage adapter interface for managed generated character output.
 */
export interface GeneratedStorageAdapter {
  save(generatedStorageId: string, data: Uint8Array): Promise<string>;
  get(
    generatedStorageId: string
  ): Promise<{ record: GeneratedStorageRecord; data: Uint8Array } | null>;
  delete(generatedStorageId: string): Promise<boolean>;
  cleanupExpired(maxAgeMs: number): Promise<number>;
  cleanupAll(): Promise<number>;
  list(): Promise<readonly GeneratedStorageRecord[]>;
}

/**
 * Generates a collision-resistant unique ID for generated character assets.
 * Example: 'generated_char_1725888000000_a1b2c3d4e5f67890'
 */
export function generateGeneratedStorageId(): string {
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

  return `generated_char_${timestamp}_${randomHex}`;
}

/**
 * Validates that a generated storage ID conforms to the strict safe format.
 */
export function isValidGeneratedStorageId(id: string): boolean {
  return typeof id === "string" && /^generated_char_\d+_[a-f0-9]{8,32}$/.test(id);
}

/**
 * Production FileSystem Storage Adapter for generated character assets.
 * Manages an isolated folder (<tempDir>/pixelpal_generated) with owner-only access.
 */
export class FileSystemGeneratedStorageAdapter implements GeneratedStorageAdapter {
  private readonly baseDir: string;
  private readonly metadataRegistry: Map<string, GeneratedStorageRecord> = new Map();

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = path.resolve(customBaseDir);
    } else {
      this.baseDir = path.resolve(os.tmpdir(), "pixelpal_generated");
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

  private resolveSecurePath(generatedStorageId: string): string {
    if (!isValidGeneratedStorageId(generatedStorageId)) {
      throw new Error(
        `Invalid generated storage ID format: '${generatedStorageId}'`
      );
    }

    const fileName = `${generatedStorageId}.png`;
    const resolvedPath = path.resolve(this.baseDir, fileName);

    // Path Traversal Defense: Must reside strictly inside baseDir
    const relative = path.relative(this.baseDir, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal attempt detected for storage ID: ${generatedStorageId}`
      );
    }

    return resolvedPath;
  }

  public async save(
    generatedStorageId: string,
    data: Uint8Array
  ): Promise<string> {
    this.ensureBaseDirectory();
    const filePath = this.resolveSecurePath(generatedStorageId);

    // Write file with owner-restricted permissions (mode 0o600)
    await fs.promises.writeFile(filePath, data, { mode: 0o600 });

    const record: GeneratedStorageRecord = {
      generatedStorageId,
      generatedFilePath: filePath,
      sizeBytes: data.length,
      createdAt: Date.now(),
    };

    this.metadataRegistry.set(generatedStorageId, record);
    return filePath;
  }

  public async get(
    generatedStorageId: string
  ): Promise<{ record: GeneratedStorageRecord; data: Uint8Array } | null> {
    try {
      const filePath = this.resolveSecurePath(generatedStorageId);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = await fs.promises.readFile(filePath);
      let record = this.metadataRegistry.get(generatedStorageId);
      if (!record) {
        const stats = await fs.promises.stat(filePath);
        record = {
          generatedStorageId,
          generatedFilePath: filePath,
          sizeBytes: stats.size,
          createdAt: stats.birthtimeMs || stats.mtimeMs,
        };
        this.metadataRegistry.set(generatedStorageId, record);
      }

      return { record, data: new Uint8Array(data) };
    } catch {
      return null;
    }
  }

  public async delete(generatedStorageId: string): Promise<boolean> {
    try {
      const filePath = this.resolveSecurePath(generatedStorageId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      this.metadataRegistry.delete(generatedStorageId);
      return true;
    } catch {
      return false;
    }
  }

  public async cleanupExpired(maxAgeMs: number = 7_200_000): Promise<number> {
    this.ensureBaseDirectory();
    let deletedCount = 0;
    const now = Date.now();

    try {
      const entries = await fs.promises.readdir(this.baseDir);
      for (const entry of entries) {
        if (!entry.endsWith(".png")) {
          continue;
        }

        const storageId = entry.slice(0, -4);
        if (!isValidGeneratedStorageId(storageId)) {
          continue;
        }

        const filePath = path.join(this.baseDir, entry);
        try {
          const stats = await fs.promises.stat(filePath);
          const age = now - stats.mtimeMs;
          if (age > maxAgeMs) {
            await fs.promises.unlink(filePath);
            this.metadataRegistry.delete(storageId);
            deletedCount++;
          }
        } catch {
          // Ignore individual file error
        }
      }
    } catch {
      // Directory error
    }

    return deletedCount;
  }

  public async cleanupAll(): Promise<number> {
    this.ensureBaseDirectory();
    let deletedCount = 0;

    try {
      const entries = await fs.promises.readdir(this.baseDir);
      for (const entry of entries) {
        if (!entry.endsWith(".png")) {
          continue;
        }

        const storageId = entry.slice(0, -4);
        if (!isValidGeneratedStorageId(storageId)) {
          continue;
        }

        const filePath = path.join(this.baseDir, entry);
        try {
          await fs.promises.unlink(filePath);
          this.metadataRegistry.delete(storageId);
          deletedCount++;
        } catch {
          // Ignore individual deletion error
        }
      }
    } catch {
      // Directory error
    }

    return deletedCount;
  }

  public async list(): Promise<readonly GeneratedStorageRecord[]> {
    return Array.from(this.metadataRegistry.values());
  }
}

/**
 * In-Memory Storage Adapter for hermetic unit testing.
 */
export class InMemoryGeneratedStorageAdapter implements GeneratedStorageAdapter {
  private readonly storage: Map<string, { record: GeneratedStorageRecord; data: Uint8Array }> =
    new Map();

  public async save(
    generatedStorageId: string,
    data: Uint8Array
  ): Promise<string> {
    if (!isValidGeneratedStorageId(generatedStorageId)) {
      throw new Error(`Invalid generated storage ID: '${generatedStorageId}'`);
    }

    const virtualPath = `/in-memory-pixelpal-generated/${generatedStorageId}.png`;
    const record: GeneratedStorageRecord = {
      generatedStorageId,
      generatedFilePath: virtualPath,
      sizeBytes: data.length,
      createdAt: Date.now(),
    };

    this.storage.set(generatedStorageId, { record, data: new Uint8Array(data) });
    return virtualPath;
  }

  public async get(
    generatedStorageId: string
  ): Promise<{ record: GeneratedStorageRecord; data: Uint8Array } | null> {
    return this.storage.get(generatedStorageId) ?? null;
  }

  public async delete(generatedStorageId: string): Promise<boolean> {
    return this.storage.delete(generatedStorageId);
  }

  public async cleanupExpired(maxAgeMs: number): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, item] of this.storage.entries()) {
      if (now - item.record.createdAt > maxAgeMs) {
        this.storage.delete(id);
        count++;
      }
    }
    return count;
  }

  public async cleanupAll(): Promise<number> {
    const count = this.storage.size;
    this.storage.clear();
    return count;
  }

  public async list(): Promise<readonly GeneratedStorageRecord[]> {
    return Array.from(this.storage.values()).map((v) => v.record);
  }
}
