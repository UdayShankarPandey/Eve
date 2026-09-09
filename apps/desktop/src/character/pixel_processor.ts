/**
 * PixelPal — Deterministic Pixel-Art Sprite Processor
 * Sprint 6 Phase 4 Foundation
 *
 * Transforms validated Phase 3 generated base character images into
 * deterministic, crisp, transparent, sprite-ready pixel assets.
 *
 * Sequence:
 * 1. Validated Phase 3 input verification (storage ID format, traversal defense).
 * 2. Full raster decode & format verification (PNG, sane dimension bounds).
 * 3. Nearest-neighbor aspect-preserving downscaling (64x64 canonical, 128x128 optional).
 * 4. Transparent alpha thresholding (binary crisp edges, zero translucent halos).
 * 5. Deterministic Median-Cut color quantization (<=16 opaque colors, transparency segregated).
 * 6. Metadata stripping & standardized RGBA PNG serialization.
 * 7. Secure storage in application-owned sprite storage (sprite_char_<timestamp>_<randomHex>).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import sharp, { type Metadata } from "sharp";
import {
  FileSystemSpriteStorageAdapter,
  generateSpriteStorageId,
  type SpriteStorageAdapter,
} from "./sprite_storage.ts";
import {
  quantizeRgbaBuffer,
} from "./color_quantizer.ts";
import { isValidGeneratedStorageId } from "./generated_storage.ts";
import { computeSha256Hex } from "./validator.ts";
import type {
  PixelProcessErrorCode,
  PixelProcessExecutionInfo,
  PixelProcessOptions,
  PixelProcessRequest,
  PixelProcessResult,
  SpriteDimension,
  SpriteImageMetadata,
} from "./types.ts";

/**
 * Configuration options for the PixelArtProcessor service.
 */
export interface PixelArtProcessorOptions {
  /** Storage adapter for persisting sprite assets */
  readonly storageAdapter?: SpriteStorageAdapter;
  /** Default execution options */
  readonly defaultOptions?: Partial<PixelProcessOptions>;
  /** Base directory for sprite storage */
  readonly spriteStorageDir?: string;
}

/**
 * Maximum input pixel limit (2048 x 2048 = 4,194,304 pixels) to guard against decomp bombs.
 */
const MAX_INPUT_PIXELS = 4_194_304;

/**
 * Default canonical pixel processing options.
 */
export const DEFAULT_PIXEL_OPTIONS: Required<PixelProcessOptions> = {
  targetDimension: 64,
  maxOpaqueColors: 16,
  alphaThreshold: 128,
  dithering: false,
};

/**
 * Custom error class for pixel processing failures.
 */
export class PixelProcessingError extends Error {
  public readonly code: PixelProcessErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: PixelProcessErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PixelProcessingError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Authoritative Pixel-Art Processor Service.
 */
export class PixelArtProcessor {
  private readonly storage: SpriteStorageAdapter;
  private readonly defaultOptions: Required<PixelProcessOptions>;

  constructor(options: PixelArtProcessorOptions = {}) {
    if (options.storageAdapter) {
      this.storage = options.storageAdapter;
    } else {
      this.storage = new FileSystemSpriteStorageAdapter(options.spriteStorageDir);
    }

    this.defaultOptions = {
      targetDimension:
        options.defaultOptions?.targetDimension ?? DEFAULT_PIXEL_OPTIONS.targetDimension,
      maxOpaqueColors:
        options.defaultOptions?.maxOpaqueColors ?? DEFAULT_PIXEL_OPTIONS.maxOpaqueColors,
      alphaThreshold:
        options.defaultOptions?.alphaThreshold ?? DEFAULT_PIXEL_OPTIONS.alphaThreshold,
      dithering:
        options.defaultOptions?.dithering ?? DEFAULT_PIXEL_OPTIONS.dithering,
    };
  }

  /**
   * Retrieves the configured sprite storage adapter.
   */
  public getStorageAdapter(): SpriteStorageAdapter {
    return this.storage;
  }

