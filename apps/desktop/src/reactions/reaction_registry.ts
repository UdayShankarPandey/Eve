import {
  EventTypes,
  type EventType,
} from "../../../../packages/shared-types/src/events.ts";
import {
  ReactionPriority,
  type ReactionDefinition,
} from "../../../../packages/shared-types/src/reactions.ts";
import { AnimationIds } from "../animation/types.ts";

/**
 * Default MVP Reaction Definitions based on authoritative documentation.
 */
export const DEFAULT_REACTIONS: readonly ReactionDefinition[] = [
  {
    id: "react_battery_critical",
    eventType: EventTypes.BATTERY_CRITICAL,
    animationId: AnimationIds.SAD,
    priority: ReactionPriority.CRITICAL,
    cooldownMs: 60_000,
    isOneShot: false,
    description: "Critical battery level (<= 8%) triggers sad / panic state",
  },
  {
    id: "react_battery_low",
    eventType: EventTypes.BATTERY_LOW,
    animationId: AnimationIds.WORRIED,
    priority: ReactionPriority.HIGH,
    cooldownMs: 180_000,
    durationMs: 4_000,
    isOneShot: true,
    description: "Low battery level (<= 15%) triggers worried warning",
  },
  {
    id: "react_network_disconnected",
    eventType: EventTypes.NETWORK_DISCONNECTED,
    animationId: AnimationIds.WORRIED,
    priority: ReactionPriority.HIGH,
    cooldownMs: 60_000,
    durationMs: 3_000,
    isOneShot: true,
    description: "Network offline triggers worried reaction",
  },
  {
    id: "react_charging_started",
    eventType: EventTypes.CHARGING_STARTED,
    animationId: AnimationIds.HAPPY,
    priority: ReactionPriority.NORMAL,
    cooldownMs: 30_000,
    durationMs: 3_000,
    isOneShot: true,
    description: "Connecting AC power triggers happy / relieved reaction",
  },
  {
    id: "react_charging_stopped",
    eventType: EventTypes.CHARGING_STOPPED,
    animationId: AnimationIds.WORRIED,
    priority: ReactionPriority.NORMAL,
    cooldownMs: 30_000,
    durationMs: 3_000,
    isOneShot: true,
    description: "Disconnecting AC power triggers concerned reaction",
  },
  {
    id: "react_network_connected",
    eventType: EventTypes.NETWORK_CONNECTED,
    animationId: AnimationIds.HAPPY,
    priority: ReactionPriority.NORMAL,
    cooldownMs: 30_000,
    durationMs: 3_000,
    isOneShot: true,
    description: "Network connectivity restored triggers happy reaction",
  },
  {
    id: "react_download_completed",
    eventType: EventTypes.DOWNLOAD_COMPLETED,
    animationId: AnimationIds.HAPPY,
    priority: ReactionPriority.NORMAL,
    cooldownMs: 10_000,
    durationMs: 4_000,
    isOneShot: true,
    description: "Completed file download triggers happy celebration",
  },
  {
    id: "react_user_idle",
    eventType: EventTypes.USER_IDLE,
    animationId: AnimationIds.SLEEPY,
    priority: ReactionPriority.LOW,
    cooldownMs: 10_000,
    isOneShot: false,
    description: "User inactivity timeout triggers sleepy background state",
  },
  {
    id: "react_user_active",
    eventType: EventTypes.USER_ACTIVE,
    animationId: AnimationIds.HAPPY,
    priority: ReactionPriority.LOW,
    cooldownMs: 10_000,
    durationMs: 3_000,
    isOneShot: true,
    description: "Resumed user input triggers wake-up / happy greeting",
  },
  {
    id: "react_pc_locked",
    eventType: EventTypes.PC_LOCKED,
    animationId: AnimationIds.SLEEPY,
    priority: ReactionPriority.LOW,
    cooldownMs: 5_000,
    isOneShot: false,
    description: "Workstation lock triggers sleepy / sleeping state",
  },
  {
    id: "react_pc_unlocked",
    eventType: EventTypes.PC_UNLOCKED,
    animationId: AnimationIds.SURPRISED,
    priority: ReactionPriority.LOW,
    cooldownMs: 5_000,
    durationMs: 3_000,
    isOneShot: true,
    description: "Workstation unlock triggers surprised / wake reaction",
  },
  {
    id: "react_app_opened",
    eventType: EventTypes.APP_OPENED,
    animationId: AnimationIds.SURPRISED,
    priority: ReactionPriority.LOW,
    cooldownMs: 15_000,
    durationMs: 2_000,
    isOneShot: true,
    description: "Application focus transition triggers curious / surprised reaction",
  },
];

