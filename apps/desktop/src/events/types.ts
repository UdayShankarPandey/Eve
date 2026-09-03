export {
  EventTypes,
  type EventType,
  type EventSource,
  type DesktopEvent,
  type BatteryEventPayload,
  type UserActivityEventPayload,
  type SessionEventPayload,
  type NetworkEventPayload,
  type AppEventPayload,
  type DownloadEventPayload,
  type FileEventPayload,
  type ScreenTimeEventPayload,
} from "../../../../packages/shared-types/src/events.ts";

/**
 * Event listener callback signature.
 */
export type EventListener<T = unknown> = (
  event: import("../../../../packages/shared-types/src/events.ts").DesktopEvent<T>
) => void;

/**
 * Filter predicate for fine-grained subscriptions.
 */
export type EventFilter = (
  event: import("../../../../packages/shared-types/src/events.ts").DesktopEvent<unknown>
) => boolean;

/**
 * Subscription options for the EventBus.
 */
export interface SubscriptionOptions {
  /** Optional filter predicate */
  filter?: EventFilter;
  /** Whether the listener should automatically unregister after firing once */
  once?: boolean;
}
