import test, { describe } from "node:test";
import assert from "node:assert";
import {
  EventBus,
  EventTypes,
  type DesktopEvent,
  type NetworkEventPayload,
  type AppEventPayload,
  type DownloadEventPayload,
} from "../index.ts";

describe("Phase 2: Event Normalization & Phase 2 Payloads Tests", () => {
  test("1. Network connected and disconnected events adhere to standardized payload schema", () => {
    const bus = new EventBus();
    const networkEvents: DesktopEvent<NetworkEventPayload>[] = [];

    bus.subscribe<NetworkEventPayload>(EventTypes.NETWORK_CONNECTED, (e) => networkEvents.push(e));
    bus.subscribe<NetworkEventPayload>(EventTypes.NETWORK_DISCONNECTED, (e) => networkEvents.push(e));

    bus.publish<NetworkEventPayload>({
      id: "net_1",
      type: EventTypes.NETWORK_CONNECTED,
      timestamp: 1000,
      source: "network",
      payload: { connected: true, previous_connected: false },
    });

    bus.publish<NetworkEventPayload>({
      id: "net_2",
      type: EventTypes.NETWORK_DISCONNECTED,
      timestamp: 2000,
      source: "network",
      payload: { connected: false, previous_connected: true },
    });

    assert.strictEqual(networkEvents.length, 2);
    assert.strictEqual(networkEvents[0].type, EventTypes.NETWORK_CONNECTED);
    assert.strictEqual(networkEvents[0].payload.connected, true);
    assert.strictEqual(networkEvents[1].type, EventTypes.NETWORK_DISCONNECTED);
    assert.strictEqual(networkEvents[1].payload.connected, false);

    bus.destroy();
  });

  test("2. Application activity events deliver normalized app_name and process metadata", () => {
    const bus = new EventBus();
    const appEvents: DesktopEvent<AppEventPayload>[] = [];

    bus.subscribe<AppEventPayload>(EventTypes.APP_OPENED, (e) => appEvents.push(e));

    bus.publish<AppEventPayload>({
      id: "app_1",
      type: EventTypes.APP_OPENED,
      timestamp: 1000,
      source: "application",
      payload: {
        app_name: "VS Code",
        process_id: 1234,
        previous_app: "Google Chrome",
      },
    });

    assert.strictEqual(appEvents.length, 1);
    assert.strictEqual(appEvents[0].payload.app_name, "VS Code");
    assert.strictEqual(appEvents[0].payload.previous_app, "Google Chrome");
    assert.strictEqual(appEvents[0].source, "application");

    bus.destroy();
  });

  test("3. Download completed events normalize filename, size, and extension metadata", () => {
    const bus = new EventBus();
    const downloadEvents: DesktopEvent<DownloadEventPayload>[] = [];

    bus.subscribe<DownloadEventPayload>(EventTypes.DOWNLOAD_COMPLETED, (e) => downloadEvents.push(e));

    bus.publish<DownloadEventPayload>({
      id: "dl_1",
      type: EventTypes.DOWNLOAD_COMPLETED,
      timestamp: 1000,
      source: "filesystem",
      payload: {
        filename: "dataset.zip",
        size_bytes: 1048576,
        extension: "zip",
        download_dir: "C:\\Users\\User\\Downloads",
      },
    });

    assert.strictEqual(downloadEvents.length, 1);
    assert.strictEqual(downloadEvents[0].payload.filename, "dataset.zip");
    assert.strictEqual(downloadEvents[0].payload.size_bytes, 1048576);
    assert.strictEqual(downloadEvents[0].payload.extension, "zip");
    assert.strictEqual(downloadEvents[0].source, "filesystem");

    bus.destroy();
  });
});
