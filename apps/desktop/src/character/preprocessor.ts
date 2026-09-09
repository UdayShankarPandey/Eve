/**
 * PixelPal — Character Image Preprocessing Engine
 * Sprint 6 Phase 2 Foundation
 *
 * Implements deterministic raster decoding, EXIF orientation normalization,
 * conservative center/bounded crop, optional isolated background removal,
 * dimension normalization, metadata stripping, and safe temporary storage.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import {
  FileSystemProcessedStorageAdapter,
  generateProcessedStorageId,
} from "./processed_storage.ts";
import {
  CornerChromaBackgroundRemovalStrategy,
  NoBackgroundRemovalStrategy,
} from "./background_removal.ts";
import { computeSha256Hex } from "./validator.ts";
import type {
  BackgroundRemovalStrategy,
  ImageDimensions,
  ImageProcessingError,
  ImagePreprocessorOptions,
  PreprocessExecutionInfo,
  PreprocessFailureResult,
  PreprocessImageRequest,
  PreprocessOptions,
  PreprocessResult,
  PreprocessSuccessResult,
  ProcessedImageMetadata,
  ProcessedStorageAdapter,
} from "./types.ts";

/**
 * Canonical default options for intermediate character preprocessing.
 */
export const DEFAULT_PREPROCESS_OPTIONS: Required<PreprocessOptions> = {
  targetDimensions: { width: 512, height: 512 },
  cropMode: "center-crop-square",
  backgroundRemovalMode: "none",
  backgroundRemovalThreshold: 25,
  normalizeOrientation: true,
  stripMetadata: true,
};

/**
 * Maximum permitted decoded pixels (4096 * 4096 = 16,777,216 pixels)
 * Decompression bomb / resource exhaustion defense.
 */
const MAX_ALLOWED_PIXELS = 16_777_216;

/**
 * The authoritative Character Image Preprocessing Engine.
 */
export class ImagePreprocessor {
  private readonly storage: ProcessedStorageAdapter;
  private readonly defaultOptions: Required<PreprocessOptions>;
  private readonly bgStrategies: Map<string, BackgroundRemovalStrategy> = new Map();

  constructor(options: ImagePreprocessorOptions = {}) {
    this.storage =
      options.storageAdapter ??
      new FileSystemProcessedStorageAdapter(options.processedStorageDir);

    this.defaultOptions = {
      ...DEFAULT_PREPROCESS_OPTIONS,
      ...options.defaultOptions,
    };

    // Register built-in background removal strategies
    const noBg = new NoBackgroundRemovalStrategy();
    const cornerChroma = new CornerChromaBackgroundRemovalStrategy();
    this.bgStrategies.set(noBg.mode, noBg);
    this.bgStrategies.set(cornerChroma.mode, cornerChroma);

    if (options.backgroundRemovalStrategy) {
      this.bgStrategies.set(
        options.backgroundRemovalStrategy.mode,
        options.backgroundRemovalStrategy
      );
    }
  }

  public getStorageAdapter(): ProcessedStorageAdapter {
    return this.storage;
  }

  /**
   * Main preprocessing workflow:
   * Source -> Safe Decode -> Rotate -> Crop -> BG Removal -> Resize -> Strip Metadata -> PNG Storage
   */
  public async process(request: PreprocessImageRequest): Promise<PreprocessResult> {
    const opts: Required<PreprocessOptions> = {
      ...this.defaultOptions,
      ...request.options,
      targetDimensions: request.options?.targetDimensions ?? this.defaultOptions.targetDimensions,
    };

    const source = request.source;
    const sourceStorageId = "storageId" in source ? source.storageId : "unknown_source";

    // 1. Verify source existence and path safety
    const sourcePath = "tempFilePath" in source ? source.tempFilePath : undefined;
    if (!sourcePath || typeof sourcePath !== "string") {
      return this.failureResult(
        "INVALID_SOURCE",
        "Source image request does not provide a valid tempFilePath",
        sourceStorageId
      );
    }

    // Protect against arbitrary path injection: source must be a recognized upload path
    if (path.isAbsolute(sourcePath) && !fs.existsSync(sourcePath)) {
      return this.failureResult(
        "INVALID_SOURCE",
        `Source temporary file does not exist: '${sourcePath}'`,
        sourceStorageId
      );
    }

    let rawBuffer: Buffer;
    try {
      rawBuffer = await fs.promises.readFile(sourcePath);
    } catch (readErr) {
      return this.failureResult(
        "INVALID_SOURCE",
        `Failed to read source file: ${
          readErr instanceof Error ? readErr.message : String(readErr)
        }`,
        sourceStorageId
      );
    }

    // 2. Initialize Sharp pipeline with resource limits
    let pipeline = sharp(rawBuffer, {
      failOn: "error",
      limitInputPixels: MAX_ALLOWED_PIXELS,
    });

    let metadata: Metadata;
    try {
      metadata = await pipeline.metadata();
    } catch (decodeErr) {
      return this.failureResult(
        "DECODE_FAILED",
        `Raster decoding failed on source image: ${
          decodeErr instanceof Error ? decodeErr.message : String(decodeErr)
        }`,
        sourceStorageId
      );
    }

    if (!metadata.width || !metadata.height) {
      return this.failureResult(
        "DECODE_FAILED",
        "Decoded image dimensions are missing or invalid",
        sourceStorageId
      );
    }

    // Format security: strictly constrain to approved Phase 1 formats
    const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      return this.failureResult(
        "UNSUPPORTED_RASTER",
        `Decoded image format '${metadata.format}' is unsupported. Only png, jpeg, and webp are allowed`,
        sourceStorageId
      );
    }

