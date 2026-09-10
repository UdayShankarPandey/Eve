/**
 * PixelPal — Desktop AI Conversation Types & Interfaces
 * Sprint 9
 */

import type {
  ConversationMessage,
  ConversationLlmRequest,
  ConversationLlmRawResponse,
} from "../../../../packages/shared-types/src/conversation.ts";

export * from "../../../../packages/shared-types/src/conversation.ts";

/**
 * Storage adapter interface for persisting conversation history.
 */
export interface ConversationStorageAdapter {
  /**
   * Loads persisted conversation history, recovering safely on missing/corrupt files.
   */
  loadHistory(): Promise<ConversationMessage[]>;

  /**
   * Persists conversation history atomically.
   */
  saveHistory(messages: readonly ConversationMessage[]): Promise<void>;

  /**
   * Clears persisted conversation history.
   */
  clearHistory(): Promise<void>;
}

/**
 * Host-side LLM provider interface for conversational turns.
 */
export interface ConversationLlmProvider {
  /**
   * Generates a structured conversational response.
   * On failure, timeout, or refusal, throws an error so the caller can trigger safe fallback.
   */
  generateResponse(request: ConversationLlmRequest): Promise<ConversationLlmRawResponse>;
}
