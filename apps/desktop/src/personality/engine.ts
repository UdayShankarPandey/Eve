/**
 * PixelPal — Personality Engine Orchestrator
 * Sprint 8 Phase 3 & Phase 4
 *
 * Implements the core Personality Engine:
 * - Deterministic, configuration-driven behavior shaping
 * - Expression preference modulation
 * - Reaction frequency policy (CRITICAL alerts are NEVER suppressed)
 * - Notification intensity shaping
 * - Bounded, privacy-safe event variable extraction
 * - Offline-first AI dialogue boundary
 *
 * Architecture Invariant:
 * The Personality Engine does NOT replace ReactionResolver.
 * ReactionResolver is authoritative over reaction eligibility and cooldown.
 * PersonalityEngine shapes presentation of accepted reactions.
 */

import {
  ReactionPriority,
  type ReactionDefinition,
} from "../../../../packages/shared-types/src/reactions.ts";
import type { DesktopEvent } from "../../../../packages/shared-types/src/events.ts";
import type { AnimationId } from "../../../../packages/shared-types/src/animation.ts";
import type { CharacterExpressionId } from "../../../../packages/shared-types/src/character.ts";
import {
  type PersonalityId,
  type PersonalityConfig,
  type PersonalityProfile,
  type ReactionFrequency,
  type NotificationIntensity,
  type DialogueContext,
  type PersonalityPresentation,
  type PersonalityStorageAdapter,
  type AiDialogueProvider,
  ReactionFrequencies,
  DEFAULT_PERSONALITY_CONFIG,
} from "./types.ts";
import {
  getPersonalityProfile,
  normalizePersonalityId,
  isValidReactionFrequency,
  isValidNotificationIntensity,
  validatePersonalityConfig,
} from "./profiles.ts";
import { resolveDialogueText } from "./ai_boundary.ts";

/**
 * Extracts privacy-safe dialogue variables from a DesktopEvent.
 * Strictly adheres to Sprint 5 privacy boundaries:
 * - No sensitive window titles or unredacted raw desktop dumps
 * - Only approved structured fields from existing event schemas
 */
export function extractDialogueContext(event: DesktopEvent): DialogueContext {
  const payload = (event.payload || {}) as Record<string, unknown>;
  const context: Record<string, unknown> = {};

  // Battery variables
  if (typeof payload.battery_percent === "number") {
    context.battery_percent = Math.round(payload.battery_percent);
  }
  if (typeof payload.ac_line_status === "number") {
    context.ac_line_status = payload.ac_line_status;
  }

  // Network variables
  if (typeof payload.connected === "boolean") {
    context.network_connected = payload.connected;
  }
  if (typeof payload.network_type === "string") {
    context.network_type = payload.network_type;
  }

  // App variables (privacy safe: app_name only, no window_title or memory addresses)
  if (typeof payload.app_name === "string" && payload.app_name.trim() !== "") {
    context.app_name = payload.app_name.trim();
  }

  // Download variables (filename only, no local system paths)
  if (typeof payload.filename === "string" && payload.filename.trim() !== "") {
    context.filename = payload.filename.trim();
  }

  // User activity variables
  if (typeof payload.idle_duration_ms === "number") {
    context.idle_minutes = Math.max(1, Math.round(payload.idle_duration_ms / 60_000));
  }

  return context as DialogueContext;
}

/**
 * Personality Engine coordinating personality configuration, presentation shaping,
 * and resilient offline-first dialogue generation.
 */
export class PersonalityEngine {
  private config: PersonalityConfig;
  private readonly storage: PersonalityStorageAdapter;
  private readonly aiProvider?: AiDialogueProvider;
  private isInitialized = false;

  constructor(
    storage: PersonalityStorageAdapter,
    aiProvider?: AiDialogueProvider
  ) {
    this.storage = storage;
    this.aiProvider = aiProvider;
    this.config = { ...DEFAULT_PERSONALITY_CONFIG };
  }

  /**
   * Initializes the engine by loading persisted configuration.
   */
  public async init(): Promise<PersonalityConfig> {
    try {
      this.config = await this.storage.loadConfig();
    } catch {
      this.config = { ...DEFAULT_PERSONALITY_CONFIG, updatedAt: Date.now() };
    }
    this.isInitialized = true;
    return this.getConfig();
  }

  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Returns a copy of the active personality configuration.
   */
  public getConfig(): PersonalityConfig {
    return { ...this.config };
  }

