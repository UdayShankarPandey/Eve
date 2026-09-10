/**
 * PixelPal — Privacy & Permissions Shared Types & Contracts
 * Sprint 10 Foundation
 *
 * Defines canonical data contracts for:
 * - Six canonical permission domains (SYSTEM, APPLICATIONS, FILES, NOTIFICATIONS, SCREEN_TIME, AI_CONTEXT)
 * - Permission descriptions explaining observation, necessity, local vs AI scope, and boundaries
 * - Scoped configuration (e.g. selected file paths)
 * - Persistent configuration schema and safe defaults
 * - Machine-readable AI context scope diagnostics
 * - Data control contracts (deletion, reset)
 */

/**
 * Closed set of canonical permission identifiers.
 */
export const PermissionIds = {
  SYSTEM: "SYSTEM",
  APPLICATIONS: "APPLICATIONS",
  FILES: "FILES",
  NOTIFICATIONS: "NOTIFICATIONS",
  SCREEN_TIME: "SCREEN_TIME",
  AI_CONTEXT: "AI_CONTEXT",
} as const;

export type PermissionId = (typeof PermissionIds)[keyof typeof PermissionIds];

/**
 * Validates whether a raw string is a canonical PermissionId.
 */
export function isValidPermissionId(id: unknown): id is PermissionId {
  return typeof id === "string" && Object.values(PermissionIds).includes(id as PermissionId);
}

/**
 * Specific scope configuration for the FILES permission.
 */
export interface FilesPermissionScope {
  /** Explicit allowlist of root directory paths monitored for changes */
  readonly allowedPaths: readonly string[];
}

/**
 * Generic permission scope configuration.
 */
export type PermissionScope = FilesPermissionScope | Record<string, unknown>;

/**
 * Canonical definition for a single permission domain.
 */
export interface PermissionDefinition {
  /** Stable permission identifier */
  readonly id: PermissionId;
  /** Human-readable display name */
  readonly name: string;
  /** Whether the permission is currently granted */
  readonly enabled: boolean;
  /** Comprehensive, specific explanation of what is monitored and what remains private */
  readonly description: string;
  /** Optional domain-specific scope constraints (e.g. allowed paths for FILES) */
  readonly scope?: PermissionScope;
}

/**
 * Root persistent configuration document for privacy permissions.
 */
export interface PermissionConfig {
  /** Schema version for forward-compatible migrations */
  readonly schemaVersion: number;
  /** Map of all canonical permission definitions keyed by PermissionId */
  readonly permissions: Record<PermissionId, PermissionDefinition>;
  /** Epoch timestamp in milliseconds of last configuration modification */
  readonly updatedAt: number;
}

/**
 * Machine-readable summary of what context can currently reach the AI provider.
 */
export interface AiContextScopeDescription {
  /** Master AI context toggle status */
  readonly aiContextEnabled: boolean;
  /** List of desktop context categories currently permitted to enter AI requests */
  readonly allowedCategories: readonly string[];
  /** List of desktop context categories currently blocked from AI requests */
  readonly blockedCategories: readonly string[];
}

/**
 * Result contract for data deletion operations.
 */
export interface DataDeletionResult {
  readonly success: boolean;
  readonly target: "events" | "conversation" | "character" | "settings";
  readonly itemsDeleted: number;
  readonly message?: string;
  readonly error?: string;
}

/**
 * Comprehensive, specific permission descriptions adhering to Sprint 10 privacy guidelines:
 * 1. What PixelPal observes
 * 2. Why it needs that access
 * 3. What remains local
 * 4. What may be sent to AI
 * 5. What is NOT accessed
 */
