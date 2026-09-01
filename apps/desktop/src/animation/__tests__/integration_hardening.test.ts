import test, { describe } from "node:test";
import assert from "node:assert";
import {
  AnimationManager,
  AnimationIds,
  AutonomousIdleScheduler,
  globalAnimationRegistry,
} from "../index.ts";
import type {
  AnimationDefinition,
  IdleAction,
} from "../index.ts";

describe("Phase 3: Integration & Hardening Tests", () => {
  test("1. End-to-end integration: Manager + Idle Scheduler co-exist smoothly", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const scheduler = new AutonomousIdleScheduler(manager, {
      minIntervalMs: 2000,
      maxIntervalMs: 5000,
    });

    scheduler.start();
    assert.strictEqual(scheduler.isActive(), true);
    assert.strictEqual(manager.isIdle(), true);

    // 1. Autonomous micro-blink occurs
    const blinkAction = scheduler.trigger("blink");
    assert.ok(blinkAction);
    assert.strictEqual(blinkAction.type, "blink");
    assert.strictEqual(manager.isIdle(), true);

    // 2. Incoming high-level reaction (e.g. Battery low -> WORRIED)
    manager.setAnimation(AnimationIds.WORRIED);
    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.WORRIED);
    assert.strictEqual(manager.isOneShotActive(), true);

    // Scheduler automatically pauses during reaction
    assert.strictEqual(scheduler.trigger("look_around"), null);

    // Progress the one-shot reaction through frames 0 -> 1 -> 2 -> 3 -> complete
    manager.step(200); // frame 1
    manager.step(200); // frame 2
    manager.step(200); // frame 3
    manager.step(200); // complete -> return to idle

    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.IDLE);
    assert.strictEqual(manager.isIdle(), true);

    // Now idle actions resume
    const lookAction = scheduler.trigger("look_around");
    assert.ok(lookAction);
    assert.strictEqual(lookAction.type, "look_around");

    scheduler.destroy();
    manager.destroy();
  });

  test("2. Rapid transition stress test: Switching animations rapidly does not leak or desync", () => {
    const manager = new AnimationManager({ timingMode: "manual" });

    const sequence = [
      AnimationIds.HAPPY,
      AnimationIds.SAD,
      AnimationIds.WORRIED,
      AnimationIds.SLEEPY,
      AnimationIds.SURPRISED,
      AnimationIds.IDLE,
    ];

    for (let cycle = 0; cycle < 5; cycle++) {
      for (const animId of sequence) {
        manager.setAnimation(animId);
        assert.strictEqual(manager.getCurrentAnimation().id, animId);
        assert.strictEqual(manager.getCurrentFrame(), 0);
        manager.step(100);
      }
    }

    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.IDLE);
    manager.destroy();
  });

  test("3. Timer cleanup stress test: Starting, pausing, resuming, stopping repeatedly leaves no active timers", () => {
    const manager = new AnimationManager({ timingMode: "timer" });
    const scheduler = new AutonomousIdleScheduler(manager, {
      minIntervalMs: 1000,
      maxIntervalMs: 2000,
    });

    for (let i = 0; i < 10; i++) {
      manager.play();
      scheduler.start();
      manager.pause();
      scheduler.pause();
      manager.resume();
      scheduler.resume();
      manager.stop();
      scheduler.stop();
    }

    assert.strictEqual(manager.isPlaying(), false);
    assert.strictEqual(scheduler.isActive(), false);
    assert.strictEqual(scheduler.isScheduled(), false);

    scheduler.destroy();
    manager.destroy();
  });

  test("4. Fallback resilience: Calling invalid animations in sequence resolves safely without crashing", () => {
    const manager = new AnimationManager({ timingMode: "manual" });

    const invalidIds = ["", "undefined", "null", "unknown_123", "corrupt_data"];
    for (const invalidId of invalidIds) {
      const resolved = manager.setAnimation(invalidId);
      assert.strictEqual(resolved.resolvedFromFallback, true);
      assert.strictEqual(resolved.definition.id, AnimationIds.IDLE);
      assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.IDLE);
    }

    manager.destroy();
  });
});
