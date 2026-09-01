import type { EventType, DesktopEvent } from "./events.ts";
import type { AnimationId } from "./animation.ts";

/**
 * Standard Reaction Priority Levels.
 * Numerical priority hierarchy for deterministic conflict resolution.
 */
export const ReactionPriority = {
  /** Critical system state (e.g., imminent shutdown, critical battery <= 8%) */
  CRITICAL: 100,
  /** High-importance system alerts (e.g., battery low <= 15%, network disconnected) */
  HIGH: 80,
  /** Normal notifications & desktop actions (e.g., charging change, download completed) */
  NORMAL: 50,
  /** Low-priority user & application activity (e.g., idle, active, app opened) */
  LOW: 30,
  /** Background & ambient autonomous behavior (e.g., idle blink, subtle move) */
  BACKGROUND: 10,
} as const;

export type ReactionPriorityLevel = (typeof ReactionPriority)[keyof typeof ReactionPriority];

/**
 * Definition of a single deterministic reaction rule.
 */
export interface ReactionDefinition {
  /** Unique reaction identifier (e.g., "react_battery_low") */
  id: string;
  /** Triggering canonical event type */
  eventType: EventType;
  /** Resulting animation from the Sprint 2 animation vocabulary */
  animationId: AnimationId;
  /** Priority level (10 - 100) */
  priority: number;
  /** Cooldown duration in milliseconds */
  cooldownMs: number;
  /** Optional active reaction duration in milliseconds (for one-shot animations) */
  durationMs?: number;
  /** Whether the reaction plays once and returns to the background state */
  isOneShot: boolean;
  /** Human-readable description */
  description?: string;
}

/**
 * Snapshot of a currently active reaction.
 */
export interface ActiveReactionState {
  /** The reaction definition currently playing */
  reaction: ReactionDefinition;
  /** The DesktopEvent that triggered this reaction */
  event: DesktopEvent;
  /** Epoch timestamp in milliseconds when the reaction started */
  startedAt: number;
  /** Epoch timestamp in milliseconds when the reaction expires / finishes */
  expiresAt: number;
}
