/**
 * PixelPal — Production Desktop Runtime Coordinator
 * Sprint 10 Production Wiring Completion & Sprint 11 Hardening
 *
 * Establishes the authoritative runtime service lifecycle:
 * 1. Startup: Instantiates PermissionManager, loads permissions.json, and synchronizes initial native detector config to Rust.
 * 2. Dynamic Sync: Listens to permission changes and updates native detectors in real-time via invoke("update_detector_config") (single sync trigger).
 * 3. Event Ingestion & Gating: Listens to Tauri "desktop-event" IPC, passes events through EventGate, and dispatches permitted events to globalEventBus.
 * 4. Reaction & Animation Orchestration: Connects live ReactionExecutor and AnimationManager to globalEventBus for real-time companion behavior.
 * 5. Data Controls: Instantiates DataControlsManager and exposes host-side data deletion / settings reset APIs.
 * 6. AI Conversation Privacy: Configures ConversationManager with PermissionManager to ensure zero-context AI privacy.
 * 7. Singleton & Lifecycle Discipline: Provides clean single authoritative instances and hermetic shutdown.
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
import {
  AnimationManager,
  AutonomousIdleScheduler,
} from "../animation/index.ts";
import {
  ReactionExecutor,
  ReactionResolver,
} from "../reactions/index.ts";

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
  /** Optional custom animation manager */
  animationManager?: AnimationManager;
  /** Optional custom autonomous idle scheduler */
  idleScheduler?: AutonomousIdleScheduler;
  /** Optional custom reaction resolver */
  reactionResolver?: ReactionResolver;
  /** Optional custom reaction executor */
  reactionExecutor?: ReactionExecutor;
  /** Whether to automatically start listening to Tauri "desktop-event" upon init (default: true) */
  autoStartEventListener?: boolean;
}

/**
 * Authoritative runtime lifecycle states.
 */
export type RuntimeLifecycleState =
  | "NEW"
  | "INITIALIZING"
  | "INITIALIZED"
  | "DESTROYING"
  | "DESTROYED";

/**
 * Authoritative production coordinator managing all desktop runtime services.
 */
export class RuntimeCoordinator {
  private readonly permissionManager: PermissionManager;
  private readonly eventGate: EventGate;
  private readonly eventBus: EventBus;
  private readonly dataControls: DataControlsManager;
  private readonly conversationManager: ConversationManager;
  private readonly animationManager: AnimationManager;
  private readonly idleScheduler: AutonomousIdleScheduler;
  private readonly reactionResolver: ReactionResolver;
  private readonly reactionExecutor: ReactionExecutor;

  private readonly invokeFn: InvokeCommandFn;
  private readonly listenFn: ListenEventFn;
  private readonly autoStartEventListener: boolean;

  private state: RuntimeLifecycleState = "NEW";
  private initPromise: Promise<void> | null = null;
  private unlistenDesktopEvents?: () => void;
  private unsubscribePermissionListener?: () => void;
  private activeSyncPromise: Promise<void> | null = null;

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

    // 5. Instantiate AnimationManager, AutonomousIdleScheduler, and ReactionExecutor
    this.animationManager =
      options.animationManager ??
      new AnimationManager({
        timingMode: typeof window !== "undefined" ? "raf" : "timer",
      });

    this.idleScheduler =
      options.idleScheduler ??
      new AutonomousIdleScheduler(this.animationManager, {
        autoStart: false,
      });

    this.reactionResolver =
      options.reactionResolver ??
      new ReactionResolver();

    this.reactionExecutor =
      options.reactionExecutor ??
      new ReactionExecutor({
        resolver: this.reactionResolver,
        animationManager: this.animationManager,
        idleScheduler: this.idleScheduler,
        eventBus: this.eventBus,
        autoStart: false,
      });

