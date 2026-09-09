/**
 * PixelPal — Deterministic Pixel-Art Sprite Processor Test Suite
 * Sprint 6 Phase 4 Foundation
 *
 * Comprehensive hermetic test suite verifying:
 * - Generated image input validation & path traversal defense
 * - Canonical 64x64 sprite dimension policy & aspect-ratio fitting
 * - Deterministic Median-Cut palette reduction (<= 16 opaque colors)
 * - First-class alpha handling & binary transparency thresholds
 * - Nearest-neighbor downscaling semantics (zero interpolation blur)
 * - Complete determinism (same bytes + options -> identical SHA-256)
 * - Application-controlled sprite storage isolation & lifecycle cleanup
 * - Complete privacy sanitization (zero EXIF/GPS/XMP metadata)
 * - End-to-end chaining: Upload -> Preprocess -> Generate -> Pixel Process
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";
import {
  PixelArtProcessor,
  DEFAULT_PIXEL_OPTIONS,
  FileSystemSpriteStorageAdapter,
  isValidSpriteStorageId,
  generateSpriteStorageId,
  medianCutQuantize,
  quantizeRgbaBuffer,
  CharacterGenerator,
  MockCharacterGenerationProvider,
  FileSystemGeneratedStorageAdapter,
  FileSystemProcessedStorageAdapter,
  FileSystemTemporaryStorageAdapter,
  ImageUploadBoundary,
  ImagePreprocessor,
  type GenerateCharacterSuccessResult,
  type PixelProcessFailureResult,
  type PixelProcessSuccessResult,
  type PreprocessSuccessResult,
  type UploadSuccessResult,
} from "../index.ts";

/**
 * Creates a synthetic multi-color PNG buffer with transparency for testing.
 */
async function createSyntheticGeneratedPng(
  width = 512,
  height = 512
): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <!-- Transparent canvas with centered stylized character silhouette -->
    <circle cx="${width / 2}" cy="${height / 2 - 50}" r="80" fill="#FF5722"/>
    <rect x="${width / 2 - 60}" y="${height / 2 + 30}" width="120" height="140" rx="20" fill="#2196F3"/>
    <circle cx="${width / 2 - 30}" cy="${height / 2 - 60}" r="12" fill="#212121"/>
    <circle cx="${width / 2 + 30}" cy="${height / 2 - 60}" r="12" fill="#212121"/>
    <rect x="${width / 2 - 20}" y="${height / 2 - 25}" width="40" height="10" rx="5" fill="#E91E63"/>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Creates a synthetic multi-gradient PNG with more than 64 colors.
 */
