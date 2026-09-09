/**
 * PixelPal — Mock Character Generation Provider
 * Sprint 6 Phase 3 Foundation
 *
 * Test double implementing CharacterGenerationProvider for deterministic,
 * offline unit and integration testing without network or credentials.
 */

import type {
  CharacterGenerationProvider,
  ProviderGenerationRequest,
  ProviderGenerationResponse,
} from "./generation_provider.ts";
import { ProviderError } from "./openai_provider.ts";

/**
 * Configuration options for mock provider behavior.
 */
export interface MockProviderOptions {
  /** Synthetic image buffer to return on success */
  readonly mockImageBuffer?: Buffer;
  /** Simulated provider error code to throw */
  readonly simulatedErrorCode?:
    | "AI_CONFIGURATION_MISSING"
    | "AI_AUTHENTICATION_FAILED"
    | "AI_RATE_LIMITED"
    | "AI_CONTENT_REJECTED"
    | "AI_TIMEOUT"
    | "AI_REQUEST_FAILED"
    | "AI_INVALID_RESPONSE";
  /** Custom simulated error message */
  readonly simulatedErrorMessage?: string;
  /** Custom model identifier to report */
  readonly reportedModel?: string;
}

/**
 * Offline Mock Provider for hermetic testing.
 */
export class MockCharacterGenerationProvider implements CharacterGenerationProvider {
  public readonly providerId = "mock-openai";
  public readonly generateCalls: ProviderGenerationRequest[] = [];
  private options: MockProviderOptions;

  constructor(options: MockProviderOptions = {}) {
    this.options = options;
  }

  public setOptions(options: MockProviderOptions): void {
    this.options = options;
  }

  public async generate(
    request: ProviderGenerationRequest
  ): Promise<ProviderGenerationResponse> {
    this.generateCalls.push(request);

    if (this.options.simulatedErrorCode) {
      throw new ProviderError(
        this.options.simulatedErrorCode,
        this.options.simulatedErrorMessage ??
          `Simulated mock error: ${this.options.simulatedErrorCode}`
      );
    }

    const imageBuffer =
      this.options.mockImageBuffer ??
      Buffer.from([
        // Minimal PNG stub signature for tests when no custom buffer is supplied
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);

    return {
      imageBuffer,
      model: this.options.reportedModel ?? request.model,
      providerId: this.providerId,
      responseMetadata: {
        mock: true,
        generatedAt: Date.now(),
      },
    };
  }
}
