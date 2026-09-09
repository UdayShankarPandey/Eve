/**
 * PixelPal — Character Profile Storage & Local Persistence
 * Sprint 6 Phase 5 Foundation
 *
 * Provides safe, atomic, isolated file-based persistence for CharacterProfile documents.
 * Enforces unique IDs, strict path traversal defense, POSIX permissions, atomic writes
 * (write-to-temp then rename), and bidirectional schema validation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  CharacterProfile,
} from "../../../../packages/shared-types/src/character.ts";
import {
  isValidCharacterId,
  validateProfile,
} from "./profile_validator.ts";

/**
 * Metadata record for a persisted CharacterProfile on disk.
 */
export interface ProfileStorageRecord {
  readonly characterId: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Storage adapter interface for managed CharacterProfile persistence.
 */
export interface ProfileStorageAdapter {
  save(profile: CharacterProfile): Promise<string>;
  get(
    characterId: string
  ): Promise<{ record: ProfileStorageRecord; profile: CharacterProfile } | null>;
  delete(characterId: string): Promise<boolean>;
  list(): Promise<readonly CharacterProfile[]>;
  cleanupAll(): Promise<number>;
}

/**
 * Generates a stable, collision-resistant unique ID for a CharacterProfile.
 * Format: character_<timestamp>_<randomHex>
 * Example: 'character_1725888000000_1a2b3c4d5e6f7890'
 */
export function generateCharacterId(): string {
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

  return `character_${timestamp}_${randomHex}`;
}

/**
 * Production FileSystem Storage Adapter for CharacterProfile documents.
 * Manages an isolated folder (<tempDir>/pixelpal_profiles) with atomic writes and owner-only access.
 */
export class FileSystemProfileStorageAdapter implements ProfileStorageAdapter {
  private readonly baseDir: string;
  private readonly metadataRegistry: Map<string, ProfileStorageRecord> = new Map();

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = path.resolve(customBaseDir);
    } else {
      this.baseDir = path.resolve(os.tmpdir(), "pixelpal_profiles");
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

  public resolveSecurePath(characterId: string): string {
    if (!isValidCharacterId(characterId)) {
      throw new Error(`Invalid character ID format: '${characterId}'`);
    }

    const fileName = `${characterId}.json`;
    const resolvedPath = path.resolve(this.baseDir, fileName);

    // Path Traversal Defense: Must reside strictly inside baseDir
    const relative = path.relative(this.baseDir, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal attempt detected for character ID: ${characterId}`
      );
    }

    return resolvedPath;
  }

  /**
   * Atomically saves a CharacterProfile to disk.
   * Performs validation, writes to a temporary file, and renames atomically to prevent corruption.
   */
  public async save(profile: CharacterProfile): Promise<string> {
    const validation = validateProfile(profile);
    if (!validation.valid) {
      const err = validation.errors[0];
      throw new Error(
        `Profile validation failed: ${err.message} (${err.code})`
      );
    }

    this.ensureBaseDirectory();
    const finalPath = this.resolveSecurePath(profile.characterId);

    // Atomic write pattern: write to .tmp.<random> in the same directory, then rename
    const randomSuffix = Math.random().toString(16).slice(2, 10);
    const tempPath = path.resolve(
      this.baseDir,
      `${profile.characterId}.tmp.${randomSuffix}`
    );

    const jsonContent = JSON.stringify(profile, null, 2);

    try {
      fs.writeFileSync(tempPath, jsonContent, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "w",
      });

      // Atomic rename
      fs.renameSync(tempPath, finalPath);

      // Verify file presence and stat
      const stat = fs.statSync(finalPath);
      const record: ProfileStorageRecord = {
        characterId: profile.characterId,
        filePath: finalPath,
        sizeBytes: stat.size,
        schemaVersion: profile.schemaVersion,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };

      this.metadataRegistry.set(profile.characterId, record);
      return finalPath;
    } catch (error) {
      // Clean up orphaned temp file on failure
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore secondary cleanup error
        }
      }
      throw error;
    }
  }

  /**
   * Retrieves and deserializes a CharacterProfile from disk.
   * Validates schema integrity on read.
   */
  public async get(
    characterId: string
  ): Promise<{ record: ProfileStorageRecord; profile: CharacterProfile } | null> {
    const filePath = this.resolveSecurePath(characterId);

    if (!fs.existsSync(filePath)) {
      this.metadataRegistry.delete(characterId);
      return null;
    }

    try {
      const rawContent = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(rawContent) as unknown;

      const validation = validateProfile(parsed);
      if (!validation.valid) {
        const err = validation.errors[0];
        throw new Error(
          `Persisted profile failed schema validation: ${err.message} (${err.code})`
        );
      }

      const profile = parsed as CharacterProfile;
      const stat = fs.statSync(filePath);

      const record: ProfileStorageRecord = {
        characterId: profile.characterId,
        filePath,
        sizeBytes: stat.size,
        schemaVersion: profile.schemaVersion,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };

      this.metadataRegistry.set(characterId, record);
      return { record, profile };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Persisted profile JSON is corrupted for character ID: ${characterId}`
        );
      }
      throw error;
    }
  }

  /**
   * Deletes a CharacterProfile from disk.
   */
  public async delete(characterId: string): Promise<boolean> {
    const filePath = this.resolveSecurePath(characterId);

    if (!fs.existsSync(filePath)) {
      this.metadataRegistry.delete(characterId);
      return false;
    }

    fs.unlinkSync(filePath);
    this.metadataRegistry.delete(characterId);
    return true;
  }

  /**
   * Lists all valid CharacterProfiles in the storage directory.
   */
  public async list(): Promise<readonly CharacterProfile[]> {
    this.ensureBaseDirectory();
    const files = fs.readdirSync(this.baseDir);
    const profiles: CharacterProfile[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const characterId = file.replace(/\.json$/, "");
      if (!isValidCharacterId(characterId)) continue;

      try {
        const loaded = await this.get(characterId);
        if (loaded) {
          profiles.push(loaded.profile);
        }
      } catch {
        // Skip corrupted or unreadable profile files
      }
    }

    return profiles;
  }

  /**
   * Cleans up all managed profile files in the storage directory.
   */
  public async cleanupAll(): Promise<number> {
    this.ensureBaseDirectory();
    const files = fs.readdirSync(this.baseDir);
    let count = 0;

    for (const file of files) {
      if (file.endsWith(".json") || file.includes(".tmp.")) {
        const fullPath = path.resolve(this.baseDir, file);
        try {
          fs.unlinkSync(fullPath);
          count++;
        } catch {
          // Ignore individual file error
        }
      }
    }

    this.metadataRegistry.clear();
    return count;
  }
}

