/**
 * PixelPal — Conversation LLM Provider Abstraction & OpenAI Implementation
 * Sprint 9 Phase 3
 *
 * Implements:
 * - ConversationLlmProvider interface and structured error types
 * - MockConversationLlmProvider for hermetic, offline test suites
 * - OpenAIConversationLlmProvider utilizing official SDK with Structured Outputs (json_schema)
 * - Credential isolation: API keys are strictly runtime/host-only and never exposed
 */

import OpenAI from "openai";
import {
  type ConversationLlmProvider,
  type ConversationLlmRequest,
  type ConversationLlmRawResponse,
  DEFAULT_CONVERSATION_TIMEOUT_MS,
} from "./types.ts";
import {
  buildChatMessages,
  CONVERSATION_RESPONSE_JSON_SCHEMA,
} from "./instruction_builder.ts";

/**
 * Standard conversational model supported by OpenAI for low-latency structured responses.
 */
export const DEFAULT_CONVERSATION_MODEL = "gpt-4o-mini";

/**
 * Error thrown by conversation LLM providers with structured diagnostic codes.
 */
export class ConversationLlmError extends Error {
  public readonly code:
    | "API_KEY_MISSING"
    | "PROVIDER_UNAVAILABLE"
    | "TIMEOUT"
    | "MODEL_REFUSAL"
    | "INVALID_RESPONSE_FORMAT"
    | "NETWORK_ERROR";
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ConversationLlmError["code"],
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ConversationLlmError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Sanitizes error messages to prevent accidental leaking of API keys or sensitive URLs.
 */
export function sanitizeProviderErrorMessage(error: unknown, apiKey?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (apiKey && apiKey.length > 5) {
    message = message.split(apiKey).join("[REDACTED_API_KEY]");
  }
  return message;
}

/**
 * Mock LLM provider for hermetic unit and integration testing.
 */
export class MockConversationLlmProvider implements ConversationLlmProvider {
  private handler?: (request: ConversationLlmRequest) => Promise<ConversationLlmRawResponse>;

  constructor(
    handler?: (request: ConversationLlmRequest) => Promise<ConversationLlmRawResponse>
  ) {
    this.handler = handler;
  }

  public setHandler(
    handler: (request: ConversationLlmRequest) => Promise<ConversationLlmRawResponse>
  ): void {
    this.handler = handler;
  }

  public async generateResponse(
    request: ConversationLlmRequest
  ): Promise<ConversationLlmRawResponse> {
    if (this.handler) {
      return this.handler(request);
    }

    // Default mock response
    return {
      replyText: `Hello! I see you said: "${request.userMessage.slice(0, 30)}"`,
      expression: "happy",
      notificationIntensity: "normal",
    };
  }
}

/**
 * Options for configuring the OpenAIConversationLlmProvider.
 */
export interface OpenAIConversationProviderOptions {
  /** Optional API key (defaults to process.env.OPENAI_API_KEY) */
  readonly apiKey?: string;
  /** Optional custom base URL (e.g. for enterprise proxy / testing) */
  readonly baseURL?: string;
  /** Conversation model identifier (defaults to gpt-4o-mini) */
  readonly model?: string;
  /** Timeout in milliseconds (default: 3000ms) */
  readonly timeoutMs?: number;
  /** Injected OpenAI client instance (for testing) */
  readonly client?: OpenAI;
}

/**
 * Host-side OpenAI provider for AI Conversation with Structured Outputs.
 */
export class OpenAIConversationLlmProvider implements ConversationLlmProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;

  constructor(options: OpenAIConversationProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || DEFAULT_CONVERSATION_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CONVERSATION_TIMEOUT_MS;

    if (options.client) {
      this.client = options.client;
    } else {
      if (!this.apiKey || this.apiKey.trim() === "") {
        throw new ConversationLlmError(
          "API_KEY_MISSING",
          "OpenAI API key is missing. Set OPENAI_API_KEY in environment or configure provider options."
        );
      }

      this.client = new OpenAI({
        apiKey: this.apiKey.trim(),
        baseURL: options.baseURL,
        timeout: this.timeoutMs,
      });
    }
  }

  public async generateResponse(
    request: ConversationLlmRequest
  ): Promise<ConversationLlmRawResponse> {
    const messages = buildChatMessages(request);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: messages as OpenAI.ChatCompletionMessageParam[],
          response_format: {
            type: "json_schema",
            json_schema: CONVERSATION_RESPONSE_JSON_SCHEMA,
          },
        },
        { signal: controller.signal }
      );

      const choice = completion.choices?.[0];
      if (!choice) {
        throw new ConversationLlmError(
          "INVALID_RESPONSE_FORMAT",
          "OpenAI returned an empty choices array"
        );
      }

      // Check for refusal
      if (choice.message.refusal) {
        throw new ConversationLlmError(
          "MODEL_REFUSAL",
          `Model refused request: ${choice.message.refusal}`
        );
      }

      const content = choice.message.content;
      if (!content || content.trim() === "") {
        throw new ConversationLlmError(
          "INVALID_RESPONSE_FORMAT",
          "OpenAI returned empty message content"
        );
      }

      const parsed = JSON.parse(content);
      return {
        replyText: String(parsed.replyText ?? ""),
        expression: String(parsed.expression ?? ""),
        notificationIntensity: parsed.notificationIntensity
          ? String(parsed.notificationIntensity)
          : undefined,
      };
    } catch (err) {
      if (err instanceof ConversationLlmError) {
        throw err;
      }

      // Check for abort / timeout
      if (
        (err as { name?: string })?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        throw new ConversationLlmError(
          "TIMEOUT",
          `Conversation request timed out after ${this.timeoutMs}ms`
        );
      }

      const sanitizedMessage = sanitizeProviderErrorMessage(err, this.apiKey);
      throw new ConversationLlmError(
        "NETWORK_ERROR",
        `OpenAI request failed: ${sanitizedMessage}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
