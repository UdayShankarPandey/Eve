import type {
  DesktopEvent,
  EventListener,
  EventType,
  SubscriptionOptions,
} from "./types.ts";

interface InternalSubscription {
  id: number;
  listener: EventListener<any>;
  options?: SubscriptionOptions;
}

/**
 * Lightweight, in-process, strongly typed Event Bus for PixelPal.
 * Delivers standardized DesktopEvent records from native OS detectors to consumers (e.g. Reaction Engine).
 */
export class EventBus {
  private readonly listeners: Map<string, InternalSubscription[]> = new Map();
  private nextSubscriptionId = 1;
  private isDisposed = false;
  private eventHistory: DesktopEvent<any>[] = [];
  private maxHistorySize = 50;

  constructor() {}

  /**
   * Subscribes a listener to a specific event type or all events ('*').
   * Returns an unsubscribe function.
   */
  public subscribe<T = unknown>(
    eventType: EventType | "*",
    listener: EventListener<T>,
    options?: SubscriptionOptions
  ): () => void {
    this.ensureNotDisposed();

    const subId = this.nextSubscriptionId++;
    const key = eventType;

    const sub: InternalSubscription = {
      id: subId,
      listener,
      options,
    };

    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }

    this.listeners.get(key)!.push(sub);

    return () => {
      this.unsubscribe(key, subId);
    };
  }

  /**
   * Subscribes a listener that will fire only once for the specified event type.
   */
  public once<T = unknown>(eventType: EventType | "*", listener: EventListener<T>): () => void {
    return this.subscribe(eventType, listener, { once: true });
  }

  /**
   * Unsubscribes a specific subscription ID for an event type.
   */
  public unsubscribe(eventType: EventType | "*", subscriptionId: number): void {
    const list = this.listeners.get(eventType);
    if (!list) return;

    const index = list.findIndex((s) => s.id === subscriptionId);
    if (index !== -1) {
      list.splice(index, 1);
    }

    if (list.length === 0) {
      this.listeners.delete(eventType);
    }
  }

  /**
   * Publishes a standardized DesktopEvent to all matching subscribers.
   */
  public publish<T = unknown>(event: DesktopEvent<T>): void {
    this.ensureNotDisposed();

    // Store in internal rolling history for development / diagnostics
    this.recordEvent(event);

    // 1. Dispatch to type-specific subscribers
    const specificList = this.listeners.get(event.type);
    if (specificList) {
      this.dispatchToList(specificList, event, event.type);
    }

    // 2. Dispatch to wildcard ('*') subscribers
    const wildcardList = this.listeners.get("*");
    if (wildcardList) {
      this.dispatchToList(wildcardList, event, "*");
    }
  }

  /**
   * Emits an event (alias for publish).
   */
  public emit<T = unknown>(event: DesktopEvent<T>): void {
    this.publish(event);
  }

  /**
   * Dispatches an event to a list of subscriptions safely, isolating errors.
   */
  private dispatchToList(list: InternalSubscription[], event: DesktopEvent<any>, eventKey: string): void {
    const toRemove: number[] = [];
    const copy = [...list]; // avoid mutation during iteration

    for (const sub of copy) {
      // Check filter if specified
      if (sub.options?.filter && !sub.options.filter(event)) {
        continue;
      }

      try {
        sub.listener(event);
      } catch (err) {
        console.error(`[EventBus] Error in listener for '${event.type}':`, err);
      }

      if (sub.options?.once) {
        toRemove.push(sub.id);
      }
    }

    for (const id of toRemove) {
      this.unsubscribe(eventKey, id);
    }
  }

  /**
   * Stores event in short-term diagnostic history.
   */
  private recordEvent(event: DesktopEvent<any>): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Returns recent diagnostic event history.
   */
  public getHistory(): DesktopEvent<any>[] {
    return [...this.eventHistory];
  }

  /**
   * Clears event history.
   */
  public clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Returns current active subscription count for a given event type or total.
   */
  public getSubscriberCount(eventType?: EventType | "*"): number {
    if (eventType) {
      return this.listeners.get(eventType)?.length ?? 0;
    }
    let total = 0;
    for (const subs of this.listeners.values()) {
      total += subs.length;
    }
    return total;
  }

  private ensureNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error("[EventBus] Instance is disposed and cannot be used.");
    }
  }

  /**
   * Clears all subscriptions and destroys the bus.
   */
  public destroy(): void {
    this.isDisposed = true;
    this.listeners.clear();
    this.eventHistory = [];
  }
}

/**
 * Global singleton EventBus instance.
 */
export const globalEventBus = new EventBus();
