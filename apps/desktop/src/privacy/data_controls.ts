/**
 * PixelPal — Data Controls & Deletion Engine
 * Sprint 10 Phase 3
 *
 * Implements real, verifiable data controls:
 * 1. Clear event history (in-memory diagnostics and event logs)
 * 2. Delete conversations (clears memory and deletes conversation_history.json)
 * 3. Delete character and owned assets (validates ID, removes generated & sprite files, deletes profile)
 * 4. Reset settings (restores default permissions and personality, preserving character identity)
 */

import type { EventBus } from "../events/event_bus.ts";
import type { ConversationStorageAdapter } from "../conversation/types.ts";
import { FileSystemConversationStorageAdapter } from "../conversation/storage.ts";
import type { ProfileStorageAdapter } from "../character/profile_storage.ts";
import { FileSystemProfileStorageAdapter } from "../character/profile_storage.ts";
import type { GeneratedStorageAdapter } from "../character/generated_storage.ts";
import { FileSystemGeneratedStorageAdapter } from "../character/generated_storage.ts";
import type { SpriteStorageAdapter } from "../character/sprite_storage.ts";
import { FileSystemSpriteStorageAdapter } from "../character/sprite_storage.ts";
import {
  type PersonalityStorageAdapter,
  DEFAULT_PERSONALITY_CONFIG,
} from "../personality/types.ts";
import { FileSystemPersonalityStorageAdapter } from "../personality/storage.ts";
import type { PermissionStorageAdapter } from "./types.ts";
import { FileSystemPermissionStorageAdapter } from "./storage.ts";
import { isValidCharacterId } from "../character/profile_validator.ts";
import { isValidGeneratedStorageId } from "../character/generated_storage.ts";
import { isValidSpriteStorageId } from "../character/sprite_storage.ts";
import type { DataDeletionResult } from "./types.ts";

/**
 * Options for configuring DataControlsManager dependencies.
 */
export interface DataControlsManagerOptions {
  readonly eventBus?: EventBus;
  readonly conversationStorage?: ConversationStorageAdapter;
  readonly profileStorage?: ProfileStorageAdapter;
  readonly generatedStorage?: GeneratedStorageAdapter;
  readonly spriteStorage?: SpriteStorageAdapter;
  readonly personalityStorage?: PersonalityStorageAdapter;
  readonly permissionStorage?: PermissionStorageAdapter;
}

/**
 * Central orchestrator for user data controls and privacy deletions.
 */
export class DataControlsManager {
  private readonly eventBus?: EventBus;
  private readonly conversationStorage: ConversationStorageAdapter;
  private readonly profileStorage: ProfileStorageAdapter;
  private readonly generatedStorage: GeneratedStorageAdapter;
  private readonly spriteStorage: SpriteStorageAdapter;
  private readonly personalityStorage: PersonalityStorageAdapter;
  private readonly permissionStorage: PermissionStorageAdapter;

  constructor(options: DataControlsManagerOptions = {}) {
    this.eventBus = options.eventBus;
    this.conversationStorage =
      options.conversationStorage ?? new FileSystemConversationStorageAdapter();
    this.profileStorage =
      options.profileStorage ?? new FileSystemProfileStorageAdapter();
    this.generatedStorage =
      options.generatedStorage ?? new FileSystemGeneratedStorageAdapter();
    this.spriteStorage =
      options.spriteStorage ?? new FileSystemSpriteStorageAdapter();
    this.personalityStorage =
      options.personalityStorage ?? new FileSystemPersonalityStorageAdapter();
    this.permissionStorage =
      options.permissionStorage ?? new FileSystemPermissionStorageAdapter();
  }

  /**
   * 1. Clears local event history.
   */
  public async clearEventHistory(targetBus?: EventBus): Promise<DataDeletionResult> {
    const bus = targetBus ?? this.eventBus;
    if (bus) {
      const count = bus.getHistory().length;
      bus.clearHistory();
      return {
        success: true,
        target: "events",
        itemsDeleted: count,
        message: `Cleared ${count} events from event history.`,
      };
    }

    return {
      success: true,
      target: "events",
      itemsDeleted: 0,
      message: "No active event bus attached; event history is clear.",
    };
  }

  /**
   * 2. Deletes conversation history permanently from disk and memory.
   */
  public async deleteConversationHistory(): Promise<DataDeletionResult> {
    try {
      await this.conversationStorage.clearHistory();
      return {
        success: true,
        target: "conversation",
        itemsDeleted: 1,
        message: "Conversation history file and in-memory cache deleted successfully.",
      };
    } catch (err) {
      return {
        success: false,
        target: "conversation",
        itemsDeleted: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 3. Safely deletes a character profile and all associated PixelPal-owned assets.
   * Enforces path traversal protection and strictly preserves unrelated characters.
   */
  public async deleteCharacter(characterId: string): Promise<DataDeletionResult> {
    // 1. Validate ID format to block path traversal
    if (!isValidCharacterId(characterId)) {
      return {
        success: false,
        target: "character",
        itemsDeleted: 0,
        error: `Invalid character ID format: '${characterId}'. Directory traversal blocked.`,
      };
    }

    try {
      // 2. Load existing profile to identify referenced owned assets
      const stored = await this.profileStorage.get(characterId);
      if (!stored) {
        return {
          success: false,
          target: "character",
          itemsDeleted: 0,
          error: `Character profile not found: '${characterId}'.`,
        };
      }

      let assetsDeleted = 0;
      const profile = stored.profile;

      // 3. Delete Phase 3 generated asset if present and valid
      if (
        profile.assets?.generatedCharacterId &&
        isValidGeneratedStorageId(profile.assets.generatedCharacterId)
      ) {
        try {
          const deletedGen = await this.generatedStorage.delete(
            profile.assets.generatedCharacterId
          );
          if (deletedGen) assetsDeleted++;
        } catch {
          // Continue cleanup
        }
      }

      // 4. Delete Phase 4 sprite asset if present and valid
      if (
        profile.assets?.spriteId &&
        isValidSpriteStorageId(profile.assets.spriteId)
      ) {
        try {
          const deletedSprite = await this.spriteStorage.delete(
            profile.assets.spriteId
          );
          if (deletedSprite) assetsDeleted++;
        } catch {
          // Continue cleanup
        }
      }

      // 5. Delete character profile document
      const deletedProfile = await this.profileStorage.delete(characterId);
      if (deletedProfile) {
        assetsDeleted++;
      }

      return {
        success: true,
        target: "character",
        itemsDeleted: assetsDeleted,
        message: `Deleted character '${characterId}' and ${assetsDeleted - 1} associated assets.`,
      };
    } catch (err) {
      return {
        success: false,
        target: "character",
        itemsDeleted: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 4. Resets settings to default values.
   * Restores default privacy permissions and default personality configuration.
   * Does NOT touch character profiles or identity.
   */
  public async resetSettings(): Promise<DataDeletionResult> {
    try {
      // 1. Reset permissions configuration
      await this.permissionStorage.resetConfig();

      // 2. Reset personality configuration
      await this.personalityStorage.saveConfig({
        ...DEFAULT_PERSONALITY_CONFIG,
        updatedAt: Date.now(),
      });

      return {
        success: true,
        target: "settings",
        itemsDeleted: 2,
        message: "Settings reset to default values successfully (permissions and personality).",
      };
    } catch (err) {
      return {
        success: false,
        target: "settings",
        itemsDeleted: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