/**
 * Validation result for ReactionRegistry rules.
 */
export interface RegistryValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Centralized registry of event-to-reaction rules.
 */
export class ReactionRegistry {
  private reactionsList: ReactionDefinition[] = [];
  private reactionsById: Map<string, ReactionDefinition> = new Map();
  private reactionsByEvent: Map<EventType, ReactionDefinition> = new Map();

  constructor(initialReactions: readonly ReactionDefinition[] = DEFAULT_REACTIONS) {
    this.registerAll(initialReactions);
  }

  /**
   * Registers a single reaction definition.
   */
  public register(reaction: ReactionDefinition): void {
    this.reactionsList.push(reaction);
    this.reactionsById.set(reaction.id, reaction);
    this.reactionsByEvent.set(reaction.eventType, reaction);
  }

  /**
   * Registers multiple reaction definitions.
   */
  public registerAll(reactions: readonly ReactionDefinition[]): void {
    for (const reaction of reactions) {
      this.register(reaction);
    }
  }

  /**
   * Retrieves the reaction mapped to a specific event type.
   */
  public getForEventType(eventType: EventType): ReactionDefinition | undefined {
    return this.reactionsByEvent.get(eventType);
  }

  /**
   * Retrieves a reaction definition by its ID.
   */
  public get(id: string): ReactionDefinition | undefined {
    return this.reactionsById.get(id);
  }

  /**
   * Returns all registered reaction definitions.
   */
  public getAll(): ReactionDefinition[] {
    return Array.from(this.reactionsById.values());
  }

  /**
   * Validates a list of reaction definitions or the current registry contents.
   */
  public static validateReactions(reactions: readonly ReactionDefinition[]): RegistryValidationResult {
    const errors: string[] = [];
    const seenIds = new Set<string>();
    const validAnimations = Object.values(AnimationIds) as string[];

    for (const reaction of reactions) {
      if (!reaction.id || reaction.id.trim() === "") {
        errors.push("Reaction missing required 'id'");
      } else if (seenIds.has(reaction.id)) {
        errors.push(`Duplicate reaction ID found: '${reaction.id}'`);
      }
      seenIds.add(reaction.id);

      if (!reaction.eventType || reaction.eventType.trim() === "") {
        errors.push(`Reaction[${reaction.id}] missing required 'eventType'`);
      }

      if (!reaction.animationId || reaction.animationId.trim() === "") {
        errors.push(`Reaction[${reaction.id}] missing required 'animationId'`);
      } else if (!validAnimations.includes(reaction.animationId)) {
        errors.push(
          `Reaction[${reaction.id}] references invalid animationId '${reaction.animationId}'`
        );
      }

      if (typeof reaction.priority !== "number" || reaction.priority < 0) {
        errors.push(`Reaction[${reaction.id}] 'priority' must be a non-negative number`);
      }

      if (typeof reaction.cooldownMs !== "number" || reaction.cooldownMs < 0) {
        errors.push(`Reaction[${reaction.id}] 'cooldownMs' must be a non-negative number`);
      }

      if (
        reaction.durationMs !== undefined &&
        (typeof reaction.durationMs !== "number" || reaction.durationMs <= 0)
      ) {
        errors.push(`Reaction[${reaction.id}] 'durationMs' must be a positive number if specified`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates integrity of registered reaction definitions.
   */
  public validate(reactions?: readonly ReactionDefinition[]): RegistryValidationResult {
    return ReactionRegistry.validateReactions(reactions ?? this.reactionsList);
  }

  /**
   * Clears all custom reactions and restores default MVP mappings.
   */
  public reset(): void {
    this.reactionsList = [];
    this.reactionsById.clear();
    this.reactionsByEvent.clear();
    this.registerAll(DEFAULT_REACTIONS);
  }
}

/**
 * Global ReactionRegistry singleton instance.
 */
export const globalReactionRegistry = new ReactionRegistry();
