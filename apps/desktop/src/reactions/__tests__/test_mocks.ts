import {
  ReactionExecutor,
  ReactionResolver,
  ReactionRegistry,
  CooldownManager,
  type IAnimationManager,
  type IIdleScheduler,
} from "../index.ts";
import { type DesktopEvent, type EventType } from "../../events/index.ts";

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

  onAnimationComplete(listener: (animation: any) => void): () => void {
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

export interface TestHarness {
  mockTime: number;
  timeProvider: () => number;
  registry: ReactionRegistry;
  cooldownManager: CooldownManager;
  resolver: ReactionResolver;
  animMgr: MockAnimationManager;
  idleScheduler: MockIdleScheduler;
  executor: ReactionExecutor;
  handle: (type: EventType, overrides?: Partial<DesktopEvent>) => ReturnType<ReactionExecutor["handleEvent"]>;
}

/**
 * Creates a configured execution harness to prevent boilerplate duplication across test suites.
 */
export function createTestHarness(initialTime = 1000, options?: { autoStart?: boolean }): TestHarness {
  let currentTime = initialTime;
  const timeProvider = () => currentTime;
  const registry = new ReactionRegistry();
  const cooldownManager = new CooldownManager(timeProvider);
  const resolver = new ReactionResolver({ registry, cooldownManager, timeProvider });
  const animMgr = new MockAnimationManager();
  const idleScheduler = new MockIdleScheduler();
  const executor = new ReactionExecutor({
    resolver,
    animationManager: animMgr,
    idleScheduler,
    timeProvider,
    autoStart: options?.autoStart ?? true,
  });

  return {
    get mockTime() {
      return currentTime;
    },
    set mockTime(val: number) {
      currentTime = val;
    },
    timeProvider,
    registry,
    cooldownManager,
    resolver,
    animMgr,
    idleScheduler,
    executor,
    handle(type: EventType, overrides?: Partial<DesktopEvent>) {
      const event: DesktopEvent = {
        id: overrides?.id ?? `evt_${Math.random().toString(36).slice(2, 7)}`,
        type,
        timestamp: overrides?.timestamp ?? currentTime,
        source: overrides?.source ?? "system",
        payload: overrides?.payload ?? {},
        ...overrides,
      };
      return executor.handleEvent(event);
    },
  };
}
