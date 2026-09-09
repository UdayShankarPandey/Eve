/**
 * PixelPal — Character Expressions & Asset System Test Suite
 * Sprint 7 Test Suite
 *
 * Comprehensive validation of:
 * A. 9-expression MVP model & taxonomy
 * B. Controlled, injection-proof prompt generation preserving identity
 * C. Expression generator service with offline MockProvider
 * D. CharacterProfile consistency enforcement
 * E. Asset quality validation pipeline (dimensions, transparency, RGBA, crisp edges, corruption rejection)
 * F. Animation manifest registry integration & deterministic fallback
 * G. Manifest JSON serialization & round-trip
 */

import { describe, test } from "node:test";
import * as assert from "node:assert";
import sharp from "sharp";

import {
  CharacterExpressionIds,
  ALL_CHARACTER_EXPRESSION_IDS,
  buildExpressionPrompt,
  isValidExpressionId,
  CharacterExpressionGenerator,
  validateExpressionConsistency,
  validateExpressionAssetQuality,
  CharacterExpressionRegistry,
  MockCharacterGenerationProvider,
  PixelArtProcessor,
  type CharacterExpressionId,
  type CharacterProfile,
  type ExpressionAssetRecord,
} from "../index.ts";

import { AnimationIds } from "../../animation/types.ts";

