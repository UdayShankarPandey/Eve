import type { DesktopEvent } from "../../../../packages/shared-types/src/events.ts";
import type {
  ActiveReactionState,
  ResolutionResult,
  TimeProvider,
} from "./types.ts";
import { ReactionRegistry, globalReactionRegistry } from "./reaction_registry.ts";
import { CooldownManager } from "./cooldown_manager.ts";

/**
 * Deterministic Reaction Resolver.
 * Decides whether an incoming DesktopEvent should trigger a character reaction
 * based on registered rules, cooldowns, and active priority state.
 */
export class ReactionResolver {
  private registry: ReactionRegistry;
  private cooldownManager: CooldownManager;
  private timeProvider: TimeProvider;

  constructor(options?: {
    registry?: ReactionRegistry;
    cooldownManager?: CooldownManager;
    timeProvider?: TimeProvider;
  }) {
    this.registry = options?.registry || globalReactionRegistry;
    this.timeProvider = options?.timeProvider || (() => Date.now());
    this.cooldownManager =
      options?.cooldownManager || new CooldownManager(this.timeProvider);
  }

  /**
   * Returns the underlying CooldownManager instance.
   */
  public getCooldownManager(): CooldownManager {
    return this.cooldownManager;
  }

  /**
   * Returns the underlying ReactionRegistry instance.
   */
  public getRegistry(): ReactionRegistry {
    return this.registry;
  }

  /**
   * Evaluates an incoming DesktopEvent against reaction rules.
   *
   * @param event - The incoming DesktopEvent to evaluate
   * @param activeReaction - Currently active reaction (if any)
   * @param customNow - Optional custom timestamp (for testing)
   */
  public resolve(
    event: DesktopEvent,
    activeReaction?: ActiveReactionState | null,
    customNow?: number
  ): ResolutionResult {
    const now = customNow ?? this.timeProvider();

    // 1. Check if event is mapped to a reaction in the registry
    const reaction = this.registry.getForEventType(event.type);
    if (!reaction) {
      return {
        status: "NO_REACTION",
        reason: `No reaction registered for event type '${event.type}'`,
      };
    }

    // 2. Check if the candidate reaction is currently on cooldown
    if (this.cooldownManager.isOnCooldown(reaction.id, now)) {
      const remaining = this.cooldownManager.getRemainingCooldown(reaction.id, now);
      return {
        status: "SUPPRESSED_ON_COOLDOWN",
        reaction,
        reason: `Reaction '${reaction.id}' is on cooldown (${remaining}ms remaining)`,
        activeReaction: activeReaction ?? undefined,
      };
    }

    // 3. Check active reaction priority and interruption
    if (activeReaction && now < activeReaction.expiresAt) {
      const isActiveOneShot = activeReaction.reaction.isOneShot;

      if (isActiveOneShot) {
        // While an active one-shot reaction is executing:
        if (reaction.priority > activeReaction.reaction.priority) {
          // Candidate has strictly higher priority -> interrupts active reaction
          return {
            status: "RESOLVED",
            reaction,
            reason: `High-priority reaction '${reaction.id}' (${reaction.priority}) interrupts active reaction '${activeReaction.reaction.id}' (${activeReaction.reaction.priority})`,
            activeReaction,
          };
        }

        // Candidate has equal or lower priority -> suppressed to avoid emotion flickering
        return {
          status: "SUPPRESSED_BY_PRIORITY",
          reaction,
          reason: `Reaction '${reaction.id}' (priority ${reaction.priority}) is suppressed by active reaction '${activeReaction.reaction.id}' (priority ${activeReaction.reaction.priority})`,
          activeReaction,
        };
      } else {
        // While an active loop state is executing (e.g. USER_IDLE, PC_LOCKED, BATTERY_CRITICAL):
        if (reaction.id === activeReaction.reaction.id) {
          return {
            status: "SUPPRESSED_BY_PRIORITY",
            reaction,
            reason: `Already executing loop reaction '${reaction.id}'`,
            activeReaction,
          };
        }

        if (reaction.priority >= activeReaction.reaction.priority) {
          // State transition event (e.g. USER_ACTIVE exiting USER_IDLE, or higher priority)
          return {
            status: "RESOLVED",
            reaction,
            reason: `Reaction '${reaction.id}' (${reaction.priority}) transitions from active loop '${activeReaction.reaction.id}' (${activeReaction.reaction.priority})`,
            activeReaction,
          };
        }

        return {
          status: "SUPPRESSED_BY_PRIORITY",
          reaction,
          reason: `Reaction '${reaction.id}' (priority ${reaction.priority}) is suppressed by active loop '${activeReaction.reaction.id}' (priority ${activeReaction.reaction.priority})`,
          activeReaction,
        };
      }
    }

    // 4. No active reaction or active reaction has expired -> accepted
    return {
      status: "RESOLVED",
      reaction,
      reason: `Reaction '${reaction.id}' accepted`,
    };
  }
}
