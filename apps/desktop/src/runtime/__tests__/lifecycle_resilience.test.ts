/**
 * PixelPal — Runtime Lifecycle & Resilience Tests
 * Sprint 11 Phase 4: Lifecycle State Machine, Partial Init Rollback, Listener Leak Audit
 */

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  RuntimeCoordinator,
  bootstrapRuntime,
  resetRuntimeCoordinator,
  getActiveRuntimeCoordinator,
} from "../runtime.ts";
import { InMemoryPermissionStorageAdapter } from "../../privacy/storage.ts";
import { EventBus } from "../../events/event_bus.ts";
import { EventTypes } from "../../events/types.ts";
import type { DesktopEvent } from "../../../../../packages/shared-types/src/events.ts";
import { AnimationManager } from "../../animation/manager.ts";
import { AutonomousIdleScheduler } from "../../animation/idle.ts";
import { ReactionExecutor } from "../../reactions/reaction_executor.ts";
import { ReactionResolver } from "../../reactions/reaction_resolver.ts";

describe("Sprint 11 Phase 4: Runtime Lifecycle & Resilience", () => {
  beforeEach(() => {
    resetRuntimeCoordinator();
  });

  afterEach(() => {
    resetRuntimeCoordinator();
  });

  // =========================================================================
  // 1. STATE MACHINE & IDEMPOTENCE
  // =========================================================================
  test("1. RuntimeCoordinator state transitions: NEW -> INITIALIZED -> DESTROYED", async () => {
    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      autoStartEventListener: false,
    });

    assert.equal(coordinator.getState(), "NEW");
    assert.equal(coordinator.isReady(), false);

    await coordinator.init();

    assert.equal(coordinator.getState(), "INITIALIZED");
    assert.equal(coordinator.isReady(), true);

    // Repeated init() is idempotent
    await coordinator.init();
    assert.equal(coordinator.getState(), "INITIALIZED");

    coordinator.destroy();

    assert.equal(coordinator.getState(), "DESTROYED");
    assert.equal(coordinator.isReady(), false);

    // Repeated destroy() is safe
    assert.doesNotThrow(() => {
      coordinator.destroy();
    });
    assert.equal(coordinator.getState(), "DESTROYED");

    // Initializing a destroyed instance throws
    await assert.rejects(async () => {
      await coordinator.init();
    }, /Cannot initialize a destroyed RuntimeCoordinator instance/);
  });

  test("2. Concurrent calls to init() return the same initialization promise", async () => {
    let syncCallCount = 0;
    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async (cmd) => {
        if (cmd === "update_detector_config") {
          syncCallCount++;
          await new Promise((r) => setTimeout(r, 20));
        }
        return {};
      },
      autoStartEventListener: false,
    });

    // Launch multiple init calls concurrently
    await Promise.all([
      coordinator.init(),
      coordinator.init(),
      coordinator.init(),
    ]);

    assert.equal(coordinator.getState(), "INITIALIZED");
    assert.equal(syncCallCount, 1, "Native sync must only execute once across concurrent inits");
  });

  // =========================================================================
  // 2. PARTIAL INITIALIZATION FAILURE & ROLLBACK
  // =========================================================================
  test("3. Partial initialization failure during native sync cleans up acquired resources", async () => {
    const customEventBus = new EventBus();
    const initialSubscriberCount = customEventBus.getSubscriberCount();

    const coordinator = new RuntimeCoordinator({
      eventBus: customEventBus,
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async (cmd) => {
        if (cmd === "update_detector_config") {
          throw new Error("Simulated native IPC failure during startup");
        }
        return {};
      },
      autoStartEventListener: false,
    });

    await assert.rejects(async () => {
      await coordinator.init();
    }, /Simulated native IPC failure during startup/);

    // Coordinator must be rolled back to DESTROYED
    assert.equal(coordinator.getState(), "DESTROYED");
    assert.equal(coordinator.isReady(), false);

    // EventBus subscriber count must return to baseline (ReactionExecutor was cleaned up)
    assert.equal(
      customEventBus.getSubscriberCount(),
      initialSubscriberCount,
      "Subscribers added before failure must be cleanly removed on rollback"
    );
  });

  test("4. Partial initialization failure during event listener attachment rolls back", async () => {
    const customEventBus = new EventBus();
    const initialSubscriberCount = customEventBus.getSubscriberCount();

    const coordinator = new RuntimeCoordinator({
      eventBus: customEventBus,
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      listenFn: async () => {
        throw new Error("Simulated Tauri listen permission error");
      },
      autoStartEventListener: true,
    });

    await assert.rejects(async () => {
      await coordinator.init();
    }, /Simulated Tauri listen permission error/);

    assert.equal(coordinator.getState(), "DESTROYED");
    assert.equal(customEventBus.getSubscriberCount(), initialSubscriberCount);
  });

  test("5. bootstrapRuntime() discards failed coordinator and allows fresh bootstrap", async () => {
    let failFirst = true;

    const options = {
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error("First bootstrap attempt failed");
        }
        return {};
      },
      autoStartEventListener: false,
    };

    // First attempt fails
    await assert.rejects(async () => {
      await bootstrapRuntime(options);
    }, /First bootstrap attempt failed/);

    assert.equal(getActiveRuntimeCoordinator(), undefined, "Failed instance must not be registered as active");

    // Second attempt succeeds cleanly
    const instance = await bootstrapRuntime(options);
    assert.ok(instance);
    assert.equal(instance.getState(), "INITIALIZED");
    assert.equal(getActiveRuntimeCoordinator(), instance);
  });

  // =========================================================================
  // 3. LISTENER & SUBSCRIBER LEAK AUDIT
  // =========================================================================
  test("6. EventBus subscriber count returns to baseline on coordinator destroy", async () => {
    const testBus = new EventBus();
    const baselineSubscribers = testBus.getSubscriberCount();

    const coordinator = new RuntimeCoordinator({
      eventBus: testBus,
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      autoStartEventListener: false,
    });

    await coordinator.init();
    assert.ok(testBus.getSubscriberCount() > baselineSubscribers, "Subscriptions should be active when initialized");

    coordinator.destroy();
    assert.equal(
      testBus.getSubscriberCount(),
      baselineSubscribers,
      "Subscriber count must return exactly to baseline after destroy()"
    );
  });

  test("7. Repeated bootstrap -> destroy cycles do not accumulate EventBus subscriptions", async () => {
    const testBus = new EventBus();
    const baselineSubscribers = testBus.getSubscriberCount();

    for (let i = 0; i < 5; i++) {
      const coord = await bootstrapRuntime({
        eventBus: testBus,
        permissionStorage: new InMemoryPermissionStorageAdapter(),
        invokeFn: async () => ({}),
        autoStartEventListener: false,
      });

      assert.equal(coord.getState(), "INITIALIZED");
      resetRuntimeCoordinator();

      assert.equal(
        testBus.getSubscriberCount(),
        baselineSubscribers,
        `Cycle ${i + 1}: Subscriber count must return to baseline after reset`
      );
    }
  });

  test("8. Tauri unlisten is invoked on destroy, and late events are safely dropped", async () => {
    let unlistenCalled = false;
    let registeredHandler: ((event: { payload: DesktopEvent }) => void) | null = null;

    const coordinator = new RuntimeCoordinator({
      permissionStorage: new InMemoryPermissionStorageAdapter(),
      invokeFn: async () => ({}),
      listenFn: async (_event, handler) => {
        registeredHandler = handler;
        return () => {
          unlistenCalled = true;
        };
      },
      autoStartEventListener: true,
    });

    await coordinator.init();
    assert.ok(registeredHandler !== null);
    assert.equal(unlistenCalled, false);

    coordinator.destroy();
    assert.equal(unlistenCalled, true, "Unlisten function must be called when coordinator is destroyed");

    // Simulate late native event arriving after destroy
    let eventPublished = false;
    coordinator.getEventBus().subscribe("*", () => {
      eventPublished = true;
    });

    assert.doesNotThrow(() => {
      registeredHandler!({
        payload: {
          id: "late_1",
          type: EventTypes.BATTERY_LOW,
          timestamp: Date.now(),
          source: "battery",
          payload: { percent: 15 },
        },
      });
    });

    assert.equal(eventPublished, false, "Late events after destroy must be dropped safely");
  });

  // =========================================================================
  // 4. REACTION & ANIMATION LIFECYCLE
  // =========================================================================
  test("9. ReactionExecutor start is idempotent and destroy cleans up all subscriptions and timers", () => {
    const eventBus = new EventBus();
    const animManager = new AnimationManager({ timingMode: "manual" });
    const resolver = new ReactionResolver();

    const baselineBusSubs = eventBus.getSubscriberCount();

    const executor = new ReactionExecutor({
      eventBus,
      animationManager: animManager,
      resolver,
      autoStart: false,
    });

    // Start
    executor.start();
    const activeSubs = eventBus.getSubscriberCount();
    assert.equal(activeSubs, baselineBusSubs + 1);

    // Second start call is idempotent
    executor.start();
    assert.equal(eventBus.getSubscriberCount(), activeSubs, "Duplicate start() must not add duplicate subscriber");

    // Destroy
    executor.destroy();
    assert.equal(eventBus.getSubscriberCount(), baselineBusSubs, "Destroy must remove EventBus subscriber");
  });

  test("10. AnimationManager and AutonomousIdleScheduler lifecycle cleanup", () => {
    const animManager = new AnimationManager({ timingMode: "timer" });
    animManager.play();
    assert.equal(animManager.isPlaying(), true);

    const idleScheduler = new AutonomousIdleScheduler(animManager, {
      minIntervalMs: 500,
      maxIntervalMs: 1000,
      autoStart: true,
    });

    assert.equal(idleScheduler.isActive(), true);

    // Stop and pause
    idleScheduler.pause();
    assert.equal(idleScheduler.isActive(), false);
    idleScheduler.resume();
    assert.equal(idleScheduler.isActive(), true);

    // Destroy both
    idleScheduler.destroy();
    animManager.destroy();

    assert.equal(idleScheduler.isActive(), false);
    assert.equal(animManager.isPlaying(), false);
  });
});
