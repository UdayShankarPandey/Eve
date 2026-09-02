import type { TimeProvider } from "./types.ts";

/**
 * Manages per-reaction cooldowns deterministically.
 */
export class CooldownManager {
  private readonly cooldowns: Map<string, number> = new Map();
  private readonly timeProvider: TimeProvider;

  constructor(timeProvider?: TimeProvider) {
    this.timeProvider = timeProvider || (() => Date.now());
  }

  /**
   * Checks whether a specific reaction is currently on cooldown.
   *
   * @param reactionId - Unique reaction identifier
   * @param customNow - Optional custom timestamp (for testing or atomic evaluation)
   */
  public isOnCooldown(reactionId: string, customNow?: number): boolean {
    const now = customNow ?? this.timeProvider();
    const expiresAt = this.cooldowns.get(reactionId);
    if (expiresAt === undefined) {
      return false;
    }
    return now < expiresAt;
  }

  /**
   * Records a reaction trigger and arms its cooldown.
   *
   * @param reactionId - Unique reaction identifier
   * @param cooldownMs - Cooldown duration in milliseconds
   * @param customNow - Optional custom timestamp
   */
  public recordTrigger(reactionId: string, cooldownMs: number, customNow?: number): void {
    if (cooldownMs <= 0) {
      return;
    }
    const now = customNow ?? this.timeProvider();
    this.cooldowns.set(reactionId, now + cooldownMs);
  }

  /**
   * Returns remaining cooldown in milliseconds (or 0 if expired/not on cooldown).
   *
   * @param reactionId - Unique reaction identifier
   * @param customNow - Optional custom timestamp
   */
  public getRemainingCooldown(reactionId: string, customNow?: number): number {
    const now = customNow ?? this.timeProvider();
    const expiresAt = this.cooldowns.get(reactionId);
    if (expiresAt === undefined || now >= expiresAt) {
      return 0;
    }
    return expiresAt - now;
  }

  /**
   * Clears cooldown for a specific reaction.
   */
  public resetReaction(reactionId: string): void {
    this.cooldowns.delete(reactionId);
  }

  /**
   * Clears all active cooldowns.
   */
  public reset(): void {
    this.cooldowns.clear();
  }
}
