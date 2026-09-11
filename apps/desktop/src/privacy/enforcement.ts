/**
 * PixelPal — Permission Enforcement Policy & Event Gate
 * Sprint 10 Phase 2
 *
 * Implements strict runtime enforcement:
 * - Authoritative mapping between canonical EventTypes and Permission domains
 * - Immediate suppression of events whose controlling permission is disabled
 * - Filesystem events gated by both permission status and path allowlist
 * - Safe EventGate wrapper to prevent unauthorized event dispatch to downstream consumers
 */

import { EventTypes, type EventType, type DesktopEvent } from "../../../../packages/shared-types/src/events.ts";
import {
  type PermissionId,
  type PermissionConfig,
  type FilesPermissionScope,
  PermissionIds,
} from "./types.ts";
import {
  isPathAllowed,
  resolveAuthorizedDownloadsDir,
  FileScopeValidator,
} from "./file_scope.ts";
import type { EventBus } from "../events/event_bus.ts";

/**
 * Authoritative mapping from canonical EventTypes to controlling PermissionId.
 */
export const EVENT_TO_PERMISSION_MAP: Readonly<Record<EventType, PermissionId>> = {
  // SYSTEM Permission Domain
  [EventTypes.BATTERY_LOW]: PermissionIds.SYSTEM,
  [EventTypes.BATTERY_CRITICAL]: PermissionIds.SYSTEM,
  [EventTypes.CHARGING_STARTED]: PermissionIds.SYSTEM,
  [EventTypes.CHARGING_STOPPED]: PermissionIds.SYSTEM,
  [EventTypes.USER_IDLE]: PermissionIds.SYSTEM,
  [EventTypes.USER_ACTIVE]: PermissionIds.SYSTEM,
  [EventTypes.PC_LOCKED]: PermissionIds.SYSTEM,
  [EventTypes.PC_UNLOCKED]: PermissionIds.SYSTEM,
  [EventTypes.NETWORK_CONNECTED]: PermissionIds.SYSTEM,
  [EventTypes.NETWORK_DISCONNECTED]: PermissionIds.SYSTEM,

  // APPLICATIONS Permission Domain
  [EventTypes.APP_OPENED]: PermissionIds.APPLICATIONS,
  [EventTypes.APP_CLOSED]: PermissionIds.APPLICATIONS,

  // FILES Permission Domain
  [EventTypes.DOWNLOAD_COMPLETED]: PermissionIds.FILES,
  [EventTypes.FILE_CREATED]: PermissionIds.FILES,
  [EventTypes.FILE_MODIFIED]: PermissionIds.FILES,
  [EventTypes.FILE_DELETED]: PermissionIds.FILES,

  // SCREEN_TIME Permission Domain
  [EventTypes.SCREEN_TIME_HIGH]: PermissionIds.SCREEN_TIME,
} as const;

/**
 * Returns the controlling PermissionId for a given EventType, or null if unmapped.
 */
export function getRequiredPermissionForEvent(eventType: EventType): PermissionId | null {
  return EVENT_TO_PERMISSION_MAP[eventType] ?? null;
}

/**
 * Evaluates whether an event is permitted to be emitted or processed under the active PermissionConfig.
 * Returns true if permitted, false if prohibited.
 */
export function isEventPermitted(
  event: DesktopEvent<any>,
  config: PermissionConfig,
  validator?: FileScopeValidator
): boolean {
  if (!event || !event.type) {
    return false;
  }

  const requiredPermission = getRequiredPermissionForEvent(event.type);
  if (!requiredPermission) {
    // Unmapped or unknown event types fail closed to prevent accidental leakage
    return false;
  }

  const permDef = config.permissions[requiredPermission];
  if (!permDef || !permDef.enabled) {
    return false; // Controlling permission is disabled
  }

  // Domain-specific secondary enforcement for FILES
  if (requiredPermission === PermissionIds.FILES) {
    const scope = permDef.scope as FilesPermissionScope | undefined;
    const allowedPaths = scope?.allowedPaths ?? [];

    if (allowedPaths.length === 0) {
      // Strict rule: without an explicitly configured allowed folder, NO file events pass
      return false;
    }

    const payload = event.payload || {};
    const filePath = typeof payload.path === "string"
      ? payload.path
      : typeof payload.directory === "string"
        ? payload.directory
        : typeof payload.download_dir === "string"
          ? payload.download_dir
          : undefined;

    const permitted = validator
      ? validator.isPathAllowed(filePath)
      : isPathAllowed(filePath, allowedPaths);

    if (!filePath || !permitted) {
      return false; // File is outside allowed scope
    }
  }

  return true;
}