  /**
   * Returns the behavioral profile for the active personality.
   */
  public getActiveProfile(): PersonalityProfile {
    return getPersonalityProfile(this.config.personalityId);
  }

  /**
   * Updates configuration and persists changes atomically.
   */
  public async updateConfig(
    partial: Partial<PersonalityConfig>
  ): Promise<PersonalityConfig> {
    const merged = validatePersonalityConfig({
      ...this.config,
      ...partial,
      updatedAt: Date.now(),
    });

    await this.storage.saveConfig(merged);
    this.config = merged;
    return this.getConfig();
  }

  /**
   * Sets the active personality ID.
   */
  public async setPersonality(personalityId: PersonalityId): Promise<PersonalityConfig> {
    const normalized = normalizePersonalityId(personalityId);
    return this.updateConfig({ personalityId: normalized });
  }

  /**
   * Sets reaction frequency ("low" | "normal" | "high").
   */
  public async setFrequency(frequency: ReactionFrequency): Promise<PersonalityConfig> {
    if (!isValidReactionFrequency(frequency)) {
      return this.getConfig();
    }
    return this.updateConfig({ frequency });
  }

  /**
   * Sets notification intensity ("quiet" | "normal" | "expressive").
   */
  public async setIntensity(intensity: NotificationIntensity): Promise<PersonalityConfig> {
    if (!isValidNotificationIntensity(intensity)) {
      return this.getConfig();
    }
    return this.updateConfig({ intensity });
  }

  /**
   * Enables or disables optional AI dialogue enhancement.
   */
  public async setAiDialogueEnabled(enabled: boolean): Promise<PersonalityConfig> {
    return this.updateConfig({ aiDialogueEnabled: Boolean(enabled) });
  }

  /**
   * Evaluates whether a reaction should be suppressed by the current frequency setting.
   *
   * CRITICAL SAFETY RULE:
   * Priority >= HIGH (80), such as BATTERY_CRITICAL or BATTERY_LOW, can NEVER be suppressed.
   */
  public shouldSuppressByFrequency(priority: number): boolean {
    // Critical and high-importance reactions are NEVER suppressed
    if (priority >= ReactionPriority.HIGH) {
      return false;
    }

    // High frequency allows everything
    if (this.config.frequency === ReactionFrequencies.HIGH) {
      return false;
    }

    // Low frequency suppresses low-priority background/routine notifications (priority <= 30)
    if (this.config.frequency === ReactionFrequencies.LOW) {
      return priority <= ReactionPriority.LOW;
    }

    // Normal frequency permits all normal and higher priority reactions
    return false;
  }

  /**
   * Resolves the preferred animation or expression for an event under the active personality.
   */
  public resolveExpression(
    reaction: ReactionDefinition,
    event: DesktopEvent
  ): AnimationId | CharacterExpressionId {
    const profile = this.getActiveProfile();

    // 1. Check if the profile specifies a preferred expression for the exact event type
    const eventPreference = profile.preferredExpressions[event.type];
    if (eventPreference) {
      return eventPreference;
    }

    // 2. Check if the profile specifies a preference for the reaction's base animation
    const animationPreference = profile.preferredExpressions[reaction.animationId];
    if (animationPreference) {
      return animationPreference;
    }

    // 3. Fall back to the reaction definition's standard animation
    return reaction.animationId;
  }

  /**
   * Formats the presentation outcome for an accepted reaction.
   *
   * Invariant:
   * Called only AFTER ReactionResolver has accepted the reaction.
   */
  public async formatPresentation(
    reaction: ReactionDefinition,
    event: DesktopEvent
  ): Promise<PersonalityPresentation> {
    const isSuppressed = this.shouldSuppressByFrequency(reaction.priority);
    const animationId = this.resolveExpression(reaction, event);
    const context = extractDialogueContext(event);

    let dialogueText = "";
    let source: "local_template" | "ai_dialogue" | "fallback" = "local_template";

    if (!isSuppressed) {
      const dialogueResult = await resolveDialogueText({
        personalityId: this.config.personalityId,
        eventType: event.type,
        context,
        aiDialogueEnabled: this.config.aiDialogueEnabled,
        aiProvider: this.aiProvider,
      });
      dialogueText = dialogueResult.text;
      source = dialogueResult.source;
    }

    return {
      animationId,
      dialogueText,
      notificationIntensity: this.config.intensity,
      personalityId: this.config.personalityId,
      isSuppressedByFrequency: isSuppressed,
      source,
    };
  }
}
