import { AnimationManager } from "./manager.ts";
import { AnimationIds } from "./types.ts";

/**
 * Supported autonomous idle behavior action types.
 */
export type IdleActionType = "blink" | "subtle_movement" | "look_around" | "yawn";

/**
 * Details of an executed or scheduled idle action.
 */
export interface IdleAction {
  /** Type of autonomous micro-behavior */
  type: IdleActionType;
  /** Human-readable description */
  description: string;
  /** Estimated duration in milliseconds */
  durationMs: number;
  /** Timestamp when action was initiated */
  timestamp: number;
}

/**
 * Listener for autonomous idle action triggers.
 */
export type IdleActionListener = (action: IdleAction) => void;

/**
 * Configuration options for the AutonomousIdleScheduler.
 */
export interface IdleSchedulerOptions {
  /** Minimum delay in ms between idle behaviors (default: 3000ms) */
  minIntervalMs?: number;
  /** Maximum delay in ms between idle behaviors (default: 8000ms) */
  maxIntervalMs?: number;
  /** List of enabled idle behavior types */
  enabledActions?: IdleActionType[];
  /** Custom random generator for deterministic testing (default: Math.random) */
  randomFn?: () => number;
  /** Whether to start scheduling automatically (default: false) */
  autoStart?: boolean;
}

/**
 * Autonomous Idle Behavior Scheduler.
 * Operates independently of OS events to give the companion natural ambient life
 * (blinking, subtle sway, looking around, yawning) with variable intervals.
 */
export class AutonomousIdleScheduler {
  private readonly manager: AnimationManager;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly enabledActions: IdleActionType[];
  private readonly randomFn: () => number;

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private actionTimerId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private isPaused = false;
  private isDisposed = false;
  private currentActiveAction: IdleAction | null = null;

  private readonly actionListeners: Set<IdleActionListener> = new Set();
  private unsubscribeManager: (() => void) | null = null;

  constructor(manager: AnimationManager, options: IdleSchedulerOptions = {}) {
    this.manager = manager;
    this.minIntervalMs = Math.max(500, options.minIntervalMs ?? 3000);
    this.maxIntervalMs = Math.max(this.minIntervalMs, options.maxIntervalMs ?? 8000);
    this.enabledActions = options.enabledActions ?? ["blink", "subtle_movement", "look_around", "yawn"];
    this.randomFn = options.randomFn ?? Math.random;

    // Listen to manager state to pause autonomous idle actions when character is in a reaction state
    this.unsubscribeManager = this.manager.onAnimationChange(() => {
      this.handleManagerAnimationChange();
    });

    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * Starts the autonomous idle scheduler.
   */
  public start(): void {
    this.ensureNotDisposed();
    if (this.isRunning) return;

    this.isRunning = true;
    this.isPaused = false;
    this.scheduleNext();
  }

  /**
   * Stops the autonomous idle scheduler and clears all pending timers.
   */
  public stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.clearScheduledTimer();
    this.clearActionTimer();
  }

  /**
   * Pauses the scheduler temporarily (e.g. during a high-priority reaction).
   */
  public pause(): void {
    this.isPaused = true;
    this.clearScheduledTimer();
  }

