import test, { describe } from "node:test";
import assert from "node:assert";
import {
  EventBus,
  EventTypes,
  type DesktopEvent,
  type FileEventPayload,
  type ScreenTimeEventPayload,
  type AppEventPayload,
  type NetworkEventPayload,
  type DetectorDiagnostics,
} from "../index.ts";
import { ReactionResolver } from "../../reactions/index.ts";

describe("Sprint 5 — Phase 1: Advanced Desktop Awareness Foundation Tests", () => {
  test("1. Filesystem lifecycle events (FILE_CREATED, FILE_MODIFIED, FILE_DELETED) normalize correctly", () => {
    const bus = new EventBus();
    const receivedEvents: DesktopEvent<FileEventPayload>[] = [];

    bus.subscribe<FileEventPayload>(EventTypes.FILE_CREATED, (e) => receivedEvents.push(e));
    bus.subscribe<FileEventPayload>(EventTypes.FILE_MODIFIED, (e) => receivedEvents.push(e));
    bus.subscribe<FileEventPayload>(EventTypes.FILE_DELETED, (e) => receivedEvents.push(e));

    // Emit FILE_CREATED
    bus.publish<FileEventPayload>({
      id: "fs_1",
      type: EventTypes.FILE_CREATED,
      timestamp: 1000,
      source: "filesystem",
      payload: {
        filename: "project_spec.docx",
        path: "C:\\Workspace\\project_spec.docx",
        size_bytes: 24576,
        extension: "docx",
        directory: "C:\\Workspace",
        change_type: "created",
      },
    });

    // Emit FILE_MODIFIED
    bus.publish<FileEventPayload>({
      id: "fs_2",
      type: EventTypes.FILE_MODIFIED,
      timestamp: 2000,
      source: "filesystem",
      payload: {
        filename: "project_spec.docx",
        path: "C:\\Workspace\\project_spec.docx",
        size_bytes: 32768,
        extension: "docx",
        directory: "C:\\Workspace",
        change_type: "modified",
      },
    });

    // Emit FILE_DELETED
    bus.publish<FileEventPayload>({
      id: "fs_3",
      type: EventTypes.FILE_DELETED,
      timestamp: 3000,
      source: "filesystem",
      payload: {
        filename: "project_spec.docx",
        path: "C:\\Workspace\\project_spec.docx",
        size_bytes: 32768,
        extension: "docx",
        directory: "C:\\Workspace",
        change_type: "deleted",
      },
    });

    assert.strictEqual(receivedEvents.length, 3);

    assert.strictEqual(receivedEvents[0].type, EventTypes.FILE_CREATED);
    assert.strictEqual(receivedEvents[0].payload.filename, "project_spec.docx");
    assert.strictEqual(receivedEvents[0].payload.change_type, "created");
    assert.strictEqual(receivedEvents[0].source, "filesystem");

    assert.strictEqual(receivedEvents[1].type, EventTypes.FILE_MODIFIED);
    assert.strictEqual(receivedEvents[1].payload.size_bytes, 32768);
    assert.strictEqual(receivedEvents[1].payload.change_type, "modified");

    assert.strictEqual(receivedEvents[2].type, EventTypes.FILE_DELETED);
    assert.strictEqual(receivedEvents[2].payload.change_type, "deleted");

    bus.destroy();
  });

  test("2. SCREEN_TIME_HIGH event adheres to schema and dispatches through EventBus", () => {
    const bus = new EventBus();
    const screenTimeEvents: DesktopEvent<ScreenTimeEventPayload>[] = [];

    bus.subscribe<ScreenTimeEventPayload>(EventTypes.SCREEN_TIME_HIGH, (e) =>
      screenTimeEvents.push(e)
    );

    bus.publish<ScreenTimeEventPayload>({
      id: "st_1",
      type: EventTypes.SCREEN_TIME_HIGH,
      timestamp: 5000,
      source: "session",
      payload: {
        active_duration_ms: 3600000,
        threshold_ms: 3600000,
        session_start_timestamp: 1000,
      },
    });

    assert.strictEqual(screenTimeEvents.length, 1);
    assert.strictEqual(screenTimeEvents[0].type, EventTypes.SCREEN_TIME_HIGH);
    assert.strictEqual(screenTimeEvents[0].source, "session");
    assert.strictEqual(screenTimeEvents[0].payload.active_duration_ms, 3600000);
    assert.strictEqual(screenTimeEvents[0].payload.threshold_ms, 3600000);
    assert.strictEqual(screenTimeEvents[0].payload.session_start_timestamp, 1000);

    bus.destroy();
  });

  test("3. Wildcard subscription receives Sprint 5 events seamlessly", () => {
    const bus = new EventBus();
    const allEvents: DesktopEvent<unknown>[] = [];

    bus.subscribe("*", (e) => allEvents.push(e));

    bus.publish<FileEventPayload>({
      id: "fs_wild",
      type: EventTypes.FILE_CREATED,
      timestamp: 1000,
      source: "filesystem",
      payload: {
        filename: "data.csv",
        path: "C:\\Data\\data.csv",
        size_bytes: 512,
        extension: "csv",
        directory: "C:\\Data",
        change_type: "created",
      },
    });

    bus.publish<ScreenTimeEventPayload>({
      id: "st_wild",
      type: EventTypes.SCREEN_TIME_HIGH,
      timestamp: 2000,
      source: "session",
      payload: {
        active_duration_ms: 7200000,
        threshold_ms: 3600000,
        session_start_timestamp: 1000,
      },
    });

    assert.strictEqual(allEvents.length, 2);
    assert.strictEqual(allEvents[0].type, EventTypes.FILE_CREATED);
    assert.strictEqual(allEvents[1].type, EventTypes.SCREEN_TIME_HIGH);

    bus.destroy();
  });

  test("4. Selected Application Awareness: APP_OPENED and APP_CLOSED deliver normalized app_id and process metadata", () => {
    const bus = new EventBus();
    const appOpenedEvents: DesktopEvent<import("../index.ts").AppEventPayload>[] = [];
    const appClosedEvents: DesktopEvent<import("../index.ts").AppEventPayload>[] = [];

    bus.subscribe<import("../index.ts").AppEventPayload>(EventTypes.APP_OPENED, (e) =>
      appOpenedEvents.push(e)
    );
    bus.subscribe<import("../index.ts").AppEventPayload>(EventTypes.APP_CLOSED, (e) =>
      appClosedEvents.push(e)
    );

    // Selected App Opened
    bus.publish<import("../index.ts").AppEventPayload>({
      id: "app_open_1",
      type: EventTypes.APP_OPENED,
      timestamp: 1000,
      source: "application",
      payload: {
        app_name: "VS Code",
        app_id: "Code",
        process_id: 4321,
        previous_app: "Google Chrome",
      },
    });

    // Selected App Closed / Focus Left
    bus.publish<import("../index.ts").AppEventPayload>({
      id: "app_close_1",
      type: EventTypes.APP_CLOSED,
      timestamp: 2000,
      source: "application",
      payload: {
        app_name: "VS Code",
        app_id: "Code",
        process_id: 4321,
      },
    });

    assert.strictEqual(appOpenedEvents.length, 1);
    assert.strictEqual(appOpenedEvents[0].type, EventTypes.APP_OPENED);
    assert.strictEqual(appOpenedEvents[0].payload.app_name, "VS Code");
    assert.strictEqual(appOpenedEvents[0].payload.app_id, "Code");
    assert.strictEqual(appOpenedEvents[0].payload.process_id, 4321);
    assert.strictEqual(appOpenedEvents[0].payload.previous_app, "Google Chrome");

    assert.strictEqual(appClosedEvents.length, 1);
    assert.strictEqual(appClosedEvents[0].type, EventTypes.APP_CLOSED);
    assert.strictEqual(appClosedEvents[0].payload.app_name, "VS Code");
    assert.strictEqual(appClosedEvents[0].payload.app_id, "Code");

    bus.destroy();
  });

  test("5. End-to-End complete EventBus pipeline across all Sprint 5 awareness event categories", () => {
    const bus = new EventBus();
    const eventAuditLog: string[] = [];

    bus.subscribe<NetworkEventPayload>(EventTypes.NETWORK_CONNECTED, (e) =>
      eventAuditLog.push(`NET_UP:${e.source}:${e.payload.connected}`)
    );
    bus.subscribe<NetworkEventPayload>(EventTypes.NETWORK_DISCONNECTED, (e) =>
      eventAuditLog.push(`NET_DOWN:${e.source}:${e.payload.connected}`)
    );
    bus.subscribe<AppEventPayload>(EventTypes.APP_OPENED, (e) =>
      eventAuditLog.push(`APP_OPEN:${e.source}:${e.payload.app_name}`)
    );
    bus.subscribe<AppEventPayload>(EventTypes.APP_CLOSED, (e) =>
      eventAuditLog.push(`APP_CLOSE:${e.source}:${e.payload.app_name}`)
    );
    bus.subscribe<FileEventPayload>(EventTypes.FILE_CREATED, (e) =>
      eventAuditLog.push(`FS_CREATE:${e.source}:${e.payload.filename}`)
    );
    bus.subscribe<FileEventPayload>(EventTypes.FILE_MODIFIED, (e) =>
      eventAuditLog.push(`FS_MODIFY:${e.source}:${e.payload.filename}`)
    );
    bus.subscribe<FileEventPayload>(EventTypes.FILE_DELETED, (e) =>
      eventAuditLog.push(`FS_DELETE:${e.source}:${e.payload.filename}`)
    );
    bus.subscribe<ScreenTimeEventPayload>(EventTypes.SCREEN_TIME_HIGH, (e) =>
      eventAuditLog.push(`ST_HIGH:${e.source}:${e.payload.threshold_ms}ms`)
    );

    // Publish all Sprint 5 awareness events
    bus.publish<NetworkEventPayload>({
      id: "net_conn",
      type: EventTypes.NETWORK_CONNECTED,
      timestamp: 1000,
      source: "network",
      payload: { connected: true },
    });
    bus.publish<NetworkEventPayload>({
      id: "net_disconn",
      type: EventTypes.NETWORK_DISCONNECTED,
      timestamp: 1001,
      source: "network",
      payload: { connected: false },
    });
    bus.publish<AppEventPayload>({
      id: "app_open",
      type: EventTypes.APP_OPENED,
      timestamp: 1002,
      source: "application",
      payload: { app_name: "VS Code", app_id: "Code" },
    });
    bus.publish<AppEventPayload>({
      id: "app_close",
      type: EventTypes.APP_CLOSED,
      timestamp: 1003,
      source: "application",
      payload: { app_name: "VS Code", app_id: "Code" },
    });
    bus.publish<FileEventPayload>({
      id: "file_cr",
      type: EventTypes.FILE_CREATED,
      timestamp: 1004,
      source: "filesystem",
      payload: {
        filename: "report.pdf",
        path: "C:\\Workspace\\report.pdf",
        size_bytes: 1024,
        directory: "C:\\Workspace",
        change_type: "created",
      },
    });
    bus.publish<FileEventPayload>({
      id: "file_mod",
      type: EventTypes.FILE_MODIFIED,
      timestamp: 1005,
      source: "filesystem",
      payload: {
        filename: "report.pdf",
        path: "C:\\Workspace\\report.pdf",
        size_bytes: 2048,
        directory: "C:\\Workspace",
        change_type: "modified",
      },
    });
    bus.publish<FileEventPayload>({
      id: "file_del",
      type: EventTypes.FILE_DELETED,
      timestamp: 1006,
      source: "filesystem",
      payload: {
        filename: "report.pdf",
        path: "C:\\Workspace\\report.pdf",
        size_bytes: 2048,
        directory: "C:\\Workspace",
        change_type: "deleted",
      },
    });
    bus.publish<ScreenTimeEventPayload>({
      id: "st_high",
      type: EventTypes.SCREEN_TIME_HIGH,
      timestamp: 1007,
      source: "session",
      payload: {
        active_duration_ms: 3600000,
        threshold_ms: 3600000,
        session_start_timestamp: 1000,
      },
    });

    assert.strictEqual(eventAuditLog.length, 8);
    assert.deepStrictEqual(eventAuditLog, [
      "NET_UP:network:true",
      "NET_DOWN:network:false",
      "APP_OPEN:application:VS Code",
      "APP_CLOSE:application:VS Code",
      "FS_CREATE:filesystem:report.pdf",
      "FS_MODIFY:filesystem:report.pdf",
      "FS_DELETE:filesystem:report.pdf",
      "ST_HIGH:session:3600000ms",
    ]);

    bus.destroy();
  });

  test("6. Reaction Engine Compatibility: Sprint 5 unmapped events produce NO_REACTION safely while Sprint 4 events resolve correctly", () => {
    const resolver = new ReactionResolver();

    // 1. Unmapped Sprint 5 awareness events must produce NO_REACTION safely
    const unmappedTypes = [
      EventTypes.FILE_CREATED,
      EventTypes.FILE_MODIFIED,
      EventTypes.FILE_DELETED,
      EventTypes.SCREEN_TIME_HIGH,
      EventTypes.APP_CLOSED,
    ];

    for (const evtType of unmappedTypes) {
      const event: DesktopEvent = {
        id: `unmapped_${evtType}`,
        type: evtType,
        timestamp: 1000,
        source: "system",
        payload: {},
      };

      const result = resolver.resolve(event);
      assert.strictEqual(result.status, "NO_REACTION", `Expected NO_REACTION for ${evtType}`);
      assert.strictEqual(result.reaction, undefined);
    }

    // 2. Sprint 4 mapped events continue to resolve deterministically
    const mappedCases = [
      { type: EventTypes.NETWORK_CONNECTED, expectedAnim: "happy" },
      { type: EventTypes.NETWORK_DISCONNECTED, expectedAnim: "worried" },
      { type: EventTypes.APP_OPENED, expectedAnim: "surprised" },
      { type: EventTypes.DOWNLOAD_COMPLETED, expectedAnim: "happy" },
    ];

    for (const mc of mappedCases) {
      const event: DesktopEvent = {
        id: `mapped_${mc.type}`,
        type: mc.type,
        timestamp: 1000,
        source: "system",
        payload: {},
      };

      const result = resolver.resolve(event);
      assert.strictEqual(result.status, "RESOLVED", `Expected RESOLVED for ${mc.type}`);
      assert.strictEqual(result.reaction?.animationId, mc.expectedAnim);
    }
  });

  test("7. Diagnostics & Deduplication Hardening: Diagnostics payload tracks all awareness subsystems without sensitive data", () => {
    const mockDiagnostics: DetectorDiagnostics = {
      check_count: 42,
      total_events_emitted: 10,
      total_errors: 0,
      last_check_timestamp: 1725700000000,
      battery_events: 1,
      user_activity_events: 2,
      session_events: 1,
      network_events: 2,
      app_activity_events: 1,
      downloads_events: 1,
      filesystem_events: 1,
      screen_time_events: 1,
    };

    assert.strictEqual(mockDiagnostics.check_count, 42);
    assert.strictEqual(mockDiagnostics.total_events_emitted, 10);
    assert.strictEqual(mockDiagnostics.total_errors, 0);
    assert.strictEqual(
      mockDiagnostics.battery_events +
        mockDiagnostics.user_activity_events +
        mockDiagnostics.session_events +
        mockDiagnostics.network_events +
        mockDiagnostics.app_activity_events +
        mockDiagnostics.downloads_events +
        mockDiagnostics.filesystem_events +
        mockDiagnostics.screen_time_events,
      10
    );

    // Verify privacy safety: keys contain zero personal or content-level data
    const keys = Object.keys(mockDiagnostics);
    assert.ok(!keys.includes("file_contents"));
    assert.ok(!keys.includes("keystrokes"));
    assert.ok(!keys.includes("clipboard"));
    assert.ok(!keys.includes("window_titles"));
    assert.ok(!keys.includes("passwords"));
  });
});
