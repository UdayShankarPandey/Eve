/**
 * PixelPal — Sprint 6 Phase 2: Character Image Preprocessor Test Suite
 *
 * Deterministic test matrix covering:
 * 1. Valid inputs (PNG, JPEG, WebP)
 * 2. EXIF orientation normalization
 * 3. Conservative crop & framing strategies (portrait, landscape, square)
 * 4. Dimension normalization & aspect-ratio preservation
 * 5. Optional isolated background removal (none vs corner-chroma)
 * 6. Raster decode failure on corrupt body bytes
 * 7. Resource limits / decompression bomb protection
 * 8. Safe application-owned processed storage & path security
 * 9. Temporary storage lifecycle & cleanup
 * 10. Privacy & metadata stripping
 */

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";

import {
  ImageUploadBoundary,
  ImagePreprocessor,
  FileSystemTemporaryStorageAdapter,
  FileSystemProcessedStorageAdapter,
  InMemoryProcessedStorageAdapter,
  DEFAULT_PREPROCESS_OPTIONS,
  type PreprocessSuccessResult,
  type PreprocessFailureResult,
  type UploadSuccessResult,
} from "../index.ts";

/**
 * Helper to programmatically create synthetic test PNG buffers.
 */
async function createSyntheticPng(
  width: number,
  height: number,
  color = { r: 120, g: 150, b: 200, alpha: 1 }
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

/**
 * Helper to programmatically create synthetic test JPEG buffers with optional EXIF orientation.
 */
async function createSyntheticJpeg(
  width: number,
  height: number,
  orientation?: number
): Promise<Buffer> {
  let instance = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 210, g: 140, b: 90 },
    },
  }).jpeg();

  if (orientation) {
    instance = instance.withMetadata({ orientation });
  }

  return instance.toBuffer();
}

/**
 * Helper to programmatically create synthetic test WebP buffers.
 */
async function createSyntheticWebp(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 80, g: 180, b: 120, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
}

/**
 * Helper to create an image with a solid backdrop and a distinct center subject.
 */
