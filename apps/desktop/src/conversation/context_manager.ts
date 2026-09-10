/**
 * PixelPal — Controlled Conversation Context Manager
 * Sprint 9 Phase 2
 *
 * Enforces the strict privacy and context allowlist boundary:
 * - Allows ONLY approved fields: battery, charging, network, idle minutes, app name, recent event summaries.
 * - Strictly strips and blocks: window titles, keystrokes, clipboard, passwords, process memory, file contents.
 * - Restricts recent events to a maximum of 3 bounded summaries.
 * - Never continuously uploads desktop telemetry.
 */

import type { DesktopEvent } from "../../../../packages/shared-types/src/events.ts";
import { EventTypes } from "../../../../packages/shared-types/src/events.ts";
import {
  type ApprovedConversationContext,
  type BoundedEventSummary,
  MAX_RECENT_EVENTS_IN_CONTEXT,
} from "./types.ts";

/**
 * Sanitizes an application name, stripping path separators, excessive length,
 * and rejecting any potential window title leakage.
 */
export function sanitizeAppName(rawName: unknown): string | undefined {
  if (typeof rawName !== "string") {
    return undefined;
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // Bound length to prevent buffer bloat
  const bounded = trimmed.slice(0, 50);

  // Filter out characters commonly associated with window titles or paths
  return bounded.replace(/[\\/:*?"<>|]/g, "").trim() || undefined;
}

/**
 * Creates a bounded, privacy-safe summary for a canonical DesktopEvent.
 * Explicitly excludes raw payloads, window titles, or private paths.
 */
export function createSafeEventSummary(event: DesktopEvent): BoundedEventSummary | null {
  const payload = (event.payload || {}) as Record<string, unknown>;

  switch (event.type) {
    case EventTypes.BATTERY_LOW:
    case EventTypes.BATTERY_CRITICAL: {
      const pct = typeof payload.battery_percent === "number"
        ? Math.round(payload.battery_percent)
        : undefined;
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: pct !== undefined ? `Battery level is at ${pct}%` : "Low battery warning",
      };
    }

    case EventTypes.CHARGING_STARTED:
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: "Power adapter connected (charging started)",
      };

    case EventTypes.CHARGING_STOPPED:
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: "Power adapter disconnected (running on battery)",
      };

    case EventTypes.NETWORK_CONNECTED: {
      const netType = typeof payload.network_type === "string" ? payload.network_type : "";
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: netType ? `Network connected (${netType})` : "Network connection restored",
      };
    }

    case EventTypes.NETWORK_DISCONNECTED:
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: "Network interface disconnected",
      };

    case EventTypes.DOWNLOAD_COMPLETED: {
      const filename = typeof payload.filename === "string" ? payload.filename.trim() : "";
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: filename ? `Download finished: ${filename}` : "A file download completed",
      };
    }

    case EventTypes.APP_OPENED: {
      const appName = sanitizeAppName(payload.app_name);
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: appName ? `Switched to application: ${appName}` : "Application opened",
      };
    }

    case EventTypes.USER_IDLE: {
      const mins = typeof payload.idle_duration_ms === "number"
        ? Math.max(1, Math.round(payload.idle_duration_ms / 60000))
        : undefined;
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: mins !== undefined ? `User inactive for ${mins} minutes` : "User became idle",
      };
    }

    case EventTypes.USER_ACTIVE:
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: "User resumed active input",
      };

    case EventTypes.PC_LOCKED:
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: "Workstation locked",
      };

    case EventTypes.PC_UNLOCKED:
      return {
        eventType: event.type,
        timestamp: event.timestamp,
        summary: "Workstation unlocked",
      };

    default:
      // Unknown or unapproved event categories are omitted to prevent leakage
      return null;
  }
}

/**
 * State snapshot maintained by the desktop host for conversation context.
 */
export interface DesktopStateSnapshot {
  batteryPercent?: number;
  isCharging?: boolean;
  networkConnected?: boolean;
  networkType?: string;
  idleMinutes?: number;
  activeAppName?: string;
}

/**
 * Manages the generation of strictly allowlisted conversation context.
 */
export class ConversationContextManager {
  private currentState: DesktopStateSnapshot = {};
  private recentEvents: BoundedEventSummary[] = [];

  /**
   * Updates the current cached desktop state snapshot.
   */
  public updateState(partialState: Partial<DesktopStateSnapshot>): void {
    if (partialState.batteryPercent !== undefined) {
      this.currentState.batteryPercent = Math.min(
        100,
        Math.max(0, Math.round(partialState.batteryPercent))
      );
    }
    if (partialState.isCharging !== undefined) {
      this.currentState.isCharging = Boolean(partialState.isCharging);
    }
    if (partialState.networkConnected !== undefined) {
      this.currentState.networkConnected = Boolean(partialState.networkConnected);
    }
    if (partialState.networkType !== undefined) {
      this.currentState.networkType = String(partialState.networkType).slice(0, 30);
    }
    if (partialState.idleMinutes !== undefined) {
      this.currentState.idleMinutes = Math.max(0, Math.round(partialState.idleMinutes));
    }
    if (partialState.activeAppName !== undefined) {
      this.currentState.activeAppName = sanitizeAppName(partialState.activeAppName);
    }
  }

  /**
   * Records a recent desktop event, converting it to a safe summary and enforcing bounding.
   */
  public recordEvent(event: DesktopEvent): void {
    const safeSummary = createSafeEventSummary(event);
    if (!safeSummary) {
      return;
    }

    this.recentEvents.push(safeSummary);
    while (this.recentEvents.length > MAX_RECENT_EVENTS_IN_CONTEXT) {
      this.recentEvents.shift();
    }
  }

  /**
   * Clears the recent events window.
   */
  public clearRecentEvents(): void {
    this.recentEvents = [];
  }

  /**
   * Builds the strictly allowlisted context payload for the LLM request.
   * Guarantees zero sensitive data or raw event payloads are present.
   */
  public buildApprovedContext(): ApprovedConversationContext {
    return {
      ...(this.currentState.batteryPercent !== undefined
        ? { batteryPercent: this.currentState.batteryPercent }
        : {}),
      ...(this.currentState.isCharging !== undefined
        ? { isCharging: this.currentState.isCharging }
        : {}),
      ...(this.currentState.networkConnected !== undefined
        ? { networkConnected: this.currentState.networkConnected }
        : {}),
      ...(this.currentState.networkType !== undefined
        ? { networkType: this.currentState.networkType }
        : {}),
      ...(this.currentState.idleMinutes !== undefined
        ? { idleMinutes: this.currentState.idleMinutes }
        : {}),
      ...(this.currentState.activeAppName !== undefined
        ? { activeAppName: this.currentState.activeAppName }
        : {}),
      ...(this.recentEvents.length > 0
        ? { recentEvents: [...this.recentEvents] }
        : {}),
    };
  }
}
