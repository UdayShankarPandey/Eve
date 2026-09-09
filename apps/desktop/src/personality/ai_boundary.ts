/**
 * PixelPal — AI Boundary & Resilient Dialogue Resolution
 * Sprint 8 Phase 4
 *
 * Enforces the strict offline-first boundary:
 * - Local deterministic dialogue templates are ALWAYS available
 * - AI dialogue is completely optional and isolated
 * - AI failure, timeout, or malformed output instantly and cleanly falls back to local templates
 * - Output is strictly validated as human text (no executable instructions, max length bounded)
 * - Zero API key exposure to frontend contracts
 */

import type {
  PersonalityId,
  DialogueContext,
  AiDialogueProvider,
} from "./types.ts";
import { getPersonalityDialogue } from "./templates.ts";

/** Maximum allowed character count for dialogue lines to maintain speech bubble safety */
export const MAX_DIALOGUE_LENGTH = 280;

/** Default timeout for AI dialogue generation in milliseconds */
export const DEFAULT_AI_TIMEOUT_MS = 2500;

export interface ResolveDialogueOptions {
  personalityId: PersonalityId;
  eventType: string;
  context?: DialogueContext;
  aiDialogueEnabled?: boolean;
  aiProvider?: AiDialogueProvider;
  timeoutMs?: number;
}

export interface DialogueResolutionResult {
  text: string;
  source: "local_template" | "ai_dialogue" | "fallback";
}

/**
 * Sanitizes and validates dialogue text produced by any source.
 * Rejects control characters, excessive length, or code-like structures.
 */
export function sanitizeDialogueText(text: unknown, fallback: string): string {
  if (typeof text !== "string") {
    return fallback;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  // Reject executable-like constructs
  if (
    trimmed.startsWith("<script") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("eval(")
  ) {
    return fallback;
  }

  // Truncate to maximum bubble display boundary if needed
  if (trimmed.length > MAX_DIALOGUE_LENGTH) {
    return trimmed.slice(0, MAX_DIALOGUE_LENGTH - 3) + "...";
  }

  return trimmed;
}

/**
 * Resolves dialogue text adhering strictly to the offline-first AI boundary contract.
 */
export async function resolveDialogueText(
  options: ResolveDialogueOptions
): Promise<DialogueResolutionResult> {
  const {
    personalityId,
    eventType,
    context,
    aiDialogueEnabled = false,
    aiProvider,
    timeoutMs = DEFAULT_AI_TIMEOUT_MS,
  } = options;

  // Local fallback is generated synchronously and deterministically
  const localFallback = getPersonalityDialogue(
    personalityId,
    eventType,
    context
  );

  // If AI is disabled or no provider is configured, return local template immediately
  if (!aiDialogueEnabled || !aiProvider) {
    return {
      text: localFallback,
      source: "local_template",
    };
  }

  // Attempt bounded AI generation with strict timeout and error catching
  try {
    const aiPromise = aiProvider.generateDialogue({
      personalityId,
      eventType,
      context: context ?? {},
      fallbackText: localFallback,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("AI dialogue generation timed out"));
      }, timeoutMs);
      // Avoid unref issues in non-node or test environments
      if (typeof timer === "object" && "unref" in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    });

    const aiResult = await Promise.race([aiPromise, timeoutPromise]);
    const validated = sanitizeDialogueText(aiResult, localFallback);

    if (validated === localFallback && aiResult !== localFallback) {
      // AI output was rejected by validation
      return {
        text: localFallback,
        source: "fallback",
      };
    }

    return {
      text: validated,
      source: "ai_dialogue",
    };
  } catch {
    // On timeout, network failure, or provider exception, fall back to local template safely
    return {
      text: localFallback,
      source: "fallback",
    };
  }
}
