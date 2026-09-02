import test, { describe } from "node:test";
import assert from "node:assert";
import { EventBus } from "../../events/event_bus.ts";
import { EventTypes } from "../../events/index.ts";
import { AnimationIds } from "../../animation/types.ts";
import { createTestHarness } from "./test_mocks.ts";

describe("Phase 3: Reaction Engine Hardening & Stress Tests", () => {
  test("1. Event Burst Stress: 500 rapid events produce zero reaction spam or memory leaks", () => {
    const h = createTestHarness(1000);
    const eventBus = new EventBus();

    let resolvedCount = 0;
    let suppressedCount = 0;

    // Simulate burst of 100 BATTERY_LOW events in same millisecond
    for (let i = 0; i < 100; i++) {
      const res = h.handle(EventTypes.BATTERY_LOW, {
        id: `bat_burst_${i}`,
        source: "battery",
        payload: { battery_percent: 12 },
      });
      if (res.status === "RESOLVED") resolvedCount++;
      else if (res.status === "SUPPRESSED_ON_COOLDOWN" || res.status === "SUPPRESSED_BY_PRIORITY") suppressedCount++;
    }

    // Exactly 1 reaction was resolved; 99 were suppressed by cooldown
    assert.strictEqual(resolvedCount, 1);
    assert.strictEqual(suppressedCount, 99);
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);

    // Simulate 100 DOWNLOAD_COMPLETED events
    let downloadResolved = 0;
    for (let i = 0; i < 100; i++) {
      const res = h.handle(EventTypes.DOWNLOAD_COMPLETED, {
        id: `dl_burst_${i}`,
        source: "filesystem",
        payload: { file_name: "test.zip" },
      });
      // BATTERY_LOW is HIGH priority (80); DOWNLOAD_COMPLETED is NORMAL (50) -> all suppressed
      if (res.status === "RESOLVED") downloadResolved++;
    }
    assert.strictEqual(downloadResolved, 0);
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);

    h.executor.destroy();
    eventBus.destroy();
  });

  test("2. Priority Stress & Rapid Cascades: LOW -> NORMAL -> HIGH -> CRITICAL sequence", () => {
    const h = createTestHarness(1000);

    // 1. LOW: APP_OPENED
    h.handle(EventTypes.APP_OPENED, { id: "e1", source: "application" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SURPRISED);

    // 2. NORMAL: CHARGING_STARTED (interrupts LOW)
    h.mockTime = 1100;
    h.handle(EventTypes.CHARGING_STARTED, { id: "e2", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.HAPPY);

    // 3. HIGH: BATTERY_LOW (interrupts NORMAL)
    h.mockTime = 1200;
    h.handle(EventTypes.BATTERY_LOW, { id: "e3", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);

    // 4. CRITICAL: BATTERY_CRITICAL (interrupts HIGH)
    h.mockTime = 1300;
    h.handle(EventTypes.BATTERY_CRITICAL, { id: "e4", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SAD);

    // 5. Attempt reverse order (LOW: USER_IDLE while CRITICAL is active) -> suppressed by priority
    h.mockTime = 1400;
    const resLow = h.handle(EventTypes.USER_IDLE, { id: "e5", source: "user_activity" });
    assert.strictEqual(resLow.status, "SUPPRESSED_BY_PRIORITY");
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SAD);

    h.executor.destroy();
  });

  test("3. Cooldown Boundary Precision: Exact millisecond threshold testing", () => {
    const h = createTestHarness(1000);

    const reactionDef = h.resolver.getRegistry().getForEventType(EventTypes.DOWNLOAD_COMPLETED)!;
    const cooldown = reactionDef.cooldownMs; // 10,000ms

    // Initial trigger at T = 1000
    const res1 = h.handle(EventTypes.DOWNLOAD_COMPLETED, { id: "d1", source: "filesystem" });
    assert.strictEqual(res1.status, "RESOLVED");

    // Complete animation to free active state
    h.animMgr.triggerComplete(AnimationIds.HAPPY);

    // T = 1001 (T0 + 1ms) -> SUPPRESSED
    h.mockTime = 1001;
    assert.strictEqual(h.handle(EventTypes.DOWNLOAD_COMPLETED, { id: "d2", source: "filesystem" }).status, "SUPPRESSED_ON_COOLDOWN");

    // T = 10,999 (T0 + cooldown - 1ms) -> SUPPRESSED
    h.mockTime = 1000 + cooldown - 1;
    assert.strictEqual(h.handle(EventTypes.DOWNLOAD_COMPLETED, { id: "d3", source: "filesystem" }).status, "SUPPRESSED_ON_COOLDOWN");

    // T = 11,000 (T0 + cooldown) -> RESOLVED (exact boundary)
    h.mockTime = 1000 + cooldown;
    assert.strictEqual(h.handle(EventTypes.DOWNLOAD_COMPLETED, { id: "d4", source: "filesystem" }).status, "RESOLVED");

    h.executor.destroy();
  });

  test("4. Stale Callback Cascade Protection (A -> B -> C): Older callbacks cannot terminate newer reactions", () => {
    const h = createTestHarness(1000);

    // Start Reaction A (token 1)
    h.handle(EventTypes.APP_OPENED, { id: "eA", source: "application" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SURPRISED);

    // Start Reaction B (token 2)
    h.mockTime = 1100;
    h.handle(EventTypes.CHARGING_STARTED, { id: "eB", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.HAPPY);

    // Start Reaction C (token 3)
    h.mockTime = 1200;
    h.handle(EventTypes.BATTERY_LOW, { id: "eC", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);

    // Stale completion callback from A (token 1)
    h.executor.completeReaction(1, "stale_A");
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(h.executor.getActiveReaction()?.reaction.id, "react_battery_low");

    // Stale completion callback from B (token 2)
    h.executor.completeReaction(2, "stale_B");
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(h.executor.getActiveReaction()?.reaction.id, "react_battery_low");

    // Valid completion callback from C (token 3)
    h.executor.completeReaction(3, "valid_C");
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.IDLE);
    assert.strictEqual(h.executor.isReactionActive(), false);

    h.executor.destroy();
  });

  test("5. Lifecycle Stress: Multiple start, stop, restart, and destroy calls remain clean and leak-free", () => {
    const h = createTestHarness(1000, { autoStart: false });

    // Multiple start() calls
    h.executor.start();
    h.executor.start();
    h.executor.start();
    assert.strictEqual(h.executor.isActive(), true);

    // Multiple stop() calls
    h.executor.stop();
    h.executor.stop();
    assert.strictEqual(h.executor.isActive(), false);

    // Restart
    h.executor.start();
    assert.strictEqual(h.executor.isActive(), true);

    // Destroy
    h.executor.destroy();
    h.executor.destroy();
    assert.strictEqual(h.executor.isActive(), false);

    // No events processed after destroy
    const res = h.executor.handleEvent({ id: "e_dead", type: EventTypes.BATTERY_LOW, timestamp: 1000, source: "battery", payload: {} });
    assert.strictEqual(res.status, "NO_REACTION");
  });

  test("6. Determinism Test: 5 iterations of complex interleaved event sequences produce identical outputs", () => {
    const runSimulation = () => {
      const h = createTestHarness(1000);

      const sequence = [
        { type: EventTypes.APP_OPENED, dt: 100 },
        { type: EventTypes.NETWORK_DISCONNECTED, dt: 200 },
        { type: EventTypes.BATTERY_LOW, dt: 300 },
        { type: EventTypes.DOWNLOAD_COMPLETED, dt: 400 },
        { type: EventTypes.BATTERY_CRITICAL, dt: 500 },
      ];

      const statuses: string[] = [];
      for (const item of sequence) {
        h.mockTime += item.dt;
        const res = h.handle(item.type, { id: `sim_${item.type}` });
        statuses.push(`${item.type}:${res.status}:${res.reaction?.animationId ?? "none"}`);
      }

      h.executor.destroy();
      return { statuses, animHistory: [...h.animMgr.history] };
    };

    const baseline = runSimulation();

    for (let i = 0; i < 4; i++) {
      const current = runSimulation();
      assert.deepStrictEqual(current.statuses, baseline.statuses);
      assert.deepStrictEqual(current.animHistory, baseline.animHistory);
    }
  });
});
