/**
 * PixelPal — OpenAI Character Generation Provider
 * Sprint 6 Phase 3 Foundation
 *
 * Implements the official OpenAI image generation & editing provider behind
 * the CharacterGenerationProvider abstraction.
 *
 * Enforces strict credential isolation:
 * - API keys are read from server-side process.env only.
 * - Keys are NEVER logged, exposed, or leaked into error diagnostics.
 * - HTTP details are completely encapsulated within this provider.
 */

import OpenAI, { toFile } from "openai";
import type {
  CharacterGenerationProvider,
  ProviderGenerationRequest,
  ProviderGenerationResponse,
} from "./generation_provider.ts";
import type { CharacterGenerationErrorCode } from "./types.ts";

/**
 * Model capability specification for OpenAI image models.
 */
export interface ModelCapability {
  readonly modelId: string;
  readonly supportsEdit: boolean;
  readonly supportsGenerate: boolean;
  readonly supportsReferenceImage: boolean;
}

/**
 * Authoritative capability map for supported OpenAI models.
 * - gpt-image-2.5-sunburst: supports both images.generate and images.edit (with reference images).
 * - gpt-image-2.5-flare: speed-oriented model; supports images.generate only (documented v1/images/generations).
 */
export const OPENAI_MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  "gpt-image-2.5-sunburst": {
    modelId: "gpt-image-2.5-sunburst",
    supportsEdit: true,
    supportsGenerate: true,
    supportsReferenceImage: true,
  },
  "gpt-image-2.5-flare": {
    modelId: "gpt-image-2.5-flare",
    supportsEdit: false,
    supportsGenerate: true,
    supportsReferenceImage: false,
  },
};

/**
 * Standard image generation models supported for character creation.
 */
export const OPENAI_SUPPORTED_MODELS = [
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
] as const;

export type OpenAIGenerationModel = (typeof OPENAI_SUPPORTED_MODELS)[number];

/**
 * Default recommended model for base character creation.
 * Sunburst is the primary model for reference-image editing (v1/images/edits).
 */
export const DEFAULT_OPENAI_MODEL: OpenAIGenerationModel = "gpt-image-2.5-sunburst";

/**
 * Custom error class for provider-level failures with structured codes.
 */
export class ProviderError extends Error {
  public readonly code: CharacterGenerationErrorCode;
  public readonly provider: string = "openai";
  public readonly details?: Record<string, unknown>;

