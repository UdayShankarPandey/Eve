/**
 * PixelPal — Safe Application-Owned Temporary Storage & Path Traversal Defense
 * Sprint 6 Phase 1 Foundation
 *
 * Enforces strict isolation of uploaded image artifacts, generates cryptographic
 * unique IDs, sanitizes filenames, prevents directory traversal, and provides
 * robust lifecycle cleanup routines.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type {
  ImageFormat,
  StagedImageRecord,
  TemporaryStorageAdapter,
} from "./types.ts";

/**
 * Windows reserved device names that must never be created on disk.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Allowed extensions for staged temporary images.
 */
const FORMAT_EXTENSIONS: Record<ImageFormat, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
};

/**
 * Generates a collision-resistant unique ID for staged upload records.
 * Format: char_upload_<timestamp>_<randomHex>
 * Example: 'char_upload_1725888000000_1a2b3c4d5e6f7890'
 */
export function generateStorageId(): string {
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

  return `char_upload_${timestamp}_${randomHex}`;
}

/**
 * Validates that a storage ID adheres to the strict safe identifier pattern.
 * Prevents injection through storage IDs.
 */
export function isValidStorageId(id: string): boolean {
  return typeof id === "string" && /^char_upload_\d+_[a-f0-9]{8,32}$/.test(id);
}

/**
 * Sanitizes an untrusted client filename for safe display or metadata logging.
 * Strips path traversal sequences, directory separators, control characters,
 * and Windows reserved device names.
 */
export function sanitizeFileName(rawFileName?: string): string {
  if (!rawFileName || typeof rawFileName !== "string") {
    return "unnamed_upload";
  }

  // 1. Strip null bytes and control characters (0x00 - 0x1F, 0x7F)
  let clean = rawFileName.replace(/[\x00-\x1f\x7f]/g, "");

  // 2. Remove directory components: extract only the basename
  clean = path.basename(clean.replace(/[\\/]+/g, path.sep));

  // 3. Remove relative path traversal tokens
  clean = clean.replace(/\.\.+/g, "");

  // 4. Remove leading/trailing dots and spaces
  clean = clean.trim().replace(/^\.+/, "").replace(/\.+$/, "");

  // 5. Replace any remaining hazardous characters with underscores
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, "_");

  // 6. Check against Windows reserved device names
  const baseNameWithoutExt = clean.split(".")[0]?.toLowerCase() ?? "";
  if (WINDOWS_RESERVED_NAMES.has(baseNameWithoutExt)) {
    clean = `safe_${clean}`;
  }

  // 7. Enforce sensible maximum length
  if (clean.length > 120) {
    const ext = path.extname(clean);
    clean = clean.slice(0, 120 - ext.length) + ext;
  }

  return clean.length > 0 ? clean : "unnamed_upload";
}

/**
 * Production FileSystem Storage Adapter.
 * Manages an isolated application-owned temporary folder with path traversal defense.
 */
