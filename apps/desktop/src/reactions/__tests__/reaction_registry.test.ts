import test, { describe } from "node:test";
import assert from "node:assert";
import {
  ReactionRegistry,
  DEFAULT_REACTIONS,
  ReactionPriority,
} from "../index.ts";
import { EventTypes } from "../../events/index.ts";
import { AnimationIds } from "../../animation/types.ts";

describe("Phase 1: Reaction Registry Tests", () => {
  test("1. All 12 documented MVP reactions exist in the default registry", () => {
    const registry = new ReactionRegistry();
    const all = registry.getAll();
    assert.strictEqual(all.length, 12);

    const mappedEvents = all.map((r) => r.eventType);
    assert.ok(mappedEvents.includes(EventTypes.BATTERY_CRITICAL));
    assert.ok(mappedEvents.includes(EventTypes.BATTERY_LOW));
    assert.ok(mappedEvents.includes(EventTypes.NETWORK_DISCONNECTED));
    assert.ok(mappedEvents.includes(EventTypes.CHARGING_STARTED));
    assert.ok(mappedEvents.includes(EventTypes.CHARGING_STOPPED));
    assert.ok(mappedEvents.includes(EventTypes.NETWORK_CONNECTED));
    assert.ok(mappedEvents.includes(EventTypes.DOWNLOAD_COMPLETED));
    assert.ok(mappedEvents.includes(EventTypes.USER_IDLE));
    assert.ok(mappedEvents.includes(EventTypes.USER_ACTIVE));
    assert.ok(mappedEvents.includes(EventTypes.PC_LOCKED));
    assert.ok(mappedEvents.includes(EventTypes.PC_UNLOCKED));
    assert.ok(mappedEvents.includes(EventTypes.APP_OPENED));
  });

  test("2. Default reactions pass integrity validation with zero errors", () => {
    const registry = new ReactionRegistry();
    const validation = registry.validate();
    assert.strictEqual(validation.isValid, true);
    assert.strictEqual(validation.errors.length, 0);
  });

  test("3. Registry validation catches invalid animation IDs and negative priorities", () => {
    const registry = new ReactionRegistry([]);
    registry.register({
      id: "invalid_reaction_1",
      eventType: EventTypes.BATTERY_LOW,
      animationId: "non_existent_animation",
      priority: -10,
      cooldownMs: -500,
      isOneShot: true,
    });

    const validation = registry.validate();
    assert.strictEqual(validation.isValid, false);
    assert.ok(validation.errors.some((e) => e.includes("references invalid animationId")));
    assert.ok(validation.errors.some((e) => e.includes("'priority' must be a non-negative number")));
    assert.ok(validation.errors.some((e) => e.includes("'cooldownMs' must be a non-negative number")));
  });

  test("4. Registry validation catches duplicate reaction IDs", () => {
    const registry = new ReactionRegistry([]);
    registry.register({
      id: "dup_id",
      eventType: EventTypes.BATTERY_LOW,
      animationId: AnimationIds.WORRIED,
      priority: ReactionPriority.HIGH,
      cooldownMs: 1000,
      isOneShot: true,
    });
    registry.register({
      id: "dup_id",
      eventType: EventTypes.CHARGING_STARTED,
      animationId: AnimationIds.HAPPY,
      priority: ReactionPriority.NORMAL,
      cooldownMs: 1000,
      isOneShot: true,
    });

    const validation = registry.validate();
    assert.strictEqual(validation.isValid, false);
    assert.ok(validation.errors.some((e) => e.includes("Duplicate reaction ID found")));
  });

  test("5. Reset restores default reactions", () => {
    const registry = new ReactionRegistry([]);
    assert.strictEqual(registry.getAll().length, 0);

    registry.reset();
    assert.strictEqual(registry.getAll().length, DEFAULT_REACTIONS.length);
  });
});
