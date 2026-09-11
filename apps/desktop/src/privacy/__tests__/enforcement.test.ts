/**
 * PixelPal — Permission Enforcement & Event Gate Tests
 * Sprint 10 Phase 2
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";

import {
  EventTypes,
  type DesktopEvent,
} from "../../events/types.ts";
import {
  DEFAULT_PERMISSIONS_CONFIG,
  PermissionIds,
} from "../types.ts";
import {
  EVENT_TO_PERMISSION_MAP,
  getRequiredPermissionForEvent,
  isEventPermitted,
  EventGate,
  mapPermissionConfigToDetectorConfig,
  isNotificationPresentationPermitted,
} from "../enforcement.ts";
import { EventBus } from "../../events/event_bus.ts";

describe("Category D: Permission Enforcement & Event Gate", () => {
  const allowedDir = path.resolve("C:\\Workspace\\AllowedProject");
  const outsideDir = path.resolve("C:\\Users\\Secret");

  function createTestEvent(type: any, payload: Record<string, unknown> = {}): DesktopEvent {
    return {
      id: `ev_${Date.now()}_${Math.random()}`,
      type,
      timestamp: Date.now(),
      source: "system",
      payload,
    };
  }

  it("1. Complete Event-to-Permission mapping covers all canonical MVP events", () => {
    assert.equal(getRequiredPermissionForEvent(EventTypes.BATTERY_LOW), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.BATTERY_CRITICAL), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.CHARGING_STARTED), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.CHARGING_STOPPED), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.USER_IDLE), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.USER_ACTIVE), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.PC_LOCKED), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.PC_UNLOCKED), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.NETWORK_CONNECTED), PermissionIds.SYSTEM);
    assert.equal(getRequiredPermissionForEvent(EventTypes.NETWORK_DISCONNECTED), PermissionIds.SYSTEM);

    assert.equal(getRequiredPermissionForEvent(EventTypes.APP_OPENED), PermissionIds.APPLICATIONS);
    assert.equal(getRequiredPermissionForEvent(EventTypes.APP_CLOSED), PermissionIds.APPLICATIONS);

    assert.equal(getRequiredPermissionForEvent(EventTypes.DOWNLOAD_COMPLETED), PermissionIds.FILES);
    assert.equal(getRequiredPermissionForEvent(EventTypes.FILE_CREATED), PermissionIds.FILES);
    assert.equal(getRequiredPermissionForEvent(EventTypes.FILE_MODIFIED), PermissionIds.FILES);
    assert.equal(getRequiredPermissionForEvent(EventTypes.FILE_DELETED), PermissionIds.FILES);

    assert.equal(getRequiredPermissionForEvent(EventTypes.SCREEN_TIME_HIGH), PermissionIds.SCREEN_TIME);

    // Unmapped event type returns null
    assert.equal(getRequiredPermissionForEvent("UNKNOWN_EVENT" as any), null);
  });

  it("2. Disabling SYSTEM blocks all battery, power, network, session, and idle events", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.SYSTEM.enabled = false;

    assert.equal(isEventPermitted(createTestEvent(EventTypes.BATTERY_LOW), config), false);
    assert.equal(isEventPermitted(createTestEvent(EventTypes.BATTERY_CRITICAL), config), false);
    assert.equal(isEventPermitted(createTestEvent(EventTypes.CHARGING_STARTED), config), false);
    assert.equal(isEventPermitted(createTestEvent(EventTypes.NETWORK_CONNECTED), config), false);
    assert.equal(isEventPermitted(createTestEvent(EventTypes.USER_IDLE), config), false);
    assert.equal(isEventPermitted(createTestEvent(EventTypes.PC_LOCKED), config), false);
  });

  it("3. Disabling APPLICATIONS blocks app opened and closed events", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.APPLICATIONS.enabled = false;

    assert.equal(isEventPermitted(createTestEvent(EventTypes.APP_OPENED, { app_name: "Code" }), config), false);
    assert.equal(isEventPermitted(createTestEvent(EventTypes.APP_CLOSED, { app_name: "Code" }), config), false);

    // SYSTEM events still pass
    assert.equal(isEventPermitted(createTestEvent(EventTypes.BATTERY_LOW), config), true);
  });

  it("4. FILES permission enforces both enabled state and directory scoping", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.FILES.enabled = true;
    config.permissions.FILES.scope = {
      allowedPaths: [allowedDir],
    };

    // File inside allowed scope is permitted
    const insideFile = path.join(allowedDir, "code.ts");
    assert.equal(
      isEventPermitted(createTestEvent(EventTypes.FILE_CREATED, { path: insideFile }), config),
      true
    );

    // File outside allowed scope is blocked
    const outsideFile = path.join(outsideDir, "secret.key");
    assert.equal(
      isEventPermitted(createTestEvent(EventTypes.FILE_CREATED, { path: outsideFile }), config),
      false
    );

    // When FILES permission is disabled, even allowed files are blocked
    config.permissions.FILES.enabled = false;
    assert.equal(
      isEventPermitted(createTestEvent(EventTypes.FILE_CREATED, { path: insideFile }), config),
      false
    );

    // When allowedPaths is empty, even enabled FILES permission blocks all files
    config.permissions.FILES.enabled = true;
    config.permissions.FILES.scope = { allowedPaths: [] };
    assert.equal(
      isEventPermitted(createTestEvent(EventTypes.FILE_CREATED, { path: insideFile }), config),
      false
    );
  });

  it("5. EventGate intercepts and suppresses prohibited events before downstream dispatch", () => {
    const bus = new EventBus();
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.APPLICATIONS.enabled = false; // Block apps

    const gate = new EventGate(config);

    const receivedEvents: DesktopEvent[] = [];
    bus.subscribe("*", (ev) => receivedEvents.push(ev));

    // Permitted event
    const batteryEvent = createTestEvent(EventTypes.BATTERY_LOW);
    const permitted = gate.publishIfPermitted(bus, batteryEvent);
    assert.equal(permitted, true);
    assert.equal(receivedEvents.length, 1);
    assert.equal(gate.getDroppedEventsCount(), 0);

    // Prohibited event
    const appEvent = createTestEvent(EventTypes.APP_OPENED, { app_name: "VS Code" });
    const blocked = gate.publishIfPermitted(bus, appEvent);
    assert.equal(blocked, false);
    assert.equal(receivedEvents.length, 1, "Prohibited event must NOT reach downstream bus listeners");
    assert.equal(gate.getDroppedEventsCount(), 1);

    // Dynamic runtime update: re-enable APPLICATIONS
    config.permissions.APPLICATIONS.enabled = true;
    gate.updateConfig(config);

    const rePermitted = gate.publishIfPermitted(bus, appEvent);
    assert.equal(rePermitted, true);
    assert.equal(receivedEvents.length, 2);
  });

  it("6. mapPermissionConfigToDetectorConfig maps high-level permissions to native detector config", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.SYSTEM.enabled = true;
    config.permissions.APPLICATIONS.enabled = false;
    config.permissions.FILES.enabled = true;
    config.permissions.FILES.scope = { allowedPaths: [allowedDir] };
    config.permissions.SCREEN_TIME.enabled = false;

    const nativeMapping = mapPermissionConfigToDetectorConfig(config);
    assert.equal(nativeMapping.battery_enabled, true);
    assert.equal(nativeMapping.network_enabled, true);
    assert.equal(nativeMapping.app_activity_enabled, false, "Native app detector must be disabled");
    assert.equal(nativeMapping.filesystem_enabled, true);
    assert.deepEqual(nativeMapping.monitored_directories, [allowedDir]);
    assert.equal(nativeMapping.screen_time_enabled, false, "Native screen time detector must be disabled");
  });

  it("7. NOTIFICATIONS permission explicitly controls presentation intent", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    assert.equal(isNotificationPresentationPermitted(config), true);

    config.permissions.NOTIFICATIONS.enabled = false;
    assert.equal(isNotificationPresentationPermitted(config), false);
  });

  it("8. IPC-01: mapPermissionConfigToDetectorConfig outputs all 13 canonical native configuration fields", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    const nativeMapping = mapPermissionConfigToDetectorConfig(config);

    const requiredFields = [
      "battery_enabled",
      "app_activity_enabled",
      "user_activity_enabled",
      "session_enabled",
      "network_enabled",
      "filesystem_enabled",
      "monitored_directories",
      "downloads_enabled",
      "downloads_dir",
      "selected_applications",
      "idle_threshold_ms",
      "screen_time_threshold_ms",
      "screen_time_enabled",
    ];

    for (const field of requiredFields) {
      assert.ok(
        field in nativeMapping,
        `Field '${field}' must be present in NativeDetectorConfigMapping to match Rust DetectorConfig`
      );
    }

    assert.equal(typeof nativeMapping.idle_threshold_ms, "number");
    assert.equal(typeof nativeMapping.screen_time_threshold_ms, "number");
    assert.ok(
      nativeMapping.downloads_dir === null || typeof nativeMapping.downloads_dir === "string",
      "downloads_dir must be string or null"
    );
    assert.ok(Array.isArray(nativeMapping.selected_applications));
  });

  it("9. RUST-01: Downloads detector is strictly gated on explicit canonical Downloads authorization", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));

    // Case 1: FILES disabled
    config.permissions.FILES.enabled = false;
    config.permissions.FILES.scope = { allowedPaths: ["C:\\Users\\Test\\Downloads"] };
    const res1 = mapPermissionConfigToDetectorConfig(config);
    assert.equal(res1.downloads_enabled, false);
    assert.equal(res1.downloads_dir, null);

    // Case 2: FILES enabled, allowedPaths empty []
    config.permissions.FILES.enabled = true;
    config.permissions.FILES.scope = { allowedPaths: [] };
    const res2 = mapPermissionConfigToDetectorConfig(config);
    assert.equal(res2.downloads_enabled, false);
    assert.equal(res2.downloads_dir, null);

    // Case 3: FILES enabled, unrelated folder (must NOT enable downloads)
    config.permissions.FILES.enabled = true;
    config.permissions.FILES.scope = { allowedPaths: ["C:\\Some\\Arbitrary\\Folder"] };
    const res3 = mapPermissionConfigToDetectorConfig(config);
    assert.equal(res3.downloads_enabled, false);
    assert.equal(res3.downloads_dir, null);
  });
});
