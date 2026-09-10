/**
 * PixelPal — AI Conversation Shared Types & Contracts
 * Sprint 9 Foundation
 *
 * Defines canonical data contracts for:
 * - Conversational roles, turns, and messages
 * - Strictly allowlisted desktop context
 * - LLM request and structured response schema
 * - Validated character response and fallback metadata
 */

import type { CharacterExpressionId } from "./character.ts";
import type { PersonalityId, NotificationIntensity } from "./personality.ts";

/**
 * Closed set of conversational message roles.
 */
export type ConversationRole = "user" | "assistant";

/**
 * Structured conversational message record.
 */
export interface ConversationMessage {
  /** Unique message identifier (e.g., msg_<timestamp>_<randomHex>) */
  readonly id: string;
  /** Role of the speaker */
  readonly role: ConversationRole;
  /** Sanitized message text */
  readonly content: string;
  /** Epoch timestamp in milliseconds */
  readonly timestamp: number;
  /** Optional expression associated with assistant replies */
  readonly expressionId?: CharacterExpressionId;
}

/**
 * Bounded summary of a recent desktop event approved for conversational awareness.
 */
export interface BoundedEventSummary {
  /** Canonical event type (e.g. "DOWNLOAD_COMPLETED") */
  readonly eventType: string;
  /** Epoch timestamp in milliseconds */
  readonly timestamp: number;
  /** Brief, privacy-safe descriptor (e.g. "archive.zip finished downloading") */
  readonly summary: string;
}

/**
 * Strictly allowlisted and bounded desktop context for conversational awareness.
 * Privacy Rule: No window titles, keystrokes, clipboard, process memory, or arbitrary paths.
 */
export interface ApprovedConversationContext {
  /** Current battery level in percentage (0–100) */
  readonly batteryPercent?: number;
  /** Whether the device is currently plugged into AC power */
  readonly isCharging?: boolean;
  /** Whether network connectivity is active */
  readonly networkConnected?: boolean;
  /** Network adapter category (e.g. "Wi-Fi", "Ethernet") */
  readonly networkType?: string;
  /** Duration of user inactivity in minutes */
  readonly idleMinutes?: number;
  /** Sanitized active application name only (strictly NO window title) */
  readonly activeAppName?: string;
  /** Bounded window of recent desktop events (maximum 3) */
  readonly recentEvents?: readonly BoundedEventSummary[];
}

/**
 * Sanitized personality metadata injected into conversational instructions.
 */
export interface SanitizedPersonalityContext {
  readonly id: PersonalityId;
  readonly name: string;
  readonly tone: string;
  readonly description: string;
}

/**
 * Host-side request contract passed to the Conversation LLM Provider.
 */
export interface ConversationLlmRequest {
  /** Latest user input */
  readonly userMessage: string;
  /** Bounded conversation history */
  readonly history: readonly ConversationMessage[];
  /** Filtered, allowlisted desktop context */
  readonly context: ApprovedConversationContext;
  /** Active companion personality description */
  readonly personality: SanitizedPersonalityContext;
}

/**
 * Raw structured response payload returned by the LLM before application-side validation.
 */
export interface ConversationLlmRawResponse {
  readonly replyText: string;
  readonly expression: string;
  readonly notificationIntensity?: string;
}

/**
 * Validated, renderer-safe character response ready for dialogue bubbles and expression animation.
 */
export interface ValidatedCharacterResponse {
  /** Display dialogue text (bounded to MAX_REPLY_TEXT_LENGTH) */
  readonly replyText: string;
  /** Guaranteed valid expression ID from Sprint 7 taxonomy */
  readonly expressionId: CharacterExpressionId;
  /** Presentation intensity */
  readonly notificationIntensity: NotificationIntensity;
  /** Source of the response: live LLM or local deterministic fallback */
  readonly source: "llm" | "fallback";
  /** Diagnostic reason if fallback occurred */
  readonly fallbackReason?: string;
}

/**
 * Safety bounds for conversation.
 */
export const MAX_USER_MESSAGE_LENGTH = 500;
export const MAX_REPLY_TEXT_LENGTH = 280;
export const MAX_CONVERSATION_MESSAGES = 20;
export const MAX_CONVERSATION_CHARACTERS = 4000;
export const MAX_RECENT_EVENTS_IN_CONTEXT = 3;
export const DEFAULT_CONVERSATION_TIMEOUT_MS = 3000;
