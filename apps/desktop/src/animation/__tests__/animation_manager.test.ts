import test, { describe } from "node:test";
import assert from "node:assert";
import {
  AnimationManager,
  AnimationIds,
} from "../index.ts";
import type {
  AnimationDefinition,
  AnimationPlaybackState,
} from "../index.ts";

describe("Phase 2: Animation Manager Tests", () => {
  test("1. Initial state defaults to idle at frame 0 and not playing", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    const state = manager.getPlaybackState();

    assert.strictEqual(state.currentAnimation.id, AnimationIds.IDLE);
    assert.strictEqual(state.frameIndex, 0);
    assert.strictEqual(state.isPlaying, false);
    assert.strictEqual(state.isOneShot, false);
    assert.strictEqual(state.cycleCount, 0);
    assert.strictEqual(manager.getCurrentFrame(), 0);
    assert.strictEqual(manager.isIdle(), true);

    manager.destroy();
  });

  test("2. Setting an animation updates active definition and resets frame counters", () => {
    const manager = new AnimationManager({ timingMode: "manual" });

    // Step a bit in idle
    manager.step(300);
    assert.strictEqual(manager.getCurrentFrame(), 1);

    // Switch to happy
    const resolved = manager.setAnimation(AnimationIds.HAPPY);
    assert.strictEqual(resolved.definition.id, AnimationIds.HAPPY);
    assert.strictEqual(resolved.resolvedFromFallback, false);
    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.HAPPY);
    assert.strictEqual(manager.getCurrentFrame(), 0);
    assert.strictEqual(manager.getPlaybackState().cycleCount, 0);

    manager.destroy();
  });

  test("3. Frame progression respects FPS timing accurately", () => {
    // Idle is 4 FPS = 250ms per frame, 4 frames total (0, 1, 2, 3)
    const manager = new AnimationManager({ timingMode: "manual" });
    assert.strictEqual(manager.getCurrentFrame(), 0);

    // Advance 200ms -> still on frame 0
    manager.step(200);
    assert.strictEqual(manager.getCurrentFrame(), 0);

    // Advance another 50ms (total 250ms) -> frame 1
    manager.step(50);
    assert.strictEqual(manager.getCurrentFrame(), 1);

    // Advance 250ms -> frame 2
    manager.step(250);
    assert.strictEqual(manager.getCurrentFrame(), 2);

    // Advance 250ms -> frame 3
    manager.step(250);
    assert.strictEqual(manager.getCurrentFrame(), 3);

    // Advance 250ms -> wraps to frame 0 (loop)
    manager.step(250);
    assert.strictEqual(manager.getCurrentFrame(), 0);
    assert.strictEqual(manager.getPlaybackState().cycleCount, 1);

    manager.destroy();
  });

  test("4. Looping animations loop indefinitely without frame overflow", () => {
    // Happy is 6 FPS = ~166.67ms per frame, 4 frames
    const manager = new AnimationManager({
      initialAnimationId: AnimationIds.HAPPY,
      timingMode: "manual",
    });

    // Advance through 10 full cycles (40 frames = 40 * 166.67ms = ~6667ms)
    for (let i = 0; i < 40; i++) {
      manager.step(167);
    }

    assert.ok(manager.getPlaybackState().cycleCount >= 9);
    assert.ok(manager.getCurrentFrame() >= 0 && manager.getCurrentFrame() < 4);

    manager.destroy();
  });

  test("5. One-shot animations complete and transition back to idle", () => {
    // Worried is 5 FPS = 200ms per frame, 4 frames (0, 1, 2, 3), one-shot, transitionTo: 'idle'
    const manager = new AnimationManager({
      initialAnimationId: AnimationIds.WORRIED,
      timingMode: "manual",
    });

    assert.strictEqual(manager.isOneShotActive(), true);
    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.WORRIED);

    let completedTriggered = false;
    let completedAnimId = "";
    manager.onAnimationComplete((completed: AnimationDefinition) => {
      completedTriggered = true;
      completedAnimId = completed.id;
    });

    // Frame 0 -> 1 (200ms)
    manager.step(200);
    assert.strictEqual(manager.getCurrentFrame(), 1);

    // Frame 1 -> 2 (200ms)
    manager.step(200);
    assert.strictEqual(manager.getCurrentFrame(), 2);

    // Frame 2 -> 3 (200ms)
    manager.step(200);
    assert.strictEqual(manager.getCurrentFrame(), 3);
    assert.strictEqual(completedTriggered, false);

    // Frame 3 -> Completion -> transition to idle (200ms)
    manager.step(200);
    assert.strictEqual(completedTriggered, true);
    assert.strictEqual(completedAnimId, AnimationIds.WORRIED);

    // Now active animation must be returned to idle!
    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.IDLE);
    assert.strictEqual(manager.getCurrentFrame(), 0);
    assert.strictEqual(manager.isOneShotActive(), false);

    manager.destroy();
  });

  test("6. Fallback resolution works seamlessly inside AnimationManager", () => {
    const manager = new AnimationManager({ timingMode: "manual" });

    // Request non-existent animation
    const resolved = manager.setAnimation("non_existent_id");
    assert.strictEqual(resolved.resolvedFromFallback, true);
    assert.strictEqual(resolved.definition.id, AnimationIds.IDLE);
    assert.strictEqual(manager.getCurrentAnimation().id, AnimationIds.IDLE);

    manager.destroy();
  });

  test("7. Listeners receive frame changes and animation changes", () => {
    const manager = new AnimationManager({ timingMode: "manual" });

    const frameEvents: number[] = [];
    const animEvents: string[] = [];
    const stateEvents: AnimationPlaybackState[] = [];

    const unsubFrame = manager.onFrameChange((frame: number) => frameEvents.push(frame));
    const unsubAnim = manager.onAnimationChange((newAnim: AnimationDefinition) => animEvents.push(newAnim.id));
    const unsubState = manager.onStateChange((st: AnimationPlaybackState) => stateEvents.push(st));

    manager.setAnimation(AnimationIds.SAD);
    assert.strictEqual(animEvents.length, 1);
    assert.strictEqual(animEvents[0], AnimationIds.SAD);

    // Advance frames in Sad (3 FPS = 333.3ms)
    manager.step(334);
    assert.ok(frameEvents.includes(1));
    assert.ok(stateEvents.length > 0);

    // Unsubscribe verification
    unsubFrame();
    unsubAnim();
    unsubState();

    const frameCountBefore = frameEvents.length;
    manager.step(334);
    assert.strictEqual(frameEvents.length, frameCountBefore);

    manager.destroy();
  });

  test("8. Play, pause, resume, and stop correctly update playback status", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    assert.strictEqual(manager.isPlaying(), false);

    manager.play();
    assert.strictEqual(manager.isPlaying(), true);

    manager.pause();
    assert.strictEqual(manager.isPlaying(), false);

    manager.resume();
    assert.strictEqual(manager.isPlaying(), true);

    manager.stop();
    assert.strictEqual(manager.isPlaying(), false);

    manager.destroy();
  });

  test("9. Duplicate play() calls do not corrupt state or spawn duplicate loops", () => {
    const manager = new AnimationManager({ timingMode: "timer" });

    manager.play();
    manager.play();
    manager.play();

    assert.strictEqual(manager.isPlaying(), true);
    manager.stop();
    assert.strictEqual(manager.isPlaying(), false);

    manager.destroy();
  });

  test("10. Destroy cleans up all timers and disables further operations", () => {
    const manager = new AnimationManager({ timingMode: "manual" });
    manager.destroy();

    assert.throws(() => {
      manager.play();
    }, /Instance is destroyed/);

    assert.throws(() => {
      manager.setAnimation(AnimationIds.HAPPY);
    }, /Instance is destroyed/);
  });
});
