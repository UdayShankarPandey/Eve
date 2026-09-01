/**
 * Standard Desktop Event Types for PixelPal Event Engine.
 */
export const EventTypes = {
  // Battery & Power
  BATTERY_LOW: "BATTERY_LOW",
  BATTERY_CRITICAL: "BATTERY_CRITICAL",
  CHARGING_STARTED: "CHARGING_STARTED",
  CHARGING_STOPPED: "CHARGING_STOPPED",

  // User Activity
  USER_IDLE: "USER_IDLE",
  USER_ACTIVE: "USER_ACTIVE",

  // System & Session
  PC_LOCKED: "PC_LOCKED",
  PC_UNLOCKED: "PC_UNLOCKED",

  // Network
  NETWORK_CONNECTED: "NETWORK_CONNECTED",
  NETWORK_DISCONNECTED: "NETWORK_DISCONNECTED",

  // Application Activity
  APP_OPENED: "APP_OPENED",
  APP_CLOSED: "APP_CLOSED",

  // Filesystem
  DOWNLOAD_COMPLETED: "DOWNLOAD_COMPLETED",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes] | string;

/**
 * Event source categories.
 */
export type EventSource =
  | "battery"
  | "power"
  | "user_activity"
  | "session"
  | "network"
  | "application"
  | "filesystem"
  | "system";

/**
 * Standardized Desktop Event Contract.
 * Common data structure emitted by all native OS detectors and transported by the Event Bus.
 */
export interface DesktopEvent<T = Record<string, unknown>> {
  /** Unique event identifier (UUID or timestamp-based ID) */
  id: string;
  /** Canonical event type */
  type: EventType;
  /** Epoch timestamp in milliseconds when the event was detected */
  timestamp: number;
  /** Subsystem or detector category that generated the event */
  source: EventSource;
  /** Strongly-typed or key-value event payload */
  payload: T;
  /** Optional metadata such as schema version, session ID, or diagnostics */
  metadata?: Record<string, unknown>;
}

/**
 * Payload schemas for Phase 1 & Phase 2 events.
 */
export interface BatteryEventPayload {
  battery_percent: number;
  ac_line_status: number; // 0 = Discharging, 1 = AC / Charging, 255 = Unknown
  previous_percent?: number;
}

export interface UserActivityEventPayload {
  idle_duration_ms: number;
  idle_threshold_ms: number;
}

export interface SessionEventPayload {
  session_id?: number;
  lock_state?: "locked" | "unlocked" | string;
}

export interface NetworkEventPayload {
  connected: boolean;
  network_type?: string;
  previous_connected?: boolean;
}

export interface AppEventPayload {
  app_name: string;
  process_id?: number;
  window_title?: string;
  previous_app?: string;
}

export interface DownloadEventPayload {
  filename: string;
  size_bytes: number;
  extension?: string;
  download_dir?: string;
}
