/**
 * PixelPal — AI Privacy & Context Boundary Enforcement
 * Sprint 10 Phase 4
 *
 * Enforces the layered privacy boundary for LLM desktop context:
 * - AI_CONTEXT permission controls whether ANY desktop awareness context may leave the machine
 * - When AI_CONTEXT is disabled, exactly zero desktop context fields are permitted
 * - When AI_CONTEXT is enabled, each field is additionally gated by its controlling detector permission
 * - Machine-readable context scope diagnostics for transparent user visibility
 * - Strict allowlisting guarantees zero silent expansion of context
 */

import type {
  ApprovedConversationContext,
  BoundedEventSummary,
} from "../../../../packages/shared-types/src/conversation.ts";
import type { EventType } from "../../../../packages/shared-types/src/events.ts";
import {
  type PermissionConfig,
  type AiContextScopeDescription,
  PermissionIds,
} from "./types.ts";
import { getRequiredPermissionForEvent } from "./enforcement.ts";

/**
 * Filters an ApprovedConversationContext snapshot against active privacy permissions.
 *
 * Invariants:
 * 1. If AI_CONTEXT is disabled -> returns `{}` (zero desktop awareness signals).
 * 2. If AI_CONTEXT is enabled -> each field is included ONLY if its controlling detector permission is enabled.
 * 3. Never silently passes unknown or unapproved fields.
 */
export function filterApprovedContext(
  rawContext: ApprovedConversationContext,
  config: PermissionConfig
): ApprovedConversationContext {
  if (!rawContext || typeof rawContext !== "object") {
    return {};
  }

  // Master AI Context gate: if disabled, ZERO desktop context leaves the machine
  const aiPerm = config.permissions[PermissionIds.AI_CONTEXT];
  if (!aiPerm || !aiPerm.enabled) {
    return {};
  }

  const systemEnabled = Boolean(config.permissions[PermissionIds.SYSTEM]?.enabled);
  const appEnabled = Boolean(config.permissions[PermissionIds.APPLICATIONS]?.enabled);
  const filesEnabled = Boolean(config.permissions[PermissionIds.FILES]?.enabled);
  const screenTimeEnabled = Boolean(config.permissions[PermissionIds.SCREEN_TIME]?.enabled);

  const filtered: Record<string, unknown> = {};

  // System & Power signals
  if (systemEnabled) {
    if (typeof rawContext.batteryPercent === "number") {
      filtered.batteryPercent = rawContext.batteryPercent;
    }
    if (typeof rawContext.isCharging === "boolean") {
      filtered.isCharging = rawContext.isCharging;
    }
    if (typeof rawContext.networkConnected === "boolean") {
      filtered.networkConnected = rawContext.networkConnected;
    }
    if (typeof rawContext.networkType === "string") {
      filtered.networkType = rawContext.networkType;
    }
    if (typeof rawContext.idleMinutes === "number") {
      filtered.idleMinutes = rawContext.idleMinutes;
    }
  }

  // Application Activity signals
  if (appEnabled && typeof rawContext.activeAppName === "string") {
    filtered.activeAppName = rawContext.activeAppName;
  }

  // Filter recent event summaries by their individual controlling permissions
  if (Array.isArray(rawContext.recentEvents) && rawContext.recentEvents.length > 0) {
    const safeRecentEvents: BoundedEventSummary[] = [];

    for (const eventSummary of rawContext.recentEvents) {
      if (!eventSummary || typeof eventSummary !== "object") continue;

      const controllingPerm = getRequiredPermissionForEvent(eventSummary.eventType as EventType);
      if (!controllingPerm) continue;

      let permAllowed = false;
      if (controllingPerm === PermissionIds.SYSTEM && systemEnabled) permAllowed = true;
      if (controllingPerm === PermissionIds.APPLICATIONS && appEnabled) permAllowed = true;
      if (controllingPerm === PermissionIds.FILES && filesEnabled) permAllowed = true;
      if (controllingPerm === PermissionIds.SCREEN_TIME && screenTimeEnabled) permAllowed = true;

      if (permAllowed) {
        safeRecentEvents.push({
          eventType: eventSummary.eventType,
          timestamp: eventSummary.timestamp,
          summary: eventSummary.summary,
        });
      }
    }

    if (safeRecentEvents.length > 0) {
      filtered.recentEvents = safeRecentEvents;
    }
  }

  return filtered as ApprovedConversationContext;
}

/**
 * Returns a machine-readable summary of context categories currently permitted vs blocked for AI requests.
 * Transparently reveals category status without exposing any private data values.
 */
export function describeAiContextScope(
  config: PermissionConfig
): AiContextScopeDescription {
  const aiPerm = config.permissions[PermissionIds.AI_CONTEXT];
  const aiContextEnabled = Boolean(aiPerm?.enabled);

  if (!aiContextEnabled) {
    return {
      aiContextEnabled: false,
      allowedCategories: [],
      blockedCategories: [
        "battery_and_power",
        "network_status",
        "idle_duration",
        "active_application",
        "recent_events",
      ],
    };
  }

  const systemEnabled = Boolean(config.permissions[PermissionIds.SYSTEM]?.enabled);
  const appEnabled = Boolean(config.permissions[PermissionIds.APPLICATIONS]?.enabled);
  const filesEnabled = Boolean(config.permissions[PermissionIds.FILES]?.enabled);

  const allowed: string[] = [];
  const blocked: string[] = [];

  if (systemEnabled) {
    allowed.push("battery_and_power", "network_status", "idle_duration");
  } else {
    blocked.push("battery_and_power", "network_status", "idle_duration");
  }

  if (appEnabled) {
    allowed.push("active_application");
  } else {
    blocked.push("active_application");
  }

  if (filesEnabled) {
    allowed.push("recent_file_summaries");
  } else {
    blocked.push("recent_file_summaries");
  }

  return {
    aiContextEnabled: true,
    allowedCategories: allowed,
    blockedCategories: blocked,
  };
}
