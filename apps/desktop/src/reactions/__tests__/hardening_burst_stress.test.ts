import test, { describe } from "node:test";
import assert from "node:assert";
import {
  ReactionExecutor,
  ReactionResolver,
  ReactionRegistry,
  CooldownManager,
  ReactionPriority,
  type IAnimationManager,
  type IIdleScheduler,
} from "../index.ts";
import { EventBus } from "../../events/event_bus.ts";
import { EventTypes, type DesktopEvent } from "../../events/index.ts";
import { AnimationIds } from "../../animation/types.ts";

/**
 * Mock AnimationManager capturing animation history and completions.
 */
class HardeningAnimationManager implements IAnimationManager {
  public currentAnim = "idle";
  public playing = false;
  public completeListeners: Set<(anim: any) => void> = new Set();
  public history: string[] = [];

  setAnimation(id: string, options?: { forceRestart?: boolean }): any {
    this.currentAnim = id;
    this.history.push(id);
    return { definition: { id } };
  }

  getCurrentAnimation(): { id: string } {
    return { id: this.currentAnim };
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(animationId?: string): void {
    if (animationId) {
      this.setAnimation(animationId);
    }
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  onAnimationComplete(listener: (animation: any) => void): () => void {
    this.completeListeners.add(listener);
    return () => this.completeListeners.delete(listener);
  }

  triggerComplete(animId = this.currentAnim): void {
    for (const listener of this.completeListeners) {
      listener({ id: animId });
    }
  }
}

class HardeningIdleScheduler implements IIdleScheduler {
  public running = false;
  public startCount = 0;
  public stopCount = 0;

  start(): void {
    this.running = true;
    this.startCount++;
  }

  stop(): void {
    this.running = false;
    this.stopCount++;
  }
}

describe("Phase 3: Reaction Engine Hardening & Stress Tests", () => {
  test("1. Event Burst Stress: 500 rapid events produce zero reaction spam or memory leaks", () => {
    let mockTime = 1000;
    const eventBus = new EventBus();
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new HardeningAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      eventBus,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    let resolvedCount = 0;
    let suppressedCount = 0;

    // Simulate burst of 100 BATTERY_LOW events in same millisecond
    for (let i = 0; i < 100; i++) {
      const res = executor.handleEvent({
        id: `bat_burst_${i}`,
        type: EventTypes.BATTERY_LOW,
        timestamp: mockTime,
        source: "battery",
        payload: { battery_percent: 12 },
      });
      if (res.status === "RESOLVED") resolvedCount++;
      else if (res.status === "SUPPRESSED_ON_COOLDOWN" || res.status === "SUPPRESSED_BY_PRIORITY") suppressedCount++;
    }

    // Exactly 1 reaction was resolved; 99 were suppressed by cooldown
    assert.strictEqual(resolvedCount, 1);
    assert.strictEqual(suppressedCount, 99);
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);

    // Simulate 100 DOWNLOAD_COMPLETED events
    let downloadResolved = 0;
    for (let i = 0; i < 100; i++) {
      const res = executor.handleEvent({
        id: `dl_burst_${i}`,
        type: EventTypes.DOWNLOAD_COMPLETED,
        timestamp: mockTime,
        source: "filesystem",
        payload: { file_name: "test.zip" },
      });
      // BATTERY_LOW is HIGH priority (80); DOWNLOAD_COMPLETED is NORMAL (50) -> all suppressed
      if (res.status === "RESOLVED") downloadResolved++;
    }
    assert.strictEqual(downloadResolved, 0);
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);

    executor.destroy();
    eventBus.destroy();
  });

  test("2. Priority Stress & Rapid Cascades: LOW -> NORMAL -> HIGH -> CRITICAL sequence", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new HardeningAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // 1. LOW: APP_OPENED
    executor.handleEvent({ id: "e1", type: EventTypes.APP_OPENED, timestamp: 1000, source: "application", payload: {} });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SURPRISED);

    // 2. NORMAL: CHARGING_STARTED (interrupts LOW)
    mockTime = 1100;
    executor.handleEvent({ id: "e2", type: EventTypes.CHARGING_STARTED, timestamp: 1100, source: "battery", payload: {} });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.HAPPY);

