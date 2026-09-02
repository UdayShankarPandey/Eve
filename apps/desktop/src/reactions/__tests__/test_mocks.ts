import type { IAnimationManager, IIdleScheduler } from "../index.ts";

/**
 * Shared mock AnimationManager for deterministic testing without DOM/window requirements.
 */
export class MockAnimationManager implements IAnimationManager {
  public currentAnim = "idle";
  public playing = false;
  public completeListeners: Set<(anim: any) => void> = new Set();
  public history: string[] = [];
  public shouldThrow = false;

  setAnimation(id: string, _options?: { forceRestart?: boolean }): any {
    if (this.shouldThrow) {
      throw new Error("Mock AnimationManager setAnimation failure");
    }
    this.currentAnim = id;
    this.history.push(id);
    return { definition: { id } };
  }

  getCurrentAnimation(): { id: string } {
    return { id: this.currentAnim };
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(animationId?: string): void {
    if (animationId) {
      this.setAnimation(animationId);
    }
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  onAnimationComplete(listener: (anim: any) => void): () => void {
    this.completeListeners.add(listener);
    return () => this.completeListeners.delete(listener);
  }

  triggerComplete(animId = this.currentAnim): void {
    for (const listener of this.completeListeners) {
      listener({ id: animId });
    }
  }
}

/**
 * Shared mock AutonomousIdleScheduler for testing suppression & resumption.
 */
export class MockIdleScheduler implements IIdleScheduler {
  public running = false;
  public startCalls = 0;
  public stopCalls = 0;

  public get startCount(): number {
    return this.startCalls;
  }

  public get stopCount(): number {
    return this.stopCalls;
  }

  start(): void {
    this.running = true;
    this.startCalls++;
  }

  stop(): void {
    this.running = false;
    this.stopCalls++;
  }
}
