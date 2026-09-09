/**
 * PixelPal — Personality Engine Shared Types & Contracts
 * Sprint 8 Foundation
 *
 * Provides domain representations for:
 * - Canonical 6-personality MVP profiles (Cute, Friendly, Sarcastic, Chaotic, Calm, Professional)
 * - Reaction frequency and notification intensity controls
 * - Persisted personality configuration (independent from CharacterProfile identity)
 * - Dialogue templates and bounded context variables
 * - Final presentation outcome contract
 */

import type { AnimationId } from "./animation.ts";
import type { CharacterExpressionId } from "./character.ts";

/**
 * Canonical 6 MVP Personality Identifiers.
 * Strictly closed set preventing arbitrary strings from entering the domain.
 */
export const PersonalityIds = {
  CUTE: "cute",
  FRIENDLY: "friendly",
  SARCASTIC: "sarcastic",
  CHAOTIC: "chaotic",
  CALM: "calm",
  PROFESSIONAL: "professional",
} as const;

export type PersonalityId =
  (typeof PersonalityIds)[keyof typeof PersonalityIds];

/**
 * All valid canonical personality IDs for fast validation.
 */
export const ALL_PERSONALITY_IDS: readonly PersonalityId[] = [
  PersonalityIds.CUTE,
  PersonalityIds.FRIENDLY,
  PersonalityIds.SARCASTIC,
  PersonalityIds.CHAOTIC,
  PersonalityIds.CALM,
  PersonalityIds.PROFESSIONAL,
] as const;

/** Canonical default personality if none configured or on safe fallback */
export const DEFAULT_PERSONALITY_ID: PersonalityId = PersonalityIds.FRIENDLY;

/**
 * Reaction Frequency levels.
 * Shapes presentation frequency of non-critical reactions.
 * Critical reactions (e.g. BATTERY_CRITICAL) are NEVER suppressed.
 */
export const ReactionFrequencies = {
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
} as const;

export type ReactionFrequency =
  (typeof ReactionFrequencies)[keyof typeof ReactionFrequencies];

export const ALL_REACTION_FREQUENCIES: readonly ReactionFrequency[] = [
  ReactionFrequencies.LOW,
  ReactionFrequencies.NORMAL,
  ReactionFrequencies.HIGH,
] as const;

/**
 * Notification Intensity levels.
 * Governs visual/audio presence without controlling arbitrary OS notification APIs.
 */
export const NotificationIntensities = {
  QUIET: "quiet",
  NORMAL: "normal",
  EXPRESSIVE: "expressive",
} as const;

export type NotificationIntensity =
  (typeof NotificationIntensities)[keyof typeof NotificationIntensities];

export const ALL_NOTIFICATION_INTENSITIES: readonly NotificationIntensity[] = [
  NotificationIntensities.QUIET,
  NotificationIntensities.NORMAL,
  NotificationIntensities.EXPRESSIVE,
] as const;

/**
 * Personality Profile definition answering "HOW does this character behave?".
 * Completely separated from CharacterProfile identity fields.
 */
export interface PersonalityProfile {
  /** Canonical personality identifier */
  readonly id: PersonalityId;
  /** Display title (e.g., "Cute", "Friendly") */
  readonly name: string;
  /** Behavioral description */
  readonly description: string;
  /** Emotional tone descriptor */
  readonly tone: string;
  /** Default reaction frequency for this profile */
  readonly defaultFrequency: ReactionFrequency;
  /** Default notification intensity for this profile */
  readonly defaultIntensity: NotificationIntensity;
  /**
   * Preferred expression or animation mappings for canonical events.
   * Maps event type or standard reaction animation to preferred expression.
   */
  readonly preferredExpressions: Partial<
    Record<string, CharacterExpressionId | AnimationId>
  >;
}

/**
 * Persisted user personality configuration.
 * Stored as user configuration in persistent desktop storage, independent of CharacterProfile.
 */
export interface PersonalityConfig {
  readonly schemaVersion: 1;
  readonly personalityId: PersonalityId;
  readonly frequency: ReactionFrequency;
  readonly intensity: NotificationIntensity;
  readonly aiDialogueEnabled: boolean;
  readonly updatedAt: number;
}

/**
 * Deterministic safe default configuration.
 */
export const DEFAULT_PERSONALITY_CONFIG: PersonalityConfig = {
  schemaVersion: 1,
  personalityId: DEFAULT_PERSONALITY_ID,
  frequency: ReactionFrequencies.NORMAL,
  intensity: NotificationIntensities.NORMAL,
  aiDialogueEnabled: false,
  updatedAt: 0,
};

/**
 * Bounded, privacy-safe dialogue variable context.
 * Strictly adheres to Sprint 5 privacy boundaries:
 * - No sensitive window titles or unredacted raw desktop dumps
 * - Only approved structured fields from existing event schemas
 */
export interface DialogueContext {
  readonly battery_percent?: number;
  readonly ac_line_status?: number;
  readonly network_connected?: boolean;
  readonly network_type?: string;
  readonly app_name?: string;
  readonly filename?: string;
  readonly idle_minutes?: number;
  readonly character_name?: string;
  readonly [key: string]: unknown;
}

/**
 * Presentation outcome produced by the Personality Engine for an accepted reaction.
 */
export interface PersonalityPresentation {
  /** Selected animation ID (from AnimationVocabulary or CharacterExpressionRegistry) */
  readonly animationId: AnimationId | CharacterExpressionId;
  /** Deterministic dialogue text to display (e.g. in speech bubble) */
  readonly dialogueText: string;
  /** Selected presentation intensity */
  readonly notificationIntensity: NotificationIntensity;
  /** Selected personality ID */
  readonly personalityId: PersonalityId;
  /** Whether the reaction's presentation was muted/suppressed by frequency configuration */
  readonly isSuppressedByFrequency: boolean;
  /** Generation source (local deterministic template vs optional AI boundary) */
  readonly source: "local_template" | "ai_dialogue" | "fallback";
}
