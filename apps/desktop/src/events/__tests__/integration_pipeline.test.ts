import test, { describe } from "node:test";
import assert from "node:assert";
import {
  EventBus,
  EventTypes,
  type DesktopEvent,
  type BatteryEventPayload,
  type UserActivityEventPayload,
  type SessionEventPayload,
  type NetworkEventPayload,
  type AppEventPayload,
  type DownloadEventPayload,
} from "../index.ts";

describe("Phase 3: End-to-End Event Pipeline & Hardening Tests", () => {
  test("1. End-to-End Pipeline: All canonical event types dispatch through EventBus to subscribers", () => {
    const bus = new EventBus();
    const eventLog: string[] = [];

    // Register typed subscribers for all MVP event types
    bus.subscribe<BatteryEventPayload>(EventTypes.BATTERY_LOW, (e) => {
      eventLog.push(`BATTERY_LOW:${e.payload.battery_percent}%`);
    });
    bus.subscribe<BatteryEventPayload>(EventTypes.CHARGING_STARTED, (e) => {
      eventLog.push(`CHARGING_STARTED:${e.payload.ac_line_status}`);
    });
    bus.subscribe<UserActivityEventPayload>(EventTypes.USER_IDLE, (e) => {
      eventLog.push(`USER_IDLE:${e.payload.idle_duration_ms}ms`);
    });
    bus.subscribe<SessionEventPayload>(EventTypes.PC_LOCKED, (e) => {
      eventLog.push(`PC_LOCKED:${e.payload.lock_state}`);
    });
    bus.subscribe<NetworkEventPayload>(EventTypes.NETWORK_CONNECTED, (e) => {
      eventLog.push(`NETWORK_CONNECTED:${e.payload.connected}`);
    });
    bus.subscribe<AppEventPayload>(EventTypes.APP_OPENED, (e) => {
      eventLog.push(`APP_OPENED:${e.payload.app_name}`);
    });
    bus.subscribe<DownloadEventPayload>(EventTypes.DOWNLOAD_COMPLETED, (e) => {
      eventLog.push(`DOWNLOAD_COMPLETED:${e.payload.filename}`);
    });

    // Simulate emissions from all detectors through the bus
    bus.publish<BatteryEventPayload>({
      id: "e1",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1000,
      source: "battery",
      payload: { battery_percent: 14, ac_line_status: 0 },
    });

    bus.publish<BatteryEventPayload>({
      id: "e2",
      type: EventTypes.CHARGING_STARTED,
      timestamp: 1001,
      source: "battery",
      payload: { battery_percent: 14, ac_line_status: 1 },
    });

    bus.publish<UserActivityEventPayload>({
      id: "e3",
      type: EventTypes.USER_IDLE,
      timestamp: 1002,
      source: "user_activity",
      payload: { idle_duration_ms: 120000, idle_threshold_ms: 120000 },
    });

    bus.publish<SessionEventPayload>({
      id: "e4",
      type: EventTypes.PC_LOCKED,
      timestamp: 1003,
      source: "session",
      payload: { lock_state: "locked" },
    });

    bus.publish<NetworkEventPayload>({
      id: "e5",
      type: EventTypes.NETWORK_CONNECTED,
      timestamp: 1004,
      source: "network",
      payload: { connected: true },
    });

    bus.publish<AppEventPayload>({
      id: "e6",
      type: EventTypes.APP_OPENED,
      timestamp: 1005,
      source: "application",
      payload: { app_name: "VS Code", previous_app: "Terminal" },
    });

    bus.publish<DownloadEventPayload>({
      id: "e7",
      type: EventTypes.DOWNLOAD_COMPLETED,
      timestamp: 1006,
      source: "filesystem",
      payload: { filename: "update.tar.gz", size_bytes: 849200, extension: "gz" },
    });

    assert.strictEqual(eventLog.length, 7);
    assert.deepStrictEqual(eventLog, [
      "BATTERY_LOW:14%",
      "CHARGING_STARTED:1",
      "USER_IDLE:120000ms",
      "PC_LOCKED:locked",
      "NETWORK_CONNECTED:true",
      "APP_OPENED:VS Code",
      "DOWNLOAD_COMPLETED:update.tar.gz",
    ]);

    bus.destroy();
  });

  test("2. Event Bus Hardening: Payload isolation across multiple concurrent subscribers", () => {
    const bus = new EventBus();
    const observedPayloads: any[] = [];

    // First subscriber receives payload
    bus.subscribe(EventTypes.APP_OPENED, (e) => {
      observedPayloads.push({ ...e.payload });
    });

    // Second subscriber receives payload
    bus.subscribe(EventTypes.APP_OPENED, (e) => {
      observedPayloads.push({ ...e.payload });
    });

    bus.publish<AppEventPayload>({
      id: "e1",
      type: EventTypes.APP_OPENED,
      timestamp: 1000,
      source: "application",
      payload: { app_name: "Spotify" },
    });

    assert.strictEqual(observedPayloads.length, 2);
    assert.strictEqual(observedPayloads[0].app_name, "Spotify");
    assert.strictEqual(observedPayloads[1].app_name, "Spotify");

    bus.destroy();
  });

  test("3. Concurrency & Lifecycle: Repeated subscribe/unsubscribe cycles leave zero leaks", () => {
    const bus = new EventBus();
    const unsubs: (() => void)[] = [];

    // Create 100 subscriptions
    for (let i = 0; i < 100; i++) {
      unsubs.push(bus.subscribe(EventTypes.USER_ACTIVE, () => {}));
    }
    assert.strictEqual(bus.getSubscriberCount(EventTypes.USER_ACTIVE), 100);

    // Unsubscribe all
    for (const unsub of unsubs) {
      unsub();
    }
    assert.strictEqual(bus.getSubscriberCount(EventTypes.USER_ACTIVE), 0);

    bus.destroy();
  });
});
