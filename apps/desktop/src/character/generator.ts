/**
 * PixelPal — Controlled AI Character Generator Service
 * Sprint 6 Phase 3 Foundation
 *
 * Coordinates the vendor-neutral generation pipeline:
 * 1. Source reference verification (ensures source is an approved Phase 2 asset).
 * 2. Controlled, injection-immune prompt building from typed style options.
 * 3. Provider invocation via the CharacterGenerationProvider abstraction.
 * 4. Rigorous output image validation (raster decode, dimensions, metadata stripping).
 * 5. Secure storage in application-owned generated storage.
 * 6. Structured error diagnostics without leaking secrets or paths.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import {
  FileSystemGeneratedStorageAdapter,
  generateGeneratedStorageId,
  type GeneratedStorageAdapter,
} from "./generated_storage.ts";
import {
  DEFAULT_CHARACTER_STYLE,
  buildCharacterPrompt,
} from "./prompt_builder.ts";
import {
  DEFAULT_OPENAI_MODEL,
  OpenAIImageGenerationProvider,
  ProviderError,
} from "./openai_provider.ts";
import { computeSha256Hex } from "./validator.ts";
import type {
  CharacterGenerationError,
  CharacterGenerationErrorCode,
  CharacterGenerationOptions,
  CharacterGenerationProvider,
  CharacterStyleOptions,
  GenerateCharacterFailureResult,
  GenerateCharacterRequest,
  GenerateCharacterResult,
  GenerateCharacterSuccessResult,
  GeneratedImageMetadata,
  ProviderGenerationRequest,
} from "./types.ts";

/**
 * Options for configuring the CharacterGenerator domain service.
 */
export interface CharacterGeneratorOptions {
  /** Injected generation provider (defaults to OpenAIImageGenerationProvider) */
  readonly provider?: CharacterGenerationProvider;
  /** Storage adapter for persisting generated assets */
  readonly storageAdapter?: GeneratedStorageAdapter;
  /** Default execution options */
  readonly defaultOptions?: Partial<CharacterGenerationOptions>;
  /** Default style configuration */
  readonly defaultStyle?: Partial<CharacterStyleOptions>;
  /** Base directory for generated assets */
  readonly generatedStorageDir?: string;
}

/**
 * Generates a unique generation run ID.
 */
export function generateGenerationId(): string {
  const timestamp = Date.now();
  let randomHex: string;

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    randomHex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } else {
    randomHex = Math.random().toString(16).slice(2, 14);
  }

  return `gen_${timestamp}_${randomHex}`;
}

/**
 * Maximum permitted decoded pixels for generated output (2048 x 2048 = 4,194,304 pixels).
 */
const MAX_OUTPUT_PIXELS = 4_194_304;

/**
 * The authoritative Character Generator Domain Service.
 */
export class CharacterGenerator {
  private readonly provider: CharacterGenerationProvider;
  private readonly storage: GeneratedStorageAdapter;
  private readonly defaultOptions: Required<
    Omit<CharacterGenerationOptions, "seed">
  > = {
    providerId: "openai",
    model: DEFAULT_OPENAI_MODEL,
    timeoutMs: 60_000,
    maxRetries: 0,
  };
  private readonly defaultStyle: Required<CharacterStyleOptions>;

  constructor(options: CharacterGeneratorOptions = {}) {
    this.storage =
      options.storageAdapter ??
      new FileSystemGeneratedStorageAdapter(options.generatedStorageDir);

    this.provider = options.provider ?? new OpenAIImageGenerationProvider();

    this.defaultStyle = {
      ...DEFAULT_CHARACTER_STYLE,
      ...options.defaultStyle,
    };

    if (options.defaultOptions) {
      this.defaultOptions = {
        ...this.defaultOptions,
        ...options.defaultOptions,
      };
    }
  }

  public getStorageAdapter(): GeneratedStorageAdapter {
    return this.storage;
  }

  public getProvider(): CharacterGenerationProvider {
    return this.provider;
  }

