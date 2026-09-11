/**
 * PixelPal — Conversation Manager Coordinator
 * Sprint 9 Core Orchestrator
 *
 * Coordinates:
 * - Bounded conversational turn history
 * - Allowlisted, privacy-bounded desktop context
 * - Active companion personality instructions
 * - Provider dispatch with Structured Outputs
 * - Independent schema and semantic response validation
 * - Resilient offline-first fallback
 * - Atomic persistence of message history
 */

import { PersonalityIds, type PersonalityId } from "../../../../packages/shared-types/src/personality.ts";
import {
  type ConversationStorageAdapter,
  type ConversationLlmProvider,
  type ValidatedCharacterResponse,
  type ConversationMessage,
  type SanitizedPersonalityContext,
} from "./types.ts";
import {
  validateUserMessage,
  ConversationHistoryManager,
} from "./history.ts";
import { ConversationContextManager } from "./context_manager.ts";
import { validateStructuredLlmResponse } from "./validator.ts";
import { getLocalConversationFallback } from "./fallback.ts";
import { InMemoryConversationStorageAdapter } from "./storage.ts";
import { getPersonalityProfile } from "../personality/profiles.ts";
import type { PermissionManager } from "../privacy/permission_manager.ts";

/**
 * Options for configuring the ConversationManager.
 */
export interface ConversationManagerOptions {
  storage?: ConversationStorageAdapter;
  provider?: ConversationLlmProvider;
  contextManager?: ConversationContextManager;
  permissionManager?: PermissionManager;
  getPersonalityId?: () => PersonalityId;
}

/**
 * Top-level conversational coordinator for PixelPal.
 */
export class ConversationManager {
  private readonly storage: ConversationStorageAdapter;
  private readonly historyManager: ConversationHistoryManager;
  private readonly contextManager: ConversationContextManager;
  private permissionManager?: PermissionManager;
  private provider?: ConversationLlmProvider;
  private readonly getPersonalityId: () => PersonalityId;
  private isInitialized = false;
  private turnQueue: Promise<unknown> = Promise.resolve();
  private currentGeneration = 0;

  constructor(options: ConversationManagerOptions = {}) {
    this.storage = options.storage || new InMemoryConversationStorageAdapter();
    this.historyManager = new ConversationHistoryManager();
    this.contextManager = options.contextManager || new ConversationContextManager();
    this.permissionManager = options.permissionManager;
    this.provider = options.provider;
    this.getPersonalityId = options.getPersonalityId || (() => PersonalityIds.FRIENDLY);
  }

  /**
   * Initializes the conversation manager by loading persisted history.
   */
  public async init(): Promise<void> {
    try {
      const persisted = await this.storage.loadHistory();
      this.historyManager.loadMessages(persisted);
    } catch {
      this.historyManager.clear();
    }
    this.isInitialized = true;
  }

  /**
   * Returns whether the manager has completed initialization.
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Returns the underlying context manager for feeding desktop state and events.
   */
  public getContextManager(): ConversationContextManager {
    return this.contextManager;
  }

  /**
   * Sets or swaps the active LLM provider (e.g. for testing or switching models).
   */
  public setProvider(provider?: ConversationLlmProvider): void {
    this.provider = provider;
  }

  /**
   * Sets or updates the active PermissionManager for AI context filtering.
   */
  public setPermissionManager(pm?: PermissionManager): void {
    this.permissionManager = pm;
  }

  /**
   * Returns the active PermissionManager if configured.
   */
  public getPermissionManager(): PermissionManager | undefined {
    return this.permissionManager;
  }

  /**
   * Returns a copy of the current bounded conversation history.
   */
  public getHistory(): readonly ConversationMessage[] {
    return this.historyManager.getMessages();
  }

  /**
   * Clears conversational history both in memory and persistent storage.
   * Increments the generation token so in-flight requests cannot resurrect deleted history.
   */
  public async clearHistory(): Promise<void> {
    this.currentGeneration++;
    this.historyManager.clear();
    await this.storage.clearHistory();
  }