    // Reject multi-frame / animated images to ensure single-character deterministic processing
    if (metadata.pages && metadata.pages > 1) {
      return this.failureResult(
        "UNSUPPORTED_RASTER",
        `Animated or multi-frame images are not supported (detected ${metadata.pages} frames)`,
        sourceStorageId
      );
    }

    const originalDimensions: ImageDimensions = {
      width: metadata.width,
      height: metadata.height,
    };

    // Check memory safety against decompression bomb
    if (metadata.width * metadata.height > MAX_ALLOWED_PIXELS) {
      return this.failureResult(
        "RESOURCE_LIMIT",
        `Decoded raster size (${metadata.width * metadata.height} px) exceeds maximum limit (${MAX_ALLOWED_PIXELS} px)`,
        sourceStorageId
      );
    }

    let orientationApplied: number | undefined;
    // 3. Orientation Normalization
    if (opts.normalizeOrientation) {
      try {
        orientationApplied = metadata.orientation;
        // Calling rotate() without parameters instructs Sharp to automatically
        // orient the image according to EXIF Orientation tag and reset the tag.
        pipeline = pipeline.rotate();
      } catch (orientErr) {
        return this.failureResult(
          "ORIENTATION_FAILED",
          `Failed to normalize orientation: ${
            orientErr instanceof Error ? orientErr.message : String(orientErr)
          }`,
          sourceStorageId
        );
      }
    }

    // We must render to buffer after rotation if orientation changed width/height
    let currentWidth = metadata.width;
    let currentHeight = metadata.height;
    if (orientationApplied && orientationApplied >= 5 && orientationApplied <= 8) {
      // 90 or 270 degree rotation swaps width and height
      currentWidth = metadata.height;
      currentHeight = metadata.width;
    }

    let cropApplied:
      | { left: number; top: number; width: number; height: number }
      | undefined;

    // 4. Crop / Framing Cleanup
    if (opts.cropMode === "center-crop-square") {
      const squareSize = Math.min(currentWidth, currentHeight);
      const left = Math.floor((currentWidth - squareSize) / 2);
      const top = Math.floor((currentHeight - squareSize) / 2);

      cropApplied = { left, top, width: squareSize, height: squareSize };
      try {
        pipeline = pipeline.extract({
          left,
          top,
          width: squareSize,
          height: squareSize,
        });
        currentWidth = squareSize;
        currentHeight = squareSize;
      } catch (cropErr) {
        return this.failureResult(
          "CROP_FAILED",
          `Center crop failed: ${
            cropErr instanceof Error ? cropErr.message : String(cropErr)
          }`,
          sourceStorageId
        );
      }
    }

    // 5. Dimension Normalization & Resampling
    const targetW = opts.targetDimensions.width;
    const targetH = opts.targetDimensions.height;

    let resampled = false;
    if (currentWidth !== targetW || currentHeight !== targetH) {
      try {
        pipeline = pipeline.resize({
          width: targetW,
          height: targetH,
          fit: opts.cropMode === "fit-preserve-aspect" ? "inside" : "fill",
          kernel: sharp.kernel.lanczos3,
          withoutEnlargement: false,
        });
        resampled = true;
      } catch (resizeErr) {
        return this.failureResult(
          "DIMENSION_NORMALIZATION_FAILED",
          `Resizing failed: ${
            resizeErr instanceof Error ? resizeErr.message : String(resizeErr)
          }`,
          sourceStorageId
        );
      }
    }