export class FileSystemTemporaryStorageAdapter implements TemporaryStorageAdapter {
  private readonly baseDir: string;
  private readonly metadataRegistry: Map<string, StagedImageRecord> = new Map();

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = path.resolve(customBaseDir);
    } else {
      this.baseDir = path.resolve(os.tmpdir(), "pixelpal_uploads");
    }

    this.ensureBaseDirectory();
  }

  /**
   * Resolves the canonical base storage directory.
   */
  public getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Ensures the temporary storage directory exists.
   */
  private ensureBaseDirectory(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Resolves a target file path and rigorously asserts that it does not escape the baseDir.
   */
  private resolveSecurePath(storageId: string, format: ImageFormat): string {
    if (!isValidStorageId(storageId)) {
      throw new Error(`Invalid storage ID format: '${storageId}'`);
    }

    const ext = FORMAT_EXTENSIONS[format];
    const fileName = `${storageId}${ext}`;
    const resolvedPath = path.resolve(this.baseDir, fileName);

    // Path Traversal Defense: Must be strictly inside baseDir
    const relative = path.relative(this.baseDir, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path traversal attempt detected for storage ID: ${storageId}`);
    }

    return resolvedPath;
  }

  /**
   * Persists image bytes to application-owned temporary storage.
   */
  public async save(
    storageId: string,
    format: ImageFormat,
    data: Uint8Array
  ): Promise<string> {
    this.ensureBaseDirectory();
    const filePath = this.resolveSecurePath(storageId, format);

    // Write file with owner-restricted permissions (mode 0o600)
    await fs.promises.writeFile(filePath, data, { mode: 0o600 });

    const record: StagedImageRecord = {
      storageId,
      tempFilePath: filePath,
      format,
      sizeBytes: data.length,
      createdAt: Date.now(),
    };

    this.metadataRegistry.set(storageId, record);
    return filePath;
  }

  /**
   * Retrieves stored image record and bytes by storage ID.
   */
  public async get(
    storageId: string
  ): Promise<{ record: StagedImageRecord; data: Uint8Array } | null> {
    const record = this.metadataRegistry.get(storageId);
    if (!record) {
      return null;
    }

    if (!fs.existsSync(record.tempFilePath)) {
      this.metadataRegistry.delete(storageId);
      return null;
    }

    const buffer = await fs.promises.readFile(record.tempFilePath);
    return {
      record,
      data: new Uint8Array(buffer),
    };
  }

  /**
   * Deletes a temporary file by storage ID.
   */
  public async delete(storageId: string): Promise<boolean> {
    const record = this.metadataRegistry.get(storageId);
    let deleted = false;

    if (record && fs.existsSync(record.tempFilePath)) {
      try {
        await fs.promises.unlink(record.tempFilePath);
        deleted = true;
      } catch {
        // Ignore file removal errors if already gone
      }
    }

    this.metadataRegistry.delete(storageId);
    return deleted;
  }

  /**
   * Cleans up all managed files older than maxAgeMs.
   */
  public async cleanupExpired(maxAgeMs: number): Promise<number> {
    const now = Date.now();
    const expiryCutoff = now - maxAgeMs;
    let purgedCount = 0;

    // Clean up from memory registry
    for (const [id, record] of Array.from(this.metadataRegistry.entries())) {
      if (record.createdAt <= expiryCutoff) {
        if (await this.delete(id)) {
          purgedCount++;
        }
      }
    }

    // Also scan filesystem directory for orphaned files created earlier
    try {
      if (fs.existsSync(this.baseDir)) {
        const files = await fs.promises.readdir(this.baseDir);
        for (const file of files) {
          // Never touch unrelated files in the directory
          if (!file.startsWith("char_upload_")) {
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
            // Ignore race conditions or transient lock errors
          }
        }
      }
    } catch {
      // Ignore scan failures
    }

    return purgedCount;
  }

  /**
   * Completely purges all managed files in the temporary directory.
   */
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
          // Never touch unrelated files in the directory
          if (!file.startsWith("char_upload_")) {
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

  /**
   * Lists all active staged image records.
   */
  public async list(): Promise<readonly StagedImageRecord[]> {
    return Array.from(this.metadataRegistry.values());
  }
}

/**
 * In-Memory Temporary Storage Adapter.
 * Zero-filesystem footprint, useful for browser/webview environments and isolated unit tests.
 */
export class InMemoryTemporaryStorageAdapter implements TemporaryStorageAdapter {
  private readonly store: Map<string, { record: StagedImageRecord; data: Uint8Array }> =
    new Map();

  public async save(
    storageId: string,
    format: ImageFormat,
    data: Uint8Array
  ): Promise<string> {
    if (!isValidStorageId(storageId)) {
      throw new Error(`Invalid storage ID format: '${storageId}'`);
    }

    const virtualPath = `/virtual/temp/pixelpal/${storageId}${FORMAT_EXTENSIONS[format]}`;
    const record: StagedImageRecord = {
      storageId,
      tempFilePath: virtualPath,
      format,
      sizeBytes: data.length,
      createdAt: Date.now(),
    };

    this.store.set(storageId, { record, data: new Uint8Array(data) });
    return virtualPath;
  }

  public async get(
    storageId: string
  ): Promise<{ record: StagedImageRecord; data: Uint8Array } | null> {
    const item = this.store.get(storageId);
    if (!item) return null;
    return { record: item.record, data: new Uint8Array(item.data) };
  }

  public async delete(storageId: string): Promise<boolean> {
    return this.store.delete(storageId);
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

  public async list(): Promise<readonly StagedImageRecord[]> {
    return Array.from(this.store.values()).map((v) => v.record);
  }
}
