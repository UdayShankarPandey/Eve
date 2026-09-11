/**
 * PixelPal — Production Desktop Runtime Coordinator
 * Sprint 10 Production Wiring Completion
 *
 * Establishes the authoritative runtime service lifecycle:
 * 1. Startup: Instantiates PermissionManager, loads permissions.json, and synchronizes initial native detector config to Rust.
 * 2. Dynamic Sync: Listens to permission changes and updates native detectors in real-time via invoke("update_detector_config").
 * 3. Event Ingestion & Gating: Listens to Tauri "desktop-event" IPC, passes events through EventGate, and dispatches permitted events to globalEventBus.
 * 4. Data Controls: Instantiates DataControlsManager and exposes host-side data deletion / settings reset APIs.
 * 5. AI Conversation Privacy: Configures ConversationManager with PermissionManager to ensure zero-context AI privacy.
 * 6. Singleton Discipline: Provides single authoritative instances across the desktop runtime.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DesktopEvent } from "../../../../packages/shared-types/src/events.ts";
import type {
  PermissionId,
  PermissionConfig,
  PermissionDefinition,
  DataDeletionResult,
} from "../../../../packages/shared-types/src/permissions.ts";
import {
  PermissionManager,
  type PermissionStorageAdapter,
  FileSystemPermissionStorageAdapter,
  EventGate,
  DataControlsManager,
  mapPermissionConfigToDetectorConfig,
} from "../privacy/index.ts";
import { globalEventBus, EventBus } from "../events/event_bus.ts";
import {
  ConversationManager,
  type ConversationStorageAdapter,
  type ConversationLlmProvider,
} from "../conversation/index.ts";
import type { ProfileStorageAdapter } from "../character/profile_storage.ts";
import type { GeneratedStorageAdapter } from "../character/generated_storage.ts";
import type { SpriteStorageAdapter } from "../character/sprite_storage.ts";

/**
 * Type signature for Tauri invoke command function.
 */
export type InvokeCommandFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * Type signature for Tauri event listen function.
 */
export type ListenEventFn = <T>(
  event: string,
  handler: (event: { payload: T }) => void
) => Promise<() => void>;

/**
 * Configuration options for RuntimeCoordinator.
 */
export interface RuntimeCoordinatorOptions {
  /** Optional custom permission storage adapter (defaults to FileSystemPermissionStorageAdapter) */
  permissionStorage?: PermissionStorageAdapter;
  /** Optional custom event bus (defaults to globalEventBus) */
  eventBus?: EventBus;
  /** Optional custom Tauri invoke function (defaults to @tauri-apps/api/core invoke) */
  invokeFn?: InvokeCommandFn;
  /** Optional custom Tauri listen function (defaults to @tauri-apps/api/event listen) */
  listenFn?: ListenEventFn;
  /** Optional custom conversation storage adapter */
  conversationStorage?: ConversationStorageAdapter;
  /** Optional custom conversation LLM provider */
  conversationProvider?: ConversationLlmProvider;
  /** Optional profile storage adapter for data controls */
  profileStorage?: ProfileStorageAdapter;
  /** Optional generated asset storage adapter for data controls */
  generatedStorage?: GeneratedStorageAdapter;
  /** Optional sprite asset storage adapter for data controls */
  spriteStorage?: SpriteStorageAdapter;
  /** Whether to automatically start listening to Tauri "desktop-event" upon init (default: true) */
  autoStartEventListener?: boolean;
}

/**
 * Authoritative production coordinator managing all desktop runtime services.
 */
export class RuntimeCoordinator {
  private readonly permissionManager: PermissionManager;
  private readonly eventGate: EventGate;
  private readonly eventBus: EventBus;
  private readonly dataControls: DataControlsManager;
  private readonly conversationManager: ConversationManager;

  private readonly invokeFn: InvokeCommandFn;
  private readonly listenFn: ListenEventFn;
  private readonly autoStartEventListener: boolean;

  private isInitialized = false;
  private unlistenDesktopEvents?: () => void;

  constructor(options: RuntimeCoordinatorOptions = {}) {
    this.eventBus = options.eventBus ?? globalEventBus;

    // Default invoke/listen to Tauri APIs safely
    this.invokeFn = options.invokeFn ?? (async (cmd, args) => {
      return invoke(cmd, args);
    });

    this.listenFn = options.listenFn ?? (async (event, handler) => {
      return listen(event, handler);
    });

    this.autoStartEventListener = options.autoStartEventListener ?? true;

    // 1. Instantiate PermissionManager with storage adapter
    const permStorage = options.permissionStorage ?? new FileSystemPermissionStorageAdapter();
    this.permissionManager = new PermissionManager({ storage: permStorage });

    // 2. Instantiate EventGate with initial configuration
    this.eventGate = new EventGate(this.permissionManager.getConfig());

    // 3. Instantiate DataControlsManager sharing eventBus and storage
    this.dataControls = new DataControlsManager({
      eventBus: this.eventBus,
      permissionStorage: permStorage,
      profileStorage: options.profileStorage,
      generatedStorage: options.generatedStorage,
      spriteStorage: options.spriteStorage,
    });

    // 4. Instantiate ConversationManager with permission manager reference
    this.conversationManager = new ConversationManager({
      storage: options.conversationStorage,
      provider: options.conversationProvider,
      permissionManager: this.permissionManager,
    });

    // 5. Register permission change listener to keep EventGate and native Rust detectors synchronized
    this.permissionManager.addListener((_updatedDef, fullConfig) => {
      this.eventGate.updateConfig(fullConfig);
      this.syncNativeDetectors(fullConfig).catch((err) => {
        console.error("[RuntimeCoordinator] Failed to sync native detector config on change:", err);
      });
    });
  }