  /**
   * Resumes the scheduler.
   */
  public resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    this.scheduleNext();
  }

  /**
   * Checks if the scheduler is running.
   */
  public isActive(): boolean {
    return this.isRunning && !this.isPaused && !this.isDisposed;
  }

  /**
   * Checks if a timer is currently scheduled.
   */
  public isScheduled(): boolean {
    return this.timerId !== null;
  }

  /**
   * Returns the currently active idle action, if any.
   */
  public getCurrentAction(): IdleAction | null {
    return this.currentActiveAction;
  }

  /**
   * Manually triggers an autonomous idle action immediately (great for tests and direct previews).
   */
  public trigger(actionType?: IdleActionType): IdleAction | null {
    this.ensureNotDisposed();

    // Do not interrupt if manager is currently playing a non-idle state or one-shot reaction
    if (!this.manager.isIdle() || this.manager.isOneShotActive()) {
      return null;
    }

    const selectedType = actionType || this.selectRandomAction();
    const action = this.executeAction(selectedType);

    // Reschedule next action if scheduler is actively running
    if (this.isRunning && !this.isPaused) {
      this.scheduleNext();
    }

    return action;
  }

  /**
   * Computes the next randomized interval in milliseconds.
   */
  public getNextIntervalMs(): number {
    const range = this.maxIntervalMs - this.minIntervalMs;
    const randomFraction = this.randomFn();
    return Math.floor(this.minIntervalMs + randomFraction * range);
  }

  /**
   * Selects a weighted random idle action.
   */
  private selectRandomAction(): IdleActionType {
    if (this.enabledActions.length === 0) {
      return "blink";
    }

    // Weighted distribution: Blink (40%), Subtle Movement (30%), Look Around (20%), Yawn (10%)
    const rand = this.randomFn();
    if (rand < 0.4 && this.enabledActions.includes("blink")) {
      return "blink";
    } else if (rand < 0.7 && this.enabledActions.includes("subtle_movement")) {
      return "subtle_movement";
    } else if (rand < 0.9 && this.enabledActions.includes("look_around")) {
      return "look_around";
    } else if (this.enabledActions.includes("yawn")) {
      return "yawn";
    }

    return this.enabledActions[Math.floor(this.randomFn() * this.enabledActions.length)];
  }

  /**
   * Executes the chosen autonomous behavior.
   */
  private executeAction(type: IdleActionType): IdleAction {
    let durationMs = 300;
    let description = "Autonomous idle micro-behavior";

    switch (type) {
      case "blink": {
        durationMs = 250;
        description = "Quick natural eye blink";
        break;
      }
      case "subtle_movement": {
        durationMs = 800;
        description = "Gentle breathing posture sway";
        break;
      }
      case "look_around": {
        durationMs = 600;
        description = "Curious glance look-around";
        break;
      }
      case "yawn": {
        durationMs = 1200;
        description = "Sleepy yawn stretch";
        if (this.manager.isIdle()) {
          this.manager.setAnimation(AnimationIds.SLEEPY, { forceRestart: true });
        }
        break;
      }
    }

    const action: IdleAction = {
      type,
      description,
      durationMs,
      timestamp: Date.now(),
    };

    this.currentActiveAction = action;
    this.notifyAction(action);

    // Clear active action record after its duration
    this.clearActionTimer();
    this.actionTimerId = setTimeout(() => {
      this.actionTimerId = null;
      if (this.currentActiveAction === action) {
        this.currentActiveAction = null;
      }
    }, durationMs);

    return action;
  }

  /**
   * Schedules the next timer tick with a variable randomized interval.
   */
  private scheduleNext(): void {
    this.clearScheduledTimer();

    if (!this.isRunning || this.isPaused || this.isDisposed) {
      return;
    }

    const interval = this.getNextIntervalMs();
    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (this.isRunning && !this.isPaused && !this.isDisposed) {
        this.trigger();
      }
    }, interval);
  }

  /**
   * Responds to manager animation changes to respect interruptibility.
   */
  private handleManagerAnimationChange(): void {
    if (!this.manager.isIdle() || this.manager.isOneShotActive()) {
      // Character is in a high-level emotion or one-shot reaction: pause autonomous triggers
      this.pause();
    } else if (this.isRunning && this.isPaused) {
      // Character returned to background idle: resume autonomous scheduling
      this.resume();
    }
  }

  /**
   * Subscribes to idle action events.
   */
  public onAction(listener: IdleActionListener): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  private notifyAction(action: IdleAction): void {
    for (const listener of this.actionListeners) {
      try {
        listener(action);
      } catch (err) {
        console.error("[AutonomousIdleScheduler] Error in action listener:", err);
      }
    }
  }

  private clearScheduledTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private clearActionTimer(): void {
    if (this.actionTimerId !== null) {
      clearTimeout(this.actionTimerId);
      this.actionTimerId = null;
    }
  }

  private ensureNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error("[AutonomousIdleScheduler] Instance is destroyed and cannot be used.");
    }
  }

  /**
   * Completely tears down the scheduler, cancels timers, and clears all listeners.
   */
  public destroy(): void {
    this.stop();
    this.isDisposed = true;
    if (this.unsubscribeManager) {
      this.unsubscribeManager();
      this.unsubscribeManager = null;
    }
    this.clearActionTimer();
    this.actionListeners.clear();
    this.currentActiveAction = null;
  }
}
