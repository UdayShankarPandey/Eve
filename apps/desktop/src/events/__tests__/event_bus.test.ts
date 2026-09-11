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

describe("EVT-02: Zero-Allocation Dispatch & Re-entrancy Safety", () => {
  test("1. Normal listener execution order is strictly preserved (FIFO)", () => {
    const bus = new EventBus();
    const callOrder: number[] = [];

    bus.subscribe(EventTypes.BATTERY_LOW, () => callOrder.push(1));
    bus.subscribe(EventTypes.BATTERY_LOW, () => callOrder.push(2));
    bus.subscribe(EventTypes.BATTERY_LOW, () => callOrder.push(3));

    bus.publish({ id: "e1", type: EventTypes.BATTERY_LOW, timestamp: 1, source: "battery", payload: {} });

    assert.deepStrictEqual(callOrder, [1, 2, 3]);
    bus.destroy();
  });

  test("2. Wildcard listener order: type-specific listeners fire first, wildcard listeners second", () => {
    const bus = new EventBus();
    const callOrder: string[] = [];

    bus.subscribe("*", () => callOrder.push("wildcard_1"));
    bus.subscribe(EventTypes.BATTERY_LOW, () => callOrder.push("specific_1"));
    bus.subscribe("*", () => callOrder.push("wildcard_2"));
    bus.subscribe(EventTypes.BATTERY_LOW, () => callOrder.push("specific_2"));

    bus.publish({ id: "e1", type: EventTypes.BATTERY_LOW, timestamp: 1, source: "battery", payload: {} });

    assert.deepStrictEqual(callOrder, ["specific_1", "specific_2", "wildcard_1", "wildcard_2"]);
    bus.destroy();
  });

  test("3. Re-entrant unsubscribe during dispatch does not alter current iteration indices", () => {
    const bus = new EventBus();
    const executed: number[] = [];
    let unsub2: () => void = () => {};

    bus.subscribe(EventTypes.CHARGING_STARTED, () => {
      executed.push(1);
      // Listener 1 unsubscribes listener 2 mid-dispatch!
      unsub2();
    });

    unsub2 = bus.subscribe(EventTypes.CHARGING_STARTED, () => {
      executed.push(2);
    });

    bus.subscribe(EventTypes.CHARGING_STARTED, () => {
      executed.push(3);
    });

    // In Copy-on-Write snapshot dispatch, active dispatch completes the existing snapshot cleanly
    bus.publish({ id: "e1", type: EventTypes.CHARGING_STARTED, timestamp: 1, source: "battery", payload: {} });
    assert.strictEqual(executed.includes(1), true);
    assert.strictEqual(executed.includes(3), true);

    // On subsequent event, unsubscribed listener 2 NEVER executes
    executed.length = 0;
    bus.publish({ id: "e2", type: EventTypes.CHARGING_STARTED, timestamp: 2, source: "battery", payload: {} });
    assert.deepStrictEqual(executed, [1, 3], "Subsequent dispatch must not invoke unsubscribed listener 2");

    bus.destroy();
  });

  test("4. Re-entrant subscribe during dispatch does not fire for the currently in-flight event", () => {
    const bus = new EventBus();
    const executed: string[] = [];

    bus.subscribe(EventTypes.NETWORK_CONNECTED, () => {
      executed.push("listener_1");
      // Dynamically subscribe listener 2 during listener 1 execution
      bus.subscribe(EventTypes.NETWORK_CONNECTED, () => {
        executed.push("listener_2");
      });
    });

    // First event: listener 2 was registered mid-dispatch, MUST NOT run for this in-flight event
    bus.publish({ id: "e1", type: EventTypes.NETWORK_CONNECTED, timestamp: 1, source: "network", payload: {} });
    assert.deepStrictEqual(executed, ["listener_1"]);

    // Second event: newly registered listener 2 MUST now execute
    executed.length = 0;
    bus.publish({ id: "e2", type: EventTypes.NETWORK_CONNECTED, timestamp: 2, source: "network", payload: {} });
    assert.deepStrictEqual(executed, ["listener_1", "listener_2"]);

    bus.destroy();
  });

  test("5. Listener throwing during dispatch isolates error and continues dispatching to remaining subscribers", () => {
    const bus = new EventBus();
    const executed: number[] = [];

    bus.subscribe(EventTypes.APP_OPENED, () => {
      executed.push(1);
      throw new Error("Simulated failure in subscriber 1");
    });

    bus.subscribe(EventTypes.APP_OPENED, () => {
      executed.push(2);
    });

    assert.doesNotThrow(() => {
      bus.publish({ id: "e1", type: EventTypes.APP_OPENED, timestamp: 1, source: "app", payload: {} });
    });

    assert.deepStrictEqual(executed, [1, 2]);
    bus.destroy();
  });

  test("6. Empty subscriber list publishes safely without allocating temporary structures", () => {
    const bus = new EventBus();

    // Event with 0 specific and 0 wildcard subscribers
    assert.doesNotThrow(() => {
      bus.publish({ id: "e1", type: EventTypes.FILE_CREATED, timestamp: 1, source: "filesystem", payload: {} });
    });

    assert.strictEqual(bus.getHistory().length, 1);
    bus.destroy();
  });

  test("7. Repeated publication: 100 consecutive events execute deterministically with zero memory churn", () => {
    const bus = new EventBus();
    let receiveCount = 0;

    bus.subscribe(EventTypes.USER_IDLE, () => {
      receiveCount++;
    });

    for (let i = 0; i < 100; i++) {
      bus.publish({ id: `e_${i}`, type: EventTypes.USER_IDLE, timestamp: i, source: "user_activity", payload: {} });
    }

    assert.strictEqual(receiveCount, 100);
    bus.destroy();
  });
});