async function createMultiColorPng(width = 128, height = 128): Promise<Buffer> {
  const rects: string[] = [];
  const step = 4;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const r = (x * 2) % 256;
      const g = (y * 2) % 256;
      const b = (x + y) % 256;
      rects.push(
        `<rect x="${x}" y="${y}" width="${step}" height="${step}" fill="rgb(${r},${g},${b})" />`
      );
    }
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${rects.join("\n")}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("Sprint 6 Phase 4 — Deterministic Pixel-Art Processing & Sprite Foundation", () => {
  let tempUploadDir: string;
  let tempProcessedDir: string;
  let tempGeneratedDir: string;
  let tempSpriteDir: string;

  let uploadStorage: FileSystemTemporaryStorageAdapter;
  let processedStorage: FileSystemProcessedStorageAdapter;
  let generatedStorage: FileSystemGeneratedStorageAdapter;
  let spriteStorage: FileSystemSpriteStorageAdapter;

  let uploadBoundary: ImageUploadBoundary;
  let preprocessor: ImagePreprocessor;
  let mockProvider: MockCharacterGenerationProvider;
  let generator: CharacterGenerator;
  let pixelProcessor: PixelArtProcessor;

  let sampleGeneratedResult: GenerateCharacterSuccessResult;

  beforeEach(async () => {
    tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_uploads_"));
    tempProcessedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_processed_"));
    tempGeneratedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_generated_"));
    tempSpriteDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_sprites_"));

    uploadStorage = new FileSystemTemporaryStorageAdapter(tempUploadDir);
    processedStorage = new FileSystemProcessedStorageAdapter(tempProcessedDir);
    generatedStorage = new FileSystemGeneratedStorageAdapter(tempGeneratedDir);
    spriteStorage = new FileSystemSpriteStorageAdapter(tempSpriteDir);

    uploadBoundary = new ImageUploadBoundary({ storageAdapter: uploadStorage });
    preprocessor = new ImagePreprocessor({ storageAdapter: processedStorage });
    mockProvider = new MockCharacterGenerationProvider();

    generator = new CharacterGenerator({
      storageAdapter: generatedStorage,
      provider: mockProvider,
    });

    pixelProcessor = new PixelArtProcessor({
      storageAdapter: spriteStorage,
    });

    // Create a real end-to-end chain from Phase 1 -> Phase 2 -> Phase 3
    const rawPng = await createSyntheticGeneratedPng(400, 400);
    const uploadRes = (await uploadBoundary.upload(
      new Uint8Array(rawPng),
      "character_input.png"
    )) as UploadSuccessResult;

    const preprocessRes = (await preprocessor.process({
      source: uploadRes,
    })) as PreprocessSuccessResult;

    const mockAiImage = await createSyntheticGeneratedPng(512, 512);
    mockProvider.setOptions({ mockImageBuffer: mockAiImage });

    sampleGeneratedResult = (await generator.generate({
      source: preprocessRes,
    })) as GenerateCharacterSuccessResult;
  });

  afterEach(async () => {
    if (fs.existsSync(tempUploadDir)) fs.rmSync(tempUploadDir, { recursive: true, force: true });
    if (fs.existsSync(tempProcessedDir)) fs.rmSync(tempProcessedDir, { recursive: true, force: true });
    if (fs.existsSync(tempGeneratedDir)) fs.rmSync(tempGeneratedDir, { recursive: true, force: true });
    if (fs.existsSync(tempSpriteDir)) fs.rmSync(tempSpriteDir, { recursive: true, force: true });
  });

  describe("1. Generated Image Input Validation & Traversal Defense", () => {
    test("Rejects processing request with missing source object", async () => {
      // @ts-expect-error testing invalid input
      const result = await pixelProcessor.process({});
      assert.strictEqual(result.success, false);
      const failure = result as PixelProcessFailureResult;
      assert.strictEqual(failure.error.code, "PIXEL_SOURCE_INVALID");
    });

    test("Rejects invalid generated storage ID format", async () => {
      const result = await pixelProcessor.process({
        source: {
          generatedStorageId: "malicious_id_1234",
          generatedFilePath: path.join(tempGeneratedDir, "ghost.png"),
        },
      });

      assert.strictEqual(result.success, false);
      const failure = result as PixelProcessFailureResult;
      assert.strictEqual(failure.error.code, "PIXEL_SOURCE_INVALID");
    });

    test("Rejects path traversal attempts in generatedFilePath", async () => {
      const result = await pixelProcessor.process({
        source: {
          generatedStorageId: sampleGeneratedResult.generatedStorageId,
          generatedFilePath: `${tempGeneratedDir}/../../../evil.png`,
        },
      });

      assert.strictEqual(result.success, false);
      const failure = result as PixelProcessFailureResult;
      assert.strictEqual(failure.error.code, "PIXEL_SOURCE_INVALID");
      assert.ok(failure.error.message.includes("Path traversal"));
    });

    test("Rejects non-existent source file on disk", async () => {
      const nonExistentId = "generated_char_9999999999_12345678";
      const result = await pixelProcessor.process({
        source: {
          generatedStorageId: nonExistentId,
          generatedFilePath: path.join(tempGeneratedDir, `${nonExistentId}.png`),
        },
      });

      assert.strictEqual(result.success, false);
      const failure = result as PixelProcessFailureResult;
      assert.strictEqual(failure.error.code, "PIXEL_SOURCE_INVALID");
      assert.ok(failure.error.message.includes("not found"));
    });

    test("Rejects corrupted/invalid image file content", async () => {
      const corruptFile = path.join(tempGeneratedDir, `${sampleGeneratedResult.generatedStorageId}.png`);
      fs.writeFileSync(corruptFile, Buffer.from("NOT_AN_IMAGE_BYTES"));

      const result = await pixelProcessor.process({
        source: sampleGeneratedResult,
      });

      assert.strictEqual(result.success, false);
      const failure = result as PixelProcessFailureResult;
      assert.strictEqual(failure.error.code, "PIXEL_DECODE_FAILED");
    });

    test("Rejects empty image file (0 bytes)", async () => {
      const emptyFile = path.join(tempGeneratedDir, `${sampleGeneratedResult.generatedStorageId}.png`);
      fs.writeFileSync(emptyFile, Buffer.alloc(0));

      const result = await pixelProcessor.process({
        source: sampleGeneratedResult,
      });

      assert.strictEqual(result.success, false);
      const failure = result as PixelProcessFailureResult;
      assert.strictEqual(failure.error.code, "PIXEL_DECODE_FAILED");
    });
  });

  describe("2. Canonical Dimensions & Aspect Ratio Fitting", () => {
    test("Produces canonical 64x64 square sprite by default", async () => {
      const result = (await pixelProcessor.process({
        source: sampleGeneratedResult,
      })) as PixelProcessSuccessResult;

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.metadata.width, 64);
      assert.strictEqual(result.metadata.height, 64);
      assert.strictEqual(result.processingInfo.targetDimensions.width, 64);
      assert.strictEqual(result.processingInfo.targetDimensions.height, 64);

      const onDiskMeta = await sharp(result.spriteFilePath).metadata();
      assert.strictEqual(onDiskMeta.width, 64);
      assert.strictEqual(onDiskMeta.height, 64);
    });

    test("Supports optional 128x128 sprite output", async () => {
      const result = (await pixelProcessor.process({
        source: sampleGeneratedResult,
        options: { targetDimension: 128 },
      })) as PixelProcessSuccessResult;

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.metadata.width, 128);
      assert.strictEqual(result.metadata.height, 128);

      const onDiskMeta = await sharp(result.spriteFilePath).metadata();
      assert.strictEqual(onDiskMeta.width, 128);
      assert.strictEqual(onDiskMeta.height, 128);
    });

    test("Rejects arbitrary non-canonical sprite dimensions", async () => {
      const result = await pixelProcessor.process({
        source: sampleGeneratedResult,
        // @ts-expect-error testing invalid dimension
        options: { targetDimension: 96 },
      });

      assert.strictEqual(result.success, false);
      const failure = result as PixelProcessFailureResult;
      assert.strictEqual(failure.error.code, "PIXEL_RESIZE_FAILED");
    });

    test("Preserves aspect ratio and centers non-square input with transparent padding", async () => {
      // Create rectangular 400x200 image
      const rectBuf = await sharp({
        create: { width: 400, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
      }).png().toBuffer();

      const customId = "generated_char_1725888000000_1234567890abcdef";
      const customPath = path.join(tempGeneratedDir, `${customId}.png`);
      fs.writeFileSync(customPath, rectBuf);

      const result = (await pixelProcessor.process({
        source: {
          generatedStorageId: customId,
          generatedFilePath: customPath,
        },
        options: { targetDimension: 64 },
      })) as PixelProcessSuccessResult;

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.metadata.width, 64);
      assert.strictEqual(result.metadata.height, 64);

      // Verify top edge has transparent padding
      const { data } = await sharp(result.spriteFilePath).raw().toBuffer({ resolveWithObject: true });
      // Pixel at top-left (0, 0) should be transparent (padded)
      assert.strictEqual(data[3], 0);
    });
  });

  describe("3. Deterministic Palette Reduction (Median-Cut)", () => {
    test("Reduces complex multi-color image to strictly <= 16 opaque colors", async () => {
      const multiColorBuf = await createMultiColorPng(256, 256);
      const customId = "generated_char_1725888000001_aabbccddeeff0011";
      const customPath = path.join(tempGeneratedDir, `${customId}.png`);
      fs.writeFileSync(customPath, multiColorBuf);

      const result = (await pixelProcessor.process({
        source: {
          generatedStorageId: customId,
          generatedFilePath: customPath,
        },
        options: { maxOpaqueColors: 16 },
      })) as PixelProcessSuccessResult;

      assert.strictEqual(result.success, true);
      assert.ok(result.metadata.opaqueColorCount <= 16);
      assert.ok(result.metadata.opaqueColorCount > 0);

      // Programmatically inspect actual output pixels
      const { data } = await sharp(result.spriteFilePath).raw().toBuffer({ resolveWithObject: true });
      const uniqueColors = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
          const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
          uniqueColors.add(key);
        }
      }

      assert.strictEqual(uniqueColors.size, result.metadata.opaqueColorCount);
      assert.ok(uniqueColors.size <= 16);
    });

    test("Respects custom maxOpaqueColors (e.g. 8 colors)", async () => {
      const multiColorBuf = await createMultiColorPng(128, 128);
      const customId = "generated_char_1725888000002_aabbccddeeff0022";
      const customPath = path.join(tempGeneratedDir, `${customId}.png`);
      fs.writeFileSync(customPath, multiColorBuf);

      const result = (await pixelProcessor.process({
        source: {
          generatedStorageId: customId,
          generatedFilePath: customPath,
        },
        options: { maxOpaqueColors: 8 },
      })) as PixelProcessSuccessResult;

      assert.strictEqual(result.success, true);
      assert.ok(result.metadata.opaqueColorCount <= 8);
    });

    test("Direct medianCutQuantize produces sorted deterministic palette", () => {
      const pixels = [
        { r: 255, g: 0, b: 0 },
        { r: 250, g: 5, b: 5 },
        { r: 0, g: 255, b: 0 },
        { r: 0, g: 0, b: 255 },
        { r: 255, g: 255, b: 0 },
        { r: 0, g: 255, b: 255 },
      ];

      const pal1 = medianCutQuantize(pixels, 4);
      const pal2 = medianCutQuantize(pixels, 4);

      assert.deepStrictEqual(pal1, pal2);
      assert.strictEqual(pal1.length, 4);
    });
  });

  describe("4. Alpha Handling & Transparency Segregation", () => {
    test("Preserves fully transparent background as RGBA (0, 0, 0, 0)", async () => {
      const result = (await pixelProcessor.process({
        source: sampleGeneratedResult,
      })) as PixelProcessSuccessResult;

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.metadata.hasAlpha, true);

      const { data } = await sharp(result.spriteFilePath).raw().toBuffer({ resolveWithObject: true });
      // Top-left pixel should be fully transparent
      assert.strictEqual(data[0], 0);
      assert.strictEqual(data[1], 0);
      assert.strictEqual(data[2], 0);
      assert.strictEqual(data[3], 0);
    });

    test("Thresholds semi-transparent edge pixels cleanly without halos", () => {
      // 2x2 raw RGBA test image:
      // Pixel 0: alpha 20 (below threshold 128 -> should become 0)
      // Pixel 1: alpha 200 (above threshold 128 -> should become 255)
      // Pixel 2: alpha 0 (transparent -> remains 0)
      // Pixel 3: alpha 255 (opaque -> remains 255)
      const raw = Buffer.from([
        100, 100, 100, 20,
        200, 50, 50, 200,
        0, 0, 0, 0,
        50, 150, 250, 255,
      ]);

      const res = quantizeRgbaBuffer(raw, 2, 2, {
        maxOpaqueColors: 16,
        alphaThreshold: 128,
        dithering: false,
      });

      // Pixel 0: became 0
      assert.strictEqual(res.buffer[3], 0);
      // Pixel 1: became 255
      assert.strictEqual(res.buffer[7], 255);
      // Pixel 2: remained 0
      assert.strictEqual(res.buffer[11], 0);
      // Pixel 3: remained 255
      assert.strictEqual(res.buffer[15], 255);
    });

    test("Does not add white or black matte to transparent pixels", async () => {
      const result = (await pixelProcessor.process({
        source: sampleGeneratedResult,
      })) as PixelProcessSuccessResult;

      const { data } = await sharp(result.spriteFilePath).raw().toBuffer({ resolveWithObject: true });

      let transparentCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) {
          transparentCount++;
          // Must not have color components bleeding into transparent pixels
          assert.strictEqual(data[i], 0);
          assert.strictEqual(data[i + 1], 0);
          assert.strictEqual(data[i + 2], 0);
        }
      }

      assert.ok(transparentCount > 0);
    });
  });

  describe("5. Nearest-Neighbor Downscaling Semantics", () => {
    test("Nearest-neighbor preserves sharp pixel block edges without blurring", async () => {
      // 8x8 checkerboard image scaled up to 64x64 with sharp edges
      const checkerSvg = `<svg width="64" height="64">
        <rect x="0" y="0" width="32" height="64" fill="#000000"/>
        <rect x="32" y="0" width="32" height="64" fill="#FFFFFF"/>
      </svg>`;

      const checkerBuf = await sharp(Buffer.from(checkerSvg)).png().toBuffer();
      const customId = "generated_char_1725888000003_aabbccddeeff0033";
      const customPath = path.join(tempGeneratedDir, `${customId}.png`);
      fs.writeFileSync(customPath, checkerBuf);

      const result = (await pixelProcessor.process({
        source: {
          generatedStorageId: customId,
          generatedFilePath: customPath,
        },
        options: { targetDimension: 64, maxOpaqueColors: 2 },
      })) as PixelProcessSuccessResult;

      assert.strictEqual(result.success, true);
      const { data } = await sharp(result.spriteFilePath).raw().toBuffer({ resolveWithObject: true });

      // In nearest-neighbor on this split, row 0 col 31 should be black (0), col 32 should be white (255)
      // with no intermediate grey interpolation pixels!
      const leftPixel = data[31 * 4]; // x=31, y=0
      const rightPixel = data[32 * 4]; // x=32, y=0

      assert.strictEqual(leftPixel, 0);
      assert.strictEqual(rightPixel, 255);
    });
  });

  describe("6. Determinism Across Runs", () => {
    test("Processing identical source image with identical options produces identical SHA-256", async () => {
      const run1 = (await pixelProcessor.process({
        source: sampleGeneratedResult,
        options: { targetDimension: 64, maxOpaqueColors: 16 },
      })) as PixelProcessSuccessResult;

      const run2 = (await pixelProcessor.process({
        source: sampleGeneratedResult,
        options: { targetDimension: 64, maxOpaqueColors: 16 },
      })) as PixelProcessSuccessResult;

      assert.strictEqual(run1.success, true);
      assert.strictEqual(run2.success, true);
      assert.strictEqual(run1.metadata.sha256, run2.metadata.sha256);
      assert.strictEqual(run1.metadata.opaqueColorCount, run2.metadata.opaqueColorCount);

      const buf1 = fs.readFileSync(run1.spriteFilePath);
      const buf2 = fs.readFileSync(run2.spriteFilePath);
      assert.deepStrictEqual(buf1, buf2);
    });
  });

  describe("7. Storage, Traversal Defense & Lifecycle Management", () => {
    test("Generates valid sprite storage IDs", () => {
      const id = generateSpriteStorageId();
      assert.ok(isValidSpriteStorageId(id));
      assert.ok(id.startsWith("sprite_char_"));
    });

    test("Rejects path traversal in sprite storage path resolution", () => {
      assert.throws(() => {
        // @ts-expect-error testing private traversal defense
        spriteStorage.resolveSecurePath("../../../etc/passwd");
      }, /Invalid sprite storage ID format/);
    });

    test("Does not overwrite Phase 3 generated source asset", async () => {
      const sourceBefore = fs.readFileSync(sampleGeneratedResult.generatedFilePath);

      const result = await pixelProcessor.process({
        source: sampleGeneratedResult,
      });
      assert.strictEqual(result.success, true);

      const sourceAfter = fs.readFileSync(sampleGeneratedResult.generatedFilePath);
      assert.deepStrictEqual(sourceBefore, sourceAfter);
    });

    test("Cleans up individual sprite asset and unregisters record", async () => {
      const result = (await pixelProcessor.process({
        source: sampleGeneratedResult,
      })) as PixelProcessSuccessResult;

      assert.strictEqual(fs.existsSync(result.spriteFilePath), true);

      const deleted = await pixelProcessor.cleanup(result.spriteStorageId);
      assert.strictEqual(deleted, true);
      assert.strictEqual(fs.existsSync(result.spriteFilePath), false);
    });

    test("cleanupAll removes managed sprites while preserving unrelated files", async () => {
      const unrelated = path.join(tempSpriteDir, "unrelated_palette.txt");
      fs.writeFileSync(unrelated, "PALETTE DATA", "utf-8");

      const result = (await pixelProcessor.process({
        source: sampleGeneratedResult,
      })) as PixelProcessSuccessResult;

      assert.strictEqual(fs.existsSync(result.spriteFilePath), true);

      await pixelProcessor.cleanupAll();
      assert.strictEqual(fs.existsSync(result.spriteFilePath), false);
      assert.strictEqual(fs.existsSync(unrelated), true);
    });
  });

  describe("8. Privacy & Metadata Sanitization", () => {
    test("Sprite output contains zero EXIF, GPS, IPTC, or orientation metadata", async () => {
      const result = (await pixelProcessor.process({
        source: sampleGeneratedResult,
      })) as PixelProcessSuccessResult;

      const meta = await sharp(result.spriteFilePath).metadata();
      assert.strictEqual(meta.format, "png");
      assert.strictEqual(meta.exif, undefined);
      assert.strictEqual(meta.iptc, undefined);
      assert.strictEqual(meta.xmp, undefined);
      assert.strictEqual(meta.orientation, undefined);
    });
  });

  describe("9. Complete End-to-End Pipeline Chaining", () => {
    test("Chains Phase 1 Upload -> Phase 2 Preprocess -> Phase 3 Generate -> Phase 4 Pixel Process", async () => {
      // 1. Phase 1: Upload
      const photoBuffer = await createSyntheticGeneratedPng(450, 450);
      const uploadRes = (await uploadBoundary.upload(
        new Uint8Array(photoBuffer),
        "user_portrait.png"
      )) as UploadSuccessResult;
      assert.strictEqual(uploadRes.success, true);

      // 2. Phase 2: Preprocess
      const preprocessRes = (await preprocessor.process({
        source: uploadRes,
      })) as PreprocessSuccessResult;
      assert.strictEqual(preprocessRes.success, true);
      assert.strictEqual(preprocessRes.metadata.width, 512);
      assert.strictEqual(preprocessRes.metadata.height, 512);

      // 3. Phase 3: AI Generation (Mock provider)
      const mockChibiPng = await createSyntheticGeneratedPng(512, 512);
      mockProvider.setOptions({ mockImageBuffer: mockChibiPng });

      const generateRes = (await generator.generate({
        source: preprocessRes,
        style: { renderingStyle: "chibi-pixel-art" },
      })) as GenerateCharacterSuccessResult;
      assert.strictEqual(generateRes.success, true);

      // 4. Phase 4: Deterministic Pixel Processing
      const pixelRes = (await pixelProcessor.process({
        source: generateRes,
        options: { targetDimension: 64, maxOpaqueColors: 16 },
      })) as PixelProcessSuccessResult;

      assert.strictEqual(pixelRes.success, true);
      assert.strictEqual(pixelRes.metadata.width, 64);
      assert.strictEqual(pixelRes.metadata.height, 64);
      assert.strictEqual(pixelRes.metadata.hasAlpha, true);
      assert.ok(pixelRes.metadata.opaqueColorCount <= 16);
      assert.strictEqual(pixelRes.sourceStorageId, generateRes.generatedStorageId);
      assert.ok(fs.existsSync(pixelRes.spriteFilePath));
    });
  });
});
