import test, { describe } from "node:test";
import assert from "node:assert";
import {
  EventBus,
  EventTypes,
  type DesktopEvent,
  type BatteryEventPayload,
  type UserActivityEventPayload,
} from "../index.ts";

describe("Phase 1: Event Bus & Event Model Tests", () => {
  test("1. Standard DesktopEvent model validates required fields", () => {
    const event: DesktopEvent<BatteryEventPayload> = {
      id: "evt_1001",
      type: EventTypes.BATTERY_LOW,
      timestamp: Date.now(),
      source: "battery",
      payload: {
        battery_percent: 15,
        ac_line_status: 0,
      },
    };

    assert.strictEqual(event.id, "evt_1001");
    assert.strictEqual(event.type, "BATTERY_LOW");
    assert.strictEqual(event.source, "battery");
    assert.strictEqual(event.payload.battery_percent, 15);
    assert.ok(event.timestamp > 0);
  });

  test("2. Publish and subscribe dispatches to matching event types", () => {
    const bus = new EventBus();
    const received: DesktopEvent<any>[] = [];

    const unsub = bus.subscribe(EventTypes.CHARGING_STARTED, (evt) => {
      received.push(evt);
    });

    // Publish matching event
    bus.publish({
      id: "e1",
      type: EventTypes.CHARGING_STARTED,
      timestamp: 1000,
      source: "battery",
      payload: { battery_percent: 50, ac_line_status: 1 },
    });

    // Publish non-matching event
    bus.publish({
      id: "e2",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1001,
      source: "battery",
      payload: { battery_percent: 12, ac_line_status: 0 },
    });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, EventTypes.CHARGING_STARTED);

    unsub();
    bus.destroy();
  });

  test("3. Unsubscribe stops future notifications", () => {
    const bus = new EventBus();
    let callCount = 0;

    const unsub = bus.subscribe(EventTypes.USER_IDLE, () => {
      callCount++;
    });

    bus.publish({
      id: "e1",
      type: EventTypes.USER_IDLE,
      timestamp: 1000,
      source: "user_activity",
      payload: { idle_duration_ms: 120000, idle_threshold_ms: 120000 },
    });

    assert.strictEqual(callCount, 1);

    unsub();

    bus.publish({
      id: "e2",
      type: EventTypes.USER_IDLE,
      timestamp: 2000,
      source: "user_activity",
      payload: { idle_duration_ms: 130000, idle_threshold_ms: 120000 },
    });

    assert.strictEqual(callCount, 1);
    bus.destroy();
  });

  test("4. Wildcard subscriber receives all events regardless of type", () => {
    const bus = new EventBus();
    const allEvents: string[] = [];

    bus.subscribe("*", (evt) => {
      allEvents.push(evt.type);
    });

    bus.publish({ id: "1", type: EventTypes.BATTERY_LOW, timestamp: 1, source: "battery", payload: {} });
    bus.publish({ id: "2", type: EventTypes.PC_LOCKED, timestamp: 2, source: "session", payload: {} });
    bus.publish({ id: "3", type: EventTypes.USER_ACTIVE, timestamp: 3, source: "user_activity", payload: {} });

    assert.strictEqual(allEvents.length, 3);
    assert.deepStrictEqual(allEvents, [
      EventTypes.BATTERY_LOW,
      EventTypes.PC_LOCKED,
      EventTypes.USER_ACTIVE,
    ]);

    bus.destroy();
  });

  test("5. once() subscriber fires exactly once and automatically unregisters", () => {
    const bus = new EventBus();
    let fireCount = 0;

    bus.once(EventTypes.PC_UNLOCKED, () => {
      fireCount++;
    });

    bus.publish({ id: "1", type: EventTypes.PC_UNLOCKED, timestamp: 1, source: "session", payload: {} });
    bus.publish({ id: "2", type: EventTypes.PC_UNLOCKED, timestamp: 2, source: "session", payload: {} });

    assert.strictEqual(fireCount, 1);
    assert.strictEqual(bus.getSubscriberCount(EventTypes.PC_UNLOCKED), 0);

    bus.destroy();
  });

  test("6. Event filter predicate filters events before invoking subscriber", () => {
    const bus = new EventBus();
    const lowBatteryAlerts: number[] = [];

    // Only subscribe to battery events where battery <= 8
    bus.subscribe<BatteryEventPayload>(
      EventTypes.BATTERY_LOW,
      (evt) => {
        lowBatteryAlerts.push(evt.payload.battery_percent);
      },
      {
        filter: (evt) => (evt.payload as BatteryEventPayload).battery_percent <= 10,
      }
    );

    bus.publish<BatteryEventPayload>({
      id: "1",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1,
      source: "battery",
      payload: { battery_percent: 15, ac_line_status: 0 },
    });

    bus.publish<BatteryEventPayload>({
      id: "2",
      type: EventTypes.BATTERY_LOW,
      timestamp: 2,
      source: "battery",
      payload: { battery_percent: 9, ac_line_status: 0 },
    });

    assert.strictEqual(lowBatteryAlerts.length, 1);
    assert.strictEqual(lowBatteryAlerts[0], 9);

    bus.destroy();
  });

  test("7. Error isolation: A throwing subscriber does not break other subscribers", () => {
    const bus = new EventBus();
    let secondSubscriberRan = false;

    bus.subscribe(EventTypes.BATTERY_CRITICAL, () => {
      throw new Error("Intentional subscriber error");
    });

    bus.subscribe(EventTypes.BATTERY_CRITICAL, () => {
      secondSubscriberRan = true;
    });

    assert.doesNotThrow(() => {
      bus.publish({
        id: "1",
        type: EventTypes.BATTERY_CRITICAL,
        timestamp: 1,
        source: "battery",
        payload: {},
      });
    });

    assert.strictEqual(secondSubscriberRan, true);
    bus.destroy();
  });

  test("8. Rolling event history records recent diagnostic events", () => {
    const bus = new EventBus();

    bus.publish({ id: "1", type: EventTypes.CHARGING_STARTED, timestamp: 1, source: "battery", payload: {} });
    bus.publish({ id: "2", type: EventTypes.CHARGING_STOPPED, timestamp: 2, source: "battery", payload: {} });

    const history = bus.getHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].id, "1");
    assert.strictEqual(history[1].id, "2");

    bus.clearHistory();
    assert.strictEqual(bus.getHistory().length, 0);

    bus.destroy();
  });

  test("9. Destroy clears all listeners and prevents further operations", () => {
    const bus = new EventBus();
    bus.subscribe(EventTypes.USER_IDLE, () => {});
    assert.strictEqual(bus.getSubscriberCount(), 1);

    bus.destroy();
    assert.strictEqual(bus.getSubscriberCount(), 0);

    assert.throws(() => {
      bus.publish({ id: "1", type: EventTypes.USER_IDLE, timestamp: 1, source: "user_activity", payload: {} });
    }, /Instance is disposed/);
  });
});
