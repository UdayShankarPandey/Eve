/**
 * PixelPal — Persistent Storage for Personality Configuration
 * Sprint 8
 *
 * Implements atomic, durable storage adhering to desktop security standards:
 * - Application data directory resolution (no os.tmpdir() in production)
 * - Atomic write-and-rename pattern to prevent corruption
 * - Mode 0o600 file permissions and mode 0o700 directory permissions
 * - Corrupted or missing configuration recovery safely falls back to default
 * - In-memory adapter for fast hermetic unit testing
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getDesktopAppDataDir } from "../character/paths.ts";
import {
  type PersonalityConfig,
  type PersonalityStorageAdapter,
  DEFAULT_PERSONALITY_CONFIG,
} from "./types.ts";
import { validatePersonalityConfig } from "./profiles.ts";

/** Default filename for personality configuration */
export const PERSONALITY_CONFIG_FILENAME = "personality.json";

/**
 * FileSystem-backed atomic persistent storage adapter for PersonalityConfig.
 */
export class FileSystemPersonalityStorageAdapter
  implements PersonalityStorageAdapter
{
  private readonly filePath: string;
  private readonly baseDir: string;

  constructor(customFilePath?: string) {
    if (customFilePath && customFilePath.trim() !== "") {
      this.filePath = path.resolve(customFilePath.trim());
      this.baseDir = path.dirname(this.filePath);
    } else {
      this.baseDir = getDesktopAppDataDir();
      this.filePath = path.join(this.baseDir, PERSONALITY_CONFIG_FILENAME);
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
  }

  public async loadConfig(): Promise<PersonalityConfig> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ...DEFAULT_PERSONALITY_CONFIG, updatedAt: Date.now() };
      }

      const content = fs.readFileSync(this.filePath, "utf-8");
      if (!content || content.trim() === "") {
        return { ...DEFAULT_PERSONALITY_CONFIG, updatedAt: Date.now() };
      }

      const parsed = JSON.parse(content);
      return validatePersonalityConfig(parsed);
    } catch {
      // Safe fallback on read error, parse error, or corruption
      return { ...DEFAULT_PERSONALITY_CONFIG, updatedAt: Date.now() };
    }
  }

  public async saveConfig(config: PersonalityConfig): Promise<void> {
    const validated = validatePersonalityConfig({
      ...config,
      updatedAt: Date.now(),
    });

    this.ensureDirectory();

    const randomSuffix = crypto.randomBytes(4).toString("hex");
    const tempPath = path.resolve(
      this.baseDir,
      `${path.basename(this.filePath)}.tmp.${randomSuffix}`
    );

    const serialized = JSON.stringify(validated, null, 2);

    try {
      fs.writeFileSync(tempPath, serialized, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "w",
      });

      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Cleanup best-effort
        }
      }
      throw err;
    }
  }
}

/**
 * In-memory storage adapter for unit testing and ephemeral sessions.
 */
export class InMemoryPersonalityStorageAdapter
  implements PersonalityStorageAdapter
{
  private config: PersonalityConfig;

  constructor(initialConfig?: PersonalityConfig) {
    this.config = initialConfig
      ? validatePersonalityConfig(initialConfig)
      : { ...DEFAULT_PERSONALITY_CONFIG, updatedAt: Date.now() };
  }

  public async loadConfig(): Promise<PersonalityConfig> {
    return { ...this.config };
  }

  public async saveConfig(config: PersonalityConfig): Promise<void> {
    this.config = validatePersonalityConfig({
      ...config,
      updatedAt: Date.now(),
    });
  }
}
