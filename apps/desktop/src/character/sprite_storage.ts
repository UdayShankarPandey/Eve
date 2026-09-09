/**
 * PixelPal — Sprite Character Asset Storage & Lifecycle Management
 * Sprint 6 Phase 4 Foundation
 *
 * Provides safe, isolated application-owned temporary storage for processed
 * sprite character assets. Enforces unique storage IDs, strict path traversal
 * defense, POSIX permissions, and automated cleanup routines.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Storage record for a processed sprite character image asset.
 */
export interface SpriteStorageRecord {
  readonly spriteStorageId: string;
  readonly spriteFilePath: string;
  readonly sizeBytes: number;
  readonly createdAt: number;
}

/**
 * Storage adapter interface for managed sprite character output.
 */
export interface SpriteStorageAdapter {
  save(spriteStorageId: string, data: Uint8Array): Promise<string>;
  get(
    spriteStorageId: string
  ): Promise<{ record: SpriteStorageRecord; data: Uint8Array } | null>;
  delete(spriteStorageId: string): Promise<boolean>;
  cleanupExpired(maxAgeMs: number): Promise<number>;
  cleanupAll(): Promise<number>;
  list(): Promise<readonly SpriteStorageRecord[]>;
}

/**
 * Generates a collision-resistant unique ID for sprite character assets.
 * Example: 'sprite_char_1725888000000_a1b2c3d4e5f67890'
 */
export function generateSpriteStorageId(): string {
  const timestamp = Date.now();
  let randomHex: string;

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    randomHex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } else {
    randomHex =
      Math.random().toString(16).slice(2, 10) +
      Math.random().toString(16).slice(2, 10);
  }

  return `sprite_char_${timestamp}_${randomHex}`;
}

/**
 * Validates that a sprite storage ID conforms to the strict safe format.
 */
export function isValidSpriteStorageId(id: string): boolean {
  return typeof id === "string" && /^sprite_char_\d+_[a-f0-9]{8,32}$/.test(id);
}

/**
 * Production FileSystem Storage Adapter for sprite character assets.
 * Manages an isolated folder (<tempDir>/pixelpal_sprites) with owner-only access.
 */