/**
 * In-Memory Storage Adapter for fast, hermetic unit tests.
 */
export class InMemoryProfileStorageAdapter implements ProfileStorageAdapter {
  private readonly store = new Map<string, { record: ProfileStorageRecord; profile: CharacterProfile }>();

  public async save(profile: CharacterProfile): Promise<string> {
    const validation = validateProfile(profile);
    if (!validation.valid) {
      const err = validation.errors[0];
      throw new Error(`Profile validation failed: ${err.message} (${err.code})`);
    }

    const virtualPath = `/in-memory/pixelpal_profiles/${profile.characterId}.json`;
    const record: ProfileStorageRecord = {
      characterId: profile.characterId,
      filePath: virtualPath,
      sizeBytes: JSON.stringify(profile).length,
      schemaVersion: profile.schemaVersion,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };

    // Deep clone to guarantee immutability in memory
    const cloned = JSON.parse(JSON.stringify(profile)) as CharacterProfile;
    this.store.set(profile.characterId, { record, profile: cloned });
    return virtualPath;
  }

  public async get(
    characterId: string
  ): Promise<{ record: ProfileStorageRecord; profile: CharacterProfile } | null> {
    if (!isValidCharacterId(characterId)) {
      throw new Error(`Invalid character ID format: '${characterId}'`);
    }

    const item = this.store.get(characterId);
    if (!item) return null;

    return {
      record: item.record,
      profile: JSON.parse(JSON.stringify(item.profile)) as CharacterProfile,
    };
  }

  public async delete(characterId: string): Promise<boolean> {
    if (!isValidCharacterId(characterId)) {
      throw new Error(`Invalid character ID format: '${characterId}'`);
    }
    return this.store.delete(characterId);
  }

  public async list(): Promise<readonly CharacterProfile[]> {
    return Array.from(this.store.values()).map((item) =>
      JSON.parse(JSON.stringify(item.profile)) as CharacterProfile
    );
  }

  public async cleanupAll(): Promise<number> {
    const count = this.store.size;
    this.store.clear();
    return count;
  }
}