    // Ensure RGBA alpha channel
    pipeline = pipeline.ensureAlpha();

    // 6. Optional Background Removal Strategy
    let backgroundRemoved = false;
    if (opts.backgroundRemovalMode !== "none") {
      const strategy = this.bgStrategies.get(opts.backgroundRemovalMode);
      if (strategy) {
        try {
          const { data: rawPixels, info } = await pipeline
            .raw()
            .toBuffer({ resolveWithObject: true });

          const bgResult = await strategy.removeBackground(
            new Uint8Array(rawPixels),
            info.width,
            info.height,
            info.channels,
            opts.backgroundRemovalThreshold
          );

          backgroundRemoved = bgResult.backgroundRemoved;

          // Rebuild pipeline from modified raw RGBA buffer
          pipeline = sharp(Buffer.from(bgResult.rawPixels.buffer), {
            raw: {
              width: info.width,
              height: info.height,
              channels: info.channels as 1 | 2 | 3 | 4,
            },
          });
        } catch (bgErr) {
          return this.failureResult(
            "BACKGROUND_REMOVAL_FAILED",
            `Background removal strategy failed: ${
              bgErr instanceof Error ? bgErr.message : String(bgErr)
            }`,
            sourceStorageId
          );
        }
      }
    }

    // 7. PNG Encoding & Metadata Stripping (Privacy Guarantee)
    let processedBuffer: Buffer;
    let finalInfo: OutputInfo;
    try {
      // By omitting withMetadata(), Sharp strips all EXIF, GPS, camera model, and dates
      const output = await pipeline
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          force: true,
        })
        .toBuffer({ resolveWithObject: true });

      processedBuffer = output.data;
      finalInfo = output.info;
    } catch (encodeErr) {
      return this.failureResult(
        "OUTPUT_WRITE_FAILED",
        `PNG encoding failed: ${
          encodeErr instanceof Error ? encodeErr.message : String(encodeErr)
        }`,
        sourceStorageId
      );
    }

    // 8. Safe Output Staging in Application-Owned Storage
    const processedStorageId = generateProcessedStorageId();
    let processedFilePath: string;

    try {
      processedFilePath = await this.storage.save(
        processedStorageId,
        new Uint8Array(processedBuffer)
      );

      // 9. Compute cryptographic SHA-256 digest
      const sha256 = await computeSha256Hex(new Uint8Array(processedBuffer));

      const finalMetadata: ProcessedImageMetadata = {
        format: "png",
        mimeType: "image/png",
        width: finalInfo.width,
        height: finalInfo.height,
        sizeBytes: processedBuffer.length,
        hasAlpha: true,
        sha256,
      };

      const processingInfo: PreprocessExecutionInfo = {
        originalDimensions,
        cropApplied,
        orientationApplied,
        backgroundRemoved,
        resampled,
      };

      const successResult: PreprocessSuccessResult = {
        success: true,
        processedStorageId,
        processedFilePath,
        sourceStorageId,
        metadata: finalMetadata,
        processingInfo,
        createdAt: Date.now(),
      };

      return successResult;
    } catch (storageErr) {
      // Ensure any partial artifact in storage is deleted immediately
      await this.storage.delete(processedStorageId).catch(() => false);
      return this.failureResult(
        "OUTPUT_WRITE_FAILED",
        `Failed to persist processed image to storage: ${
          storageErr instanceof Error ? storageErr.message : String(storageErr)
        }`,
        sourceStorageId
      );
    }
  }

  /**
   * Helper to format structured failure result.
   */
  private failureResult(
    code: ImageProcessingError["code"],
    message: string,
    sourceStorageId?: string
  ): PreprocessFailureResult {
    return {
      success: false,
      errors: [
        {
          code,
          message,
        },
      ],
      sourceStorageId,
    };
  }

  /**
   * Deletes a specific processed image from storage.
   */
  public async cleanup(processedStorageId: string): Promise<boolean> {
    return this.storage.delete(processedStorageId);
  }

  /**
   * Cleans up expired processed files.
   */
  public async cleanupExpired(maxAgeMs: number = 3600_000): Promise<number> {
    return this.storage.cleanupExpired(maxAgeMs);
  }

  /**
   * Cleans up all processed assets.
   */
  public async cleanupAll(): Promise<number> {
    return this.storage.cleanupAll();
  }
}
