import test, { describe } from "node:test";
import assert from "node:assert";
import { CooldownManager } from "../index.ts";

describe("Phase 1: Cooldown Manager Tests", () => {
  test("1. Initial state has zero cooldowns", () => {
    let mockTime = 1000;
    const cooldownMgr = new CooldownManager(() => mockTime);

    assert.strictEqual(cooldownMgr.isOnCooldown("react_battery_low"), false);
    assert.strictEqual(cooldownMgr.getRemainingCooldown("react_battery_low"), 0);
  });

  test("2. Recording trigger arms cooldown deterministically", () => {
    let mockTime = 1000;
    const cooldownMgr = new CooldownManager(() => mockTime);

    // Arm 60,000ms cooldown
    cooldownMgr.recordTrigger("react_battery_low", 60_000);

    assert.strictEqual(cooldownMgr.isOnCooldown("react_battery_low"), true);
    assert.strictEqual(cooldownMgr.getRemainingCooldown("react_battery_low"), 60_000);

    // Advance mock time by 20,000ms
    mockTime = 21_000;
    assert.strictEqual(cooldownMgr.isOnCooldown("react_battery_low"), true);
    assert.strictEqual(cooldownMgr.getRemainingCooldown("react_battery_low"), 40_000);

    // Advance mock time to 61,000ms (cooldown expired)
    mockTime = 61_000;
    assert.strictEqual(cooldownMgr.isOnCooldown("react_battery_low"), false);
    assert.strictEqual(cooldownMgr.getRemainingCooldown("react_battery_low"), 0);
  });

  test("3. Different reactions have independent cooldowns", () => {
    let mockTime = 1000;
    const cooldownMgr = new CooldownManager(() => mockTime);

    cooldownMgr.recordTrigger("react_battery_low", 180_000);

    // Battery low is on cooldown, but network disconnected is NOT
    assert.strictEqual(cooldownMgr.isOnCooldown("react_battery_low"), true);
    assert.strictEqual(cooldownMgr.isOnCooldown("react_network_disconnected"), false);

    cooldownMgr.recordTrigger("react_network_disconnected", 30_000);

    // Both on cooldown with different remaining durations
    assert.strictEqual(cooldownMgr.getRemainingCooldown("react_battery_low"), 180_000);
    assert.strictEqual(cooldownMgr.getRemainingCooldown("react_network_disconnected"), 30_000);
  });

  test("4. Resetting single reaction and resetting all cooldowns", () => {
    let mockTime = 1000;
    const cooldownMgr = new CooldownManager(() => mockTime);

    cooldownMgr.recordTrigger("r1", 5000);
    cooldownMgr.recordTrigger("r2", 5000);

    assert.strictEqual(cooldownMgr.isOnCooldown("r1"), true);
    assert.strictEqual(cooldownMgr.isOnCooldown("r2"), true);

    cooldownMgr.resetReaction("r1");
    assert.strictEqual(cooldownMgr.isOnCooldown("r1"), false);
    assert.strictEqual(cooldownMgr.isOnCooldown("r2"), true);

    cooldownMgr.reset();
    assert.strictEqual(cooldownMgr.isOnCooldown("r2"), false);
  });
});
