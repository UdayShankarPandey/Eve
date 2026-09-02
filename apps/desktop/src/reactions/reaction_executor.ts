import type { DesktopEvent } from "../../../../packages/shared-types/src/events.ts";
import type {
  ActiveReactionState,
  ReactionDefinition,
  ResolutionResult,
  TimeProvider,
} from "./types.ts";
import { ReactionResolver } from "./reaction_resolver.ts";
import type { EventBus } from "../events/event_bus.ts";

/**
 * Minimal interface required from AnimationManager for reaction execution.
 */
export interface IAnimationManager {
  setAnimation(id: string, options?: { forceRestart?: boolean }): any;
  getCurrentAnimation(): { id: string };
  isPlaying(): boolean;
  play(animationId?: string): void;
  stop(): void;
  onAnimationComplete(listener: (animation: any) => void): () => void;
}

/**
 * Minimal interface required from AutonomousIdleScheduler.
 */
export interface IIdleScheduler {
  start(): void;
  stop(): void;
}

/**
 * Options for configuring the ReactionExecutor.
 */
export interface ReactionExecutorOptions {
  resolver: ReactionResolver;
  animationManager: IAnimationManager;
  idleScheduler?: IIdleScheduler;
  eventBus?: EventBus;
  timeProvider?: TimeProvider;
  autoStart?: boolean;
}

/**
 * Headless Reaction Executor.
 * Coordinates reaction resolution, animation playback, priority interruptions,
 * duration timers, idle scheduler suppression, and lifecycle cleanup.
 */
export class ReactionExecutor {
  private readonly resolver: ReactionResolver;
  private readonly animationManager: IAnimationManager;
  private readonly idleScheduler?: IIdleScheduler;
  private readonly eventBus?: EventBus;
  private readonly timeProvider: TimeProvider;

  private activeReaction: ActiveReactionState | null = null;
  private currentExecutionToken = 0;
  private durationTimerId: ReturnType<typeof setTimeout> | null = null;

  private unsubscribeEventBus: (() => void) | null = null;
  private unsubscribeAnimationComplete: (() => void) | null = null;

  private isRunning = false;
  private isDisposed = false;

