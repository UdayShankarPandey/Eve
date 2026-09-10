/**
 * PixelPal — Deterministic Conversation Fallback Library
 * Sprint 9 Phase 5
 *
 * Provides guaranteed, offline-resilient local conversational fallbacks
 * across all 6 canonical personalities when the AI provider fails, times out,
 * or is disabled.
 */

import { PersonalityIds, type PersonalityId } from "../../../../packages/shared-types/src/personality.ts";
import type { CharacterExpressionId } from "../../../../packages/shared-types/src/character.ts";
import { NotificationIntensities } from "../../../../packages/shared-types/src/personality.ts";
import { type ValidatedCharacterResponse } from "./types.ts";

/**
 * Fallback preset definition per personality.
 */
export interface PersonalityFallbackPreset {
  readonly replyText: string;
  readonly expressionId: CharacterExpressionId;
}

/**
 * Canonical fallback presets for each of the 6 MVP personalities.
 */
export const PERSONALITY_CONVERSATION_FALLBACKS: Readonly<Record<PersonalityId, PersonalityFallbackPreset>> = {
  [PersonalityIds.CUTE]: {
    replyText: "Eep! My thoughts got tangled up in my circuits! Can you say that again?",
    expressionId: "worried",
  },
  [PersonalityIds.FRIENDLY]: {
    replyText: "I'm having a little trouble connecting right now, but I'm still right here with you!",
    expressionId: "thinking",
  },
  [PersonalityIds.SARCASTIC]: {
    replyText: "Brain freeze. Ask me again when the connection decides to cooperate.",
    expressionId: "thinking",
  },
  [PersonalityIds.CHAOTIC]: {
    replyText: "STATIC IN THE CIRCUITS! Rebooting conversational hyper-drive right now!",
    expressionId: "panic",
  },
  [PersonalityIds.CALM]: {
    replyText: "I'm taking a quiet moment. Let's try again in a little bit.",
    expressionId: "sleepy",
  },
  [PersonalityIds.PROFESSIONAL]: {
    replyText: "Connection unavailable. Operating in local mode. Please retry your inquiry.",
    expressionId: "idle",
  },
};

/**
 * Generates a safe, in-character fallback response for any failure reason.
 */
export function getLocalConversationFallback(
  personalityId: PersonalityId,
  reason: string = "AI conversation unavailable"
): ValidatedCharacterResponse {
  const preset =
    PERSONALITY_CONVERSATION_FALLBACKS[personalityId] ||
    PERSONALITY_CONVERSATION_FALLBACKS[PersonalityIds.FRIENDLY];

  return {
    replyText: preset.replyText,
    expressionId: preset.expressionId,
    notificationIntensity: NotificationIntensities.NORMAL,
    source: "fallback",
    fallbackReason: reason,
  };
}
