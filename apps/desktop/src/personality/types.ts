/**
 * PixelPal — Personality Engine Desktop Types & Interfaces
 * Sprint 8
 */

import type {
  PersonalityId,
  PersonalityConfig,
  DialogueContext,
} from "../../../../packages/shared-types/src/personality.ts";

export * from "../../../../packages/shared-types/src/personality.ts";

/**
 * Storage adapter interface for reading and writing persisted personality configuration.
 */
export interface PersonalityStorageAdapter {
  /**
   * Loads persisted configuration, falling back safely to default on missing or corrupt file.
   */
  loadConfig(): Promise<PersonalityConfig>;

  /**
   * Persists configuration safely and atomically.
   */
  saveConfig(config: PersonalityConfig): Promise<void>;
}

/**
 * Optional AI Dialogue Provider interface (Phase 4 AI boundary).
 * Strictly isolates optional LLM dialogue generation from core reaction logic.
 */
export interface AiDialogueProvider {
  /**
   * Generates a context-aware dialogue line for the specified personality.
   * If this fails or times out, the system must fall back to local deterministic templates.
   */
  generateDialogue(params: {
    readonly personalityId: PersonalityId;
    readonly eventType: string;
    readonly context: DialogueContext;
    readonly fallbackText: string;
  }): Promise<string>;
}
