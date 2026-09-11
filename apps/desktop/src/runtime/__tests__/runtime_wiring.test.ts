/**
 * PixelPal — Sprint 10 Production Wiring Tests
 * Verifies runtime bootstrap, native sync, EventGate event path, data controls, and AI privacy.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  RuntimeCoordinator,
  bootstrapRuntime,
  resetRuntimeCoordinator,
} from "../runtime.ts";
import {
  InMemoryPermissionStorageAdapter,
  FileSystemPermissionStorageAdapter,
} from "../../privacy/storage.ts";
import { PermissionIds, DEFAULT_PERMISSIONS_CONFIG } from "../../../../../packages/shared-types/src/permissions.ts";
import type { DesktopEvent } from "../../../../../packages/shared-types/src/events.ts";
import { EventBus } from "../../events/event_bus.ts";
import { EventTypes } from "../../events/types.ts";
import { MockConversationLlmProvider } from "../../conversation/llm_provider.ts";
import { InMemoryConversationStorageAdapter } from "../../conversation/storage.ts";
import { InMemoryProfileStorageAdapter } from "../../character/profile_storage.ts";
import { InMemoryGeneratedStorageAdapter } from "../../character/generated_storage.ts";
import { InMemorySpriteStorageAdapter } from "../../character/sprite_storage.ts";
import type { CharacterProfile } from "../../../../../packages/shared-types/src/character.ts";

function createTestProfile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    schemaVersion: 1,
    characterId: overrides.characterId ?? "character_1740000000000_abcdef12",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    assets: overrides.assets ?? {
      generatedCharacterId: "generated_char_1740000000000_abcdef12",
      spriteId: "sprite_char_1740000000000_abcdef12",
    },
    style: {
      proportions: "standard-mascot",
      renderingStyle: "chibi-pixel-art",
      detailLevel: "simplified-iconic",
      backgroundIntent: "transparent-ready",
    },
    clothing: {
      category: "casual",
      top: "hoodie",
      bottom: "jeans",
      footwear: "sneakers",
      accessory: "glasses",
      colorTheme: "pastel-soft",
    },
    palette: {
      mood: "warm",
      maxOpaqueColors: 16,
      colors: [
        { r: 255, g: 100, b: 50 },
        { r: 0, g: 0, b: 0 },
      ],
      transparencyPolicy: "binary-threshold",
      alphaThreshold: 128,
    },
    ...overrides,
  };
}

describe("Sprint 10 — Production Wiring & Runtime Integration", () => {
  let tempDir: string;
  let testFilePath: string;
  let activeCoordinators: RuntimeCoordinator[] = [];

  beforeEach(() => {
    resetRuntimeCoordinator();
    activeCoordinators = [];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal-runtime-wiring-"));
    testFilePath = path.join(tempDir, "permissions.json");
  });

  afterEach(() => {
    resetRuntimeCoordinator();
    for (const c of activeCoordinators) {
      try {
        c.destroy();
      } catch {
        // Cleanup best effort
      }
    }
    activeCoordinators = [];
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Cleanup best effort
    }
  });

  // =========================================================================
  // TEST A — Runtime Bootstrap
  // =========================================================================
  it("TEST A: Runtime bootstrap instantiates PermissionManager, calls init(), and loads persisted config", async () => {
    // 1. Pre-seed custom permissions file on disk
    const preSeeded = {
      schemaVersion: 1,
      permissions: {
        ...DEFAULT_PERMISSIONS_CONFIG.permissions,
        [PermissionIds.APPLICATIONS]: {
          ...DEFAULT_PERMISSIONS_CONFIG.permissions[PermissionIds.APPLICATIONS],
          enabled: false,
        },
      },
      updatedAt: 123456789,
    };
    fs.writeFileSync(testFilePath, JSON.stringify(preSeeded), "utf-8");

    const storage = new FileSystemPermissionStorageAdapter(testFilePath);
    const coordinator = new RuntimeCoordinator({
      permissionStorage: storage,
      invokeFn: async () => ({}),
      autoStartEventListener: false,
    });

    assert.equal(coordinator.isReady(), false, "Coordinator must not be ready before init()");

    await coordinator.init();

    assert.equal(coordinator.isReady(), true, "Coordinator must be ready after init()");
    const loadedConfig = coordinator.getPermissionManager().getConfig();

    // Verify persisted config was loaded into memory
    assert.equal(
      loadedConfig.permissions[PermissionIds.APPLICATIONS].enabled,
      false,
      "Persisted APPLICATIONS disabled state must be loaded from disk"
    );
    assert.equal(
      loadedConfig.permissions[PermissionIds.SYSTEM].enabled,
      true,
      "Persisted SYSTEM default must be active"
    );
  });

  // =========================================================================
  // TEST B — Native Sync
  // =========================================================================
  it("TEST B: Initial startup sync occurs, and permission change invokes update_detector_config with native mapping", async () => {
    const invokedCommands: Array<{ cmd: string; args?: Record<string, unknown> }> = [];

    const mockInvoke = async (cmd: string, args?: Record<string, unknown>) => {
      invokedCommands.push({ cmd, args });
      return {};
    };

    const storage = new InMemoryPermissionStorageAdapter();
    const coordinator = new RuntimeCoordinator({
      permissionStorage: storage,
      invokeFn: mockInvoke,
      autoStartEventListener: false,
    });

    // 1. Test initial startup sync
    await coordinator.init();

    assert.equal(invokedCommands.length, 1, "Initial sync must invoke exactly one update_detector_config");
    assert.equal(invokedCommands[0].cmd, "update_detector_config");
    const initialConfig = (invokedCommands[0].args as any).config;
    assert.equal(initialConfig.battery_enabled, true, "Battery detector should be initially enabled");
    assert.equal(initialConfig.app_activity_enabled, true, "App detector should be initially enabled");

    // 2. Test permission change triggers update_detector_config
    invokedCommands.length = 0; // reset trace
    await coordinator.updatePermission(PermissionIds.SYSTEM, false);

    assert.ok(invokedCommands.length >= 1, "Permission change must trigger native sync");
    const lastInvocation = invokedCommands[invokedCommands.length - 1];
    assert.equal(lastInvocation.cmd, "update_detector_config");
    const updatedConfig = (lastInvocation.args as any).config;
    assert.equal(updatedConfig.battery_enabled, false, "Native battery detector must be suppressed");
    assert.equal(updatedConfig.user_activity_enabled, false, "Native idle detector must be suppressed");
    assert.equal(updatedConfig.session_enabled, false, "Native session detector must be suppressed");
    assert.equal(updatedConfig.network_enabled, false, "Native network detector must be suppressed");
    assert.equal(updatedConfig.app_activity_enabled, true, "Native app detector remains enabled");
  });

  // =========================================================================
  // TEST C — Event Path (Tauri desktop-event -> EventGate -> EventBus)
  // =========================================================================
  it("TEST C: Ingested native events enter EventGate; prohibited events are dropped; permitted events reach EventBus", async () => {
    let capturedTauriHandler: ((event: { payload: DesktopEvent }) => void) | undefined;

    const mockListen = async <T>(
      eventName: string,
      handler: (event: { payload: T }) => void
    ): Promise<() => void> => {
      if (eventName === "desktop-event") {
        capturedTauriHandler = handler as any;
      }
      return () => {};
    };

    const eventBus = new EventBus();
    const receivedByBus: DesktopEvent[] = [];
    eventBus.subscribe("*", (ev) => {
      receivedByBus.push(ev);
    });

    const storage = new InMemoryPermissionStorageAdapter();
    const coordinator = new RuntimeCoordinator({
      permissionStorage: storage,
      eventBus,
      invokeFn: async () => ({}),
      listenFn: mockListen,
      autoStartEventListener: true,
    });

    await coordinator.init();

    assert.ok(capturedTauriHandler, "RuntimeCoordinator must register a listener for 'desktop-event'");

    // 1. Deliver a permitted event: BATTERY_LOW (SYSTEM is enabled by default)
    const validEvent: DesktopEvent = {
      id: "ev_battery_1",
      type: "BATTERY_LOW",
      timestamp: Date.now(),
      source: "battery",
      payload: { percentage: 15 },
    };

    capturedTauriHandler!({ payload: validEvent });

    assert.equal(receivedByBus.length, 1, "Permitted event must reach EventBus");
    assert.equal(receivedByBus[0].id, "ev_battery_1");

    // 2. Disable SYSTEM permission
    await coordinator.updatePermission(PermissionIds.SYSTEM, false);

    // 3. Deliver another battery event while SYSTEM is disabled
    const prohibitedEvent: DesktopEvent = {
      id: "ev_battery_2",
      type: "BATTERY_LOW",
      timestamp: Date.now(),
      source: "battery",
      payload: { percentage: 10 },
    };

    capturedTauriHandler!({ payload: prohibitedEvent });

    // EventBus count must still be 1 (second event was dropped by EventGate)
    assert.equal(receivedByBus.length, 1, "Prohibited event must be dropped by EventGate and NEVER reach EventBus");
    assert.equal(coordinator.getEventGate().getDroppedEventsCount(), 1, "EventGate must record drop count");
  });

  // =========================================================================
  // TEST D — Data Controls
  // =========================================================================
  it("TEST D: Runtime API exposes data controls; character deletion uses validated profile ownership", async () => {
    const eventBus = new EventBus();
    eventBus.publish({
      id: "ev_test",
      type: "BATTERY_LOW",
      timestamp: Date.now(),
      source: "battery",
      payload: { percentage: 20 },
    });
    assert.equal(eventBus.getHistory().length, 1);

    const profileStorage = new InMemoryProfileStorageAdapter();
    const generatedStorage = new InMemoryGeneratedStorageAdapter();
    const spriteStorage = new InMemorySpriteStorageAdapter();

    // Setup a valid character profile and owned assets
    const charId = "character_1740000000000_abcdef12";
    const genId = "generated_char_1740000000000_abcdef12";
    const sprId = "sprite_char_1740000000000_abcdef12";

    await generatedStorage.save(genId, Buffer.from("dummy_gen_png"));
    await spriteStorage.save(sprId, Buffer.from("dummy_sprite_png"));

    const testProfile = createTestProfile({
      characterId: charId,
      assets: {
        generatedCharacterId: genId,
        spriteId: sprId,
      },
    });
    await profileStorage.save(testProfile);

    // Unrelated character
    const unrelatedCharId = "character_1740000000001_11223344";
    const unrelatedGenId = "generated_char_1740000000001_11223344";
    await generatedStorage.save(unrelatedGenId, Buffer.from("unrelated_gen_png"));
    await profileStorage.save(createTestProfile({ characterId: unrelatedCharId }));

    const coordinator = new RuntimeCoordinator({
      eventBus,
      profileStorage,
      generatedStorage,
      spriteStorage,
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      autoStartEventListener: false,
    });
    await coordinator.init();

    // 1. clearEventHistory()
    const clearResult = await coordinator.clearEventHistory();
    assert.equal(clearResult.success, true);
    assert.equal(eventBus.getHistory().length, 0, "EventBus history must be cleared");

    // 2. deleteCharacter() with path traversal attempt is rejected
    const traversalResult = await coordinator.deleteCharacter("../../../etc/passwd");
    assert.equal(traversalResult.success, false);
    assert.match(traversalResult.error ?? "", /Invalid character ID format/);

    // 3. deleteCharacter() with valid target deletes owned assets and preserves unrelated assets
    const deleteResult = await coordinator.deleteCharacter(charId);
    assert.equal(deleteResult.success, true);
    assert.equal(deleteResult.itemsDeleted, 3, "Target generated asset, sprite asset, and profile must be deleted");

    assert.equal(await generatedStorage.get(genId), null, "Target generated asset must be deleted");
    assert.equal(await spriteStorage.get(sprId), null, "Target sprite asset must be deleted");
    assert.equal(await profileStorage.get(charId), null, "Target profile must be deleted");

    // Unrelated character preserved
    assert.notEqual(await generatedStorage.get(unrelatedGenId), null, "Unrelated asset must be preserved");
    assert.notEqual(await profileStorage.get(unrelatedCharId), null, "Unrelated profile must be preserved");
  });

  // =========================================================================
  // TEST E — Conversation Privacy
  // =========================================================================
  it("TEST E: ConversationManager references PermissionManager; AI_CONTEXT=false produces zero context", async () => {
    const permStorage = new InMemoryPermissionStorageAdapter();
    const capturedRequests: any[] = [];
    const mockProvider = new MockConversationLlmProvider(async (req) => {
      capturedRequests.push(req);
      return {
        replyText: "Hello there!",
        expression: "happy",
        notificationIntensity: "normal",
      };
    });
    const convStorage = new InMemoryConversationStorageAdapter();

    const coordinator = new RuntimeCoordinator({
      permissionStorage: permStorage,
      conversationProvider: mockProvider,
      conversationStorage: convStorage,
      invokeFn: async () => ({}),
      autoStartEventListener: false,
    });
    await coordinator.init();

    const conversationManager = coordinator.getConversationManager();
    assert.ok(conversationManager, "ConversationManager must be instantiated");
    assert.equal(
      conversationManager.getPermissionManager(),
      coordinator.getPermissionManager(),
      "ConversationManager must reference the initialized PermissionManager"
    );

    // AI_CONTEXT is false by default
    assert.equal(coordinator.getPermissionManager().isPermissionEnabled(PermissionIds.AI_CONTEXT), false);

    // Feed desktop context into context manager
    conversationManager.getContextManager().updateState({
      batteryPercent: 75,
      isCharging: true,
      activeAppName: "code.exe",
    });

    // Execute a conversational turn
    await conversationManager.sendMessage("Hello companion");

    // Check what the provider received
    assert.equal(capturedRequests.length, 1);
    const receivedContext = capturedRequests[0].context;

    // AI_CONTEXT=false MUST result in empty approved context object {}
    assert.deepEqual(
      receivedContext,
      {},
      "AI_CONTEXT=false must produce completely empty desktop context {} before provider request"
    );

    // Now enable AI_CONTEXT
    await coordinator.updatePermission(PermissionIds.AI_CONTEXT, true);
    await conversationManager.sendMessage("How is my battery?");

    assert.equal(capturedRequests.length, 2);
    const contextWithAiPermitted = capturedRequests[1].context;
    assert.equal(contextWithAiPermitted.batteryPercent, 75);
    assert.equal(contextWithAiPermitted.isCharging, true);
  });

  // =========================================================================
  // TEST F — Files Scope & Propagation
  // =========================================================================
  it("TEST F: FILES empty scope produces no monitored directories; setting allowed paths propagates to native config", async () => {
    const invokedConfigs: any[] = [];
    const mockInvoke = async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "update_detector_config" && args?.config) {
        invokedConfigs.push(args.config);
      }
      return {};
    };

    const storage = new InMemoryPermissionStorageAdapter();
    const coordinator = new RuntimeCoordinator({
      permissionStorage: storage,
      invokeFn: mockInvoke,
      autoStartEventListener: false,
    });

    await coordinator.init();

    // 1. Initial state: FILES enabled, but allowedPaths is []
    const initialNative = invokedConfigs[invokedConfigs.length - 1];
    assert.equal(initialNative.filesystem_enabled, false, "Filesystem detector must be false when allowedPaths is empty");
    assert.deepEqual(initialNative.monitored_directories, [], "Monitored directories must be empty by default");

    // 2. User configures approved folders
    const approvedFolder = path.resolve(tempDir, "allowed_workspace");
    fs.mkdirSync(approvedFolder, { recursive: true });

    await coordinator.setAllowedFilePaths([approvedFolder]);

    const updatedNative = invokedConfigs[invokedConfigs.length - 1];
    assert.equal(updatedNative.filesystem_enabled, true, "Filesystem detector must be true after configuring paths");
    assert.equal(updatedNative.monitored_directories.length, 1);
    assert.equal(path.normalize(updatedNative.monitored_directories[0]), path.normalize(approvedFolder));

    // 3. User disables FILES permission
    await coordinator.updatePermission(PermissionIds.FILES, false);

    const disabledNative = invokedConfigs[invokedConfigs.length - 1];
    assert.equal(disabledNative.filesystem_enabled, false, "Filesystem detector must be false when FILES is disabled");
    assert.deepEqual(disabledNative.monitored_directories, [], "Monitored directories must be cleared when FILES is disabled");
  });

  // =========================================================================
  // Singleton Bootstrap Test
  // =========================================================================
  it("Singleton discipline: bootstrapRuntime() returns the same instance", async () => {
    const storage = new InMemoryPermissionStorageAdapter();
    const r1 = await bootstrapRuntime({
      permissionStorage: storage,
      invokeFn: async () => ({}),
      autoStartEventListener: false,
    });
    const r2 = await bootstrapRuntime();

    assert.equal(r1, r2, "bootstrapRuntime must return the same singleton instance");
  });

  // =========================================================================
  // TEST G — Live ReactionExecutor & AnimationManager Wiring (RUNT-03 + ANIM-04)
  // =========================================================================
  it("TEST G: Live native event flows through EventGate -> EventBus -> ReactionExecutor -> AnimationManager", async () => {
    let capturedTauriHandler: ((event: { payload: DesktopEvent }) => void) | undefined;
    const mockListen = async <T>(
      eventName: string,
      handler: (event: { payload: T }) => void
    ): Promise<() => void> => {
      if (eventName === "desktop-event") {
        capturedTauriHandler = handler as any;
      }
      return () => {};
    };

    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      listenFn: mockListen,
      autoStartEventListener: true,
    });
    activeCoordinators.push(coordinator);
    await coordinator.init();

    const animManager = coordinator.getAnimationManager();
    const reactionExec = coordinator.getReactionExecutor();
    assert.ok(animManager, "AnimationManager must be owned and accessible");
    assert.ok(reactionExec, "ReactionExecutor must be owned and accessible");

    // Initially idle
    assert.equal(animManager.getCurrentAnimation().id, animManager.getDefaultAnimationId());

    // Deliver a permitted native event (BATTERY_LOW)
    const batteryEvent: DesktopEvent = {
      id: "ev_bat_live",
      type: EventTypes.BATTERY_LOW,
      timestamp: Date.now(),
      source: "battery",
      payload: { percentage: 12 },
    };

    capturedTauriHandler!({ payload: batteryEvent });

    // ReactionExecutor should have received the event and commanded AnimationManager to play "worried"
    assert.equal(
      animManager.getCurrentAnimation().id,
      "worried",
      "Live BATTERY_LOW event must cause AnimationManager to transition to 'worried'"
    );

    // When reaction completes, it must restore dynamic default animation ID (ANIM-04), not hardcoded "idle"
    reactionExec.completeReaction();
    assert.equal(
      animManager.getCurrentAnimation().id,
      animManager.getDefaultAnimationId(),
      "Reaction completion must restore the registry default animation ID"
    );
  });

  // =========================================================================
  // TEST H — Critical Reaction Cooldown Bypass in Live Runtime (REACT-01)
  // =========================================================================
  it("TEST H: BATTERY_CRITICAL bypasses active cooldown and resolves live reaction", async () => {
    let capturedTauriHandler: ((event: { payload: DesktopEvent }) => void) | undefined;
    const mockListen = async <T>(
      eventName: string,
      handler: (event: { payload: T }) => void
    ): Promise<() => void> => {
      if (eventName === "desktop-event") {
        capturedTauriHandler = handler as any;
      }
      return () => {};
    };

    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      listenFn: mockListen,
      autoStartEventListener: true,
    });
    activeCoordinators.push(coordinator);
    await coordinator.init();

    const animManager = coordinator.getAnimationManager();
    const reactionExec = coordinator.getReactionExecutor();

    // 1. Deliver initial BATTERY_CRITICAL
    const critEvent1: DesktopEvent = {
      id: "ev_crit_1",
      type: EventTypes.BATTERY_CRITICAL,
      timestamp: 1000,
      source: "battery",
      payload: { percentage: 3 },
    };
    capturedTauriHandler!({ payload: critEvent1 });

    assert.equal(animManager.getCurrentAnimation().id, "sad");
    reactionExec.completeReaction();

    // Verify cooldown is active
    const resolver = coordinator.getReactionResolver();
    assert.equal(resolver.getCooldownManager().isOnCooldown("react_battery_critical", 2000), true);

    // 2. Deliver second BATTERY_CRITICAL while cooldown is active
    const critEvent2: DesktopEvent = {
      id: "ev_crit_2",
      type: EventTypes.BATTERY_CRITICAL,
      timestamp: 2000,
      source: "battery",
      payload: { percentage: 2 },
    };
    capturedTauriHandler!({ payload: critEvent2 });

    // Critical reaction MUST execute and transition animation, not be suppressed by cooldown
    assert.equal(
      animManager.getCurrentAnimation().id,
      "sad",
      "BATTERY_CRITICAL must bypass cooldown and execute in live runtime"
    );
  });

  // =========================================================================
  // TEST I — Deduplicated Native Sync (RUNT-01)
  // =========================================================================
  it("TEST I: updatePermission() and setAllowedFilePaths() produce exactly ONE native sync call each", async () => {
    let syncCallCount = 0;
    const mockInvoke = async (cmd: string) => {
      if (cmd === "update_detector_config") {
        syncCallCount++;
      }
      return {};
    };

    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: mockInvoke,
      autoStartEventListener: false,
    });
    activeCoordinators.push(coordinator);

    await coordinator.init();
    assert.equal(syncCallCount, 1, "init() must perform exactly 1 initial sync");

    // Test 1: updatePermission produces exactly 1 sync call
    syncCallCount = 0;
    await coordinator.updatePermission(PermissionIds.APPLICATIONS, false);
    assert.equal(
      syncCallCount,
      1,
      "Single updatePermission call must invoke update_detector_config exactly once"
    );

    // Test 2: setAllowedFilePaths produces exactly 1 sync call
    syncCallCount = 0;
    const testFolder = path.resolve(tempDir, "test_scope");
    fs.mkdirSync(testFolder, { recursive: true });
    await coordinator.setAllowedFilePaths([testFolder]);
    assert.equal(
      syncCallCount,
      1,
      "Single setAllowedFilePaths call must invoke update_detector_config exactly once"
    );
  });

  // =========================================================================
  // TEST J — Runtime Lifecycle & Safe Cleanup (destroy)
  // =========================================================================
  it("TEST J: destroy() cleans up listeners and prevents further reaction execution", async () => {
    let unlistenCalled = false;
    let capturedTauriHandler: ((event: { payload: DesktopEvent }) => void) | undefined;
    const mockListen = async <T>(
      eventName: string,
      handler: (event: { payload: T }) => void
    ): Promise<() => void> => {
      if (eventName === "desktop-event") {
        capturedTauriHandler = handler as any;
      }
      return () => {
        unlistenCalled = true;
      };
    };

    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      listenFn: mockListen,
      autoStartEventListener: true,
    });
    await coordinator.init();

    assert.equal(coordinator.isReady(), true);

    await coordinator.destroy();

    assert.equal(coordinator.isReady(), false, "Coordinator must report not ready after destroy");
    assert.equal(unlistenCalled, true, "destroy() must call the unlisten callback from Tauri");
  });

  // =========================================================================
  // TEST K — IPC Schema Completeness (IPC-01)
  // =========================================================================
  it("TEST K: update_detector_config receives complete 13-field native contract", async () => {
    let capturedConfig: any = null;
    const mockInvoke = async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "update_detector_config") {
        capturedConfig = args?.config;
      }
      return {};
    };

    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: mockInvoke,
      autoStartEventListener: false,
    });
    activeCoordinators.push(coordinator);
    await coordinator.init();

    assert.ok(capturedConfig, "Native config must have been passed to invoke");

    const expectedKeys = [
      "battery_enabled",
      "app_activity_enabled",
      "user_activity_enabled",
      "session_enabled",
      "network_enabled",
      "filesystem_enabled",
      "monitored_directories",
      "downloads_enabled",
      "downloads_dir",
      "selected_applications",
      "idle_threshold_ms",
      "screen_time_threshold_ms",
      "screen_time_enabled",
    ];

    for (const key of expectedKeys) {
      assert.ok(
        key in capturedConfig,
        `Expected key '${key}' missing from synchronized detector config`
      );
    }
    assert.equal(typeof capturedConfig.idle_threshold_ms, "number");
    assert.equal(typeof capturedConfig.screen_time_threshold_ms, "number");
    assert.ok(
      capturedConfig.downloads_dir === null || typeof capturedConfig.downloads_dir === "string",
      "downloads_dir must be string or null"
    );
    assert.ok(Array.isArray(capturedConfig.selected_applications));
  });
});