  constructor(
    code: CharacterGenerationErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Options for configuring the OpenAIImageGenerationProvider.
 */
export interface OpenAIProviderOptions {
  /** Optional API key (defaults to process.env.OPENAI_API_KEY) */
  readonly apiKey?: string;
  /** Optional custom base URL (for enterprise proxies / local testing) */
  readonly baseURL?: string;
  /** Default model identifier */
  readonly defaultModel?: string;
  /** Request timeout in milliseconds (default: 60,000) */
  readonly timeoutMs?: number;
  /** Injected OpenAI client instance (primarily for testing) */
  readonly client?: OpenAI;
}

/**
 * Official OpenAI Image Generation Provider.
 */
export class OpenAIImageGenerationProvider implements CharacterGenerationProvider {
  public readonly providerId = "openai";
  private readonly client: OpenAI | null;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAIProviderOptions = {}) {
    this.defaultModel = options.defaultModel ?? DEFAULT_OPENAI_MODEL;
    this.timeoutMs = options.timeoutMs ?? 60_000;

    if (options.client) {
      this.client = options.client;
    } else {
      const key = options.apiKey ?? process.env.OPENAI_API_KEY;
      if (!key || key.trim() === "") {
        // Missing credential - will fail safely on generate()
        this.client = null;
      } else {
        this.client = new OpenAI({
          apiKey: key.trim(),
          baseURL: options.baseURL,
          timeout: this.timeoutMs,
          maxRetries: 0, // Bounded retry: we control retries explicitly
        });
      }
    }
  }

  /**
   * Generates a base companion character from a preprocessed reference image and prompt.
   */
  public async generate(
    request: ProviderGenerationRequest
  ): Promise<ProviderGenerationResponse> {
    // 1. Verify credentials exist
    if (!this.client) {
      throw new ProviderError(
        "AI_CONFIGURATION_MISSING",
        "OpenAI API key is missing. Set OPENAI_API_KEY in the server execution environment."
      );
    }

    const model = request.model || this.defaultModel;
    const timeout = request.timeoutMs || this.timeoutMs;

    // 2. Validate model existence
    const capability = OPENAI_MODEL_CAPABILITIES[model];
    if (!capability) {
      throw new ProviderError(
        "AI_REQUEST_FAILED",
        `Model '${model}' is not supported for character generation. Supported models: ${OPENAI_SUPPORTED_MODELS.join(", ")}.`,
        { model, supportedModels: OPENAI_SUPPORTED_MODELS }
      );
    }

    const hasReferenceImage = Boolean(
      request.imageBuffer && request.imageBuffer.length > 0
    );

    // 3. Capability validation for requested operation
    if (hasReferenceImage) {
      if (!capability.supportsEdit || !capability.supportsReferenceImage) {
        throw new ProviderError(
          "AI_REQUEST_FAILED",
          `Model '${model}' does not support reference-image editing (images.edit). Use 'gpt-image-2.5-sunburst' for reference-based character generation.`,
          {
            model,
            operation: "images.edit",
            supportedModelsForEdit: ["gpt-image-2.5-sunburst"],
          }
        );
      }
    } else if (!capability.supportsGenerate) {
      throw new ProviderError(
        "AI_REQUEST_FAILED",
        `Model '${model}' does not support direct image generation (images.generate).`,
        { model, operation: "images.generate" }
      );
    }

    try {
      let imageBuffer: Buffer | null = null;
      const responseMetadata: Record<string, unknown> = {
        model,
        timestamp: Date.now(),
      };

      if (hasReferenceImage) {
        // Preferred operation: images.edit with reference image (Sunburst)
        const uploadableFile = await toFile(
          request.imageBuffer!,
          "reference_subject.png",
          { type: "image/png" }
        );

        const response = await this.client.images.edit(
          {
            image: uploadableFile,
            prompt: request.prompt,
            model,
            n: 1,
            size: "1024x1024",
            output_format: "png",
            background: "transparent",
          },
          { timeout }
        );

        imageBuffer = await this.extractImageBuffer(response);
      } else {
        // Fallback operation: images.generate with text prompt only
        const response = await this.client.images.generate(
          {
            prompt: request.prompt,
            model,
            n: 1,
            size: "1024x1024",
            output_format: "png",
            background: "transparent",
          },
          { timeout }
        );

        imageBuffer = await this.extractImageBuffer(response);
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        throw new ProviderError(
          "AI_INVALID_RESPONSE",
          "OpenAI returned an empty image payload or unsupported response structure."
        );
      }

      return {
        imageBuffer,
        model,
        providerId: this.providerId,
        responseMetadata,
      };
    } catch (err: unknown) {
      throw this.mapOpenAIError(err);
    }
  }

  /**
   * Safely extracts raw binary image data from OpenAI response (handling both b64_json and URL).
   */
  private async extractImageBuffer(response: OpenAI.ImagesResponse): Promise<Buffer> {
    if (!response.data || response.data.length === 0) {
      throw new ProviderError(
        "AI_INVALID_RESPONSE",
        "OpenAI response contains no image items."
      );
    }

    const item = response.data[0];

    // Priority 1: Base64 JSON payload (direct, zero extra network hop)
    if (item.b64_json) {
      return Buffer.from(item.b64_json, "base64");
    }

    // Priority 2: Direct URL payload
    if (item.url) {
      return this.fetchImageUrl(item.url);
    }

    throw new ProviderError(
      "AI_INVALID_RESPONSE",
      "OpenAI image response item contained neither b64_json nor url."
    );
  }

  /**
   * Fetches image data from returned temporary OpenAI CDN URL with timeout.
   */
  private async fetchImageUrl(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new ProviderError(
          "AI_REQUEST_FAILED",
          `Failed to fetch generated image from provider CDN (HTTP ${res.status}).`
        );
      }
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (fetchErr: unknown) {
      if (fetchErr instanceof ProviderError) {
        throw fetchErr;
      }
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      if (msg.includes("abort")) {
        throw new ProviderError(
          "AI_TIMEOUT",
          "Fetching generated image from provider CDN timed out."
        );
      }
      throw new ProviderError(
        "AI_REQUEST_FAILED",
        `Network failure retrieving generated image: ${msg}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Translates OpenAI SDK and network errors into structured domain errors without leaking secrets.
   */
  private mapOpenAIError(err: unknown): ProviderError {
    if (err instanceof ProviderError) {
      return err;
    }

    if (err instanceof OpenAI.APIError) {
      const status = err.status;
      const message = this.sanitizeErrorMessage(err.message);

      if (status === 401 || status === 403) {
        return new ProviderError(
          "AI_AUTHENTICATION_FAILED",
          "OpenAI authentication failed. Verify that OPENAI_API_KEY is valid."
        );
      }

      if (status === 429) {
        return new ProviderError(
          "AI_RATE_LIMITED",
          "OpenAI rate limit exceeded or quota exhausted. Please retry later.",
          { status }
        );
      }

      // Check for content policy / safety rejections
      const lowerMsg = message.toLowerCase();
      if (
        status === 400 &&
        (lowerMsg.includes("safety") ||
          lowerMsg.includes("policy") ||
          lowerMsg.includes("content_policy_violation") ||
          lowerMsg.includes("rejected"))
      ) {
        return new ProviderError(
          "AI_CONTENT_REJECTED",
          "The generation request was rejected by provider safety and content moderation policies.",
          { reason: "content_policy_violation" }
        );
      }

      if (status === 408 || err instanceof OpenAI.APIConnectionTimeoutError) {
        return new ProviderError(
          "AI_TIMEOUT",
          "OpenAI generation request timed out."
        );
      }

      return new ProviderError(
        "AI_REQUEST_FAILED",
        `OpenAI API request failed: ${message}`,
        { status }
      );
    }

    if (err instanceof Error) {
      const sanitized = this.sanitizeErrorMessage(err.message);
      if (sanitized.toLowerCase().includes("timeout")) {
        return new ProviderError("AI_TIMEOUT", "OpenAI request timed out.");
      }
      return new ProviderError("AI_REQUEST_FAILED", sanitized);
    }

    return new ProviderError(
      "AI_REQUEST_FAILED",
      "An unexpected failure occurred during OpenAI character generation."
    );
  }

  /**
   * Sanitizes error message strings to ensure API keys or authorization headers never leak.
   */
  private sanitizeErrorMessage(msg: string): string {
    return msg
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
      .replace(/Bearer\s+[a-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]");
  }
}
