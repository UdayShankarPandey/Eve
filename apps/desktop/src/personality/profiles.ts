/**
 * PixelPal — Canonical Personality Profiles & Registry
 * Sprint 8 Phase 1
 *
 * Implements the 6 MVP personalities:
 * - Cute
 * - Friendly (Canonical Default)
 * - Sarcastic
 * - Chaotic
 * - Calm
 * - Professional
 *
 * Provides strict validation and safe recovery defaults.
 */

import {
  PersonalityIds,
  ALL_PERSONALITY_IDS,
  DEFAULT_PERSONALITY_ID,
  ReactionFrequencies,
  ALL_REACTION_FREQUENCIES,
  NotificationIntensities,
  ALL_NOTIFICATION_INTENSITIES,
  DEFAULT_PERSONALITY_CONFIG,
  type PersonalityId,
  type PersonalityProfile,
  type PersonalityConfig,
  type ReactionFrequency,
  type NotificationIntensity,
} from "./types.ts";
import { EventTypes } from "../../../../packages/shared-types/src/events.ts";
import { CharacterExpressionIds } from "../../../../packages/shared-types/src/character.ts";
import { AnimationIds } from "../animation/types.ts";

/**
 * Validates if an unknown value is a valid canonical PersonalityId.
 */
export function isValidPersonalityId(value: unknown): value is PersonalityId {
  return (
    typeof value === "string" &&
    ALL_PERSONALITY_IDS.includes(value.toLowerCase().trim() as PersonalityId)
  );
}

/**
 * Normalizes input to a valid canonical PersonalityId, falling back safely to default.
 */
export function normalizePersonalityId(value: unknown): PersonalityId {
  if (typeof value === "string") {
    const cleaned = value.toLowerCase().trim() as PersonalityId;
    if (ALL_PERSONALITY_IDS.includes(cleaned)) {
      return cleaned;
    }
  }
  return DEFAULT_PERSONALITY_ID;
}

/**
 * Validates if an unknown value is a valid canonical ReactionFrequency.
 */
export function isValidReactionFrequency(
  value: unknown
): value is ReactionFrequency {
  return (
    typeof value === "string" &&
    ALL_REACTION_FREQUENCIES.includes(value.toLowerCase().trim() as ReactionFrequency)
  );
}

/**
 * Validates if an unknown value is a valid canonical NotificationIntensity.
 */
export function isValidNotificationIntensity(
  value: unknown
): value is NotificationIntensity {
  return (
    typeof value === "string" &&
    ALL_NOTIFICATION_INTENSITIES.includes(
      value.toLowerCase().trim() as NotificationIntensity
    )
  );
}

/**
 * Validates and sanitizes a complete PersonalityConfig object.
 * Corrupted or invalid fields safely fall back to canonical defaults.
 */
export function validatePersonalityConfig(raw: unknown): PersonalityConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PERSONALITY_CONFIG, updatedAt: Date.now() };
  }

  const record = raw as Record<string, unknown>;

  const personalityId = isValidPersonalityId(record.personalityId)
    ? (record.personalityId.toLowerCase().trim() as PersonalityId)
    : DEFAULT_PERSONALITY_ID;

  const frequency = isValidReactionFrequency(record.frequency)
    ? (record.frequency.toLowerCase().trim() as ReactionFrequency)
    : ReactionFrequencies.NORMAL;

  const intensity = isValidNotificationIntensity(record.intensity)
    ? (record.intensity.toLowerCase().trim() as NotificationIntensity)
    : NotificationIntensities.NORMAL;

  const aiDialogueEnabled = typeof record.aiDialogueEnabled === "boolean"
    ? record.aiDialogueEnabled
    : false;

  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : Date.now();

  return {
    schemaVersion: 1,
    personalityId,
    frequency,
    intensity,
    aiDialogueEnabled,
    updatedAt,
  };
}

/**
 * Canonical 6 MVP Personality Profiles.
 */
