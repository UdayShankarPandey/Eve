import type {
  AnimationDefinition,
  ResolvedAnimation,
} from "./types.ts";
import { AnimationRegistry, globalAnimationRegistry } from "./registry.ts";

/**
 * Current snapshot of the animation playback state.
 */
export interface AnimationPlaybackState {
  /** The currently active animation definition */
  currentAnimation: AnimationDefinition;
  /** Zero-based index of the current frame (0 .. frameCount - 1) */
  frameIndex: number;
  /** Whether the playback loop is actively running */
  isPlaying: boolean;
  /** Whether the current animation is running in one-shot mode */
  isOneShot: boolean;
  /** Number of complete cycles played for the current animation */
  cycleCount: number;
  /** Elapsed time accumulated in the current frame in milliseconds */
  timeInCurrentFrameMs: number;
}

/**
 * Listener callback signatures.
 */
export type FrameChangeListener = (frameIndex: number, animation: AnimationDefinition) => void;
export type AnimationChangeListener = (
  newAnimation: AnimationDefinition,
  previousAnimation?: AnimationDefinition
) => void;
export type AnimationCompleteListener = (completedAnimation: AnimationDefinition) => void;
export type StateChangeListener = (state: AnimationPlaybackState) => void;

/**
 * Configuration options for AnimationManager.
 */
export interface AnimationManagerOptions {
  /** Custom registry instance (defaults to global singleton) */
  registry?: AnimationRegistry;
  /** Initial animation ID to play on creation (defaults to registry default 'idle') */
  initialAnimationId?: string;
  /** Whether to start playback automatically on instantiation (default: false) */
  autoStart?: boolean;
  /** Timing driver mechanism: 'raf' (requestAnimationFrame in browser/DOM) or 'timer' (setTimeout/setInterval) or 'manual' (driven by step()) */
  timingMode?: "raf" | "timer" | "manual";
}

/**
 * Centralized Headless Animation Manager.
 * Controls frame progression, FPS timing, looping, one-shots, transitions, and cleanup.
 */
export class AnimationManager {
  private readonly registry: AnimationRegistry;
  private currentAnimation: AnimationDefinition;
  private frameIndex = 0;
  private isPlayingActive = false;
  private cycleCount = 0;
  private timeInCurrentFrameMs = 0;
  private readonly timingMode: "raf" | "timer" | "manual";

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private lastTickTimeMs: number | null = null;
  private isDisposed = false;

  private readonly frameChangeListeners: Set<FrameChangeListener> = new Set();
  private readonly animationChangeListeners: Set<AnimationChangeListener> = new Set();
  private readonly animationCompleteListeners: Set<AnimationCompleteListener> = new Set();
  private readonly stateChangeListeners: Set<StateChangeListener> = new Set();

  constructor(options: AnimationManagerOptions = {}) {
    this.registry = options.registry || globalAnimationRegistry;
    const initialId = options.initialAnimationId || this.registry.getDefaultId();
    const resolved = this.registry.resolve(initialId);
    this.currentAnimation = resolved.definition;
    this.timingMode =
      options.timingMode ??
      (typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
        ? "raf"
        : "timer");

    if (options.autoStart) {
      this.play();
    }
  }

  /**
   * Sets and begins playing a new animation by ID.
   * Resolves fallback if the ID is missing or invalid.
   */
  public setAnimation(id: string, options: { forceRestart?: boolean } = {}): ResolvedAnimation {
    this.ensureNotDisposed();
    const resolved = this.registry.resolve(id);
    const newAnim = resolved.definition;
    const isSameAnimation = this.currentAnimation.id === newAnim.id;

    if (!isSameAnimation || options.forceRestart) {
      const prevAnim = this.currentAnimation;
      this.currentAnimation = newAnim;
      this.frameIndex = 0;
      this.cycleCount = 0;
      this.timeInCurrentFrameMs = 0;

      this.notifyAnimationChange(newAnim, prevAnim);
      this.notifyFrameChange(this.frameIndex, newAnim);
      this.notifyStateChange();

      // If already playing, reschedule next tick for the new FPS
      if (this.isPlayingActive) {
        this.restartTicker();
      }
    }

    return resolved;
  }

