import test, { describe, mock } from "node:test";
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

  test("5. IDLE-01: Yawn action triggers SLEEPY, automatically restores configured default animation after 1200ms, and resumes", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const manager = new AnimationManager({ timingMode: "manual" });
      const scheduler = new AutonomousIdleScheduler(manager);

      scheduler.start();
      assert.strictEqual(manager.isIdle(), true);

      // Trigger yawn -> character enters SLEEPY
      scheduler.trigger("yawn");
      assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.SLEEPY);
      assert.strictEqual(scheduler.getCurrentAction()?.type, "yawn");

      // Advance 1200ms duration
      mock.timers.tick(1200);

      // Character must automatically restore configured default animation (IDLE)
      assert.strictEqual(manager.getCurrentAnimation().id, manager.getDefaultAnimationId());
      assert.strictEqual(manager.isIdle(), true);
      assert.strictEqual(scheduler.getCurrentAction(), null);

      // Scheduler must resume and schedule future autonomous actions
      assert.strictEqual(scheduler.isScheduled(), true);

      scheduler.destroy();
      manager.destroy();
    } finally {
      mock.timers.reset();
    }
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

  test("8. IDLE-01 Stale callback protection: Newer reaction during yawn is NOT overwritten by expired yawn timer", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const manager = new AnimationManager({ timingMode: "manual" });
      const scheduler = new AutonomousIdleScheduler(manager);

      scheduler.start();
      scheduler.trigger("yawn");
      assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.SLEEPY);

      // Advance 400ms into the yawn
      mock.timers.tick(400);

      // An incoming reaction (e.g. BATTERY_LOW -> WORRIED) takes over animation
      manager.setAnimation(AnimationIds.WORRIED);
      assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.WORRIED);

      // Advance remaining 800ms so the original yawn timer expires
      mock.timers.tick(800);

      // The stale yawn timer MUST NOT overwrite the active reaction with default idle
      assert.strictEqual(
        manager.getCurrentAnimation().id,
        AnimationIds.WORRIED,
        "Stale yawn callback must not overwrite active reaction animation"
      );

      scheduler.destroy();
      manager.destroy();
    } finally {
      mock.timers.reset();
    }
  });

  test("9. IDLE-01: pause(), stop(), and destroy() prevent yawn completion side effects", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const manager = new AnimationManager({ timingMode: "manual" });

      // Case A: pause() cancels yawn side effects
      const schedulerA = new AutonomousIdleScheduler(manager);
      schedulerA.start();
      schedulerA.trigger("yawn");
      assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.SLEEPY);
      schedulerA.pause();
      assert.strictEqual(schedulerA.getCurrentAction(), null);
      mock.timers.tick(1200);
      assert.strictEqual(schedulerA.isActive(), false);
      schedulerA.destroy();

      // Case B: stop() cancels yawn side effects
      manager.setAnimation(AnimationIds.IDLE);
      const schedulerB = new AutonomousIdleScheduler(manager);
      schedulerB.start();
      schedulerB.trigger("yawn");
      schedulerB.stop();
      assert.strictEqual(schedulerB.getCurrentAction(), null);
      mock.timers.tick(1200);
      assert.strictEqual(schedulerB.isActive(), false);
      schedulerB.destroy();

      // Case C: destroy() cleans up active yawn timer
      manager.setAnimation(AnimationIds.IDLE);
      const schedulerC = new AutonomousIdleScheduler(manager);
      schedulerC.start();
      schedulerC.trigger("yawn");
      schedulerC.destroy();
      mock.timers.tick(1200);
      assert.strictEqual(schedulerC.isActive(), false);

      manager.destroy();
    } finally {
      mock.timers.reset();
    }
  });

  test("10. IDLE-01: Repeated yawn cycles do not accumulate timers and consistently restore default animation", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const manager = new AnimationManager({ timingMode: "manual" });
      const scheduler = new AutonomousIdleScheduler(manager);
      scheduler.start();

      for (let i = 0; i < 5; i++) {
        scheduler.trigger("yawn");
        assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.SLEEPY);

        mock.timers.tick(1200);
        assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.IDLE);
        assert.strictEqual(scheduler.getCurrentAction(), null);
      }

      scheduler.destroy();
      manager.destroy();
    } finally {
      mock.timers.reset();
    }
  });
});