export const PERMISSION_DESCRIPTIONS: Record<PermissionId, string> = {
  [PermissionIds.SYSTEM]:
    "Observes hardware power status (battery percentage, AC charging), user idle state, workstation lock/unlock, and network connectivity status. Needed to trigger companion reactions (such as low battery warnings or sleepy idle animations). All signals are processed locally on your machine. When AI Context is enabled, basic battery and network status may be summarized for chat. NEVER accesses passwords, system credentials, or hardware serial numbers.",

  [PermissionIds.APPLICATIONS]:
    "Observes the application name of the active foreground window to provide context-aware companion reactions when you switch tasks. Needed to react to work vs entertainment apps. Processed entirely locally. When AI Context is enabled, only the sanitized application name (e.g., 'VS Code') may be included in conversational context. NEVER captures keystrokes, window titles, document text, process memory, or in-app contents.",

  [PermissionIds.FILES]:
    "Observes file creation, modification, and deletion metadata strictly within user-selected directories, plus completed downloads. Needed for companion reactions to finished tasks and downloads. File change detection runs 100% locally. When AI Context is enabled, only brief sanitized filename summaries of recent events can be included. NEVER reads file contents, document text, source code, browser files, or directories outside your configured allowlist.",

  [PermissionIds.NOTIFICATIONS]:
    "Controls PixelPal's presentation of companion speech bubbles and notification alerts. When disabled, companion notification presentation intent is silenced and alerts are suppressed. PixelPal operates strictly on internal presentation intent and NEVER intercepts, scrapes, or reads external operating system notifications from other applications.",

  [PermissionIds.SCREEN_TIME]:
    "Tracks continuous active workstation session duration to provide healthy break and posture reminders. Needed to trigger screen-time awareness reactions. Stored and calculated strictly locally. When AI Context is enabled, inactive/active duration estimates may be summarized. NEVER uploads continuous usage telemetry or transmits minute-by-minute activity logs.",

  [PermissionIds.AI_CONTEXT]:
    "Controls whether approved, sanitized desktop awareness signals may be included in conversations with the AI companion. Needed to allow PixelPal to reference your current state (e.g., low battery) during conversation. When disabled, ZERO desktop context leaves your device and conversation runs without any desktop awareness. NEVER grants access to new signals—only gates already-approved local signals.",
} as const;

/**
 * Canonical default privacy permission configuration.
 * Privacy-First defaults:
 * - AI_CONTEXT is disabled by default (zero desktop data leaves device until opted in).
 * - FILES allowedPaths is empty by default (requires explicit user folder selection).
 * - Content access (file reading, email reading, keystrokes, clipboard, process memory) is permanently absent.
 */
export const DEFAULT_PERMISSIONS_CONFIG: PermissionConfig = {
  schemaVersion: 1,
  updatedAt: 0,
  permissions: {
    [PermissionIds.SYSTEM]: {
      id: PermissionIds.SYSTEM,
      name: "System & Hardware Awareness",
      enabled: true,
      description: PERMISSION_DESCRIPTIONS[PermissionIds.SYSTEM],
    },
    [PermissionIds.APPLICATIONS]: {
      id: PermissionIds.APPLICATIONS,
      name: "Application Activity",
      enabled: true,
      description: PERMISSION_DESCRIPTIONS[PermissionIds.APPLICATIONS],
    },
    [PermissionIds.FILES]: {
      id: PermissionIds.FILES,
      name: "Filesystem & Downloads",
      enabled: true,
      description: PERMISSION_DESCRIPTIONS[PermissionIds.FILES],
      scope: {
        allowedPaths: [],
      },
    },
    [PermissionIds.NOTIFICATIONS]: {
      id: PermissionIds.NOTIFICATIONS,
      name: "Companion Notifications",
      enabled: true,
      description: PERMISSION_DESCRIPTIONS[PermissionIds.NOTIFICATIONS],
    },
    [PermissionIds.SCREEN_TIME]: {
      id: PermissionIds.SCREEN_TIME,
      name: "Screen Time & Session Tracking",
      enabled: true,
      description: PERMISSION_DESCRIPTIONS[PermissionIds.SCREEN_TIME],
    },
    [PermissionIds.AI_CONTEXT]: {
      id: PermissionIds.AI_CONTEXT,
      name: "AI Desktop Context Sharing",
      enabled: false, // Strictly false by default for user privacy
      description: PERMISSION_DESCRIPTIONS[PermissionIds.AI_CONTEXT],
    },
  },
};