  /**
   * Starts or resumes playback.
   */
  public play(animationId?: string): void {
    this.ensureNotDisposed();

    if (animationId) {
      this.setAnimation(animationId);
    }

    if (!this.isPlayingActive) {
      this.isPlayingActive = true;
      this.lastTickTimeMs = null;
      this.startTicker();
      this.notifyStateChange();
    }
  }

  /**
   * Stops playback and resets active timers.
   */
  public stop(): void {
    if (this.isPlayingActive) {
      this.isPlayingActive = false;
      this.stopTicker();
      this.lastTickTimeMs = null;
      this.notifyStateChange();
    }
  }

  /**
   * Pauses playback without resetting frame progress.
   */
  public pause(): void {
    this.stop();
  }

  /**
   * Resumes playback from the current frame.
   */
  public resume(): void {
    this.play();
  }

  /**
   * Deterministically advances time by deltaMs (used for manual stepping, testing, and ticker updates).
   */
  public step(deltaMs: number): void {
    this.ensureNotDisposed();
    if (deltaMs <= 0) return;

    const fps = this.currentAnimation.fps;
    const frameIntervalMs = 1000 / (fps > 0 ? fps : 1);
    const totalFrames = this.currentAnimation.frameCount;

    this.timeInCurrentFrameMs += deltaMs;

    let framesToAdvance = 0;
    while (this.timeInCurrentFrameMs >= frameIntervalMs) {
      this.timeInCurrentFrameMs -= frameIntervalMs;
      framesToAdvance++;
    }

    if (framesToAdvance > 0) {
      this.advanceFrames(framesToAdvance, totalFrames);
    }
  }

  /**
   * Advances the frame counter and handles loop / one-shot transition logic.
   */
  private advanceFrames(count: number, totalFrames: number): void {
    if (totalFrames <= 0) return;

    const isOneShot = this.currentAnimation.loopMode === "one-shot";
    let nextFrame = this.frameIndex + count;
    let completedOneShot = false;

    if (isOneShot && nextFrame >= totalFrames) {
      completedOneShot = true;
      nextFrame = totalFrames - 1; // hold on last frame at completion
    } else if (!isOneShot && nextFrame >= totalFrames) {
      // Loop mode (or ping-pong)
      const completedCycles = Math.floor(nextFrame / totalFrames);
      this.cycleCount += completedCycles;
      nextFrame = nextFrame % totalFrames;
    }

    const frameChanged = this.frameIndex !== nextFrame;
    this.frameIndex = nextFrame;

    if (frameChanged) {
      this.notifyFrameChange(this.frameIndex, this.currentAnimation);
    }

    if (completedOneShot) {
      const completedAnim = this.currentAnimation;
      this.cycleCount += 1;
      this.notifyAnimationComplete(completedAnim);

      // Transition to defined fallback or background state (default 'idle')
      const targetNextId = completedAnim.transitionTo || completedAnim.fallbackId || this.registry.getDefaultId();
      this.setAnimation(targetNextId);
    } else {
      this.notifyStateChange();
    }
  }

  /**
   * Returns current playback state.
   */
  public getPlaybackState(): AnimationPlaybackState {
    return {
      currentAnimation: this.currentAnimation,
      frameIndex: this.frameIndex,
      isPlaying: this.isPlayingActive,
      isOneShot: this.currentAnimation.loopMode === "one-shot",
      cycleCount: this.cycleCount,
      timeInCurrentFrameMs: this.timeInCurrentFrameMs,
    };
  }

  /**
   * Gets the active animation definition.
   */
  public getCurrentAnimation(): AnimationDefinition {
    return this.currentAnimation;
  }

  /**
   * Gets the current frame index.
   */
  public getCurrentFrame(): number {
    return this.frameIndex;
  }

  /**
   * Checks if playback is active.
   */
  public isPlaying(): boolean {
    return this.isPlayingActive;
  }