  /**
   * Helper to retrieve sanitized personality metadata for the active personality.
   */
  private getActivePersonalityContext(): SanitizedPersonalityContext {
    const personalityId = this.getPersonalityId();
    const profile = getPersonalityProfile(personalityId);
    return {
      id: profile.id,
      name: profile.name,
      tone: profile.tone,
      description: profile.description,
    };
  }

  /**
   * Processes a user message turn and returns a validated, presentation-ready response.
   * Serializes concurrent turns strictly in FIFO order to prevent history races.
   */
  public async sendMessage(rawInput: string): Promise<ValidatedCharacterResponse> {
    const nextTurn = (async () => {
      try {
        await this.turnQueue;
      } catch {
        // Failure isolation: previous turn error does not jam the queue
      }
      return this.executeTurn(rawInput);
    })();

    this.turnQueue = nextTurn;
    return nextTurn;
  }

  /**
   * Executes a single serialized conversation turn.
   */
  private async executeTurn(rawInput: string): Promise<ValidatedCharacterResponse> {
    const personalityContext = this.getActivePersonalityContext();
    const turnGeneration = this.currentGeneration;

    // 1. Validate user input
    const inputValidation = validateUserMessage(rawInput);
    if (!inputValidation.valid || !inputValidation.sanitized) {
      return getLocalConversationFallback(
        personalityContext.id,
        inputValidation.error || "Invalid user message"
      );
    }

    const userText = inputValidation.sanitized;

    // 2. Append user message to history
    this.historyManager.append("user", userText);

    // 3. If no LLM provider is available, use local deterministic fallback
    if (!this.provider) {
      const fallback = getLocalConversationFallback(
        personalityContext.id,
        "No AI conversation provider configured"
      );
      if (turnGeneration === this.currentGeneration) {
        this.historyManager.append("assistant", fallback.replyText, fallback.expressionId);
        await this.persistHistorySafely();
      }
      return fallback;
    }

    // 4. Build approved context and history snapshot
    let approvedContext = this.contextManager.buildApprovedContext();
    if (this.permissionManager) {
      approvedContext = this.permissionManager.filterAiContext(approvedContext);
    }
    const historySnapshot = this.historyManager.getMessages().slice(0, -1); // exclude current user message

    try {
      // 5. Query LLM provider
      const rawResponse = await this.provider.generateResponse({
        userMessage: userText,
        history: historySnapshot,
        context: approvedContext,
        personality: personalityContext,
      });

      // 6. Validate structured output
      const validation = validateStructuredLlmResponse(rawResponse);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // 7. Successful turn
      let response = validation.data;
      if (this.permissionManager && !this.permissionManager.isNotificationPermitted()) {
        response = {
          ...response,
          notificationIntensity: "quiet",
        };
      }

      // Invalidate if history was cleared/reset during in-flight LLM call
      if (turnGeneration === this.currentGeneration) {
        this.historyManager.append("assistant", response.replyText, response.expressionId);
        await this.persistHistorySafely();
      }
      return response;
    } catch (err) {
      // 8. Resilient in-character fallback on provider failure, timeout, or invalid output
      const reason = err instanceof Error ? err.message : String(err);
      let fallback = getLocalConversationFallback(personalityContext.id, reason);
      if (this.permissionManager && !this.permissionManager.isNotificationPermitted()) {
        fallback = {
          ...fallback,
          notificationIntensity: "quiet",
        };
      }

      // Invalidate if history was cleared/reset during in-flight LLM call
      if (turnGeneration === this.currentGeneration) {
        this.historyManager.append("assistant", fallback.replyText, fallback.expressionId);
        await this.persistHistorySafely();
      }
      return fallback;
    }
  }

  /**
   * Persists current history safely without allowing file errors to crash the conversation turn.
   */
  private async persistHistorySafely(): Promise<void> {
    try {
      await this.storage.saveHistory(this.historyManager.getMessages());
    } catch {
      // Best effort persistence
    }
  }
}