    // 6. Register permission change listener to keep EventGate and native Rust detectors synchronized (single native-sync trigger)
    this.unsubscribePermissionListener = this.permissionManager.addListener((_updatedDef, fullConfig) => {
      this.eventGate.updateConfig(fullConfig);
      this.activeSyncPromise = this.syncNativeDetectors(fullConfig).catch((err) => {
        console.error("[RuntimeCoordinator] Failed to sync native detector config on change:", err);
      });
    });
  }

  /**
   * Returns the current lifecycle state of the RuntimeCoordinator.
   */
  public getState(): RuntimeLifecycleState {
    return this.state;
  }

  /**
   * Initializes all runtime services:
   * - Loads persisted permissions.json (or recovers to safe defaults)
   * - Syncs initial detector config to Rust
   * - Starts ReactionExecutor on eventBus
   * - Starts listening to Tauri "desktop-event" IPC channel
   *
   * Fully idempotent: multiple concurrent or sequential calls are safe.
   * On any fatal initialization error, rolls back acquired resources and marks state DESTROYED.
   */
  public async init(): Promise<void> {
    if (this.state === "INITIALIZED") {
      return;
    }
    if (this.state === "INITIALIZING" && this.initPromise) {
      return this.initPromise;
    }
    if (this.state === "DESTROYING" || this.state === "DESTROYED") {
      throw new Error("Cannot initialize a destroyed RuntimeCoordinator instance.");
    }

    this.state = "INITIALIZING";

    this.initPromise = (async () => {
      try {
        // Load persisted permissions from disk
        await this.permissionManager.init();

        // Update EventGate with loaded configuration
        const activeConfig = this.permissionManager.getConfig();
        this.eventGate.updateConfig(activeConfig);

        // Perform initial native detector synchronization to Rust
        await this.syncNativeDetectors(activeConfig);

        // Start ReactionExecutor so events reaching EventBus execute reactions
        this.reactionExecutor.start();

        // Start AutonomousIdleScheduler for ambient idle micro-behaviors
        this.idleScheduler.start();

        // Start listening to Tauri desktop events
        if (this.autoStartEventListener) {
          await this.startEventListener();
        }

        // Guard against destroy() called while initialization was in progress
        if (this.state === "DESTROYING" || this.state === "DESTROYED") {
          this.cleanupInternalResources();
          return;
        }

        this.state = "INITIALIZED";
      } catch (err) {
        this.cleanupInternalResources();
        this.state = "DESTROYED";
        throw err;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Returns whether the coordinator has completed initialization.
   */
  public isReady(): boolean {
    return this.state === "INITIALIZED";
  }

  /**
   * Starts listening to native "desktop-event" emissions from Tauri.
   */
  public async startEventListener(): Promise<void> {
    if (this.unlistenDesktopEvents || this.state === "DESTROYING" || this.state === "DESTROYED") {
      return;
    }

    try {
      this.unlistenDesktopEvents = await this.listenFn<DesktopEvent>("desktop-event", (eventPayload) => {
        if (this.state !== "INITIALIZED") {
          return; // Drop events safely if destroyed or destroying
        }
        this.handleIncomingNativeEvent(eventPayload.payload);
      });
    } catch (err) {
      console.error("[RuntimeCoordinator] Could not attach Tauri 'desktop-event' listener:", err);
      throw err;
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
      throw err;
    }
  }

  /**
   * Updates a permission setting, persists to disk, and synchronizes to native detectors.
   * Exactly ONE native detector synchronization is triggered via the change listener.
   */
  public async updatePermission(
    id: PermissionId,
    enabled: boolean
  ): Promise<PermissionDefinition> {
    const updated = await this.permissionManager.updatePermission(id, enabled);
    // syncNativeDetectors is triggered by the PermissionManager change listener (single trigger).
    // Await active sync promise so caller knows native sync completed without duplicating IPC.
    if (this.activeSyncPromise) {
      await this.activeSyncPromise;
    }
    return updated;
  }

  /**
   * Configures allowed file directories for FILES permission and syncs to native detectors.
   */
  public async setAllowedFilePaths(
    paths: readonly string[]
  ): Promise<PermissionDefinition> {
    const updated = await this.permissionManager.setAllowedFilePaths(paths);
    if (this.activeSyncPromise) {
      await this.activeSyncPromise;
    }
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

  public getAnimationManager(): AnimationManager {
    return this.animationManager;
  }

  public getIdleScheduler(): AutonomousIdleScheduler {
    return this.idleScheduler;
  }

  public getReactionExecutor(): ReactionExecutor {
    return this.reactionExecutor;
  }

  public getReactionResolver(): ReactionResolver {
    return this.reactionResolver;
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
    await this.permissionManager.reset();
    if (this.activeSyncPromise) {
      await this.activeSyncPromise;
    }
    return result;
  }

  /**
   * Completely tears down the runtime coordinator, stops event listeners,
   * unsubscribes permission listeners, and destroys active reaction & animation loops.
   * Safe and idempotent across multiple invocations.
   */
  public destroy(): void {
    if (this.state === "DESTROYED" || this.state === "DESTROYING") {
      return;
    }
    this.state = "DESTROYING";
    this.cleanupInternalResources();
    this.state = "DESTROYED";
  }

  /**
   * Internal resource cleanup invoked on destroy() or partial initialization failure.
   */
  private cleanupInternalResources(): void {
    this.stopEventListener();
    if (this.unsubscribePermissionListener) {
      this.unsubscribePermissionListener();
      this.unsubscribePermissionListener = undefined;
    }
    try {
      this.idleScheduler.destroy();
    } catch (err) {
      console.error("[RuntimeCoordinator] Error destroying AutonomousIdleScheduler:", err);
    }
    try {
      this.reactionExecutor.destroy();
    } catch (err) {
      console.error("[RuntimeCoordinator] Error destroying ReactionExecutor:", err);
    }
    try {
      this.animationManager.destroy();
    } catch (err) {
      console.error("[RuntimeCoordinator] Error destroying AnimationManager:", err);
    }
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
 * On initialization failure, ensures partial resources are cleaned up and does not retain broken instance.
 */
export async function bootstrapRuntime(
  options: RuntimeCoordinatorOptions = {}
): Promise<RuntimeCoordinator> {
  if (!activeRuntimeCoordinator || activeRuntimeCoordinator.getState() === "DESTROYED") {
    const coordinator = new RuntimeCoordinator(options);
    try {
      await coordinator.init();
      activeRuntimeCoordinator = coordinator;
    } catch (err) {
      coordinator.destroy();
      activeRuntimeCoordinator = undefined;
      throw err;
    }
  }
  return activeRuntimeCoordinator;
}

/**
 * Resets the runtime singleton and disposes active services (primarily for hermetic testing).
 */
export function resetRuntimeCoordinator(): void {
  if (activeRuntimeCoordinator) {
    activeRuntimeCoordinator.destroy();
    activeRuntimeCoordinator = undefined;
  }
}