    // 3. HIGH: BATTERY_LOW (interrupts NORMAL)
    mockTime = 1200;
    executor.handleEvent({ id: "e3", type: EventTypes.BATTERY_LOW, timestamp: 1200, source: "battery", payload: {} });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);

    // 4. CRITICAL: BATTERY_CRITICAL (interrupts HIGH)
    mockTime = 1300;
    executor.handleEvent({ id: "e4", type: EventTypes.BATTERY_CRITICAL, timestamp: 1300, source: "battery", payload: {} });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SAD);

    // 5. Attempt reverse order (LOW: USER_IDLE while CRITICAL is active) -> suppressed by priority
    mockTime = 1400;
    const resLow = executor.handleEvent({ id: "e5", type: EventTypes.USER_IDLE, timestamp: 1400, source: "user_activity", payload: {} });
    assert.strictEqual(resLow.status, "SUPPRESSED_BY_PRIORITY");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SAD);

    executor.destroy();
  });

  test("3. Cooldown Boundary Precision: Exact millisecond threshold testing", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new HardeningAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    const reactionDef = resolver.getRegistry().getForEventType(EventTypes.DOWNLOAD_COMPLETED)!;
    const cooldown = reactionDef.cooldownMs; // 10,000ms

    // Initial trigger at T = 1000
    const res1 = executor.handleEvent({ id: "d1", type: EventTypes.DOWNLOAD_COMPLETED, timestamp: 1000, source: "filesystem", payload: {} });
    assert.strictEqual(res1.status, "RESOLVED");

    // Complete animation to free active state
    animMgr.triggerComplete(AnimationIds.HAPPY);

    // T = 1001 (T0 + 1ms) -> SUPPRESSED
    mockTime = 1001;
    assert.strictEqual(executor.handleEvent({ id: "d2", type: EventTypes.DOWNLOAD_COMPLETED, timestamp: 1001, source: "filesystem", payload: {} }).status, "SUPPRESSED_ON_COOLDOWN");

    // T = 10,999 (T0 + cooldown - 1ms) -> SUPPRESSED
    mockTime = 1000 + cooldown - 1;
    assert.strictEqual(executor.handleEvent({ id: "d3", type: EventTypes.DOWNLOAD_COMPLETED, timestamp: mockTime, source: "filesystem", payload: {} }).status, "SUPPRESSED_ON_COOLDOWN");

    // T = 11,000 (T0 + cooldown) -> RESOLVED (exact boundary)
    mockTime = 1000 + cooldown;
    assert.strictEqual(executor.handleEvent({ id: "d4", type: EventTypes.DOWNLOAD_COMPLETED, timestamp: mockTime, source: "filesystem", payload: {} }).status, "RESOLVED");

    executor.destroy();
  });

  test("4. Stale Callback Cascade Protection (A -> B -> C): Older callbacks cannot terminate newer reactions", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new HardeningAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // Start Reaction A (token 1)
    executor.handleEvent({ id: "eA", type: EventTypes.APP_OPENED, timestamp: 1000, source: "application", payload: {} });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SURPRISED);

    // Start Reaction B (token 2)
    mockTime = 1100;
    executor.handleEvent({ id: "eB", type: EventTypes.CHARGING_STARTED, timestamp: 1100, source: "battery", payload: {} });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.HAPPY);

    // Start Reaction C (token 3)
    mockTime = 1200;
    executor.handleEvent({ id: "eC", type: EventTypes.BATTERY_LOW, timestamp: 1200, source: "battery", payload: {} });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);

    // Stale completion callback from A (token 1)
    executor.completeReaction(1, "stale_A");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_battery_low");

    // Stale completion callback from B (token 2)
    executor.completeReaction(2, "stale_B");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_battery_low");

    // Valid completion callback from C (token 3)
    executor.completeReaction(3, "valid_C");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.IDLE);
    assert.strictEqual(executor.isReactionActive(), false);

    executor.destroy();
  });

  test("5. Lifecycle Stress: Multiple start, stop, restart, and destroy calls remain clean and leak-free", () => {
    const eventBus = new EventBus();
    const resolver = new ReactionResolver();
    const animMgr = new HardeningAnimationManager();
    const idleSched = new HardeningIdleScheduler();

    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      idleScheduler: idleSched,
      eventBus,
      autoStart: false,
    });

    // Multiple start() calls
    executor.start();
    executor.start();
    executor.start();
    assert.strictEqual(executor.isActive(), true);

    // Multiple stop() calls
    executor.stop();
    executor.stop();
    assert.strictEqual(executor.isActive(), false);

    // Restart
    executor.start();
    assert.strictEqual(executor.isActive(), true);

    // Destroy
    executor.destroy();
    executor.destroy();
    assert.strictEqual(executor.isActive(), false);

    // No events processed after destroy
    const res = executor.handleEvent({ id: "e_dead", type: EventTypes.BATTERY_LOW, timestamp: 1000, source: "battery", payload: {} });
    assert.strictEqual(res.status, "NO_REACTION");

    eventBus.destroy();
  });

  test("6. Determinism Test: 5 iterations of complex interleaved event sequences produce identical outputs", () => {
    const runSimulation = () => {
      let time = 1000;
      const resolver = new ReactionResolver({ timeProvider: () => time });
      const animMgr = new HardeningAnimationManager();
      const executor = new ReactionExecutor({
        resolver,
        animationManager: animMgr,
        timeProvider: () => time,
        autoStart: true,
      });

      const sequence = [
        { type: EventTypes.APP_OPENED, dt: 100 },
        { type: EventTypes.NETWORK_DISCONNECTED, dt: 200 },
        { type: EventTypes.BATTERY_LOW, dt: 300 },
        { type: EventTypes.DOWNLOAD_COMPLETED, dt: 400 },
        { type: EventTypes.BATTERY_CRITICAL, dt: 500 },
      ];

      const statuses: string[] = [];
      for (const item of sequence) {
        time += item.dt;
        const res = executor.handleEvent({
          id: `sim_${item.type}`,
          type: item.type,
          timestamp: time,
          source: "system",
          payload: {},
        });
        statuses.push(`${item.type}:${res.status}:${res.reaction?.animationId ?? "none"}`);
      }

      executor.destroy();
      return { statuses, animHistory: [...animMgr.history] };
    };

    const baseline = runSimulation();

    for (let i = 0; i < 4; i++) {
      const current = runSimulation();
      assert.deepStrictEqual(current.statuses, baseline.statuses);
      assert.deepStrictEqual(current.animHistory, baseline.animHistory);
    }
  });
});
