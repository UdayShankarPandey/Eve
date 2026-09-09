/**
 * PixelPal — Character Generation Provider Abstraction
 * Sprint 6 Phase 3 Foundation
 *
 * Defines the vendor-neutral provider contract decoupling the core character
 * domain from specific external AI APIs (e.g. OpenAI, local models, test doubles).
 */

/**
 * Normalized input request delivered to an AI generation provider.
 */
export interface ProviderGenerationRequest {
  /** Sanitized binary preprocessed PNG image buffer from Phase 2 */
  readonly imageBuffer: Buffer;
  /** Controlled system instructional prompt */
  readonly prompt: string;
  /** Model identifier requested */
  readonly model: string;
  /** Request timeout in milliseconds */
  readonly timeoutMs: number;
  /** Maximum number of retry attempts for transient errors */
  readonly maxRetries?: number;
  /** Optional deterministic seed */
  readonly seed?: number;
}

/**
 * Raw response returned by an AI generation provider before domain validation.
 */
export interface ProviderGenerationResponse {
  /** Raw binary image data returned by the model */
  readonly imageBuffer: Buffer;
  /** Exact model identifier that fulfilled the request */
  readonly model: string;
  /** Provider identifier (e.g. 'openai') */
  readonly providerId: string;
  /** Optional provider-specific diagnostic metadata (no secrets/PII) */
  readonly responseMetadata?: Record<string, unknown>;
}

/**
 * Vendor-neutral interface for character image generation providers.
 */
export interface CharacterGenerationProvider {
  /** Unique machine identifier for this provider implementation */
  readonly providerId: string;

  /**
   * Generates a base companion character image from a preprocessed reference photo.
   *
   * Implementations must:
   * - Read credentials from the host server/Node environment only.
   * - Never leak API secrets into error messages or response structures.
   * - Map vendor HTTP/API errors to domain-friendly exceptions.
   * - Validate returned binary payload before returning.
   */
  generate(
    request: ProviderGenerationRequest
  ): Promise<ProviderGenerationResponse>;
}