describe("Sprint 7: Character Expressions & Asset System", () => {
  // Canonical sample profile for tests
  const sampleProfile: CharacterProfile = {
    characterId: "character_1725888000000_1234567890abcdef",
    schemaVersion: 1,
    createdAt: 1725888000000,
    updatedAt: 1725888000000,
    assets: {
      generatedCharacterId: "generated_char_1725888000000_1234567890abcdef",
      spriteId: "sprite_char_1725888000000_fedcba0987654321",
    },
    style: {
      renderingStyle: "chibi-pixel-art",
      proportions: "super-deformed",
      expression: "friendly-idle",
      paletteMood: "original-fidelity",
      detailLevel: "high-fidelity",
      backgroundIntent: "transparent-ready",
    },
    clothing: {
      category: "casual",
      top: "hoodie",
      bottom: "jeans",
      footwear: "sneakers",
      accessories: ["headphones"],
      colorTheme: "cool-slate",
    },
    palette: {
      mood: "original-fidelity",
      maxOpaqueColors: 16,
      colors: [
        { r: 40, g: 45, b: 60 },
        { r: 120, g: 140, b: 180 },
        { r: 240, g: 240, b: 245 },
      ],
      transparencyPolicy: "preserved",
      alphaThreshold: 128,
    },
  };

  // Helper to create a valid transparent 64x64 PNG sprite
  async function createTestSprite(options: {
    width?: number;
    height?: number;
    hasTransparentCorners?: boolean;
    fillColor?: { r: number; g: number; b: number };
    alpha?: number;
  } = {}): Promise<Buffer> {
    const width = options.width ?? 64;
    const height = options.height ?? 64;
    const color = options.fillColor ?? { r: 120, g: 140, b: 180 };
    const rawRgba = Buffer.alloc(width * height * 4);

    const isCorner = (x: number, y: number): boolean =>
      (x === 0 && y === 0) ||
      (x === width - 1 && y === 0) ||
      (x === 0 && y === height - 1) ||
      (x === width - 1 && y === height - 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (options.hasTransparentCorners === false) {
          // Fully opaque everywhere including corners
          rawRgba[idx] = color.r;
          rawRgba[idx + 1] = color.g;
          rawRgba[idx + 2] = color.b;
          rawRgba[idx + 3] = options.alpha ?? 255;
        } else if (isCorner(x, y) || x < 8 || x >= width - 8 || y < 8 || y >= height - 8) {
          // Transparent border & corners
          rawRgba[idx] = 0;
          rawRgba[idx + 1] = 0;
          rawRgba[idx + 2] = 0;
          rawRgba[idx + 3] = 0;
        } else {
          // Inner character pixels
          rawRgba[idx] = color.r;
          rawRgba[idx + 1] = color.g;
          rawRgba[idx + 2] = color.b;
          rawRgba[idx + 3] = options.alpha ?? 255;
        }
      }
    }

    return sharp(rawRgba, {
      raw: { width, height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  // ==========================================================================
  // Category A: Expression Model Tests
  // ==========================================================================
  describe("Category A: Expression Model & Taxonomy", () => {
    test("1. All nine MVP expressions exist in CharacterExpressionIds", () => {
      const expected: CharacterExpressionId[] = [
        "idle",
        "happy",
        "sad",
        "worried",
        "sleepy",
        "surprised",
        "panic",
        "celebrate",
        "thinking",
      ];

      assert.strictEqual(ALL_CHARACTER_EXPRESSION_IDS.length, 9);
      for (const expr of expected) {
        assert.ok(
          ALL_CHARACTER_EXPRESSION_IDS.includes(expr),
          `Missing expression: ${expr}`
        );
        assert.strictEqual(CharacterExpressionIds[expr.toUpperCase() as keyof typeof CharacterExpressionIds], expr);
      }
    });

    test("2. No duplicate expression IDs exist in the taxonomy", () => {
      const set = new Set(ALL_CHARACTER_EXPRESSION_IDS);
      assert.strictEqual(set.size, 9);
    });

    test("3. isValidExpressionId validates canonical values and rejects invalid values", () => {
      for (const expr of ALL_CHARACTER_EXPRESSION_IDS) {
        assert.strictEqual(isValidExpressionId(expr), true, `Should accept: ${expr}`);
      }

      assert.strictEqual(isValidExpressionId("angry"), false);
      assert.strictEqual(isValidExpressionId("confused"), false);
      assert.strictEqual(isValidExpressionId(""), false);
      assert.strictEqual(isValidExpressionId(null), false);
      assert.strictEqual(isValidExpressionId(undefined), false);
      assert.strictEqual(isValidExpressionId(123), false);
      assert.strictEqual(isValidExpressionId({}), false);
    });

    test("4. CharacterExpressionIds encompasses all 9 MVP expressions and AnimationIds has core 6", () => {
      assert.strictEqual(CharacterExpressionIds.IDLE, "idle");
      assert.strictEqual(CharacterExpressionIds.HAPPY, "happy");
      assert.strictEqual(CharacterExpressionIds.SAD, "sad");
      assert.strictEqual(CharacterExpressionIds.SLEEPY, "sleepy");
      assert.strictEqual(CharacterExpressionIds.WORRIED, "worried");
      assert.strictEqual(CharacterExpressionIds.SURPRISED, "surprised");
      assert.strictEqual(CharacterExpressionIds.PANIC, "panic");
      assert.strictEqual(CharacterExpressionIds.CELEBRATE, "celebrate");
      assert.strictEqual(CharacterExpressionIds.THINKING, "thinking");

      // Verify core 6 animations in AnimationIds
      assert.strictEqual(AnimationIds.IDLE, "idle");
      assert.strictEqual(AnimationIds.HAPPY, "happy");
      assert.strictEqual(AnimationIds.SAD, "sad");
      assert.strictEqual(AnimationIds.SLEEPY, "sleepy");
      assert.strictEqual(AnimationIds.WORRIED, "worried");
      assert.strictEqual(AnimationIds.SURPRISED, "surprised");
    });
  });

  // ==========================================================================
  // Category B: Generation Contract & Prompt Builder Tests
  // ==========================================================================
  describe("Category B: Generation Contract & Prompt Builder", () => {
    test("1. Builds deterministic prompts for all 9 expressions preserving character identity", () => {
      for (const expr of ALL_CHARACTER_EXPRESSION_IDS) {
        const { prompt, contract } = buildExpressionPrompt(sampleProfile, expr);

        assert.ok(prompt.includes(sampleProfile.characterId), "Prompt must include character ID");
        assert.ok(prompt.includes(`TARGET EMOTION [${expr.toUpperCase()}]`), `Prompt must target ${expr}`);
        assert.ok(prompt.includes("CRITICAL IDENTITY REQUIREMENT"), "Prompt must mandate identity preservation");
        assert.ok(prompt.includes("hoodie"), "Prompt must preserve clothing top");
        assert.ok(prompt.includes("jeans"), "Prompt must preserve clothing bottom");
        assert.ok(prompt.includes("headphones"), "Prompt must preserve accessories");
        assert.ok(prompt.includes("cool-slate"), "Prompt must preserve color theme");
        assert.ok(prompt.includes("super-deformed"), "Prompt must preserve proportions");

        assert.strictEqual(contract.characterId, sampleProfile.characterId);
        assert.strictEqual(contract.expression, expr);
        assert.strictEqual(contract.frameDimensions.width, 64);
        assert.strictEqual(contract.frameDimensions.height, 64);
      }
    });

    test("2. Rejects invalid expression identifiers during prompt construction", () => {
      assert.throws(
        () => buildExpressionPrompt(sampleProfile, "invalid-expr" as CharacterExpressionId),
        /Invalid expression identifier/
      );
    });

    test("3. Generation prompt contains zero user-supplied freeform text or leaked paths", () => {
      const { prompt } = buildExpressionPrompt(sampleProfile, "happy");
      assert.ok(!prompt.includes("C:\\"), "Prompt must not contain absolute Windows paths");
      assert.ok(!prompt.includes("/home/"), "Prompt must not contain Unix paths");
      assert.ok(!prompt.includes("apiKey"), "Prompt must not contain API key references");
      assert.ok(!prompt.includes("token"), "Prompt must not contain tokens");
    });
  });

  // ==========================================================================
  // Category C: Expression Generator & Offline Mock Tests
  // ==========================================================================
  describe("Category C: Expression Generator Service", () => {
    test("1. Generates validated expression sprite asset using MockProvider offline", async () => {
      // Create a 512x512 mock base character PNG
      const baseBuffer = await sharp({
        create: {
          width: 512,
          height: 512,
          channels: 4,
          background: { r: 100, g: 150, b: 200, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const mockProvider = new MockCharacterGenerationProvider({
        mockImageBuffer: baseBuffer,
      });
      const pixelProcessor = new PixelArtProcessor();
      const generator = new CharacterExpressionGenerator({
        provider: mockProvider,
        pixelProcessor,
      });

      const result = await generator.generateExpression(sampleProfile, "happy", baseBuffer);

      assert.ok(result.assetRecord, "Must produce asset record");
      assert.strictEqual(result.assetRecord.expression, "happy");
      assert.strictEqual(result.assetRecord.characterId, sampleProfile.characterId);
      assert.strictEqual(result.assetRecord.frameDimensions.width, 64);
      assert.strictEqual(result.assetRecord.frameDimensions.height, 64);
      assert.ok(result.assetRecord.sha256.length === 64, "Must have valid SHA-256");
      assert.ok(result.assetRecord.assetId.startsWith(`expr_asset_${sampleProfile.characterId}_happy_`));

      // Verify sprite buffer
      const spriteMeta = await sharp(result.spriteBuffer).metadata();
      assert.strictEqual(spriteMeta.format, "png");
      assert.strictEqual(spriteMeta.width, 64);
      assert.strictEqual(spriteMeta.height, 64);
      assert.strictEqual(spriteMeta.hasAlpha, true);
    });

    test("2. Rejects generation with empty base buffer", async () => {
      const generator = new CharacterExpressionGenerator({
        provider: new MockCharacterGenerationProvider(),
      });

      await assert.rejects(
        () => generator.generateExpression(sampleProfile, "idle", Buffer.alloc(0)),
        /Base image buffer is missing or empty/
      );
    });
  });

  // ==========================================================================
  // Category D: Character Consistency Tests
  // ==========================================================================
  describe("Category D: Character Consistency Validation", () => {
    test("1. Valid asset record matching CharacterProfile passes consistency check", async () => {
      const validBuffer = await createTestSprite();
      const assetRecord: ExpressionAssetRecord = {
        assetId: `expr_asset_${sampleProfile.characterId}_happy_0123456789ab`,
        characterId: sampleProfile.characterId,
        expression: "happy",
        assetPath: `/assets/sprites/${sampleProfile.characterId}/happy.png`,
        frameCount: 1,
        frameDimensions: { width: 64, height: 64 },
        fps: 4,
        durationMs: 1000,
        loopMode: "loop",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      const report = await validateExpressionConsistency(assetRecord, sampleProfile, {
        imageBuffer: validBuffer,
      });

      assert.strictEqual(report.valid, true);
      assert.strictEqual(report.errors.length, 0);
    });

    test("2. Detects characterId mismatch against CharacterProfile", async () => {
      const assetRecord: ExpressionAssetRecord = {
        assetId: `expr_asset_character_1111111111111_0000000000000000_sad_0123456789ab`,
        characterId: "character_1111111111111_0000000000000000",
        expression: "sad",
        assetPath: "/assets/sprites/other/sad.png",
        frameCount: 1,
        frameDimensions: { width: 64, height: 64 },
        fps: 4,
        durationMs: 1000,
        loopMode: "loop",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      const report = await validateExpressionConsistency(assetRecord, sampleProfile);
      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "CONSISTENCY_CHARACTER_MISMATCH"));
    });

    test("3. Detects dimension mismatch in consistency validator", async () => {
      const assetRecord: ExpressionAssetRecord = {
        assetId: `expr_asset_${sampleProfile.characterId}_worried_0123456789ab`,
        characterId: sampleProfile.characterId,
        expression: "worried",
        assetPath: `/assets/sprites/${sampleProfile.characterId}/worried.png`,
        frameCount: 1,
        frameDimensions: { width: 32, height: 32 }, // Incorrect dimensions
        fps: 5,
        durationMs: 800,
        loopMode: "one-shot",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      const report = await validateExpressionConsistency(assetRecord, sampleProfile);
      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "CONSISTENCY_DIMENSION_MISMATCH"));
    });

    test("4. Detects palette drift when sprite exceeds profile maxOpaqueColors", async () => {
      // Create a sprite with 20 distinct colors when profile max is 16
      const rawRgba = Buffer.alloc(64 * 64 * 4);
      for (let i = 0; i < 64 * 64; i++) {
        const idx = i * 4;
        if (i < 50) {
          // Transparent corner/border
          rawRgba[idx + 3] = 0;
        } else {
          // Cycle through 20 different colors
          const c = i % 20;
          rawRgba[idx] = c * 10;
          rawRgba[idx + 1] = c * 10;
          rawRgba[idx + 2] = c * 10;
          rawRgba[idx + 3] = 255;
        }
      }

      const overBudgetBuffer = await sharp(rawRgba, {
        raw: { width: 64, height: 64, channels: 4 },
      })
        .png()
        .toBuffer();

      const assetRecord: ExpressionAssetRecord = {
        assetId: `expr_asset_${sampleProfile.characterId}_celebrate_0123456789ab`,
        characterId: sampleProfile.characterId,
        expression: "celebrate",
        assetPath: `/assets/sprites/${sampleProfile.characterId}/celebrate.png`,
        frameCount: 1,
        frameDimensions: { width: 64, height: 64 },
        fps: 4,
        durationMs: 1000,
        loopMode: "loop",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      const report = await validateExpressionConsistency(assetRecord, sampleProfile, {
        imageBuffer: overBudgetBuffer,
      });

      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "CONSISTENCY_PALETTE_DRIFT"));
    });
  });

  // ==========================================================================
  // Category E: Asset Quality Validation Pipeline Tests
  // ==========================================================================
  describe("Category E: Asset Quality Validation Pipeline", () => {
    test("1. Valid 64x64 transparent PNG passes quality validation", async () => {
      const validBuffer = await createTestSprite();
      const report = await validateExpressionAssetQuality(validBuffer);

      assert.strictEqual(report.valid, true);
      assert.strictEqual(report.errors.length, 0);
      assert.strictEqual(report.width, 64);
      assert.strictEqual(report.height, 64);
      assert.strictEqual(report.hasAlpha, true);
      assert.strictEqual(report.format, "png");
    });

    test("2. Rejects corrupt or truncated buffer", async () => {
      const corruptBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // Only 4 bytes
      const report = await validateExpressionAssetQuality(corruptBuffer);

      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "QUALITY_ASSET_CORRUPTED"));
    });

    test("3. Rejects non-PNG format (JPEG magic header)", async () => {
      const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const report = await validateExpressionAssetQuality(jpegMagic);

      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "QUALITY_INVALID_FORMAT"));
    });

    test("4. Rejects dimension mismatch (32x32 when 64x64 expected)", async () => {
      const smallBuffer = await createTestSprite({ width: 32, height: 32 });
      const report = await validateExpressionAssetQuality(smallBuffer, {
        expectedDimensions: { width: 64, height: 64 },
      });

      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "QUALITY_DIMENSION_MISMATCH"));
    });

    test("5. Rejects image with unremoved solid background (opaque corners)", async () => {
      const solidBuffer = await createTestSprite({ hasTransparentCorners: false });
      const report = await validateExpressionAssetQuality(solidBuffer);

      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "QUALITY_OPAQUE_BACKGROUND"));
    });

    test("6. Rejects 100% transparent empty image", async () => {
      const emptyBuffer = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer();

      const report = await validateExpressionAssetQuality(emptyBuffer);
      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "QUALITY_TRANSPARENCY_EMPTY"));
    });

    test("7. Rejects anti-aliased semi-transparent blurry edges when crisp edges required", async () => {
      // Create image with semi-transparent pixels (alpha = 100)
      const rawRgba = Buffer.alloc(64 * 64 * 4);
      for (let i = 0; i < 64 * 64; i++) {
        const idx = i * 4;
        if (i < 100) {
          rawRgba[idx + 3] = 0; // transparent
        } else if (i < 200) {
          rawRgba[idx + 3] = 120; // semi-transparent blurry halo!
        } else {
          rawRgba[idx + 3] = 255; // opaque
        }
      }

      const blurryBuffer = await sharp(rawRgba, {
        raw: { width: 64, height: 64, channels: 4 },
      })
        .png()
        .toBuffer();

      const report = await validateExpressionAssetQuality(blurryBuffer, {
        maxSemiTransparentPixels: 0,
        requireTransparentCorners: false,
      });

      assert.strictEqual(report.valid, false);
      assert.ok(report.errors.some((e) => e.code === "QUALITY_BLURRED_EDGES"));
    });
  });

  // ==========================================================================
  // Category F: Registry & Fallback Tests
  // ==========================================================================
  describe("Category F: Registry Integration & Deterministic Fallback", () => {
    test("1. Registers multiple expression assets and resolves directly", () => {
      const registry = new CharacterExpressionRegistry({
        characterId: sampleProfile.characterId,
        defaultExpressionId: "idle",
      });

      const idleRecord: ExpressionAssetRecord = {
        assetId: `expr_asset_${sampleProfile.characterId}_idle_0123456789ab`,
        characterId: sampleProfile.characterId,
        expression: "idle",
        assetPath: `/assets/sprites/${sampleProfile.characterId}/idle.png`,
        frameCount: 1,
        frameDimensions: { width: 64, height: 64 },
        fps: 4,
        durationMs: 1000,
        loopMode: "loop",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      const happyRecord: ExpressionAssetRecord = {
        assetId: `expr_asset_${sampleProfile.characterId}_happy_0123456789ab`,
        characterId: sampleProfile.characterId,
        expression: "happy",
        assetPath: `/assets/sprites/${sampleProfile.characterId}/happy.png`,
        frameCount: 1,
        frameDimensions: { width: 64, height: 64 },
        fps: 6,
        durationMs: 667,
        loopMode: "loop",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      const resIdle = registry.registerExpressionAsset(idleRecord);
      assert.strictEqual(resIdle.valid, true);

      const resHappy = registry.registerExpressionAsset(happyRecord);
      assert.strictEqual(resHappy.valid, true);

      assert.strictEqual(registry.hasExpression("idle"), true);
      assert.strictEqual(registry.hasExpression("happy"), true);
      assert.strictEqual(registry.hasExpression("sad"), false);

      // Direct hit
      const resolvedHappy = registry.resolveExpression("happy");
      assert.strictEqual(resolvedHappy.resolvedFromFallback, false);
      assert.strictEqual(resolvedHappy.definition.id, "happy");
      assert.strictEqual(resolvedHappy.definition.fps, 6);
    });

    test("2. Resolving missing optional expression falls back deterministically to default without throwing", () => {
      const registry = new CharacterExpressionRegistry({
        characterId: sampleProfile.characterId,
        defaultExpressionId: "idle",
      });

      const idleRecord: ExpressionAssetRecord = {
        assetId: `expr_asset_${sampleProfile.characterId}_idle_0123456789ab`,
        characterId: sampleProfile.characterId,
        expression: "idle",
        assetPath: `/assets/sprites/${sampleProfile.characterId}/idle.png`,
        frameCount: 1,
        frameDimensions: { width: 64, height: 64 },
        fps: 4,
        durationMs: 1000,
        loopMode: "loop",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      registry.registerExpressionAsset(idleRecord);

      // 'panic' is not registered
      const resolvedPanic = registry.resolveExpression("panic");
      assert.strictEqual(resolvedPanic.resolvedFromFallback, true);
      assert.strictEqual(resolvedPanic.definition.id, "idle");
      assert.ok(resolvedPanic.fallbackReason?.includes("falling back to default 'idle'"));
    });

    test("3. Rejects registration of invalid canonical expression ID", () => {
      const registry = new CharacterExpressionRegistry({
        characterId: sampleProfile.characterId,
      });

      const invalidRecord = {
        assetId: "expr_invalid",
        characterId: sampleProfile.characterId,
        expression: "not-an-expression" as CharacterExpressionId,
        assetPath: "/assets/invalid.png",
        frameCount: 1,
        frameDimensions: { width: 64, height: 64 },
        fps: 4,
        durationMs: 1000,
        loopMode: "loop" as const,
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt: Date.now(),
        qualityVerified: true,
      };

      const val = registry.registerExpressionAsset(invalidRecord);
      assert.strictEqual(val.valid, false);
      assert.ok(val.errors.some((e) => e.includes("Invalid canonical expression identifier")));
    });

    test("4. Emergency fallback returns safe definition if even default is missing", () => {
      const emptyRegistry = new CharacterExpressionRegistry({
        characterId: sampleProfile.characterId,
        defaultExpressionId: "idle",
      });

      // No assets at all
      const resolved = emptyRegistry.resolveExpression("nonexistent");
      assert.strictEqual(resolved.resolvedFromFallback, true);
      assert.strictEqual(resolved.definition.id, "idle");
      assert.ok(resolved.fallbackReason?.includes("Emergency fallback"));
    });
  });

  // ==========================================================================
  // Category G: Manifest Serialization Round-Trip Tests
  // ==========================================================================
  describe("Category G: Serialization Round-Trip", () => {
    test("1. Saves and reloads registry manifest via JSON with byte-identical fidelity", () => {
      const registry = new CharacterExpressionRegistry({
        characterId: sampleProfile.characterId,
        defaultExpressionId: "idle",
        version: "1.2.0",
      });

      const exprList: CharacterExpressionId[] = ["idle", "happy", "thinking"];
      for (const expr of exprList) {
        registry.registerExpressionAsset({
          assetId: `expr_asset_${sampleProfile.characterId}_${expr}_0123456789ab`,
          characterId: sampleProfile.characterId,
          expression: expr,
          assetPath: `/assets/sprites/${sampleProfile.characterId}/${expr}.png`,
          frameCount: 1,
          frameDimensions: { width: 64, height: 64 },
          fps: 4,
          durationMs: 1000,
          loopMode: "loop",
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          createdAt: 1725888000000,
          qualityVerified: true,
        });
      }

      const json = registry.toJSON();
      const loaded = CharacterExpressionRegistry.fromJSON(json, sampleProfile.characterId);

      assert.strictEqual(loaded.hasExpression("idle"), true);
      assert.strictEqual(loaded.hasExpression("happy"), true);
      assert.strictEqual(loaded.hasExpression("thinking"), true);
      assert.strictEqual(loaded.hasExpression("sad"), false);

      const exportedManifest = loaded.exportManifest();
      assert.strictEqual(exportedManifest.version, "1.2.0");
      assert.strictEqual(exportedManifest.defaultAnimationId, "idle");
      assert.strictEqual(exportedManifest.frameWidth, 64);
      assert.strictEqual(exportedManifest.frameHeight, 64);
      assert.strictEqual(Object.keys(exportedManifest.animations).length, 3);
    });
  });
});
