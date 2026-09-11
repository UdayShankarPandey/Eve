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
  private readonly eventHistory: DesktopEvent<any>[] = [];
  private readonly maxHistorySize = 50;

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

    const currentList = this.listeners.get(key);
    if (!currentList || currentList.length === 0) {
      this.listeners.set(key, [sub]);
    } else {
      // Copy-on-Write: create a new snapshot array so active dispatches are unaffected
      this.listeners.set(key, [...currentList, sub]);
    }

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

    // Copy-on-Write: filter out removed subscriber to maintain immutable snapshot
    const nextList = list.filter((s) => s.id !== subscriptionId);
    if (nextList.length === 0) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.set(eventType, nextList);
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
    if (specificList && specificList.length > 0) {
      this.dispatchToList(specificList, event, event.type);
    }

    // 2. Dispatch to wildcard ('*') subscribers
    const wildcardList = this.listeners.get("*");
    if (wildcardList && wildcardList.length > 0) {
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
   * Dispatches an event to an immutable snapshot of subscriptions with zero temporary array copies.
   */
  private dispatchToList(
    list: readonly InternalSubscription[],
    event: DesktopEvent<any>,
    eventKey: EventType | "*"
  ): void {
    const len = list.length;
    if (len === 0) return;

    let toRemove: number[] | null = null;

    // Direct iteration over the snapshot array without cloning
    for (let i = 0; i < len; i++) {
      const sub = list[i];

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
        if (!toRemove) {
          toRemove = [];
        }
        toRemove.push(sub.id);
      }
    }

    if (toRemove) {
      for (const id of toRemove) {
        this.unsubscribe(eventKey, id);
      }
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
    this.eventHistory.length = 0;
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
    this.eventHistory.length = 0;
  }
}

/**
 * Global singleton EventBus instance.
 */
export const globalEventBus = new EventBus();