export class FileSystemSpriteStorageAdapter implements SpriteStorageAdapter {
  private readonly baseDir: string;
  private readonly metadataRegistry: Map<string, SpriteStorageRecord> = new Map();

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = path.resolve(customBaseDir);
    } else {
      this.baseDir = path.resolve(os.tmpdir(), "pixelpal_sprites");
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

  private resolveSecurePath(spriteStorageId: string): string {
    if (!isValidSpriteStorageId(spriteStorageId)) {
      throw new Error(
        `Invalid sprite storage ID format: '${spriteStorageId}'`
      );
    }

    const fileName = `${spriteStorageId}.png`;
    const resolvedPath = path.resolve(this.baseDir, fileName);

    // Path Traversal Defense: Must reside strictly inside baseDir
    const relative = path.relative(this.baseDir, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal attempt detected for storage ID: ${spriteStorageId}`
      );
    }

    return resolvedPath;
  }

  public async save(
    spriteStorageId: string,
    data: Uint8Array
  ): Promise<string> {
    this.ensureBaseDirectory();
    const filePath = this.resolveSecurePath(spriteStorageId);

    // Check collision / overwrite prevention
    if (fs.existsSync(filePath)) {
      throw new Error(
        `Collision detected: sprite asset '${spriteStorageId}' already exists.`
      );
    }

    // Write file with restricted POSIX mode 0o600
    await fs.promises.writeFile(filePath, data, { mode: 0o600 });

    const record: SpriteStorageRecord = {
      spriteStorageId,
      spriteFilePath: filePath,
      sizeBytes: data.byteLength,
      createdAt: Date.now(),
    };

    this.metadataRegistry.set(spriteStorageId, record);
    return filePath;
  }

  public async get(
    spriteStorageId: string
  ): Promise<{ record: SpriteStorageRecord; data: Uint8Array } | null> {
    if (!isValidSpriteStorageId(spriteStorageId)) {
      return null;
    }

    try {
      const filePath = this.resolveSecurePath(spriteStorageId);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const fileData = await fs.promises.readFile(filePath);
      const stat = await fs.promises.stat(filePath);

      let record = this.metadataRegistry.get(spriteStorageId);
      if (!record) {
        record = {
          spriteStorageId,
          spriteFilePath: filePath,
          sizeBytes: stat.size,
          createdAt: stat.birthtimeMs || Date.now(),
        };
        this.metadataRegistry.set(spriteStorageId, record);
      }

      return { record, data: new Uint8Array(fileData) };
    } catch {
      return null;
    }
  }

  public async delete(spriteStorageId: string): Promise<boolean> {
    if (!isValidSpriteStorageId(spriteStorageId)) {
      return false;
    }

    try {
      const filePath = this.resolveSecurePath(spriteStorageId);
      this.metadataRegistry.delete(spriteStorageId);

      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public async cleanupExpired(maxAgeMs: number): Promise<number> {
    this.ensureBaseDirectory();
    const now = Date.now();
    let deletedCount = 0;

    try {
      const files = await fs.promises.readdir(this.baseDir);

      for (const file of files) {
        if (!file.startsWith("sprite_char_") || !file.endsWith(".png")) {
          continue; // Preserve unrelated files
        }

        const fullPath = path.join(this.baseDir, file);
        try {
          const stat = await fs.promises.stat(fullPath);
          const age = now - stat.mtimeMs;

          if (age > maxAgeMs) {
            await fs.promises.unlink(fullPath);
            const id = file.replace(/\.png$/, "");
            this.metadataRegistry.delete(id);
            deletedCount++;
          }
        } catch {
          // Ignore individual file errors during mass cleanup
        }
      }
    } catch {
      // Base directory read error
    }

    return deletedCount;
  }

  public async cleanupAll(): Promise<number> {
    this.ensureBaseDirectory();
    let deletedCount = 0;

    try {
      const files = await fs.promises.readdir(this.baseDir);

      for (const file of files) {
        if (!file.startsWith("sprite_char_") || !file.endsWith(".png")) {
          continue; // Preserve unrelated files in the directory
        }

        const fullPath = path.join(this.baseDir, file);
        try {
          await fs.promises.unlink(fullPath);
          const id = file.replace(/\.png$/, "");
          this.metadataRegistry.delete(id);
          deletedCount++;
        } catch {
          // Ignore individual unlink errors
        }
      }
    } catch {
      // Base directory read error
    }

    return deletedCount;
  }

  public async list(): Promise<readonly SpriteStorageRecord[]> {
    return Array.from(this.metadataRegistry.values());
  }
}

/**
 * In-Memory Storage Adapter for Sprite Assets (for fast, zero-I/O testing).
 */
export class InMemorySpriteStorageAdapter implements SpriteStorageAdapter {
  private readonly store: Map<
    string,
    { record: SpriteStorageRecord; data: Uint8Array }
  > = new Map();

  public async save(
    spriteStorageId: string,
    data: Uint8Array
  ): Promise<string> {
    if (!isValidSpriteStorageId(spriteStorageId)) {
      throw new Error(`Invalid sprite storage ID: ${spriteStorageId}`);
    }

    if (this.store.has(spriteStorageId)) {
      throw new Error(`Collision: ID ${spriteStorageId} already exists`);
    }

    const virtualPath = `/in-memory/pixelpal_sprites/${spriteStorageId}.png`;
    const record: SpriteStorageRecord = {
      spriteStorageId,
      spriteFilePath: virtualPath,
      sizeBytes: data.byteLength,
      createdAt: Date.now(),
    };

    this.store.set(spriteStorageId, { record, data: new Uint8Array(data) });
    return virtualPath;
  }

  public async get(
    spriteStorageId: string
  ): Promise<{ record: SpriteStorageRecord; data: Uint8Array } | null> {
    const item = this.store.get(spriteStorageId);
    if (!item) return null;
    return { record: item.record, data: new Uint8Array(item.data) };
  }

  public async delete(spriteStorageId: string): Promise<boolean> {
    return this.store.delete(spriteStorageId);
  }

  public async cleanupExpired(maxAgeMs: number): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, item] of this.store.entries()) {
      if (now - item.record.createdAt > maxAgeMs) {
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

  public async list(): Promise<readonly SpriteStorageRecord[]> {
    return Array.from(this.store.values()).map((v) => v.record);
  }
}
