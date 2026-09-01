export {
  ReactionPriority,
  type ReactionPriorityLevel,
  type ReactionDefinition,
  type ActiveReactionState,
} from "../../../../packages/shared-types/src/reactions.ts";

import type {
  ReactionDefinition,
  ActiveReactionState,
} from "../../../../packages/shared-types/src/reactions.ts";

/**
 * Outcome status of evaluating an event against reaction rules.
 */
export type ResolutionStatus =
  | "RESOLVED"
  | "SUPPRESSED_ON_COOLDOWN"
  | "SUPPRESSED_BY_PRIORITY"
  | "NO_REACTION";

/**
 * Complete result returned by the ReactionResolver.
 */
export interface ResolutionResult {
  /** Resolution outcome status */
  status: ResolutionStatus;
  /** The reaction definition selected (if status === "RESOLVED") */
  reaction?: ReactionDefinition;
  /** Human-readable explanation of the resolution decision */
  reason?: string;
  /** Active reaction snapshot at the time of resolution */
  activeReaction?: ActiveReactionState;
}

/**
 * Injected time provider function (enables deterministic, non-sleeping unit tests).
 */
export type TimeProvider = () => number;
