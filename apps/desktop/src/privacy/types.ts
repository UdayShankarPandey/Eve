/**
 * PixelPal — Privacy & Permissions Desktop Types & Interfaces
 * Sprint 10 Foundation
 */

import type {
  PermissionConfig,
  PermissionDefinition,
} from "../../../../packages/shared-types/src/permissions.ts";

export * from "../../../../packages/shared-types/src/permissions.ts";

/**
 * Storage adapter interface for persisting PermissionConfig.
 */
export interface PermissionStorageAdapter {
  /**
   * Loads persisted privacy permission configuration.
   * If file is missing or corrupted, returns default configuration safely.
   */
  loadConfig(): Promise<PermissionConfig>;

  /**
   * Persists permission configuration atomically and durably.
   */
  saveConfig(config: PermissionConfig): Promise<void>;

  /**
   * Resets configuration to default privacy-first state.
   */
  resetConfig(): Promise<PermissionConfig>;
}

/**
 * Event listener callback for permission changes.
 */
export type PermissionChangeListener = (
  updatedPermission: PermissionDefinition,
  fullConfig: PermissionConfig
) => void;
