import test, { describe } from "node:test";
import assert from "node:assert";
import {
  ReactionResolver,
  ReactionRegistry,
  CooldownManager,
  ReactionPriority,
  type ActiveReactionState,
} from "../index.ts";
import { EventTypes, type DesktopEvent } from "../../events/index.ts";
import { AnimationIds } from "../../animation/types.ts";

describe("Phase 1: Reaction Resolver Tests", () => {
  test("1. All 12 canonical MVP events resolve deterministically to their documented animations", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({
      timeProvider: () => mockTime,
    });

    const cases: Array<{ eventType: string; expectedAnim: string; expectedPriority: number }> = [
      { eventType: EventTypes.BATTERY_CRITICAL, expectedAnim: AnimationIds.SAD, expectedPriority: ReactionPriority.CRITICAL },
      { eventType: EventTypes.BATTERY_LOW, expectedAnim: AnimationIds.WORRIED, expectedPriority: ReactionPriority.HIGH },
      { eventType: EventTypes.NETWORK_DISCONNECTED, expectedAnim: AnimationIds.WORRIED, expectedPriority: ReactionPriority.HIGH },
      { eventType: EventTypes.CHARGING_STARTED, expectedAnim: AnimationIds.HAPPY, expectedPriority: ReactionPriority.NORMAL },
      { eventType: EventTypes.CHARGING_STOPPED, expectedAnim: AnimationIds.WORRIED, expectedPriority: ReactionPriority.NORMAL },
      { eventType: EventTypes.NETWORK_CONNECTED, expectedAnim: AnimationIds.HAPPY, expectedPriority: ReactionPriority.NORMAL },
      { eventType: EventTypes.DOWNLOAD_COMPLETED, expectedAnim: AnimationIds.HAPPY, expectedPriority: ReactionPriority.NORMAL },
      { eventType: EventTypes.USER_IDLE, expectedAnim: AnimationIds.SLEEPY, expectedPriority: ReactionPriority.LOW },
      { eventType: EventTypes.USER_ACTIVE, expectedAnim: AnimationIds.HAPPY, expectedPriority: ReactionPriority.LOW },
      { eventType: EventTypes.PC_LOCKED, expectedAnim: AnimationIds.SLEEPY, expectedPriority: ReactionPriority.LOW },
      { eventType: EventTypes.PC_UNLOCKED, expectedAnim: AnimationIds.SURPRISED, expectedPriority: ReactionPriority.LOW },
      { eventType: EventTypes.APP_OPENED, expectedAnim: AnimationIds.SURPRISED, expectedPriority: ReactionPriority.LOW },
    ];

    for (const c of cases) {
      const event: DesktopEvent = {
        id: `evt_${c.eventType}`,
        type: c.eventType,
        timestamp: mockTime,
        source: "system",
        payload: {},
      };

      const result = resolver.resolve(event);
      assert.strictEqual(result.status, "RESOLVED", `Failed for event ${c.eventType}`);
      assert.strictEqual(result.reaction?.animationId, c.expectedAnim, `Animation mismatch for ${c.eventType}`);
      assert.strictEqual(result.reaction?.priority, c.expectedPriority, `Priority mismatch for ${c.eventType}`);
    }
  });

  test("2. Unknown event type produces NO_REACTION safely without throwing", () => {
    const resolver = new ReactionResolver();
    const event: DesktopEvent = {
      id: "unknown_1",
      type: "UNKNOWN_CUSTOM_EVENT",
      timestamp: 1000,
      source: "system",
      payload: {},
    };

    const result = resolver.resolve(event);
    assert.strictEqual(result.status, "NO_REACTION");
    assert.strictEqual(result.reaction, undefined);
  });

  test("3. Cooldown suppression: Event triggers on cooldown produce SUPPRESSED_ON_COOLDOWN", () => {
    let mockTime = 1000;
    const cooldownMgr = new CooldownManager(() => mockTime);
    const resolver = new ReactionResolver({
      cooldownManager: cooldownMgr,
      timeProvider: () => mockTime,
    });

    const event: DesktopEvent = {
      id: "bat_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: mockTime,
      source: "battery",
      payload: {},
    };

    // 1. First evaluation is accepted
    const res1 = resolver.resolve(event);
    assert.strictEqual(res1.status, "RESOLVED");

    // Arm cooldown for 180,000ms
    cooldownMgr.recordTrigger(res1.reaction!.id, res1.reaction!.cooldownMs, mockTime);

    // 2. Second evaluation during cooldown -> SUPPRESSED_ON_COOLDOWN
    mockTime = 5000;
    const res2 = resolver.resolve(event);
    assert.strictEqual(res2.status, "SUPPRESSED_ON_COOLDOWN");
    assert.strictEqual(res2.reaction?.id, "react_battery_low");

    // 3. Evaluation after cooldown expiry (181,001ms) -> RESOLVED
    mockTime = 181_001;
    const res3 = resolver.resolve(event);
    assert.strictEqual(res3.status, "RESOLVED");
  });

  test("4. Priority Resolution: High-priority event interrupts active low-priority reaction", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({
      timeProvider: () => mockTime,
    });

    const activeAppReaction: ActiveReactionState = {
      reaction: resolver.getRegistry().getForEventType(EventTypes.APP_OPENED)!, // Priority 30 (LOW)
      event: { id: "e_app", type: EventTypes.APP_OPENED, timestamp: 1000, source: "application", payload: {} },
      startedAt: 1000,
      expiresAt: 3000, // Active until 3000
    };

    // Incoming HIGH priority event (BATTERY_LOW, Priority 80)
    const highEvent: DesktopEvent = {
      id: "e_bat",
      type: EventTypes.BATTERY_LOW,
      timestamp: 1500,
      source: "battery",
      payload: {},
    };

    const result = resolver.resolve(highEvent, activeAppReaction, 1500);
    assert.strictEqual(result.status, "RESOLVED");
    assert.strictEqual(result.reaction?.id, "react_battery_low");
    assert.ok(result.reason?.includes("interrupts active reaction"));
  });

  test("5. Priority Resolution: Low-priority event is suppressed while high-priority reaction is active", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({
      timeProvider: () => mockTime,
    });

    const activeBatteryReaction: ActiveReactionState = {
      reaction: resolver.getRegistry().getForEventType(EventTypes.BATTERY_LOW)!, // Priority 80 (HIGH)
      event: { id: "e_bat", type: EventTypes.BATTERY_LOW, timestamp: 1000, source: "battery", payload: {} },
      startedAt: 1000,
      expiresAt: 5000,
    };

    // Incoming LOW priority event (APP_OPENED, Priority 30)
    const lowEvent: DesktopEvent = {
      id: "e_app",
      type: EventTypes.APP_OPENED,
      timestamp: 2000,
      source: "application",
      payload: {},
    };

    const result = resolver.resolve(lowEvent, activeBatteryReaction, 2000);
    assert.strictEqual(result.status, "SUPPRESSED_BY_PRIORITY");
    assert.strictEqual(result.reaction?.id, "react_app_opened");
  });

  test("6. Equal Priority Resolution: Equal priority candidate is suppressed by active reaction", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({
      timeProvider: () => mockTime,
    });

    const activeNormalReaction: ActiveReactionState = {
      reaction: resolver.getRegistry().getForEventType(EventTypes.CHARGING_STARTED)!, // Priority 50 (NORMAL)
      event: { id: "e_charge", type: EventTypes.CHARGING_STARTED, timestamp: 1000, source: "battery", payload: {} },
      startedAt: 1000,
      expiresAt: 4000,
    };

    // Incoming equal NORMAL priority event (DOWNLOAD_COMPLETED, Priority 50)
    const normalEvent: DesktopEvent = {
      id: "e_dl",
      type: EventTypes.DOWNLOAD_COMPLETED,
      timestamp: 2000,
      source: "filesystem",
      payload: {},
    };

    const result = resolver.resolve(normalEvent, activeNormalReaction, 2000);
    assert.strictEqual(result.status, "SUPPRESSED_BY_PRIORITY");
  });

  test("7. Determinism: Repeating same resolution queries with identical state yields identical outputs", () => {
    const resolver = new ReactionResolver();
    const event: DesktopEvent = {
      id: "e_test",
      type: EventTypes.DOWNLOAD_COMPLETED,
      timestamp: 1000,
      source: "filesystem",
      payload: {},
    };

    const r1 = resolver.resolve(event, null, 1000);
    const r2 = resolver.resolve(event, null, 1000);
    const r3 = resolver.resolve(event, null, 1000);

    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
  });
});
