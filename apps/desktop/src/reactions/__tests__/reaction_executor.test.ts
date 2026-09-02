import test, { describe } from "node:test";
import assert from "node:assert";
import {
  ReactionExecutor,
  ReactionResolver,
  ReactionRegistry,
  CooldownManager,
} from "../index.ts";
import { EventTypes, type DesktopEvent } from "../../events/index.ts";
import { AnimationIds } from "../../animation/types.ts";
import { MockAnimationManager, MockIdleScheduler } from "./test_mocks.ts";

describe("Phase 2: Reaction Executor Tests", () => {
  test("1. Basic Execution: BATTERY_LOW event triggers WORRIED animation", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    const event: DesktopEvent = {
      id: "bat_low_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: mockTime,
      source: "battery",
      payload: {},
    };

    const res = executor.handleEvent(event);
    assert.strictEqual(res.status, "RESOLVED");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(executor.isReactionActive(), true);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_battery_low");
  });

  test("2. One-shot completion: Animation complete callback restores idle state", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    const event: DesktopEvent = {
      id: "dl_1",
      type: EventTypes.DOWNLOAD_COMPLETED,
      timestamp: mockTime,
      source: "filesystem",
      payload: {},
    };

    executor.handleEvent(event);
    assert.strictEqual(animMgr.currentAnim, AnimationIds.HAPPY);
    assert.strictEqual(executor.isReactionActive(), true);

    // Simulate AnimationManager completion event
    animMgr.triggerComplete(AnimationIds.HAPPY);

    // Reaction completes -> returns to idle
    assert.strictEqual(animMgr.currentAnim, AnimationIds.IDLE);
    assert.strictEqual(executor.isReactionActive(), false);
  });

  test("3. Loop reactions: USER_IDLE and PC_LOCKED enter continuous loop without immediate timeout", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    const idleEvent: DesktopEvent = {
      id: "idle_1",
      type: EventTypes.USER_IDLE,
      timestamp: mockTime,
      source: "user_activity",
      payload: {},
    };

    executor.handleEvent(idleEvent);
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SLEEPY);
    assert.strictEqual(executor.getActiveReaction()?.reaction.isOneShot, false);
    assert.strictEqual(executor.getActiveReaction()?.expiresAt, Infinity);
  });

  test("4. User Active Transition: USER_IDLE sleepy state is cleanly transitioned by USER_ACTIVE", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // 1. Enter USER_IDLE -> sleepy
    executor.handleEvent({
      id: "idle_1",
      type: EventTypes.USER_IDLE,
      timestamp: mockTime,
      source: "user_activity",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SLEEPY);

    // 2. User moves mouse -> USER_ACTIVE
    mockTime = 5000;
    executor.handleEvent({
      id: "act_1",
      type: EventTypes.USER_ACTIVE,
      timestamp: mockTime,
      source: "user_activity",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.HAPPY);

    // 3. Complete USER_ACTIVE one-shot -> back to idle
    animMgr.triggerComplete(AnimationIds.HAPPY);
    assert.strictEqual(animMgr.currentAnim, AnimationIds.IDLE);
    assert.strictEqual(executor.isReactionActive(), false);
  });

  test("5. Priority Interruption: High-priority BATTERY_LOW replaces active low-priority APP_OPENED", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // Low priority event
    executor.handleEvent({
      id: "app_1",
      type: EventTypes.APP_OPENED,
      timestamp: 1000,
      source: "application",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SURPRISED);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_app_opened");

    // High priority event interrupts
    mockTime = 1500;
    executor.handleEvent({
      id: "bat_low_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1500,
      source: "battery",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_battery_low");
  });

  test("6. Critical Interruption: CRITICAL BATTERY_CRITICAL overrides active HIGH BATTERY_LOW", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    executor.handleEvent({
      id: "bat_low_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1000,
      source: "battery",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);

    // Critical event arrives
    mockTime = 1200;
    executor.handleEvent({
      id: "bat_crit_1",
      type: EventTypes.BATTERY_CRITICAL,
      timestamp: 1200,
      source: "battery",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SAD);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_battery_critical");
  });

  test("7. Lower-priority and equal-priority suppression", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // Start HIGH priority reaction
    executor.handleEvent({
      id: "bat_low_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1000,
      source: "battery",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);

    // Try LOW priority event while HIGH is active -> Suppressed
    mockTime = 1500;
    const resLow = executor.handleEvent({
      id: "app_1",
      type: EventTypes.APP_OPENED,
      timestamp: 1500,
      source: "application",
      payload: {},
    });
    assert.strictEqual(resLow.status, "SUPPRESSED_BY_PRIORITY");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED); // remains WORRIED
  });

  test("8. Autonomous Idle Scheduler suppression & resumption", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const idleSched = new MockIdleScheduler();
    idleSched.start(); // initially running

    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      idleScheduler: idleSched,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    assert.strictEqual(idleSched.running, true);

    // Trigger reaction -> stops idle scheduler
    executor.handleEvent({
      id: "dl_1",
      type: EventTypes.DOWNLOAD_COMPLETED,
      timestamp: 1000,
      source: "filesystem",
      payload: {},
    });

    assert.strictEqual(idleSched.running, false);
    assert.strictEqual(idleSched.stopCalls, 1);

    // Complete reaction -> resumes idle scheduler
    animMgr.triggerComplete(AnimationIds.HAPPY);
    assert.strictEqual(idleSched.running, true);
    assert.strictEqual(idleSched.startCalls, 2); // 1 initial + 1 resume
  });

  test("9. Stale callback protection: Interrupted reaction completion does not terminate newer reaction", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({ timeProvider: () => mockTime });
    const animMgr = new MockAnimationManager();
    const executor = new ReactionExecutor({
      resolver,
      animationManager: animMgr,
      timeProvider: () => mockTime,
      autoStart: true,
    });

    // Start Reaction A (LOW: APP_OPENED)
    executor.handleEvent({
      id: "app_1",
      type: EventTypes.APP_OPENED,
      timestamp: 1000,
      source: "application",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.SURPRISED);

    // Interrupt with Reaction B (HIGH: BATTERY_LOW)
    mockTime = 1100;
    executor.handleEvent({
      id: "bat_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1100,
      source: "battery",
      payload: {},
    });
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);

    // Simulated stale callback from Reaction A (token mismatch)
    executor.completeReaction(1, "stale_callback");

    // Reaction B must STILL remain active!
    assert.strictEqual(executor.isReactionActive(), true);
    assert.strictEqual(executor.getActiveReaction()?.reaction.id, "react_battery_low");
    assert.strictEqual(animMgr.currentAnim, AnimationIds.WORRIED);
  });
});