/**
 * Permission-enforcing gate wrapping EventBus publication.
 * Guarantees that disabled permissions or out-of-scope events NEVER reach downstream listeners.
 */
export class EventGate {
  private config: PermissionConfig;
  private droppedEventsCount = 0;
  private readonly fileScopeValidator: FileScopeValidator;

  constructor(initialConfig: PermissionConfig) {
    this.config = initialConfig;
    const allowedPaths = (initialConfig.permissions[PermissionIds.FILES]?.scope as FilesPermissionScope | undefined)?.allowedPaths ?? [];
    this.fileScopeValidator = new FileScopeValidator(allowedPaths);
  }

  /**
   * Updates the active permission configuration used for gating and updates canonical roots snapshot.
   */
  public updateConfig(newConfig: PermissionConfig): void {
    this.config = newConfig;
    const allowedPaths = (newConfig.permissions[PermissionIds.FILES]?.scope as FilesPermissionScope | undefined)?.allowedPaths ?? [];
    this.fileScopeValidator.updateRoots(allowedPaths);
  }

  /**
   * Returns the underlying FileScopeValidator instance.
   */
  public getFileScopeValidator(): FileScopeValidator {
    return this.fileScopeValidator;
  }

  /**
   * Checks permission and publishes the event to the target EventBus only if permitted.
   * Returns true if event was permitted and published, false if suppressed.
   */
  public publishIfPermitted<T = unknown>(
    bus: EventBus,
    event: DesktopEvent<T>
  ): boolean {
    if (isEventPermitted(event, this.config, this.fileScopeValidator)) {
      bus.publish(event);
      return true;
    } else {
      this.droppedEventsCount++;
      return false;
    }
  }

  /**
   * Returns the total count of events suppressed by permission policy.
   */
  public getDroppedEventsCount(): number {
    return this.droppedEventsCount;
  }

  /**
   * Resets the drop counter.
   */
  public resetDroppedEventsCount(): void {
    this.droppedEventsCount = 0;
  }
}

/**
 * Checks whether companion notification/speech bubble presentation intent is permitted.
 */
export function isNotificationPresentationPermitted(config: PermissionConfig): boolean {
  return Boolean(config.permissions[PermissionIds.NOTIFICATIONS]?.enabled);
}

/**
 * Shape of native detector configuration in Rust.
 */
export interface NativeDetectorConfigMapping {
  battery_enabled: boolean;
  user_activity_enabled: boolean;
  session_enabled: boolean;
  network_enabled: boolean;
  app_activity_enabled: boolean;
  downloads_enabled: boolean;
  filesystem_enabled: boolean;
  screen_time_enabled: boolean;
  idle_threshold_ms: number;
  screen_time_threshold_ms: number;
  downloads_dir: string | null;
  monitored_directories: string[];
  selected_applications: string[];
}

/**
 * Maps high-level PermissionConfig to low-level native Rust DetectorConfig.
 * Ensures disabled permissions immediately stop native detector polling loops.
 */
export function mapPermissionConfigToDetectorConfig(
  config: PermissionConfig
): NativeDetectorConfigMapping {
  const systemEnabled = Boolean(config.permissions[PermissionIds.SYSTEM]?.enabled);
  const appEnabled = Boolean(config.permissions[PermissionIds.APPLICATIONS]?.enabled);
  const filesEnabled = Boolean(config.permissions[PermissionIds.FILES]?.enabled);
  const screenTimeEnabled = Boolean(config.permissions[PermissionIds.SCREEN_TIME]?.enabled);

  const filesScope = config.permissions[PermissionIds.FILES]?.scope as
    | FilesPermissionScope
    | undefined;
  const allowedPaths = filesScope?.allowedPaths ? [...filesScope.allowedPaths] : [];

  // Downloads detection is ONLY authorized if FILES permission is granted AND
  // an explicit Downloads path is present in user's allowedPaths allowlist.
  const authorizedDownloadsDir = filesEnabled ? resolveAuthorizedDownloadsDir(allowedPaths) : null;
  const downloadsEnabled = filesEnabled && Boolean(authorizedDownloadsDir);

  return {
    battery_enabled: systemEnabled,
    user_activity_enabled: systemEnabled,
    session_enabled: systemEnabled,
    network_enabled: systemEnabled,
    app_activity_enabled: appEnabled,
    downloads_enabled: downloadsEnabled,
    filesystem_enabled: filesEnabled && allowedPaths.length > 0,
    screen_time_enabled: screenTimeEnabled,
    idle_threshold_ms: 120_000,
    screen_time_threshold_ms: 3_600_000,
    downloads_dir: authorizedDownloadsDir,
    monitored_directories: filesEnabled ? allowedPaths : [],
    selected_applications: ["VS Code", "Code"],
  };
}