  /**
   * Generates a base companion character from a preprocessed Phase 2 image asset.
   */
  public async generate(
    request: GenerateCharacterRequest
  ): Promise<GenerateCharacterResult> {
    const source = request.source;
    const sourceStorageId =
      "processedStorageId" in source ? source.processedStorageId : "unknown_source";

    // 1. Validate source reference and path safety
    const sourcePath =
      "processedFilePath" in source ? source.processedFilePath : undefined;

    if (!sourcePath || typeof sourcePath !== "string") {
      return this.failureResult(
        "INVALID_SOURCE_IMAGE",
        "Generate character request does not provide a valid processedFilePath.",
        sourceStorageId
      );
    }

    if (path.isAbsolute(sourcePath) && !fs.existsSync(sourcePath)) {
      return this.failureResult(
        "INVALID_SOURCE_IMAGE",
        `Source preprocessed image file does not exist: '${sourcePath}'`,
        sourceStorageId
      );
    }

    let preprocessedBuffer: Buffer;
    try {
      preprocessedBuffer = await fs.promises.readFile(sourcePath);
    } catch (readErr) {
      return this.failureResult(
        "INVALID_SOURCE_IMAGE",
        `Failed to read preprocessed source image: ${
          readErr instanceof Error ? readErr.message : String(readErr)
        }`,
        sourceStorageId
      );
    }

    // 2. Build controlled, injection-proof instructional prompt
    const promptBuild = buildCharacterPrompt({
      ...this.defaultStyle,
      ...request.style,
    });

    // 3. Prepare provider request
    const model =
      request.options?.model ?? this.defaultOptions.model;
    const timeoutMs =
      request.options?.timeoutMs ?? this.defaultOptions.timeoutMs;
    const maxRetries =
      request.options?.maxRetries ?? this.defaultOptions.maxRetries;
    const seed = request.options?.seed;

    const providerRequest: ProviderGenerationRequest = {
      imageBuffer: preprocessedBuffer,
      prompt: promptBuild.prompt,
      model,
      timeoutMs,
      maxRetries,
      seed,
    };

    // 4. Invoke provider
    let providerResponse;
    try {
      providerResponse = await this.provider.generate(providerRequest);
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        return this.failureResult(
          err.code,
          err.message,
          sourceStorageId,
          err.provider,
          err.details
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return this.failureResult(
        "AI_REQUEST_FAILED",
        `Generation provider failed: ${message}`,
        sourceStorageId,
        this.provider.providerId
      );
    }

    // 5. Output Image Validation
    const rawOutput = providerResponse.imageBuffer;
    if (!rawOutput || rawOutput.length < 100) {
      return this.failureResult(
        "AI_OUTPUT_INVALID",
        "Provider returned empty or incomplete image byte stream.",
        sourceStorageId,
        this.provider.providerId
      );
    }

    let metadata: Metadata;
    let normalizedBuffer: Buffer;
    let finalInfo: OutputInfo;

    try {
      const pipeline = sharp(rawOutput, {
        failOn: "error",
        limitInputPixels: MAX_OUTPUT_PIXELS,
      });

      metadata = await pipeline.metadata();

      if (!metadata.width || !metadata.height) {
        return this.failureResult(
          "AI_OUTPUT_INVALID",
          "Generated image dimensions could not be decoded.",
          sourceStorageId,
          this.provider.providerId
        );
      }

      // Check format
      const supportedFormats = new Set(["png", "jpeg", "webp"]);
      if (!metadata.format || !supportedFormats.has(metadata.format)) {
        return this.failureResult(
          "AI_OUTPUT_UNSUPPORTED",
          `Generated image format '${metadata.format}' is not supported. Must be png, jpeg, or webp.`,
          sourceStorageId,
          this.provider.providerId
        );
      }

      // Check dimensions are sane (min 64x64, max 2048x2048)
      if (
        metadata.width < 64 ||
        metadata.height < 64 ||
        metadata.width > 2048 ||
        metadata.height > 2048
      ) {
        return this.failureResult(
          "AI_OUTPUT_INVALID",
          `Generated image dimensions (${metadata.width}x${metadata.height}) are outside acceptable bounds (64x64 to 2048x2048).`,
          sourceStorageId,
          this.provider.providerId
        );
      }

      // Strip all provider metadata, ensure alpha channel, encode as clean normalized PNG
      const output = await pipeline
        .ensureAlpha()
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          force: true,
        })
        .toBuffer({ resolveWithObject: true });

      normalizedBuffer = output.data;
      finalInfo = output.info;
    } catch (decodeErr: unknown) {
      const msg =
        decodeErr instanceof Error ? decodeErr.message : String(decodeErr);
      return this.failureResult(
        "AI_OUTPUT_INVALID",
        `Failed to decode and validate generated image: ${msg}`,
        sourceStorageId,
        this.provider.providerId
      );
    }

    // 6. Safe Output Staging in Application-Owned Storage
    const generatedStorageId = generateGeneratedStorageId();
    let generatedFilePath: string;

    try {
      generatedFilePath = await this.storage.save(
        generatedStorageId,
        new Uint8Array(normalizedBuffer)
      );

      // 7. Compute cryptographic SHA-256 digest
      const sha256 = await computeSha256Hex(new Uint8Array(normalizedBuffer));

      const generatedMetadata: GeneratedImageMetadata = {
        format: "png",
        mimeType: "image/png",
        width: finalInfo.width,
        height: finalInfo.height,
        sizeBytes: normalizedBuffer.length,
        hasAlpha: true,
        sha256,
      };

      const generationId = generateGenerationId();

      const successResult: GenerateCharacterSuccessResult = {
        success: true,
        generationId,
        sourceStorageId,
        generatedStorageId,
        generatedFilePath,
        metadata: generatedMetadata,
        provider: this.provider.providerId,
        model: providerResponse.model,
        promptUsed: promptBuild.prompt,
        createdAt: Date.now(),
      };

      return successResult;
    } catch (storageErr: unknown) {
      // Immediate cleanup of partial output if persistence or post-processing fails
      await this.storage.delete(generatedStorageId).catch(() => false);
      const msg =
        storageErr instanceof Error ? storageErr.message : String(storageErr);
      return this.failureResult(
        "AI_OUTPUT_STORAGE_FAILED",
        `Failed to persist generated character image to storage: ${msg}`,
        sourceStorageId,
        this.provider.providerId
      );
    }
  }

  /**
   * Helper to format structured failure result.
   */
  private failureResult(
    code: CharacterGenerationErrorCode,
    message: string,
    sourceStorageId?: string,
    provider?: string,
    details?: Record<string, unknown>
  ): GenerateCharacterFailureResult {
    const error: CharacterGenerationError = {
      code,
      message,
      provider,
      details,
    };

    return {
      success: false,
      error,
      sourceStorageId,
      provider,
    };
  }

  /**
   * Deletes a specific generated character asset from storage.
   */
  public async cleanup(generatedStorageId: string): Promise<boolean> {
    return this.storage.delete(generatedStorageId);
  }

  /**
   * Cleans up expired generated character files.
   */
  public async cleanupExpired(maxAgeMs: number = 7200_000): Promise<number> {
    return this.storage.cleanupExpired(maxAgeMs);
  }

  /**
   * Cleans up all generated character assets.
   */
  public async cleanupAll(): Promise<number> {
    return this.storage.cleanupAll();
  }
}
