import test, { describe } from "node:test";
import assert from "node:assert";
import {
  ReactionExecutor,
  ReactionResolver,
  ReactionRegistry,
  CooldownManager,
  type IAnimationManager,
  type IIdleScheduler,
} from "../index.ts";
import { EventBus } from "../../events/event_bus.ts";
import { EventTypes, type DesktopEvent } from "../../events/index.ts";
import { AnimationIds } from "../../animation/types.ts";

class MockAnimationManager implements IAnimationManager {
  public currentAnim = "idle";
  public playing = false;
  public completeListeners: Set<(anim: any) => void> = new Set();
  public shouldThrow = false;

  setAnimation(id: string, options?: { forceRestart?: boolean }): any {
    if (this.shouldThrow) {
      throw new Error("Mock AnimationManager setAnimation failure");
    }
    this.currentAnim = id;
    return { definition: { id } };
  }

  getCurrentAnimation(): { id: string } {
    return { id: this.currentAnim };
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(animationId?: string): void {
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  onAnimationComplete(listener: (animation: any) => void): () => void {
    this.completeListeners.add(listener);
    return () => this.completeListeners.delete(listener);
  }
}

describe("Phase 2: Reaction Lifecycle & End-to-End Pipeline Tests", () => {
  test("1. End-to-End EventBus Pipeline: Publishing to EventBus triggers ReactionExecutor and updates animation", () => {
    let mockTime = 1000;
    const eventBus = new EventBus();
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();

    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      eventBus,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    assert.strictEqual(animMgr.currentAnim, AnimationIds.IDLE);

    // Publish event via EventBus
    eventBus.publish({
      id: "evt_network_down",
      type: EventTypes.NETWORK_DISCONNECTED,
      timestamp: mockTime,
      source: "network",
      payload: { is_connected: false },
    });

    // EventBus -> ReactionExecutor -> AnimationManager
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(executor.isReactionActive(), true);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_network_disconnected");

    executor.destroy();
    eventBus.destroy();
  });

  test("2. Lifecycle Idempotence: Duplicate start() calls do not spawn multiple subscriptions", () => {
    const eventBus = new EventBus();
    const resolver = new ReactionResolver();
    const animMgr = new MockAnimationManager();

    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      eventBus,
      autoStart: false,
    });

    executor.start();
    executor.start(); // duplicate start

    assert.strictEqual(executor.isActive(), true);

    // Stop and restart
    executor.stop();
    assert.strictEqual(executor.isActive(), false);

    executor.start();
    assert.strictEqual(executor.isActive(), true);

    executor.destroy();
    assert.throws(() => executor.start(), /ReactionExecutor is disposed/);
    eventBus.destroy();
  });

  test("3. Cooldown Commit Integrity: Suppressed events do NOT consume their cooldown", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // Start HIGH priority reaction (BATTERY_LOW)
    executor.handleEvent({
      id: "e_bat",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1000,
      source: "battery",
      payload: {},
    });

    // Attempt LOW priority reaction (APP_OPENED) while HIGH is active -> Suppressed by priority
    mockTime = 1500;
    const res = executor.handleEvent({
      id: "e_app",
      type: EventTypes.APP_OPENED,
      timestamp: 1500,
      source: "application",
      payload: {},
    });
    assert.strictEqual(res.status, "SUPPRESSED_BY_PRIORITY");

    // APP_OPENED must NOT be on cooldown!
    const cooldownMgr = resolver.getCooldownManager();
    assert.strictEqual(cooldownMgr.isOnCooldown("react_app_opened", 1500), false);

    // After BATTERY_LOW completes, APP_OPENED is immediately eligible
    executor.completeReaction();
    mockTime = 5000;
    const res2 = executor.handleEvent({
      id: "e_app_2",
      type: EventTypes.APP_OPENED,
      timestamp: 5000,
      source: "application",
      payload: {},
    });
    assert.strictEqual(res2.status, "RESOLVED");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SURPRISED);
  });

  test("4. Error Isolation: AnimationManager throwing does not crash executor or EventBus", () => {
    let mockTime = 1000;
    const eventBus = new EventBus();
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    animMgr.shouldThrow = true; // simulate animation failure

    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      eventBus,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // Publish event - should not throw unhandled exception
    assert.doesNotThrow(() => {
      eventBus.publish({
        id: "e_test",
        type: EventTypes.CHARGING_STARTED,
        timestamp: mockTime,
        source: "battery",
        payload: {},
      });
    });

    executor.destroy();
    eventBus.destroy();
  });
});
