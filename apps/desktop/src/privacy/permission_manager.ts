/**
 * PixelPal — Master Permission Manager
 * Sprint 10 Core Coordinator
 *
 * Coordinates:
 * - Durable persistence of permission settings
 * - Runtime permission querying and dynamic updates
 * - File scope allowlist configuration
 * - Event gating and enforcement checks
 * - AI context filtering and scope diagnostics
 * - Cross-subsystem change notifications
 */

import type { DesktopEvent } from "../../../../packages/shared-types/src/events.ts";
import type { ApprovedConversationContext } from "../../../../packages/shared-types/src/conversation.ts";
import {
  type PermissionId,
  type PermissionConfig,
  type PermissionDefinition,
  type PermissionStorageAdapter,
  type PermissionChangeListener,
  type AiContextScopeDescription,
  type FilesPermissionScope,
  PermissionIds,
  DEFAULT_PERMISSIONS_CONFIG,
  isValidPermissionId,
} from "./types.ts";
import { FileSystemPermissionStorageAdapter } from "./storage.ts";
import { isEventPermitted, mapPermissionConfigToDetectorConfig } from "./enforcement.ts";
import { filterApprovedContext, describeAiContextScope } from "./ai_privacy.ts";
import { normalizeScopePath } from "./file_scope.ts";

/**
 * Options for configuring PermissionManager.
 */
export interface PermissionManagerOptions {
  readonly storage?: PermissionStorageAdapter;
}

/**
 * Central runtime authority for privacy permissions in PixelPal.
 */
export class PermissionManager {
  private readonly storage: PermissionStorageAdapter;
  private config: PermissionConfig;
  private readonly listeners: Set<PermissionChangeListener> = new Set();
  private isInitialized = false;

  constructor(options: PermissionManagerOptions = {}) {
    this.storage = options.storage ?? new FileSystemPermissionStorageAdapter();
    this.config = { ...DEFAULT_PERMISSIONS_CONFIG, updatedAt: Date.now() };
  }

  /**
   * Initializes the manager by loading persisted configuration from storage.
   */
  public async init(): Promise<void> {
    try {
      this.config = await this.storage.loadConfig();
    } catch {
      this.config = { ...DEFAULT_PERMISSIONS_CONFIG, updatedAt: Date.now() };
    }
    this.isInitialized = true;
  }

  /**
   * Returns whether the manager has completed initialization.
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Returns a snapshot copy of the full active PermissionConfig.
   */
  public getConfig(): PermissionConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Retrieves the definition for a specific permission domain.
   */
  public getPermission(id: PermissionId): PermissionDefinition {
    if (!isValidPermissionId(id)) {
      throw new Error(`Invalid permission ID: '${String(id)}'`);
    }
    return JSON.parse(JSON.stringify(this.config.permissions[id]));
  }

  /**
   * Returns whether a specific permission is currently enabled.
   */
  public isPermissionEnabled(id: PermissionId): boolean {
    if (!isValidPermissionId(id)) {
      return false;
    }
    return Boolean(this.config.permissions[id]?.enabled);
  }

  /**
   * Updates the enabled state of a permission and persists the change atomically.
   */
  public async updatePermission(
    id: PermissionId,
    enabled: boolean
  ): Promise<PermissionDefinition> {
    if (!isValidPermissionId(id)) {
      throw new Error(`Cannot update unknown permission ID: '${String(id)}'`);
    }

    const current = this.config.permissions[id];
    const updatedDef: PermissionDefinition = {
      ...current,
      enabled: Boolean(enabled),
    };

    const updatedPermissions = {
      ...this.config.permissions,
      [id]: updatedDef,
    };

    this.config = {
      ...this.config,
      permissions: updatedPermissions,
      updatedAt: Date.now(),
    };

    await this.storage.saveConfig(this.config);
    this.notifyListeners(updatedDef);

    return JSON.parse(JSON.stringify(updatedDef));
  }

  /**
   * Configures the allowed directory paths for the FILES permission domain.
   */
  public async setAllowedFilePaths(
    paths: readonly string[]
  ): Promise<PermissionDefinition> {
    const current = this.config.permissions[PermissionIds.FILES];
    const normalizedPaths: string[] = [];

    for (const rawPath of paths) {
      if (typeof rawPath === "string" && rawPath.trim() !== "") {
        try {
          normalizedPaths.push(normalizeScopePath(rawPath));
        } catch {
          // Skip invalid path strings safely
        }
      }
    }

    const updatedDef: PermissionDefinition = {
      ...current,
      scope: {
        allowedPaths: normalizedPaths,
      } as FilesPermissionScope,
    };

    const updatedPermissions = {
      ...this.config.permissions,
      [PermissionIds.FILES]: updatedDef,
    };

    this.config = {
      ...this.config,
      permissions: updatedPermissions,
      updatedAt: Date.now(),
    };

    await this.storage.saveConfig(this.config);
    this.notifyListeners(updatedDef);

    return JSON.parse(JSON.stringify(updatedDef));
  }

  /**
   * Resets all permissions to default conservative privacy settings and persists.
   */
  public async reset(): Promise<PermissionConfig> {
    this.config = await this.storage.resetConfig();
    for (const def of Object.values(this.config.permissions)) {
      this.notifyListeners(def);
    }
    return this.getConfig();
  }

  /**
   * Subscribes a listener to be notified whenever any permission changes.
   */
  public addListener(listener: PermissionChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(updated: PermissionDefinition): void {
    const fullConfig = this.getConfig();
    for (const listener of this.listeners) {
      try {
        listener(updated, fullConfig);
      } catch (err) {
        console.error("[PermissionManager] Listener error:", err);
      }
    }
  }

  /**
   * Evaluates whether an event is permitted to be generated/processed under active policy.
   */
  public isEventPermitted(event: DesktopEvent<any>): boolean {
    return isEventPermitted(event, this.config);
  }

  /**
   * Filters an ApprovedConversationContext snapshot against active permissions before sending to AI.
   */
  public filterAiContext(
    rawContext: ApprovedConversationContext
  ): ApprovedConversationContext {
    return filterApprovedContext(rawContext, this.config);
  }

  /**
   * Returns machine-readable scope diagnostics explaining what can leave the device.
   */
  public getAiContextScope(): AiContextScopeDescription {
    return describeAiContextScope(this.config);
  }

  /**
   * Checks whether companion notification alerts and presentation intents are permitted.
   */
  public isNotificationPermitted(): boolean {
    return Boolean(this.config.permissions[PermissionIds.NOTIFICATIONS]?.enabled);
  }

  /**
   * Returns the native Rust DetectorConfig mapping reflecting active permissions.
   */
  public getNativeDetectorConfig(): ReturnType<typeof mapPermissionConfigToDetectorConfig> {
    return mapPermissionConfigToDetectorConfig(this.config);
  }

  /**
   * Synchronizes active permissions with native Tauri detectors, suppressing detectors at source.
   */
  public async syncNativeDetectors(
    invokeFn?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>
  ): Promise<void> {
    if (invokeFn) {
      await invokeFn("update_detector_config", {
        config: this.getNativeDetectorConfig(),
      });
    }
  }
}