  /**
   * Checks if the active animation is a one-shot reaction.
   */
  public isOneShotActive(): boolean {
    return this.currentAnimation.loopMode === "one-shot";
  }

  /**
   * Checks if the active animation is currently in the background idle state.
   */
  public isIdle(): boolean {
    return this.currentAnimation.id === this.registry.getDefaultId();
  }

  // --- Subscriptions ---

  public onFrameChange(listener: FrameChangeListener): () => void {
    this.frameChangeListeners.add(listener);
    return () => this.frameChangeListeners.delete(listener);
  }

  public onAnimationChange(listener: AnimationChangeListener): () => void {
    this.animationChangeListeners.add(listener);
    return () => this.animationChangeListeners.delete(listener);
  }

  public onAnimationComplete(listener: AnimationCompleteListener): () => void {
    this.animationCompleteListeners.add(listener);
    return () => this.animationCompleteListeners.delete(listener);
  }

  public onStateChange(listener: StateChangeListener): () => void {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
  }

  // --- Ticker & Lifecycle Management ---

  private startTicker(): void {
    this.stopTicker(); // prevent duplicate ticker loops

    if (this.timingMode === "manual") {
      return;
    }

    if (this.timingMode === "raf" && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      const tickRaf = (now: number) => {
        if (!this.isPlayingActive || this.isDisposed) return;
        if (this.lastTickTimeMs !== null) {
          const delta = Math.min(now - this.lastTickTimeMs, 200); // cap max delta to 200ms to avoid tab-switch frame explosions
          this.step(delta);
        }
        this.lastTickTimeMs = now;
        this.rafId = window.requestAnimationFrame(tickRaf);
      };
      this.rafId = window.requestAnimationFrame(tickRaf);
    } else {
      // Fallback or explicit timer mode
      const frameIntervalMs = Math.max(16, Math.floor(1000 / (this.currentAnimation.fps || 4)));
      let lastTime = Date.now();
      const tickTimer = () => {
        if (!this.isPlayingActive || this.isDisposed) return;
        const now = Date.now();
        const delta = now - lastTime;
        lastTime = now;
        this.step(delta);
        const nextInterval = Math.max(16, Math.floor(1000 / (this.currentAnimation.fps || 4)));
        this.timerId = setTimeout(tickTimer, nextInterval);
      };
      this.timerId = setTimeout(tickTimer, frameIntervalMs);
    }
  }

  private stopTicker(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.rafId !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private restartTicker(): void {
    if (this.isPlayingActive) {
      this.startTicker();
    }
  }

  private notifyFrameChange(frame: number, anim: AnimationDefinition): void {
    for (const listener of this.frameChangeListeners) {
      try {
        listener(frame, anim);
      } catch (err) {
        console.error("[AnimationManager] Error in frameChange listener:", err);
      }
    }
  }

  private notifyAnimationChange(newAnim: AnimationDefinition, prevAnim?: AnimationDefinition): void {
    for (const listener of this.animationChangeListeners) {
      try {
        listener(newAnim, prevAnim);
      } catch (err) {
        console.error("[AnimationManager] Error in animationChange listener:", err);
      }
    }
  }

  private notifyAnimationComplete(anim: AnimationDefinition): void {
    for (const listener of this.animationCompleteListeners) {
      try {
        listener(anim);
      } catch (err) {
        console.error("[AnimationManager] Error in animationComplete listener:", err);
      }
    }
  }

  private notifyStateChange(): void {
    const state = this.getPlaybackState();
    for (const listener of this.stateChangeListeners) {
      try {
        listener(state);
      } catch (err) {
        console.error("[AnimationManager] Error in stateChange listener:", err);
      }
    }
  }

  private ensureNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error("[AnimationManager] Instance is destroyed and cannot be used.");
    }
  }

  /**
   * Destroys the manager, stops all timers and removes all listeners.
   */
  public destroy(): void {
    this.stop();
    this.isDisposed = true;
    this.frameChangeListeners.clear();
    this.animationChangeListeners.clear();
    this.animationCompleteListeners.clear();
    this.stateChangeListeners.clear();
  }
}