  /**
   * Processes a validated Phase 3 generated image into a crisp, transparent pixel sprite.
   */
  public async process(request: PixelProcessRequest): Promise<PixelProcessResult> {
    const startTime = Date.now();
    let sourceStorageId: string | undefined;

    try {
      // 1. Validate source reference contract
      if (!request?.source) {
        throw new PixelProcessingError(
          "PIXEL_SOURCE_INVALID",
          "Pixel processing requires a valid Phase 3 generated image reference."
        );
      }

      sourceStorageId =
        "generatedStorageId" in request.source
          ? request.source.generatedStorageId
          : undefined;

      const sourceFilePath =
        "generatedFilePath" in request.source
          ? request.source.generatedFilePath
          : undefined;

      if (!sourceStorageId || !isValidGeneratedStorageId(sourceStorageId)) {
        throw new PixelProcessingError(
          "PIXEL_SOURCE_INVALID",
          `Invalid generated source storage ID: '${sourceStorageId || "undefined"}'`
        );
      }

      if (!sourceFilePath || typeof sourceFilePath !== "string") {
        throw new PixelProcessingError(
          "PIXEL_SOURCE_INVALID",
          "Source generated file path is missing or invalid."
        );
      }

      // Path traversal check
      if (sourceFilePath.includes("..")) {
        throw new PixelProcessingError(
          "PIXEL_SOURCE_INVALID",
          "Path traversal sequences detected in source generated image reference."
        );
      }

      const expectedFileName = `${sourceStorageId}.png`;
      if (path.basename(sourceFilePath) !== expectedFileName) {
        throw new PixelProcessingError(
          "PIXEL_SOURCE_INVALID",
          `Source path filename does not match generated storage ID: '${sourceStorageId}'`
        );
      }

      const normalizedPath = path.normalize(sourceFilePath);
      if (!fs.existsSync(normalizedPath)) {
        throw new PixelProcessingError(
          "PIXEL_SOURCE_INVALID",
          `Generated source file not found at path: '${sourceFilePath}'`
        );
      }

      // 2. Read and decode source image
      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.promises.readFile(normalizedPath);
      } catch (readErr) {
        throw new PixelProcessingError(
          "PIXEL_DECODE_FAILED",
          `Failed to read generated asset file: ${readErr instanceof Error ? readErr.message : String(readErr)}`
        );
      }

      if (fileBuffer.length === 0) {
        throw new PixelProcessingError(
          "PIXEL_DECODE_FAILED",
          "Source generated file is empty (0 bytes)."
        );
      }

      let metadata: Metadata;
      try {
        metadata = await sharp(fileBuffer).metadata();
      } catch (metaErr) {
        throw new PixelProcessingError(
          "PIXEL_DECODE_FAILED",
          `Failed to decode raster metadata: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`
        );
      }

      if (!metadata.width || !metadata.height) {
        throw new PixelProcessingError(
          "PIXEL_DECODE_FAILED",
          "Source image has missing or invalid dimensions."
        );
      }

      if (metadata.format !== "png") {
        throw new PixelProcessingError(
          "PIXEL_UNSUPPORTED_FORMAT",
          `Unsupported source format '${metadata.format}'. Generated assets must be PNG.`
        );
      }

      const totalPixels = metadata.width * metadata.height;
      if (totalPixels > MAX_INPUT_PIXELS) {
        throw new PixelProcessingError(
          "PIXEL_RESOURCE_LIMIT",
          `Source image exceeds maximum permitted pixel count (${totalPixels} > ${MAX_INPUT_PIXELS}).`
        );
      }

      // 3. Resolve and validate processing options
      const targetDimension = (request.options?.targetDimension ??
        this.defaultOptions.targetDimension) as SpriteDimension;

      if (targetDimension !== 64 && targetDimension !== 128) {
        throw new PixelProcessingError(
          "PIXEL_RESIZE_FAILED",
          `Unsupported target sprite dimension: ${targetDimension}. Must be 64 or 128.`
        );
      }

      const maxOpaqueColors =
        request.options?.maxOpaqueColors ?? this.defaultOptions.maxOpaqueColors;
      if (maxOpaqueColors < 2 || maxOpaqueColors > 256) {
        throw new PixelProcessingError(
          "PIXEL_QUANTIZATION_FAILED",
          `maxOpaqueColors must be between 2 and 256 (got ${maxOpaqueColors}).`
        );
      }

      const alphaThreshold =
        request.options?.alphaThreshold ?? this.defaultOptions.alphaThreshold;
      if (alphaThreshold < 0 || alphaThreshold > 255) {
        throw new PixelProcessingError(
          "PIXEL_QUANTIZATION_FAILED",
          `alphaThreshold must be between 0 and 255 (got ${alphaThreshold}).`
        );
      }

      const dithering = request.options?.dithering ?? this.defaultOptions.dithering;

      // 4. Downscale with nearest-neighbor kernel and preserve aspect ratio with transparent padding
      let resizedRawBuffer: Buffer;
      try {
        const resizeResult = await sharp(fileBuffer)
          .ensureAlpha()
          .resize(targetDimension, targetDimension, {
            kernel: sharp.kernel.nearest,
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .raw()
          .toBuffer({ resolveWithObject: true });

        resizedRawBuffer = resizeResult.data;
      } catch (resizeErr) {
        throw new PixelProcessingError(
          "PIXEL_RESIZE_FAILED",
          `Nearest-neighbor downscaling failed: ${resizeErr instanceof Error ? resizeErr.message : String(resizeErr)}`
        );
      }

      // 5. Alpha thresholding & deterministic color quantization
      let quantResult: ReturnType<typeof quantizeRgbaBuffer>;
      try {
        quantResult = quantizeRgbaBuffer(
          resizedRawBuffer,
          targetDimension,
          targetDimension,
          {
            maxOpaqueColors,
            alphaThreshold,
            dithering,
          }
        );
      } catch (quantErr) {
        throw new PixelProcessingError(
          "PIXEL_QUANTIZATION_FAILED",
          `Palette quantization failed: ${quantErr instanceof Error ? quantErr.message : String(quantErr)}`
        );
      }

      // 6. Encode to standardized, metadata-free PNG
      let spritePngBuffer: Buffer;
      try {
        spritePngBuffer = await sharp(quantResult.buffer, {
          raw: {
            width: targetDimension,
            height: targetDimension,
            channels: 4,
          },
        })
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch (encodeErr) {
        throw new PixelProcessingError(
          "PIXEL_OUTPUT_FAILED",
          `Failed to encode output sprite PNG: ${encodeErr instanceof Error ? encodeErr.message : String(encodeErr)}`
        );
      }

      // 7. Persist to application-owned sprite storage
      const spriteStorageId = generateSpriteStorageId();
      let spriteFilePath: string;

      try {
        spriteFilePath = await this.storage.save(
          spriteStorageId,
          new Uint8Array(spritePngBuffer)
        );
      } catch (storageErr) {
        throw new PixelProcessingError(
          "PIXEL_STORAGE_FAILED",
          `Failed to save sprite asset to storage: ${storageErr instanceof Error ? storageErr.message : String(storageErr)}`
        );
      }

      // 8. Compute cryptographic SHA-256 digest
      const sha256 = await computeSha256Hex(new Uint8Array(spritePngBuffer));
      const durationMs = Date.now() - startTime;

      const metadataResult: SpriteImageMetadata = {
        format: "png",
        mimeType: "image/png",
        width: targetDimension,
        height: targetDimension,
        sizeBytes: spritePngBuffer.length,
        hasAlpha: true,
        opaqueColorCount: quantResult.opaqueColorCount,
        sha256,
      };

      const executionInfo: PixelProcessExecutionInfo = {
        sourceDimensions: {
          width: metadata.width,
          height: metadata.height,
        },
        targetDimensions: {
          width: targetDimension,
          height: targetDimension,
        },
        colorsUsed: quantResult.opaqueColorCount,
        alphaThreshold,
        durationMs,
      };

      return {
        success: true,
        spriteStorageId,
        sourceStorageId,
        spriteFilePath,
        metadata: metadataResult,
        processingInfo: executionInfo,
        createdAt: Date.now(),
      };
    } catch (err: unknown) {
      return this.formatFailure(err, sourceStorageId);
    }
  }

  /**
   * Directly processes an in-memory image buffer into a crisp, transparent pixel sprite.
   */
  public async processBuffer(
    inputBuffer: Buffer,
    options?: Partial<PixelProcessOptions>
  ): Promise<{
    buffer: Buffer;
    metadata: SpriteImageMetadata;
    palette: ReturnType<typeof quantizeRgbaBuffer>["palette"];
  }> {
    let metadata: Metadata;
    try {
      metadata = await sharp(inputBuffer).metadata();
    } catch (metaErr) {
      throw new PixelProcessingError(
        "PIXEL_DECODE_FAILED",
        `Failed to decode raster metadata: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new PixelProcessingError(
        "PIXEL_DECODE_FAILED",
        "Source image has missing or invalid dimensions."
      );
    }

    const totalPixels = metadata.width * metadata.height;
    if (totalPixels > MAX_INPUT_PIXELS) {
      throw new PixelProcessingError(
        "PIXEL_RESOURCE_LIMIT",
        `Source image exceeds maximum permitted pixel count (${totalPixels} > ${MAX_INPUT_PIXELS}).`
      );
    }

    const targetDimension = (options?.targetDimension ??
      this.defaultOptions.targetDimension) as SpriteDimension;

    if (targetDimension !== 64 && targetDimension !== 128) {
      throw new PixelProcessingError(
        "PIXEL_RESIZE_FAILED",
        `Unsupported target sprite dimension: ${targetDimension}. Must be 64 or 128.`
      );
    }

    const maxOpaqueColors =
      options?.maxOpaqueColors ?? this.defaultOptions.maxOpaqueColors;
    const alphaThreshold =
      options?.alphaThreshold ?? this.defaultOptions.alphaThreshold;
    const dithering = options?.dithering ?? this.defaultOptions.dithering;

    let resizedRawBuffer: Buffer;
    try {
      const resizeResult = await sharp(inputBuffer)
        .ensureAlpha()
        .resize(targetDimension, targetDimension, {
          kernel: sharp.kernel.nearest,
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .raw()
        .toBuffer({ resolveWithObject: true });

      resizedRawBuffer = resizeResult.data;
    } catch (resizeErr) {
      throw new PixelProcessingError(
        "PIXEL_RESIZE_FAILED",
        `Nearest-neighbor downscaling failed: ${resizeErr instanceof Error ? resizeErr.message : String(resizeErr)}`
      );
    }

    const quantResult = quantizeRgbaBuffer(
      resizedRawBuffer,
      targetDimension,
      targetDimension,
      {
        maxOpaqueColors,
        alphaThreshold,
        dithering,
      }
    );

    let spritePngBuffer: Buffer;
    try {
      spritePngBuffer = await sharp(quantResult.buffer, {
        raw: {
          width: targetDimension,
          height: targetDimension,
          channels: 4,
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch (encodeErr) {
      throw new PixelProcessingError(
        "PIXEL_OUTPUT_FAILED",
        `Failed to encode output sprite PNG: ${encodeErr instanceof Error ? encodeErr.message : String(encodeErr)}`
      );
    }

    const sha256 = await computeSha256Hex(new Uint8Array(spritePngBuffer));

    const spriteMetadata: SpriteImageMetadata = {
      format: "png",
      mimeType: "image/png",
      width: targetDimension,
      height: targetDimension,
      sizeBytes: spritePngBuffer.length,
      hasAlpha: true,
      opaqueColorCount: quantResult.opaqueColorCount,
      sha256,
    };

    return {
      buffer: spritePngBuffer,
      metadata: spriteMetadata,
      palette: quantResult.palette,
    };
  }

  /**
   * Cleans up a specific sprite asset by storage ID.
   */
  public async cleanup(spriteStorageId: string): Promise<boolean> {
    return this.storage.delete(spriteStorageId);
  }

  /**
   * Cleans up all managed sprite assets.
   */
  public async cleanupAll(): Promise<number> {
    return this.storage.cleanupAll();
  }

  /**
   * Cleans up expired sprite assets.
   */
  public async cleanupExpired(maxAgeMs: number): Promise<number> {
    return this.storage.cleanupExpired(maxAgeMs);
  }

  /**
   * Formats internal or unexpected errors into clean, structured domain failures.
   */
  private formatFailure(
    err: unknown,
    sourceStorageId?: string
  ): PixelProcessResult {
    if (err instanceof PixelProcessingError) {
      return {
        success: false,
        sourceStorageId,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      sourceStorageId,
      error: {
        code: "PIXEL_OUTPUT_FAILED",
        message: `Unexpected error during pixel processing: ${message}`,
      },
    };
  }
}
