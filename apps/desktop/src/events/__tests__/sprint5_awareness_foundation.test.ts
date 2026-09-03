import test, { describe } from "node:test";
import assert from "node:assert";
import {
  EventBus,
  EventTypes,
  type DesktopEvent,
  type FileEventPayload,
  type ScreenTimeEventPayload,
} from "../index.ts";

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
});
