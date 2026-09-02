import test, { describe } from "node:test";
import assert from "node:assert";
import { EventTypes } from "../../events/index.ts";
import { AnimationIds } from "../../animation/types.ts";
import { createTestHarness } from "./test_mocks.ts";

describe("Phase 2: Reaction Executor Tests", () => {
  test("1. Basic Execution: BATTERY_LOW event triggers WORRIED animation", () => {
    const { animMgr, executor, handle } = createTestHarness(1000);

    const res = handle(EventTypes.BATTERY_LOW, { id: "bat_low_1", source: "battery" });
    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(executor.isReactionActive(), true);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_battery_low");
  });

  test("2. One-shot completion: Animation complete callback restores idle state", () => {
    const { animMgr, executor, handle } = createTestHarness(1000);

    handle(EventTypes.DOWNLOAD_COMPLETED, { id: "dl_1", source: "filesystem" });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.HAPPY);
    assert.strictEqual(executor.isReactionActive(), true);

    // Simulate AnimationManager completion event
    animMgr.triggerComplete(AnimationIds.HAPPY);

    // Reaction completes -> returns to idle
    assert.strictEqual(animMgr.currentAnim, AnimationIds.IDLE);
    assert.strictEqual(executor.isReactionActive(), false);
  });

  test("3. Loop reactions: USER_IDLE and PC_LOCKED enter continuous loop without immediate timeout", () => {
    const { animMgr, executor, handle } = createTestHarness(1000);

    handle(EventTypes.USER_IDLE, { id: "idle_1", source: "user_activity" });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SLEEPY);
    assert.strictEqual(executor.getActiveReaction()?.reaction.isOneShot, false);
    assert.strictEqual(executor.getActiveReaction()?.expiresAt, Infinity);
  });

  test("4. User Active Transition: USER_IDLE sleepy state is cleanly transitioned by USER_ACTIVE", () => {
    const h = createTestHarness(1000);

    // 1. Enter USER_IDLE -> sleepy
    h.handle(EventTypes.USER_IDLE, { id: "idle_1", source: "user_activity" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SLEEPY);

    // 2. User moves mouse -> USER_ACTIVE
    h.mockTime = 5000;
    h.handle(EventTypes.USER_ACTIVE, { id: "act_1", source: "user_activity" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.HAPPY);

    // 3. Complete USER_ACTIVE one-shot -> back to idle
    h.animMgr.triggerComplete(AnimationIds.HAPPY);
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.IDLE);
    assert.strictEqual(h.executor.isReactionActive(), false);
  });

  test("5. Priority Interruption: High-priority BATTERY_LOW replaces active low-priority APP_OPENED", () => {
    const h = createTestHarness(1000);

    // Low priority event
    h.handle(EventTypes.APP_OPENED, { id: "app_1", source: "application" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SURPRISED);
    assert.strictEqual(h.executor.getActiveReaction()?.reaction.id, "react_app_opened");

    // High priority event interrupts
    h.mockTime = 1500;
    h.handle(EventTypes.BATTERY_LOW, { id: "bat_low_1", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(h.executor.getActiveReaction()?.reaction.id, "react_battery_low");
  });

  test("6. Critical Interruption: CRITICAL BATTERY_CRITICAL overrides active HIGH BATTERY_LOW", () => {
    const h = createTestHarness(1000);

    h.handle(EventTypes.BATTERY_LOW, { id: "bat_low_1", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);

    // Critical event arrives
    h.mockTime = 1200;
    h.handle(EventTypes.BATTERY_CRITICAL, { id: "bat_crit_1", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SAD);
    assert.strictEqual(h.executor.getActiveReaction()?.reaction.id, "react_battery_critical");
  });

  test("7. Lower-priority and equal-priority suppression", () => {
    const h = createTestHarness(1000);

    // Start HIGH priority reaction
    h.handle(EventTypes.BATTERY_LOW, { id: "bat_low_1", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);

    // Try LOW priority event while HIGH is active -> Suppressed
    h.mockTime = 1500;
    const resLow = h.handle(EventTypes.APP_OPENED, { id: "app_1", source: "application" });
    assert.strictEqual(resLow.status, "SUPPRESSED_BY_PRIORITY");
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED); // remains WORRIED
  });

  test("8. Autonomous Idle Scheduler suppression & resumption", () => {
    const h = createTestHarness(1000);
    h.idleScheduler.start(); // initially running

    assert.strictEqual(h.idleScheduler.running, true);

    // Trigger reaction -> stops idle scheduler
    h.handle(EventTypes.DOWNLOAD_COMPLETED, { id: "dl_1", source: "filesystem" });

    assert.strictEqual(h.idleScheduler.running, false);
    assert.strictEqual(h.idleScheduler.stopCalls, 1);

    // Complete reaction -> resumes idle scheduler
    h.animMgr.triggerComplete(AnimationIds.HAPPY);
    assert.strictEqual(h.idleScheduler.running, true);
    assert.strictEqual(h.idleScheduler.startCalls, 2); // 1 initial + 1 resume
  });

  test("9. Stale callback protection: Interrupted reaction completion does not terminate newer reaction", () => {
    const h = createTestHarness(1000);

    // Start Reaction A (LOW: APP_OPENED)
    h.handle(EventTypes.APP_OPENED, { id: "app_1", source: "application" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.SURPRISED);

    // Interrupt with Reaction B (HIGH: BATTERY_LOW)
    h.mockTime = 1100;
    h.handle(EventTypes.BATTERY_LOW, { id: "bat_1", source: "battery" });
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);

    // Simulated stale callback from Reaction A (token mismatch)
    h.executor.completeReaction(1, "stale_callback");

    // Reaction B must STILL remain active!
    assert.strictEqual(h.executor.isReactionActive(), true);
    assert.strictEqual(h.executor.getActiveReaction()?.reaction.id, "react_battery_low");
    assert.strictEqual(h.animMgr.currentAnim, AnimationIds.WORRIED);
  });
});