  constructor(options: ReactionExecutorOptions) {
    this.resolver = options.resolver;
    this.animationManager = options.animationManager;
    this.idleScheduler = options.idleScheduler;
    this.eventBus = options.eventBus;
    this.timeProvider = options.timeProvider ?? (() => Date.now());

    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * Starts the executor, attaches event bus listeners, and prepares execution.
   */
  public start(): void {
    this.ensureNotDisposed();
    if (this.isRunning) {
      return; // prevent duplicate subscriptions
    }

    this.isRunning = true;

    // Listen to AnimationManager completion events
    this.unsubscribeAnimationComplete ??= this.animationManager.onAnimationComplete(
      (completedAnim) => {
        this.handleAnimationComplete(completedAnim);
      }
    );

    // Subscribe to EventBus if provided
    if (this.eventBus) {
      this.unsubscribeEventBus ??= this.eventBus.subscribe("*", (event) => {
        this.handleEvent(event as DesktopEvent);
      });
    }
  }

  /**
   * Stops processing events and clears active reaction timers.
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Unsubscribe from EventBus
    if (this.unsubscribeEventBus) {
      this.unsubscribeEventBus();
      this.unsubscribeEventBus = null;
    }

    this.clearDurationTimer();
    this.currentExecutionToken++;
    this.activeReaction = null;
  }

  /**
   * Permanently disposes the executor, unhooking all subscriptions and listeners.
   */
  public destroy(): void {
    if (this.isDisposed) {
      return;
    }

    this.stop();

    if (this.unsubscribeAnimationComplete) {
      this.unsubscribeAnimationComplete();
      this.unsubscribeAnimationComplete = null;
    }

    this.isDisposed = true;
  }

  /**
   * Handles an incoming DesktopEvent: evaluates resolution and executes if accepted.
   */
  public handleEvent(event: DesktopEvent<any>): ResolutionResult {
    if (!this.isRunning || this.isDisposed) {
      return {
        status: "NO_REACTION",
        reason: "ReactionExecutor is not currently running",
      };
    }

    const now = this.timeProvider();
    const result = this.resolver.resolve(event, this.activeReaction, now);

    if (result.status === "RESOLVED" && result.reaction) {
      this.executeReaction(result.reaction, event, now);
    }

    return result;
  }

  /**
   * Executes an accepted reaction definition.
   */
  private executeReaction(
    reaction: ReactionDefinition,
    event: DesktopEvent,
    now: number
  ): void {
    // 1. Invalidate previous execution token to protect against stale callbacks
    this.currentExecutionToken++;
    const token = this.currentExecutionToken;

    // 2. Clear any pending duration timer
    this.clearDurationTimer();

    // 3. Arm the reaction cooldown in CooldownManager
    this.resolver
      .getCooldownManager()
      .recordTrigger(reaction.id, reaction.cooldownMs, now);

    // 4. Calculate expiration timestamp
    const hasFiniteDuration =
      reaction.durationMs !== undefined && reaction.durationMs > 0;
    const expiresAt = hasFiniteDuration ? now + reaction.durationMs! : Infinity;

    // 5. Update active reaction state
    this.activeReaction = {
      reaction,
      event,
      startedAt: now,
      expiresAt,
    };

    // 6. Suppress autonomous ambient idle scheduler while reaction is active
    if (this.idleScheduler) {
      try {
        this.idleScheduler.stop();
      } catch (err) {
        console.error("[ReactionExecutor] Error stopping IdleScheduler:", err);
      }
    }

    // 7. Command AnimationManager to play the target animation
    try {
      this.animationManager.setAnimation(reaction.animationId, {
        forceRestart: true,
      });
      if (!this.animationManager.isPlaying()) {
        this.animationManager.play();
      }
    } catch (err) {
      console.error(
        `[ReactionExecutor] Error setting animation '${reaction.animationId}':`,
        err
      );
    }

    // 8. Schedule duration timer if specified
    if (hasFiniteDuration) {
      this.durationTimerId = setTimeout(() => {
        this.handleDurationExpired(token);
      }, reaction.durationMs);
    }
  }

  /**
   * Completes the current reaction and restores background state.
   */
  public completeReaction(token?: number, _reason = "completed"): void {
    if (token !== undefined && token !== this.currentExecutionToken) {
      // Stale callback from an interrupted reaction; ignore
      return;
    }

    this.clearDurationTimer();
    this.currentExecutionToken++;
    this.activeReaction = null;

    // Return AnimationManager to default background idle state
    try {
      this.animationManager.setAnimation("idle");
    } catch (err) {
      console.error("[ReactionExecutor] Error resetting to idle:", err);
    }

    // Resume autonomous ambient idle scheduler
    if (this.idleScheduler && this.isRunning) {
      try {
        this.idleScheduler.start();
      } catch (err) {
        console.error("[ReactionExecutor] Error resuming IdleScheduler:", err);
      }
    }
  }

  /**
   * Handles duration timeout expiry.
   */
  private handleDurationExpired(token: number): void {
    if (token !== this.currentExecutionToken) {
      return;
    }
    this.completeReaction(token, "duration_expired");
  }

  /**
   * Handles AnimationManager one-shot animation completion event.
   */
  private handleAnimationComplete(_completedAnim: any): void {
    if (!this.activeReaction) {
      return;
    }

    // If active reaction is a one-shot animation, complete it
    if (this.activeReaction.reaction.isOneShot) {
      this.completeReaction(this.currentExecutionToken, "animation_complete");
    }
  }

  /**
   * Returns current active reaction state.
   */
  public getActiveReaction(): ActiveReactionState | null {
    return this.activeReaction;
  }

  /**
   * Checks if a reaction is currently actively executing.
   */
  public isReactionActive(): boolean {
    return this.activeReaction !== null;
  }

  /**
   * Returns executor running state.
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  private clearDurationTimer(): void {
    if (this.durationTimerId !== null) {
      clearTimeout(this.durationTimerId);
      this.durationTimerId = null;
    }
  }

  private ensureNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error("ReactionExecutor is disposed and cannot be used.");
    }
  }
}
