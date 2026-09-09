/**
 * PixelPal — Controlled AI Expression Generator Service
 * Sprint 7 Phase 1 Foundation
 *
 * Coordinates multi-expression companion sprite generation:
 * 1. Takes CharacterProfile as the identity authority.
 * 2. Builds deterministic, injection-immune prompt for the requested expression.
 * 3. Invokes CharacterGenerationProvider (OpenAI in production, MockProvider in tests).
 * 4. Validates raster output.
 * 5. Passes through PixelArtProcessor to produce canonical 64x64 transparent pixel sprites.
 * 6. Returns structured ExpressionAssetRecord with cryptographic SHA-256 verification.
 */

import sharp, { type Metadata } from "sharp";
import type {
  CharacterExpressionId,
  CharacterGenerationOptions,
  CharacterGenerationProvider,
  CharacterProfile,
  ExpressionAssetRecord,
} from "./types.ts";
import {
  buildExpressionPrompt,
  isValidExpressionId,
} from "./expression_prompt_builder.ts";
import {
  DEFAULT_OPENAI_MODEL,
  OpenAIImageGenerationProvider,
} from "./openai_provider.ts";
import { PixelArtProcessor } from "./pixel_processor.ts";
import { computeSha256Hex } from "./validator.ts";
import {
  FileSystemSpriteStorageAdapter,
  type SpriteStorageAdapter,
} from "./sprite_storage.ts";

/**
 * Options for configuring the CharacterExpressionGenerator service.
 */
export interface CharacterExpressionGeneratorOptions {
  /** Injected AI generation provider (defaults to OpenAIImageGenerationProvider) */
  readonly provider?: CharacterGenerationProvider;
  /** Injected pixel processor */
  readonly pixelProcessor?: PixelArtProcessor;
  /** Storage adapter for persisting expression sprites */
  readonly spriteStorage?: SpriteStorageAdapter;
  /** Default execution options */
  readonly defaultOptions?: Partial<CharacterGenerationOptions>;
}

/**
 * Result of generating an expression asset.
 */
export interface GenerateExpressionResult {
  readonly assetRecord: ExpressionAssetRecord;
  readonly spriteBuffer: Buffer;
  readonly rawGeneratedBuffer: Buffer;
}

/**
 * Authoritative Character Expression Generator Service.
 */
export class CharacterExpressionGenerator {
  private readonly provider: CharacterGenerationProvider;
  private readonly pixelProcessor: PixelArtProcessor;
  private readonly spriteStorage: SpriteStorageAdapter;
  private readonly defaultOptions: Required<Omit<CharacterGenerationOptions, "seed">> = {
    providerId: "openai",
    model: DEFAULT_OPENAI_MODEL,
    timeoutMs: 60_000,
    maxRetries: 0,
  };

  constructor(options: CharacterExpressionGeneratorOptions = {}) {
    this.provider = options.provider ?? new OpenAIImageGenerationProvider();
    this.pixelProcessor = options.pixelProcessor ?? new PixelArtProcessor();
    this.spriteStorage =
      options.spriteStorage ?? new FileSystemSpriteStorageAdapter();

    if (options.defaultOptions) {
      this.defaultOptions = {
        providerId: options.defaultOptions.providerId ?? this.defaultOptions.providerId,
        model: options.defaultOptions.model ?? this.defaultOptions.model,
        timeoutMs: options.defaultOptions.timeoutMs ?? this.defaultOptions.timeoutMs,
        maxRetries: options.defaultOptions.maxRetries ?? this.defaultOptions.maxRetries,
      };
    }
  }

  /**
   * Retrieves the configured sprite storage adapter.
   */
  public getSpriteStorage(): SpriteStorageAdapter {
    return this.spriteStorage;
  }

  /**
   * Generates a validated expression sprite asset for a companion character.
   *
   * @param profile The source CharacterProfile acting as identity authority.
   * @param expression Target expression from the 9-expression MVP taxonomy.
   * @param baseImageBuffer Base reference character image buffer (Phase 2 or Phase 3 PNG).
   * @param options Optional override options for generation.
   */
  public async generateExpression(
    profile: CharacterProfile,
    expression: CharacterExpressionId,
    baseImageBuffer: Buffer,
    options?: CharacterGenerationOptions
  ): Promise<GenerateExpressionResult> {
    if (!isValidExpressionId(expression)) {
      throw new Error(`[CharacterExpressionGenerator] Invalid expression ID: '${String(expression)}'`);
    }

    if (!baseImageBuffer || baseImageBuffer.length === 0) {
      throw new Error("[CharacterExpressionGenerator] Base image buffer is missing or empty.");
    }

    // 1. Build deterministic, injection-immune expression prompt
    const { prompt } = buildExpressionPrompt(profile, expression);

    // 2. Resolve execution parameters
    const model = options?.model ?? this.defaultOptions.model;
    const timeoutMs = options?.timeoutMs ?? this.defaultOptions.timeoutMs;
    const maxRetries = options?.maxRetries ?? this.defaultOptions.maxRetries;
    const seed = options?.seed;

    // 3. Invoke vendor-neutral generation provider
    const providerResponse = await this.provider.generate({
      imageBuffer: baseImageBuffer,
      prompt,
      model,
      timeoutMs,
      maxRetries,
      seed,
    });

    const rawGeneratedBuffer = providerResponse.imageBuffer;

    // 4. Validate raw generated output raster
    let rawMeta: Metadata;
    try {
      rawMeta = await sharp(rawGeneratedBuffer).metadata();
    } catch (err) {
      throw new Error(
        `[CharacterExpressionGenerator] Generated image decode failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!rawMeta.width || !rawMeta.height) {
      throw new Error("[CharacterExpressionGenerator] Generated image missing valid dimensions.");
    }

    // 5. Downscale, threshold alpha, and quantize palette via PixelArtProcessor
    const pixelResult = await this.pixelProcessor.processBuffer(rawGeneratedBuffer, {
      targetDimension: 64,
      maxOpaqueColors: profile.palette.maxOpaqueColors,
      alphaThreshold: profile.palette.alphaThreshold,
      dithering: false,
    });

    const spriteBuffer = pixelResult.buffer;

    // 6. Compute SHA-256 checksum
    const sha256 = await computeSha256Hex(new Uint8Array(spriteBuffer));

    // 7. Establish canonical, immutable asset ID
    const shortHash = sha256.slice(0, 12);
    const assetId = `expr_asset_${profile.characterId}_${expression}_${shortHash}`;

    // 8. Construct ExpressionAssetRecord
    const assetRecord: ExpressionAssetRecord = {
      assetId,
      characterId: profile.characterId,
      expression,
      assetPath: `/assets/sprites/${profile.characterId}/${expression}.png`,
      frameCount: 1,
      frameDimensions: { width: 64, height: 64 },
      fps: 4,
      durationMs: 1000,
      loopMode: expression === "worried" || expression === "surprised" || expression === "panic" ? "one-shot" : "loop",
      fallbackExpressionId: "idle",
      sha256,
      createdAt: Date.now(),
      qualityVerified: true,
    };

    return {
      assetRecord,
      spriteBuffer,
      rawGeneratedBuffer,
    };
  }
}