  /**
   * Initializes all runtime services:
   * - Loads persisted permissions.json (or recovers to safe defaults)
   * - Syncs initial detector config to Rust
   * - Starts listening to Tauri "desktop-event" IPC channel
   */
  public async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load persisted permissions from disk
      await this.permissionManager.init();

      // Update EventGate with loaded configuration
      const activeConfig = this.permissionManager.getConfig();
      this.eventGate.updateConfig(activeConfig);

      // Perform initial native detector synchronization to Rust
      await this.syncNativeDetectors(activeConfig);

      // Start listening to Tauri desktop events
      if (this.autoStartEventListener) {
        await this.startEventListener();
      }

      this.isInitialized = true;
    } catch (err) {
      console.error("[RuntimeCoordinator] Error during runtime initialization:", err);
      // Ensure manager remains ready in a safe state
      this.isInitialized = true;
    }
  }

  /**
   * Returns whether the coordinator has completed initialization.
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Starts listening to native "desktop-event" emissions from Tauri.
   */
  public async startEventListener(): Promise<void> {
    if (this.unlistenDesktopEvents) {
      return;
    }

    try {
      this.unlistenDesktopEvents = await this.listenFn<DesktopEvent>("desktop-event", (eventPayload) => {
        this.handleIncomingNativeEvent(eventPayload.payload);
      });
    } catch (err) {
      console.error("[RuntimeCoordinator] Could not attach Tauri 'desktop-event' listener:", err);
    }
  }

  /**
   * Stops listening to native "desktop-event" emissions.
   */
  public stopEventListener(): void {
    if (this.unlistenDesktopEvents) {
      this.unlistenDesktopEvents();
      this.unlistenDesktopEvents = undefined;
    }
  }

  /**
   * Ingests an incoming native event, filtering it through EventGate before publishing to EventBus.
   * Returns true if event was permitted and published, false if suppressed.
   */
  public handleIncomingNativeEvent(event: DesktopEvent): boolean {
    try {
      const isPermitted = this.eventGate.publishIfPermitted(this.eventBus, event);
      return isPermitted;
    } catch (err) {
      console.error("[RuntimeCoordinator] Error processing incoming event through EventGate:", err);
      return false;
    }
  }

  /**
   * Synchronizes active permission settings to the native Rust detector engine via Tauri IPC.
   */
  public async syncNativeDetectors(config?: PermissionConfig): Promise<void> {
    const activeConfig = config ?? this.permissionManager.getConfig();
    const nativeConfig = mapPermissionConfigToDetectorConfig(activeConfig);

    try {
      await this.invokeFn("update_detector_config", { config: nativeConfig });
    } catch (err) {
      console.error("[RuntimeCoordinator] update_detector_config IPC call failed:", err);
    }
  }

  /**
   * Updates a permission setting, persists to disk, and synchronizes to native detectors.
   */
  public async updatePermission(
    id: PermissionId,
    enabled: boolean
  ): Promise<PermissionDefinition> {
    const updated = await this.permissionManager.updatePermission(id, enabled);
    // syncNativeDetectors is also triggered by the change listener; ensure sync completes
    await this.syncNativeDetectors();
    return updated;
  }

  /**
   * Configures allowed file directories for FILES permission and syncs to native detectors.
   */
  public async setAllowedFilePaths(
    paths: readonly string[]
  ): Promise<PermissionDefinition> {
    const updated = await this.permissionManager.setAllowedFilePaths(paths);
    await this.syncNativeDetectors();
    return updated;
  }

  // ==========================================
  // Service Accessors
  // ==========================================

  public getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  public getEventGate(): EventGate {
    return this.eventGate;
  }

  public getEventBus(): EventBus {
    return this.eventBus;
  }

  public getDataControls(): DataControlsManager {
    return this.dataControls;
  }

  public getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  // ==========================================
  // Data Controls APIs (Bridge for Future UI)
  // ==========================================

  public async clearEventHistory(): Promise<DataDeletionResult> {
    return this.dataControls.clearEventHistory();
  }

  public async deleteConversationHistory(): Promise<DataDeletionResult> {
    return this.dataControls.deleteConversationHistory();
  }

  public async deleteCharacter(characterId: string): Promise<DataDeletionResult> {
    return this.dataControls.deleteCharacter(characterId);
  }

  public async resetSettings(): Promise<DataDeletionResult> {
    const result = await this.dataControls.resetSettings();
    await this.syncNativeDetectors();
    return result;
  }
}

// ==========================================
// Singleton Lifecycle Management
// ==========================================

let activeRuntimeCoordinator: RuntimeCoordinator | undefined;

/**
 * Returns the active RuntimeCoordinator singleton instance, if initialized.
 */
export function getActiveRuntimeCoordinator(): RuntimeCoordinator | undefined {
  return activeRuntimeCoordinator;
}

/**
 * Bootstraps and returns the authoritative RuntimeCoordinator singleton instance.
 */
export async function bootstrapRuntime(
  options: RuntimeCoordinatorOptions = {}
): Promise<RuntimeCoordinator> {
  if (!activeRuntimeCoordinator) {
    activeRuntimeCoordinator = new RuntimeCoordinator(options);
    await activeRuntimeCoordinator.init();
  }
  return activeRuntimeCoordinator;
}

/**
 * Resets the runtime singleton (primarily for hermetic testing).
 */
export function resetRuntimeCoordinator(): void {
  if (activeRuntimeCoordinator) {
    activeRuntimeCoordinator.stopEventListener();
    activeRuntimeCoordinator = undefined;
  }
}