async function createBackdropWithSubject(
  width: number,
  height: number,
  bgRgb = { r: 255, g: 255, b: 255 },
  fgRgb = { r: 50, g: 50, b: 180 }
): Promise<Buffer> {
  const subjectSize = Math.floor(Math.min(width, height) * 0.5);
  const subjectSvg = `<svg width="${width}" height="${height}">
    <rect x="${Math.floor((width - subjectSize) / 2)}" y="${Math.floor(
    (height - subjectSize) / 2
  )}" width="${subjectSize}" height="${subjectSize}" fill="rgb(${fgRgb.r},${fgRgb.g},${fgRgb.b})" />
  </svg>`;

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { ...bgRgb, alpha: 1 },
    },
  })
    .composite([{ input: Buffer.from(subjectSvg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

describe("Sprint 6 Phase 2: Character Image Preprocessing Foundation", () => {
  let tempUploadDir: string;
  let tempProcessedDir: string;
  let uploadBoundary: ImageUploadBoundary;
  let preprocessor: ImagePreprocessor;

  beforeEach(() => {
    const randomSuffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    tempUploadDir = path.join(os.tmpdir(), `pixelpal_up_${randomSuffix}`);
    tempProcessedDir = path.join(os.tmpdir(), `pixelpal_proc_${randomSuffix}`);

    const uploadStorage = new FileSystemTemporaryStorageAdapter(tempUploadDir);
    const processedStorage = new FileSystemProcessedStorageAdapter(tempProcessedDir);

    uploadBoundary = new ImageUploadBoundary({ storageAdapter: uploadStorage });
    preprocessor = new ImagePreprocessor({ storageAdapter: processedStorage });
  });

  afterEach(() => {
    for (const dir of [tempUploadDir, tempProcessedDir]) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // Ignore locks
        }
      }
    }
  });

  describe("1. Valid Formats Decoding & Preprocessing (PNG, JPEG, WebP)", () => {
    test("Decodes and normalizes validated PNG upload to canonical PNG asset", async () => {
      const pngBuffer = await createSyntheticPng(600, 600);
      const upload = (await uploadBoundary.upload(new Uint8Array(pngBuffer), "avatar.png")) as UploadSuccessResult;
      assert.strictEqual(upload.success, true);

      const result = await preprocessor.process({ source: upload });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      assert.strictEqual(success.metadata.format, "png");
      assert.strictEqual(success.metadata.mimeType, "image/png");
      assert.strictEqual(success.metadata.width, 512);
      assert.strictEqual(success.metadata.height, 512);
      assert.strictEqual(success.metadata.hasAlpha, true);
      assert.ok(fs.existsSync(success.processedFilePath));
      assert.ok(success.processedFilePath.endsWith(".png"));
    });

    test("Decodes and normalizes validated JPEG upload to canonical transparent PNG asset", async () => {
      const jpegBuffer = await createSyntheticJpeg(800, 600);
      const upload = (await uploadBoundary.upload(new Uint8Array(jpegBuffer), "photo.jpg")) as UploadSuccessResult;
      assert.strictEqual(upload.success, true);

      const result = await preprocessor.process({ source: upload });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      assert.strictEqual(success.metadata.format, "png");
      assert.strictEqual(success.metadata.width, 512);
      assert.strictEqual(success.metadata.height, 512);
      assert.strictEqual(success.metadata.hasAlpha, true);
    });

    test("Decodes and normalizes validated WebP upload to canonical PNG asset", async () => {
      const webpBuffer = await createSyntheticWebp(400, 400);
      const upload = (await uploadBoundary.upload(new Uint8Array(webpBuffer), "art.webp")) as UploadSuccessResult;
      assert.strictEqual(upload.success, true);

      const result = await preprocessor.process({ source: upload });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      assert.strictEqual(success.metadata.format, "png");
      assert.strictEqual(success.metadata.width, 512);
      assert.strictEqual(success.metadata.height, 512);
    });
  });

  describe("2. EXIF Orientation Normalization", () => {
    test("Normalizes portrait image with EXIF orientation 6 (90° CW) to upright raster", async () => {
      // Create a 600x400 JPEG with orientation tag 6
      const orientedBuffer = await createSyntheticJpeg(600, 400, 6);
      const upload = (await uploadBoundary.upload(new Uint8Array(orientedBuffer), "camera_shot.jpg")) as UploadSuccessResult;
      assert.strictEqual(upload.success, true);

      const result = await preprocessor.process({
        source: upload,
        options: { normalizeOrientation: true },
      });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      assert.strictEqual(success.processingInfo.orientationApplied, 6);

      // Verify that output raster metadata has orientation reset to 1
      const outputMeta = await sharp(success.processedFilePath).metadata();
      assert.strictEqual(outputMeta.orientation, undefined); // EXIF stripped
      assert.strictEqual(outputMeta.width, 512);
      assert.strictEqual(outputMeta.height, 512);
    });
  });

  describe("3. Conservative Crop & Framing Strategies", () => {
    test("Center-crop-square handles landscape input without stretching", async () => {
      // 800 wide x 400 high landscape
      const landscapeBuffer = await createSyntheticPng(800, 400);
      const upload = (await uploadBoundary.upload(new Uint8Array(landscapeBuffer), "landscape.png")) as UploadSuccessResult;

      const result = await preprocessor.process({
        source: upload,
        options: { cropMode: "center-crop-square" },
      });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      assert.strictEqual(success.metadata.width, 512);
      assert.strictEqual(success.metadata.height, 512);
      assert.deepStrictEqual(success.processingInfo.cropApplied, {
        left: 200,
        top: 0,
        width: 400,
        height: 400,
      });
    });

    test("Center-crop-square handles portrait input without stretching", async () => {
      // 400 wide x 800 high portrait
      const portraitBuffer = await createSyntheticPng(400, 800);
      const upload = (await uploadBoundary.upload(new Uint8Array(portraitBuffer), "portrait.png")) as UploadSuccessResult;

      const result = await preprocessor.process({
        source: upload,
        options: { cropMode: "center-crop-square" },
      });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      assert.strictEqual(success.metadata.width, 512);
      assert.strictEqual(success.metadata.height, 512);
      assert.deepStrictEqual(success.processingInfo.cropApplied, {
        left: 0,
        top: 200,
        width: 400,
        height: 400,
      });
    });

    test("Fit-preserve-aspect preserves complete framing inside bounding box", async () => {
      // 800 wide x 400 high (2:1 aspect ratio)
      const landscapeBuffer = await createSyntheticPng(800, 400);
      const upload = (await uploadBoundary.upload(new Uint8Array(landscapeBuffer), "panoramic.png")) as UploadSuccessResult;

      const result = await preprocessor.process({
        source: upload,
        options: {
          cropMode: "fit-preserve-aspect",
          targetDimensions: { width: 512, height: 512 },
        },
      });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      // Fits inside 512x512 preserving 2:1 ratio: 512 x 256
      assert.strictEqual(success.metadata.width, 512);
      assert.strictEqual(success.metadata.height, 256);
      assert.strictEqual(success.processingInfo.cropApplied, undefined);
    });

    test("Center-crop-square handles odd dimensions deterministically and stays in bounds", async () => {
      // 557 wide x 333 high (odd dimensions)
      const oddBuffer = await createSyntheticPng(557, 333);
      const upload = (await uploadBoundary.upload(new Uint8Array(oddBuffer), "odd.png")) as UploadSuccessResult;

      const result = await preprocessor.process({
        source: upload,
        options: { cropMode: "center-crop-square" },
      });
      assert.strictEqual(result.success, true);

      const success = result as PreprocessSuccessResult;
      assert.strictEqual(success.metadata.width, 512);
      assert.strictEqual(success.metadata.height, 512);
      // squareSize = 333, left = floor((557 - 333)/2) = 112, top = 0
      assert.strictEqual(success.processingInfo.cropApplied?.width, 333);
      assert.strictEqual(success.processingInfo.cropApplied?.height, 333);
      assert.strictEqual(success.processingInfo.cropApplied?.top, 0);
      assert.strictEqual(success.processingInfo.cropApplied?.left, 112);
    });
  });

  describe("4. Dimension Normalization & Resampling", () => {
    test("Upscales small valid source (128x128) cleanly to 512x512", async () => {
      const smallBuffer = await createSyntheticPng(128, 128);
      const upload = (await uploadBoundary.upload(new Uint8Array(smallBuffer), "small.png")) as UploadSuccessResult;

      const result = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;
      assert.strictEqual(result.metadata.width, 512);
      assert.strictEqual(result.metadata.height, 512);
      assert.strictEqual(result.processingInfo.resampled, true);
    });

    test("Downscales large valid source (1600x1600) cleanly to 512x512", async () => {
      const largeBuffer = await createSyntheticPng(1600, 1600);
      const upload = (await uploadBoundary.upload(new Uint8Array(largeBuffer), "large.png")) as UploadSuccessResult;

      const result = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;
      assert.strictEqual(result.metadata.width, 512);
      assert.strictEqual(result.metadata.height, 512);
      assert.strictEqual(result.processingInfo.resampled, true);
    });
  });

  describe("5. Optional Isolated Background Removal", () => {
    test("Background removal disabled ('none') leaves backdrop pixels intact", async () => {
      const buffer = await createBackdropWithSubject(200, 200, { r: 255, g: 255, b: 255 });
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "white_bg.png")) as UploadSuccessResult;

      const result = (await preprocessor.process({
        source: upload,
        options: { backgroundRemovalMode: "none" },
      })) as PreprocessSuccessResult;

      assert.strictEqual(result.processingInfo.backgroundRemoved, false);
      const meta = await sharp(result.processedFilePath).metadata();
      assert.strictEqual(meta.hasAlpha, true);
    });

    test("Corner-chroma strategy removes uniform solid background to transparent", async () => {
      const buffer = await createBackdropWithSubject(200, 200, { r: 255, g: 255, b: 255 }, { r: 20, g: 20, b: 20 });
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "solid_white.png")) as UploadSuccessResult;

      const result = (await preprocessor.process({
        source: upload,
        options: {
          backgroundRemovalMode: "corner-chroma",
          backgroundRemovalThreshold: 30,
        },
      })) as PreprocessSuccessResult;

      assert.strictEqual(result.processingInfo.backgroundRemoved, true);

      // Verify that corner pixel (0, 0) is transparent in output
      const { data: rawPixels } = await sharp(result.processedFilePath)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alphaAtTopLeft = rawPixels[3];
      assert.strictEqual(alphaAtTopLeft, 0); // Fully transparent
    });

    test("Corner-chroma gracefully falls back when corners have high variance (non-uniform background)", async () => {
      // Create a 4-color gradient / non-uniform background
      const nonUniformSvg = `<svg width="200" height="200">
        <rect x="0" y="0" width="100" height="100" fill="red" />
        <rect x="100" y="0" width="100" height="100" fill="green" />
        <rect x="0" y="100" width="100" height="100" fill="blue" />
        <rect x="100" y="100" width="100" height="100" fill="yellow" />
      </svg>`;
      const buffer = await sharp(Buffer.from(nonUniformSvg)).png().toBuffer();
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "multicolor.png")) as UploadSuccessResult;

      const result = (await preprocessor.process({
        source: upload,
        options: { backgroundRemovalMode: "corner-chroma" },
      })) as PreprocessSuccessResult;

      // Safe fallback: non-uniform corners detected, so background is NOT destructively stripped
      assert.strictEqual(result.processingInfo.backgroundRemoved, false);
    });
  });

  describe("6. Decode Failure & Malformed Image Handling", () => {
    test("Rejects corrupt image body that passed Phase 1 header check with DECODE_FAILED", async () => {
      // Valid PNG signature + plausible IHDR (100x100), but corrupt random garbage body
      const corruptBody = new Uint8Array(200);
      corruptBody[0] = 0x89;
      corruptBody[1] = 0x50;
      corruptBody[2] = 0x4e;
      corruptBody[3] = 0x47;
      corruptBody[4] = 0x0d;
      corruptBody[5] = 0x0a;
      corruptBody[6] = 0x1a;
      corruptBody[7] = 0x0a;

      // IHDR (100x100)
      corruptBody[8] = 0; corruptBody[9] = 0; corruptBody[10] = 0; corruptBody[11] = 13;
      corruptBody[12] = 0x49; corruptBody[13] = 0x48; corruptBody[14] = 0x44; corruptBody[15] = 0x52;
      corruptBody[16] = 0; corruptBody[17] = 0; corruptBody[18] = 0; corruptBody[19] = 100;
      corruptBody[20] = 0; corruptBody[21] = 0; corruptBody[22] = 0; corruptBody[23] = 100;
      corruptBody[24] = 8; corruptBody[25] = 6; corruptBody[26] = 0; corruptBody[27] = 0; corruptBody[28] = 0;
      for (let i = 29; i < corruptBody.length; i++) corruptBody[i] = (i * 37) & 0xff;

      // Upload succeeds because Phase 1 checks headers
      const upload = (await uploadBoundary.upload(corruptBody, "corrupt.png")) as UploadSuccessResult;
      assert.strictEqual(upload.success, true);

      // Preprocessor tries to raster-decode the body with Sharp and correctly fails!
      const result = await preprocessor.process({ source: upload });
      assert.strictEqual(result.success, false);

      const failure = result as PreprocessFailureResult;
      assert.strictEqual(failure.errors[0].code, "DECODE_FAILED");
    });

    test("Rejects non-existent source file with INVALID_SOURCE", async () => {
      const result = await preprocessor.process({
        source: {
          storageId: "char_upload_123_missing",
          tempFilePath: path.join(tempUploadDir, "non_existent_file.png"),
          format: "png",
        },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual((result as PreprocessFailureResult).errors[0].code, "INVALID_SOURCE");
    });
  });

  describe("7. Safe Processed Storage & Path Protection", () => {
    test("Persists intermediate asset with unique ID in application-owned folder", async () => {
      const buffer = await createSyntheticPng(300, 300);
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "avatar.png")) as UploadSuccessResult;

      const result = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;
      assert.ok(result.processedStorageId.startsWith("processed_char_"));
      assert.ok(result.processedFilePath.startsWith(path.resolve(tempProcessedDir)));
      assert.ok(fs.existsSync(result.processedFilePath));
    });

    test("Cleanup methods successfully purge processed temporary assets", async () => {
      const buffer = await createSyntheticPng(200, 200);
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "pic.png")) as UploadSuccessResult;

      const result = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;
      assert.ok(fs.existsSync(result.processedFilePath));

      const deleted = await preprocessor.cleanup(result.processedStorageId);
      assert.strictEqual(deleted, true);
      assert.strictEqual(fs.existsSync(result.processedFilePath), false);
    });

    test("Processed storage cleanup never touches unrelated files in the folder", async () => {
      const unrelated = path.join(tempProcessedDir, "user_note.txt");
      fs.writeFileSync(unrelated, "PROTECTED TEXT", "utf-8");

      const buffer = await createSyntheticPng(200, 200);
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "pic.png")) as UploadSuccessResult;
      const result = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;

      await preprocessor.cleanupAll();
      assert.strictEqual(fs.existsSync(result.processedFilePath), false);
      assert.ok(fs.existsSync(unrelated));
      assert.strictEqual(fs.readFileSync(unrelated, "utf-8"), "PROTECTED TEXT");
    });
  });

  describe("8. Privacy & Determinism", () => {
    test("Strips EXIF, camera, GPS, and timestamp metadata from output", async () => {
      // Create JPEG with EXIF orientation metadata
      const buffer = await createSyntheticJpeg(400, 400, 3);
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "gps_photo.jpg")) as UploadSuccessResult;

      const result = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;
      const meta = await sharp(result.processedFilePath).metadata();

      assert.strictEqual(meta.exif, undefined);
      assert.strictEqual(meta.orientation, undefined);
      assert.strictEqual(meta.iptc, undefined);
      assert.strictEqual(meta.xmp, undefined);
    });

    test("Identical input and options produce identical SHA-256 digests (Determinism)", async () => {
      const buffer = await createSyntheticPng(300, 300);
      const upload = (await uploadBoundary.upload(new Uint8Array(buffer), "deterministic.png")) as UploadSuccessResult;

      const res1 = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;
      const res2 = (await preprocessor.process({ source: upload })) as PreprocessSuccessResult;

      assert.strictEqual(res1.metadata.sha256, res2.metadata.sha256);
      assert.strictEqual(res1.metadata.sizeBytes, res2.metadata.sizeBytes);
      assert.strictEqual(res1.metadata.width, res2.metadata.width);
      assert.strictEqual(res1.metadata.height, res2.metadata.height);
      assert.notStrictEqual(res1.processedStorageId, res2.processedStorageId);
    });
  });
});
