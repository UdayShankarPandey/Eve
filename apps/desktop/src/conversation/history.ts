/**
 * PixelPal — Bounded Conversation History & Input Validation
 * Sprint 9 Phase 1
 *
 * Implements:
 * - Deterministic message ID generation
 * - User input sanitization and length bounds
 * - Bounded history management (max 20 messages, max 4000 characters)
 * - Safe memory bounds without unbounded growth
 */

import * as crypto from "node:crypto";
import type { CharacterExpressionId } from "../../../../packages/shared-types/src/character.ts";
import {
  type ConversationMessage,
  type ConversationRole,
  MAX_USER_MESSAGE_LENGTH,
  MAX_CONVERSATION_MESSAGES,
  MAX_CONVERSATION_CHARACTERS,
} from "./types.ts";

/**
 * Generates a stable, collision-resistant message identifier.
 */
export function generateMessageId(): string {
  const timestamp = Date.now();
  const randomHex = crypto.randomBytes(4).toString("hex");
  return `msg_${timestamp}_${randomHex}`;
}

/**
 * Result of user input validation.
 */
export interface MessageValidationResult {
  readonly valid: boolean;
  readonly sanitized?: string;
  readonly error?: string;
}

/**
 * Validates and sanitizes incoming user text input.
 * Rejects empty or whitespace-only messages and enforces length bounds.
 */
export function validateUserMessage(input: unknown): MessageValidationResult {
  if (typeof input !== "string") {
    return { valid: false, error: "Message input must be a string" };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Message cannot be empty or whitespace-only" };
  }

  // Bound message length to protect against prompt stuffing and token exhaustion
  const sanitized =
    trimmed.length > MAX_USER_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_USER_MESSAGE_LENGTH)
      : trimmed;

  return { valid: true, sanitized };
}

/**
 * Validates if an unknown object conforms to a valid ConversationMessage record.
 */
export function isValidConversationMessage(raw: unknown): raw is ConversationMessage {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.trim().length > 0 &&
    (record.role === "user" || record.role === "assistant") &&
    typeof record.content === "string" &&
    typeof record.timestamp === "number" &&
    Number.isFinite(record.timestamp)
  );
}

/**
 * Calculates total character count across an array of messages.
 */
export function calculateTotalCharacters(messages: readonly ConversationMessage[]): number {
  return messages.reduce((acc, msg) => acc + msg.content.length, 0);
}

/**
 * Manages an in-memory bounded conversation history.
 */
export class ConversationHistoryManager {
  private messages: ConversationMessage[] = [];
  private readonly maxMessages: number;
  private readonly maxCharacters: number;

  constructor(options?: {
    readonly initialMessages?: readonly ConversationMessage[];
    readonly maxMessages?: number;
    readonly maxCharacters?: number;
  }) {
    this.maxMessages = options?.maxMessages ?? MAX_CONVERSATION_MESSAGES;
    this.maxCharacters = options?.maxCharacters ?? MAX_CONVERSATION_CHARACTERS;

    if (options?.initialMessages) {
      this.loadMessages(options.initialMessages);
    }
  }

  /**
   * Returns a copy of the current message history.
   */
  public getMessages(): readonly ConversationMessage[] {
    return [...this.messages];
  }

  /**
   * Clears all stored messages.
   */
  public clear(): void {
    this.messages = [];
  }

  /**
   * Loads existing messages, validating each and pruning to bounds.
   */
  public loadMessages(rawMessages: readonly unknown[]): void {
    const valid: ConversationMessage[] = [];
    for (const item of rawMessages) {
      if (isValidConversationMessage(item)) {
        valid.push(item);
      }
    }
    this.messages = valid;
    this.prune();
  }

  /**
   * Appends a new message to the history and enforces bounding constraints.
   */
  public append(
    role: ConversationRole,
    content: string,
    expressionId?: CharacterExpressionId
  ): ConversationMessage {
    const message: ConversationMessage = {
      id: generateMessageId(),
      role,
      content,
      timestamp: Date.now(),
      ...(expressionId ? { expressionId } : {}),
    };

    this.messages.push(message);
    this.prune();
    return message;
  }

  /**
   * Prunes messages from the start if count or character limits are exceeded.
   */
  private prune(): void {
    // 1. Enforce maximum message count
    while (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }

    // 2. Enforce maximum total characters across history
    while (
      this.messages.length > 1 &&
      calculateTotalCharacters(this.messages) > this.maxCharacters
    ) {
      this.messages.shift();
    }
  }
}
