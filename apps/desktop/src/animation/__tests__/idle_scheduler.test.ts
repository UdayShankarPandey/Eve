import test, { describe } from "node:test";
import assert from "node:assert";
import {
  AnimationManager,
  AnimationIds,
  AutonomousIdleScheduler,
} from "../index.ts";
import type {
  IdleAction,
  IdleActionType,
} from "../index.ts";

describe("Phase 2: Autonomous Idle Scheduler Tests", () => {
  test("1. Initial state starts inactive unless autoStart is true", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const scheduler = new AutonomousIdleScheduler(manager, { autoStart: false });

    assert.strictEqual(scheduler.isActive(), false);
    assert.strictEqual(scheduler.isScheduled(), false);
    assert.strictEqual(scheduler.getCurrentAction(), null);

    scheduler.destroy();
    manager.destroy();
  });

  test("2. Start and stop control lifecycle cleanly", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const scheduler = new AutonomousIdleScheduler(manager, {
      minIntervalMs: 1000,
      maxIntervalMs: 2000,
    });

    scheduler.start();
    assert.strictEqual(scheduler.isActive(), true);
    assert.strictEqual(scheduler.isScheduled(), true);

    scheduler.stop();
    assert.strictEqual(scheduler.isActive(), false);
    assert.strictEqual(scheduler.isScheduled(), false);

    scheduler.destroy();
    manager.destroy();
  });

  test("3. Variable interval calculations fall within configured bounds", () => {
    const manager = new AnimationManager({ timingMode: "manual" });

    // Test with deterministic randomFn returning 0, 0.5, 0.99
    let randVal = 0;
    const scheduler = new AutonomousIdleScheduler(manager, {
      minIntervalMs: 3000,
      maxIntervalMs: 7000,
      randomFn: () => randVal,
    });

    randVal = 0;
    assert.strictEqual(scheduler.getNextIntervalMs(), 3000);

    randVal = 0.5;
    assert.strictEqual(scheduler.getNextIntervalMs(), 5000);

    randVal = 0.99;
    assert.strictEqual(scheduler.getNextIntervalMs(), 6960);

    scheduler.destroy();
    manager.destroy();
  });

  test("4. All four autonomous idle actions can be triggered and notify listeners", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const scheduler = new AutonomousIdleScheduler(manager);

    const receivedActions: IdleAction[] = [];
    scheduler.onAction((act: IdleAction) => receivedActions.push(act));

    const actionsToTest: IdleActionType[] = [
      "blink",
      "subtle_movement",
      "look_around",
      "yawn",
    ];

    for (const actionType of actionsToTest) {
      const action = scheduler.trigger(actionType);
      assert.ok(action, `Trigger for '${actionType}' returned null`);
      assert.strictEqual(action.type, actionType);
      assert.ok(action.durationMs > 0);
      assert.ok(action.description.length > 0);
    }

    assert.strictEqual(receivedActions.length, 4);
    assert.strictEqual(receivedActions[0].type, "blink");
    assert.strictEqual(receivedActions[1].type, "subtle_movement");
    assert.strictEqual(receivedActions[2].type, "look_around");
    assert.strictEqual(receivedActions[3].type, "yawn");

    scheduler.destroy();
    manager.destroy();
  });

  test("5. Yawn action triggers transition to sleepy and returns to idle", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const scheduler = new AutonomousIdleScheduler(manager);

    assert.strictEqual(manager.isIdle(), true);

    scheduler.trigger("yawn");
    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.SLEEPY);

    // Manager can return to idle
    manager.setAnimation(AnimationIds.IDLE);
    assert.strictEqual(manager.isIdle(), true);

    scheduler.destroy();
    manager.destroy();
  });

  test("6. Interruptibility: Idle triggers are rejected when character is in a non-idle state", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const scheduler = new AutonomousIdleScheduler(manager);

    // Set a reaction state (e.g. happy reaction from charging)
    manager.setAnimation(AnimationIds.HAPPY);
    assert.strictEqual(manager.isIdle(), false);

    // Attempting an autonomous idle trigger while in reaction must be rejected!
    const result = scheduler.trigger("blink");
    assert.strictEqual(result, null);

    // Set to a one-shot reaction (worried)
    manager.setAnimation(AnimationIds.WORRIED);
    const result2 = scheduler.trigger("yawn");
    assert.strictEqual(result2, null);

    // When manager returns to idle, idle triggers work again!
    manager.setAnimation(AnimationIds.IDLE);
    const result3 = scheduler.trigger("blink");
    assert.ok(result3 !== null);
    assert.strictEqual(result3.type, "blink");

    scheduler.destroy();
    manager.destroy();
  });

  test("7. Destroying the scheduler cancels all timers and detaches listeners", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const scheduler = new AutonomousIdleScheduler(manager, { autoStart: true });

    assert.strictEqual(scheduler.isActive(), true);

    scheduler.destroy();
    assert.strictEqual(scheduler.isActive(), false);
    assert.strictEqual(scheduler.isScheduled(), false);

    assert.throws(() => {
      scheduler.start();
    }, /Instance is destroyed/);

    assert.throws(() => {
      scheduler.trigger();
    }, /Instance is destroyed/);

    manager.destroy();
  });
});
