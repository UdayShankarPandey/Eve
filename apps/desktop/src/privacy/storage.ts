/**
 * PixelPal — Persistent Storage for Privacy Permissions
 * Sprint 10
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
  type PermissionId,
  type PermissionConfig,
  type PermissionDefinition,
  type PermissionStorageAdapter,
  PermissionIds,
  DEFAULT_PERMISSIONS_CONFIG,
  PERMISSION_DESCRIPTIONS,
} from "./types.ts";

/** Default filename for privacy permissions configuration */
export const PERMISSION_CONFIG_FILENAME = "permissions.json";

/**
 * Validates and repairs an untrusted or parsed PermissionConfig document.
 * Ensures all canonical permissions exist and conform to strict schemas.
 */
export function validatePermissionConfig(raw: unknown): PermissionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...DEFAULT_PERMISSIONS_CONFIG,
      updatedAt: Date.now(),
    };
  }

  const record = raw as Record<string, unknown>;
  const schemaVersion = typeof record.schemaVersion === "number" ? record.schemaVersion : 1;
  const rawPermissions = (record.permissions && typeof record.permissions === "object")
    ? (record.permissions as Record<string, unknown>)
    : {};

  const repairedPermissions: Record<PermissionId, PermissionDefinition> = {} as Record<
    PermissionId,
    PermissionDefinition
  >;

  for (const id of Object.values(PermissionIds)) {
    const rawDef = rawPermissions[id] as Record<string, unknown> | undefined;
    const defaultDef = DEFAULT_PERMISSIONS_CONFIG.permissions[id];

    if (!rawDef || typeof rawDef !== "object") {
      repairedPermissions[id] = { ...defaultDef };
      continue;
    }

    const enabled = typeof rawDef.enabled === "boolean" ? rawDef.enabled : defaultDef.enabled;
    const name = typeof rawDef.name === "string" && rawDef.name.trim() !== ""
      ? rawDef.name.trim()
      : defaultDef.name;
    const description = typeof rawDef.description === "string" && rawDef.description.trim() !== ""
      ? rawDef.description.trim()
      : PERMISSION_DESCRIPTIONS[id];

    let scope: PermissionDefinition["scope"] = undefined;
    if (id === PermissionIds.FILES) {
      const rawScope = rawDef.scope as Record<string, unknown> | undefined;
      const rawAllowedPaths = rawScope?.allowedPaths;
      let allowedPaths: string[] = [];
      if (Array.isArray(rawAllowedPaths)) {
        allowedPaths = rawAllowedPaths
          .filter((p): p is string => typeof p === "string" && p.trim() !== "")
          .map((p) => path.resolve(p.trim()));
      }
      scope = { allowedPaths };
    }

    repairedPermissions[id] = {
      id,
      name,
      enabled,
      description,
      scope,
    };
  }

  return {
    schemaVersion,
    permissions: repairedPermissions,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
  };
}

/**
 * FileSystem-backed atomic persistent storage adapter for PermissionConfig.
 */
export class FileSystemPermissionStorageAdapter implements PermissionStorageAdapter {
  private readonly filePath: string;
  private readonly baseDir: string;

  constructor(customFilePath?: string) {
    if (customFilePath && customFilePath.trim() !== "") {
      this.filePath = path.resolve(customFilePath.trim());
      this.baseDir = path.dirname(this.filePath);
    } else {
      this.baseDir = getDesktopAppDataDir();
      this.filePath = path.join(this.baseDir, PERMISSION_CONFIG_FILENAME);
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

  public async loadConfig(): Promise<PermissionConfig> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {
          ...DEFAULT_PERMISSIONS_CONFIG,
          updatedAt: Date.now(),
        };
      }

      const content = fs.readFileSync(this.filePath, "utf-8");
      if (!content || content.trim() === "") {
        return {
          ...DEFAULT_PERMISSIONS_CONFIG,
          updatedAt: Date.now(),
        };
      }

      const parsed = JSON.parse(content);
      return validatePermissionConfig(parsed);
    } catch {
      // Safe fallback on read error, parse error, or corruption
      return {
        ...DEFAULT_PERMISSIONS_CONFIG,
        updatedAt: Date.now(),
      };
    }
  }

  public async saveConfig(config: PermissionConfig): Promise<void> {
    const validated = validatePermissionConfig({
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
          // Best effort cleanup
        }
      }
      throw err;
    }
  }

  public async resetConfig(): Promise<PermissionConfig> {
    const resetConfig: PermissionConfig = {
      ...DEFAULT_PERMISSIONS_CONFIG,
      updatedAt: Date.now(),
    };
    await this.saveConfig(resetConfig);
    return resetConfig;
  }
}

/**
 * In-memory storage adapter for fast hermetic unit testing.
 */
export class InMemoryPermissionStorageAdapter implements PermissionStorageAdapter {
  private config: PermissionConfig;

  constructor(initialConfig?: PermissionConfig) {
    this.config = initialConfig
      ? validatePermissionConfig(initialConfig)
      : { ...DEFAULT_PERMISSIONS_CONFIG, updatedAt: Date.now() };
  }

  public async loadConfig(): Promise<PermissionConfig> {
    return JSON.parse(JSON.stringify(this.config));
  }

  public async saveConfig(config: PermissionConfig): Promise<void> {
    this.config = validatePermissionConfig({
      ...config,
      updatedAt: Date.now(),
    });
  }

  public async resetConfig(): Promise<PermissionConfig> {
    this.config = {
      ...DEFAULT_PERMISSIONS_CONFIG,
      updatedAt: Date.now(),
    };
    return JSON.parse(JSON.stringify(this.config));
  }
}
