/**
 * PixelPal — Independent Structured Response Validator
 * Sprint 9 Phase 4
 *
 * Implements strict application-side schema and semantic validation of LLM output:
 * - Independent of provider claims (never trust raw JSON blindly)
 * - Enforces Sprint 7 expression taxonomy (falls back safely to valid expression)
 * - Enforces NotificationIntensity bounds
 * - Sanitizes reply text (max 280 characters, strips script/injection constructs)
 * - Rejects empty, corrupted, or command-like output
 */

import {
  ALL_CHARACTER_EXPRESSION_IDS,
  type CharacterExpressionId,
} from "../../../../packages/shared-types/src/character.ts";
import {
  ALL_NOTIFICATION_INTENSITIES,
  type NotificationIntensity,
  NotificationIntensities,
} from "../../../../packages/shared-types/src/personality.ts";
import {
  type ValidatedCharacterResponse,
  MAX_REPLY_TEXT_LENGTH,
} from "./types.ts";

export interface ValidationSuccess {
  readonly valid: true;
  readonly data: ValidatedCharacterResponse;
}

export interface ValidationFailure {
  readonly valid: false;
  readonly error: string;
}

export type ResponseValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validates if an unknown string is a canonical CharacterExpressionId from Sprint 7.
 */
export function isValidCharacterExpression(val: unknown): val is CharacterExpressionId {
  return (
    typeof val === "string" &&
    ALL_CHARACTER_EXPRESSION_IDS.includes(val.toLowerCase().trim() as CharacterExpressionId)
  );
}

/**
 * Validates if an unknown string is a canonical NotificationIntensity.
 */
export function isValidNotificationIntensity(val: unknown): val is NotificationIntensity {
  return (
    typeof val === "string" &&
    ALL_NOTIFICATION_INTENSITIES.includes(val.toLowerCase().trim() as NotificationIntensity)
  );
}

/**
 * Sanitizes reply text to ensure safe display in the companion speech bubble.
 * Strips script tags, javascript schemes, and bounds length.
 */
export function sanitizeReplyText(text: unknown): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Reject executable or script-like patterns
  if (
    trimmed.startsWith("<script") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("eval(") ||
    trimmed.startsWith("exec(")
  ) {
    return null;
  }

  // Bound to maximum bubble length
  return trimmed.length > MAX_REPLY_TEXT_LENGTH
    ? trimmed.slice(0, MAX_REPLY_TEXT_LENGTH - 3) + "..."
    : trimmed;
}

/**
 * Validates a raw response object or parsed JSON from the LLM provider.
 */
export function validateStructuredLlmResponse(
  raw: unknown,
  fallbackExpression: CharacterExpressionId = "idle"
): ResponseValidationResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "Response is not a valid JSON object" };
  }

  const record = raw as Record<string, unknown>;

  // 1. Validate & sanitize replyText
  const replyText = sanitizeReplyText(record.replyText);
  if (!replyText) {
    return {
      valid: false,
      error: "Missing, empty, or invalid 'replyText' in response",
    };
  }

  // 2. Validate expression (falls back safely if unknown string)
  let expressionId: CharacterExpressionId = fallbackExpression;
  if (isValidCharacterExpression(record.expression)) {
    expressionId = record.expression.toLowerCase().trim() as CharacterExpressionId;
  }

  // 3. Validate notificationIntensity (falls back to normal if invalid)
  let notificationIntensity: NotificationIntensity = NotificationIntensities.NORMAL;
  if (isValidNotificationIntensity(record.notificationIntensity)) {
    notificationIntensity = record.notificationIntensity
      .toLowerCase()
      .trim() as NotificationIntensity;
  }

  return {
    valid: true,
    data: {
      replyText,
      expressionId,
      notificationIntensity,
      source: "llm",
    },
  };
}

/**
 * Parses raw JSON text string and validates it against the structured response schema.
 */
export function parseAndValidateLlmResponse(
  rawJson: string,
  fallbackExpression?: CharacterExpressionId
): ResponseValidationResult {
  if (!rawJson || rawJson.trim() === "") {
    return { valid: false, error: "Raw response text is empty" };
  }

  try {
    const parsed = JSON.parse(rawJson);
    return validateStructuredLlmResponse(parsed, fallbackExpression);
  } catch (err) {
    return {
      valid: false,
      error: `Failed to parse JSON response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
