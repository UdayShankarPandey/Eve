import test, { describe } from "node:test";
import assert from "node:assert";
import {
  AnimationIds,
  CORE_ANIMATIONS,
  DEFAULT_ANIMATION_MANIFEST,
  AnimationRegistry,
  AnimationResolutionError,
  validateAnimationDefinition,
  validateManifest,
  globalAnimationRegistry,
} from "../index.ts";

describe("Phase 1: Animation Foundation & Asset System", () => {
  test("1. All six required animation IDs exist and match canonical names", () => {
    const required = ["idle", "happy", "sad", "sleepy", "worried", "surprised"] as const;
    assert.strictEqual(AnimationIds.IDLE, "idle");
    assert.strictEqual(AnimationIds.HAPPY, "happy");
    assert.strictEqual(AnimationIds.SAD, "sad");
    assert.strictEqual(AnimationIds.SLEEPY, "sleepy");
    assert.strictEqual(AnimationIds.WORRIED, "worried");
    assert.strictEqual(AnimationIds.SURPRISED, "surprised");

    for (const id of required) {
      assert.ok(
        Object.values(AnimationIds).includes(id),
        `AnimationIds must include '${id}'`
      );
    }
  });

  test("2. All six required definitions exist in the manifest and registry", () => {
    const required = ["idle", "happy", "sad", "sleepy", "worried", "surprised"] as const;
    const registry = new AnimationRegistry(DEFAULT_ANIMATION_MANIFEST);

    for (const id of required) {
      assert.ok(id in CORE_ANIMATIONS, `CORE_ANIMATIONS missing '${id}'`);
      assert.ok(registry.has(id), `Registry missing '${id}'`);
      const def = registry.get(id);
      assert.ok(def, `Registry get('${id}') returned undefined`);
      assert.strictEqual(def.id, id);
    }
  });

  test("3. Required metadata for all six animations is valid", () => {
    for (const [id, def] of Object.entries(CORE_ANIMATIONS)) {
      const result = validateAnimationDefinition(def, `Animation[${id}]`);
      assert.ok(
        result.valid,
        `Validation failed for ${id}: ${result.errors.join(", ")}`
      );
      assert.strictEqual(result.errors.length, 0);

      // Verify specific metadata constraints
      assert.strictEqual(def.frameCount, 4);
      assert.ok(def.fps >= 2 && def.fps <= 6);
      assert.ok(def.durationMs > 0);
      assert.strictEqual(def.frameDimensions.width, 64);
      assert.strictEqual(def.frameDimensions.height, 64);
      assert.ok(
        def.loopMode === "loop" || def.loopMode === "one-shot",
        `Unexpected loopMode: ${def.loopMode}`
      );
    }
  });

  test("4. Default manifest passes full validation", () => {
    const result = validateManifest(DEFAULT_ANIMATION_MANIFEST);
    assert.ok(result.valid, `Manifest errors: ${result.errors.join(", ")}`);
    assert.strictEqual(result.errors.length, 0);
  });

  test("5. Asset paths and resolution logic point to valid locations", () => {
    const registry = new AnimationRegistry();
    for (const id of Object.values(AnimationIds)) {
      const resolved = registry.resolve(id);
      assert.strictEqual(resolved.resolvedFromFallback, false);
      assert.strictEqual(resolved.definition.id, id);
      assert.ok(resolved.definition.assetPath.endsWith(".svg"));
      assert.ok(resolved.definition.assetPath.startsWith("/assets/sprites/"));
    }
  });

  test("6. Unknown animation ID falls back safely to 'idle'", () => {
    const registry = new AnimationRegistry();
    const resolved = registry.resolve("non_existent_animation");

    assert.strictEqual(resolved.resolvedFromFallback, true);
    assert.strictEqual(resolved.requestedId, "non_existent_animation");
    assert.strictEqual(resolved.definition.id, "idle");
    assert.ok(resolved.fallbackReason?.includes("not found"));
  });

  test("7. Custom fallback is respected when specified", () => {
    const customManifest = {
      ...DEFAULT_ANIMATION_MANIFEST,
      animations: {
        ...CORE_ANIMATIONS,
        special_dance: {
          id: "special_dance",
          name: "Special Dance",
          assetPath: "/assets/sprites/placeholder/dance.svg",
          frameCount: 4,
          frameDimensions: { width: 64, height: 64 },
          fps: 0, // INVALID on purpose
          durationMs: 1000,
          loopMode: "loop" as const,
          fallbackId: "happy",
        },
      },
    };

    const registry = new AnimationRegistry(customManifest);
    const resolved = registry.resolve("special_dance");

    assert.strictEqual(resolved.resolvedFromFallback, true);
    assert.strictEqual(resolved.definition.id, "happy");
  });

  test("8. Invalid metadata is rejected by validator", () => {
    // Missing id
    const res1 = validateAnimationDefinition({
      name: "Bad",
      assetPath: "/path",
      frameCount: 4,
      fps: 4,
      durationMs: 1000,
      loopMode: "loop",
      frameDimensions: { width: 64, height: 64 },
    });
    assert.strictEqual(res1.valid, false);
    assert.ok(res1.errors.some((e) => e.includes("'id' must be a non-empty string")));

    // Zero FPS
    const res2 = validateAnimationDefinition({
      id: "bad_fps",
      name: "Bad FPS",
      assetPath: "/path",
      frameCount: 4,
      fps: 0,
      durationMs: 1000,
      loopMode: "loop",
      frameDimensions: { width: 64, height: 64 },
    });
    assert.strictEqual(res2.valid, false);
    assert.ok(res2.errors.some((e) => e.includes("'fps' must be a positive number")));

    // Negative frame count
    const res3 = validateAnimationDefinition({
      id: "bad_frames",
      name: "Bad Frames",
      assetPath: "/path",
      frameCount: -1,
      fps: 4,
      durationMs: 1000,
      loopMode: "loop",
      frameDimensions: { width: 64, height: 64 },
    });
    assert.strictEqual(res3.valid, false);
    assert.ok(res3.errors.some((e) => e.includes("'frameCount' must be a positive integer")));

    // Invalid loopMode
    const res4 = validateAnimationDefinition({
      id: "bad_loop",
      name: "Bad Loop",
      assetPath: "/path",
      frameCount: 4,
      fps: 4,
      durationMs: 1000,
      loopMode: "invalid-mode" as any,
      frameDimensions: { width: 64, height: 64 },
    });
    assert.strictEqual(res4.valid, false);
    assert.ok(res4.errors.some((e) => e.includes("'loopMode' must be one of")));
  });

  test("9. Critical failure handling when even fallback is missing", () => {
    const corruptManifest = {
      version: "1.0.0",
      characterStyle: "empty",
      defaultAnimationId: "missing_default",
      frameWidth: 64,
      frameHeight: 64,
      animations: {},
    };

    const registry = new AnimationRegistry(corruptManifest);
    assert.throws(
      () => {
        registry.resolve("any_animation");
      },
      (err: unknown) => {
        assert.ok(err instanceof AnimationResolutionError);
        assert.ok(err.message.includes("Critical"));
        return true;
      }
    );
  });

  test("10. Global registry singleton is initialized and consistent", () => {
    assert.ok(globalAnimationRegistry);
    assert.strictEqual(globalAnimationRegistry.getDefaultId(), "idle");
    assert.strictEqual(globalAnimationRegistry.getAll().length, 6);

    const ids = globalAnimationRegistry.getIds();
    assert.deepStrictEqual(
      ids.sort(),
      ["happy", "idle", "sad", "sleepy", "surprised", "worried"].sort()
    );

    const validation = globalAnimationRegistry.validate();
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.errors.length, 0);
  });
});