export const PERSONALITY_PROFILES: Readonly<Record<PersonalityId, PersonalityProfile>> = {
  [PersonalityIds.CUTE]: {
    id: PersonalityIds.CUTE,
    name: "Cute",
    description: "Playful, enthusiastic companion that shows high emotional warmth and delight.",
    tone: "cheerful, expressive, affectionate",
    defaultFrequency: ReactionFrequencies.HIGH,
    defaultIntensity: NotificationIntensities.EXPRESSIVE,
    preferredExpressions: {
      [EventTypes.BATTERY_CRITICAL]: CharacterExpressionIds.PANIC,
      [EventTypes.BATTERY_LOW]: CharacterExpressionIds.WORRIED,
      [EventTypes.CHARGING_STARTED]: CharacterExpressionIds.CELEBRATE,
      [EventTypes.CHARGING_STOPPED]: CharacterExpressionIds.WORRIED,
      [EventTypes.NETWORK_CONNECTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.NETWORK_DISCONNECTED]: CharacterExpressionIds.SAD,
      [EventTypes.DOWNLOAD_COMPLETED]: CharacterExpressionIds.CELEBRATE,
      [EventTypes.USER_IDLE]: CharacterExpressionIds.SLEEPY,
      [EventTypes.USER_ACTIVE]: CharacterExpressionIds.HAPPY,
      [EventTypes.PC_LOCKED]: CharacterExpressionIds.SLEEPY,
      [EventTypes.PC_UNLOCKED]: CharacterExpressionIds.SURPRISED,
      [EventTypes.APP_OPENED]: CharacterExpressionIds.HAPPY,
    },
  },

  [PersonalityIds.FRIENDLY]: {
    id: PersonalityIds.FRIENDLY,
    name: "Friendly",
    description: "Supportive, positive companion that encourages you and keeps a balanced demeanor.",
    tone: "supportive, warm, balanced",
    defaultFrequency: ReactionFrequencies.NORMAL,
    defaultIntensity: NotificationIntensities.NORMAL,
    preferredExpressions: {
      [EventTypes.BATTERY_CRITICAL]: CharacterExpressionIds.SAD,
      [EventTypes.BATTERY_LOW]: CharacterExpressionIds.WORRIED,
      [EventTypes.CHARGING_STARTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.CHARGING_STOPPED]: CharacterExpressionIds.WORRIED,
      [EventTypes.NETWORK_CONNECTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.NETWORK_DISCONNECTED]: CharacterExpressionIds.WORRIED,
      [EventTypes.DOWNLOAD_COMPLETED]: CharacterExpressionIds.HAPPY,
      [EventTypes.USER_IDLE]: CharacterExpressionIds.SLEEPY,
      [EventTypes.USER_ACTIVE]: CharacterExpressionIds.HAPPY,
      [EventTypes.PC_LOCKED]: CharacterExpressionIds.SLEEPY,
      [EventTypes.PC_UNLOCKED]: CharacterExpressionIds.SURPRISED,
      [EventTypes.APP_OPENED]: CharacterExpressionIds.SURPRISED,
    },
  },

  [PersonalityIds.SARCASTIC]: {
    id: PersonalityIds.SARCASTIC,
    name: "Sarcastic",
    description: "Sharp-witted companion that offers clever commentary and dry humor while remaining bounded.",
    tone: "dry, witty, playful teasing",
    defaultFrequency: ReactionFrequencies.NORMAL,
    defaultIntensity: NotificationIntensities.NORMAL,
    preferredExpressions: {
      [EventTypes.BATTERY_CRITICAL]: CharacterExpressionIds.WORRIED,
      [EventTypes.BATTERY_LOW]: CharacterExpressionIds.THINKING,
      [EventTypes.CHARGING_STARTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.CHARGING_STOPPED]: CharacterExpressionIds.THINKING,
      [EventTypes.NETWORK_CONNECTED]: CharacterExpressionIds.THINKING,
      [EventTypes.NETWORK_DISCONNECTED]: CharacterExpressionIds.WORRIED,
      [EventTypes.DOWNLOAD_COMPLETED]: CharacterExpressionIds.THINKING,
      [EventTypes.USER_IDLE]: CharacterExpressionIds.THINKING,
      [EventTypes.USER_ACTIVE]: CharacterExpressionIds.SURPRISED,
      [EventTypes.PC_LOCKED]: CharacterExpressionIds.SLEEPY,
      [EventTypes.PC_UNLOCKED]: CharacterExpressionIds.THINKING,
      [EventTypes.APP_OPENED]: CharacterExpressionIds.THINKING,
    },
  },

  [PersonalityIds.CHAOTIC]: {
    id: PersonalityIds.CHAOTIC,
    name: "Chaotic",
    description: "High-energy companion with dramatic reactions, unpredictable excitement, and high variety.",
    tone: "energetic, dramatic, quirky",
    defaultFrequency: ReactionFrequencies.HIGH,
    defaultIntensity: NotificationIntensities.EXPRESSIVE,
    preferredExpressions: {
      [EventTypes.BATTERY_CRITICAL]: CharacterExpressionIds.PANIC,
      [EventTypes.BATTERY_LOW]: CharacterExpressionIds.PANIC,
      [EventTypes.CHARGING_STARTED]: CharacterExpressionIds.CELEBRATE,
      [EventTypes.CHARGING_STOPPED]: CharacterExpressionIds.PANIC,
      [EventTypes.NETWORK_CONNECTED]: CharacterExpressionIds.CELEBRATE,
      [EventTypes.NETWORK_DISCONNECTED]: CharacterExpressionIds.PANIC,
      [EventTypes.DOWNLOAD_COMPLETED]: CharacterExpressionIds.CELEBRATE,
      [EventTypes.USER_IDLE]: CharacterExpressionIds.SLEEPY,
      [EventTypes.USER_ACTIVE]: CharacterExpressionIds.CELEBRATE,
      [EventTypes.PC_LOCKED]: CharacterExpressionIds.SLEEPY,
      [EventTypes.PC_UNLOCKED]: CharacterExpressionIds.SURPRISED,
      [EventTypes.APP_OPENED]: CharacterExpressionIds.SURPRISED,
    },
  },

  [PersonalityIds.CALM]: {
    id: PersonalityIds.CALM,
    name: "Calm",
    description: "Tranquil and serene companion that keeps notifications low-key, peaceful, and gentle.",
    tone: "composed, gentle, peaceful",
    defaultFrequency: ReactionFrequencies.LOW,
    defaultIntensity: NotificationIntensities.QUIET,
    preferredExpressions: {
      [EventTypes.BATTERY_CRITICAL]: CharacterExpressionIds.WORRIED,
      [EventTypes.BATTERY_LOW]: CharacterExpressionIds.THINKING,
      [EventTypes.CHARGING_STARTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.CHARGING_STOPPED]: CharacterExpressionIds.THINKING,
      [EventTypes.NETWORK_CONNECTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.NETWORK_DISCONNECTED]: CharacterExpressionIds.WORRIED,
      [EventTypes.DOWNLOAD_COMPLETED]: CharacterExpressionIds.HAPPY,
      [EventTypes.USER_IDLE]: CharacterExpressionIds.SLEEPY,
      [EventTypes.USER_ACTIVE]: CharacterExpressionIds.HAPPY,
      [EventTypes.PC_LOCKED]: CharacterExpressionIds.SLEEPY,
      [EventTypes.PC_UNLOCKED]: CharacterExpressionIds.HAPPY,
      [EventTypes.APP_OPENED]: AnimationIds.IDLE,
    },
  },

  [PersonalityIds.PROFESSIONAL]: {
    id: PersonalityIds.PROFESSIONAL,
    name: "Professional",
    description: "Direct and efficient companion focused on status updates, productivity, and clarity.",
    tone: "concise, formal, structured",
    defaultFrequency: ReactionFrequencies.LOW,
    defaultIntensity: NotificationIntensities.QUIET,
    preferredExpressions: {
      [EventTypes.BATTERY_CRITICAL]: CharacterExpressionIds.WORRIED,
      [EventTypes.BATTERY_LOW]: CharacterExpressionIds.WORRIED,
      [EventTypes.CHARGING_STARTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.CHARGING_STOPPED]: CharacterExpressionIds.THINKING,
      [EventTypes.NETWORK_CONNECTED]: CharacterExpressionIds.HAPPY,
      [EventTypes.NETWORK_DISCONNECTED]: CharacterExpressionIds.WORRIED,
      [EventTypes.DOWNLOAD_COMPLETED]: AnimationIds.IDLE,
      [EventTypes.USER_IDLE]: CharacterExpressionIds.SLEEPY,
      [EventTypes.USER_ACTIVE]: AnimationIds.IDLE,
      [EventTypes.PC_LOCKED]: CharacterExpressionIds.SLEEPY,
      [EventTypes.PC_UNLOCKED]: AnimationIds.IDLE,
      [EventTypes.APP_OPENED]: CharacterExpressionIds.THINKING,
    },
  },
};

/**
 * Retrieves a PersonalityProfile by ID. Safely falls back to Friendly if invalid.
 */
export function getPersonalityProfile(id: PersonalityId): PersonalityProfile {
  const normalized = normalizePersonalityId(id);
  return PERSONALITY_PROFILES[normalized] || PERSONALITY_PROFILES[DEFAULT_PERSONALITY_ID];
}
