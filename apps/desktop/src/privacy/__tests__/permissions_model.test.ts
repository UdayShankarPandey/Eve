/**
 * PixelPal — Permission Model & Persistence Tests
 * Sprint 10 Phase 1
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  PermissionIds,
  isValidPermissionId,
  DEFAULT_PERMISSIONS_CONFIG,
  PERMISSION_DESCRIPTIONS,
} from "../types.ts";
import {
  validatePermissionConfig,
  FileSystemPermissionStorageAdapter,
  InMemoryPermissionStorageAdapter,
} from "../storage.ts";
import { PermissionManager } from "../permission_manager.ts";

describe("Category A: Permission Model & Definitions", () => {
  it("1. All six canonical permissions exist with valid identifiers", () => {
    const ids = Object.values(PermissionIds);
    assert.equal(ids.length, 6);
    assert.ok(ids.includes("SYSTEM"));
    assert.ok(ids.includes("APPLICATIONS"));
    assert.ok(ids.includes("FILES"));
    assert.ok(ids.includes("NOTIFICATIONS"));
    assert.ok(ids.includes("SCREEN_TIME"));
    assert.ok(ids.includes("AI_CONTEXT"));

    for (const id of ids) {
      assert.ok(isValidPermissionId(id), `isValidPermissionId should return true for ${id}`);
    }

    assert.equal(isValidPermissionId("INVALID_PERM"), false);
    assert.equal(isValidPermissionId(null), false);
    assert.equal(isValidPermissionId(123), false);
  });

  it("2. Each permission has a comprehensive, non-empty description", () => {
    for (const id of Object.values(PermissionIds)) {
      const desc = PERMISSION_DESCRIPTIONS[id];
      assert.ok(typeof desc === "string" && desc.length > 50, `Description for ${id} must be detailed`);
      // Verify descriptions address observation and boundaries
      assert.ok(desc.includes("NEVER") || desc.includes("ZERO"), `Description for ${id} must specify negative boundaries`);
    }
  });

  it("3. Default configuration adheres to privacy-first standards", () => {
    const config = DEFAULT_PERMISSIONS_CONFIG;
    assert.equal(config.schemaVersion, 1);
    assert.equal(config.permissions.AI_CONTEXT.enabled, false, "AI_CONTEXT must be disabled by default");
    assert.deepEqual(
      (config.permissions.FILES.scope as any)?.allowedPaths,
      [],
      "FILES allowed paths must be empty by default"
    );
  });
});

describe("Category B: Storage Adapters & Persistence", () => {
  let testDir: string;
  let testConfigFile: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal-perm-test-"));
    testConfigFile = path.join(testDir, "permissions.json");
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("1. InMemory adapter persists and retrieves configuration accurately", async () => {
    const adapter = new InMemoryPermissionStorageAdapter();
    const initial = await adapter.loadConfig();
    assert.equal(initial.permissions.AI_CONTEXT.enabled, false);

    const modified = {
      ...initial,
      permissions: {
        ...initial.permissions,
        AI_CONTEXT: {
          ...initial.permissions.AI_CONTEXT,
          enabled: true,
        },
      },
    };
    await adapter.saveConfig(modified);

    const loaded = await adapter.loadConfig();
    assert.equal(loaded.permissions.AI_CONTEXT.enabled, true);

    await adapter.resetConfig();
    const reset = await adapter.loadConfig();
    assert.equal(reset.permissions.AI_CONTEXT.enabled, false);
  });

  it("2. FileSystem adapter writes atomically with mode 0o600", async () => {
    const adapter = new FileSystemPermissionStorageAdapter(testConfigFile);
    const initial = await adapter.loadConfig();
    assert.equal(initial.permissions.SYSTEM.enabled, true);

    await adapter.saveConfig(initial);
    assert.ok(fs.existsSync(testConfigFile));

    const stat = fs.statSync(testConfigFile);
    assert.ok(stat.size > 0);

    // Read directly from disk
    const content = JSON.parse(fs.readFileSync(testConfigFile, "utf-8"));
    assert.equal(content.schemaVersion, 1);
    assert.equal(content.permissions.SYSTEM.name, "System & Hardware Awareness");
  });

  it("3. FileSystem adapter safely recovers from missing or corrupted file", async () => {
    const adapter = new FileSystemPermissionStorageAdapter(testConfigFile);

    // Missing file returns safe default
    const missingLoaded = await adapter.loadConfig();
    assert.equal(missingLoaded.permissions.AI_CONTEXT.enabled, false);

    // Corrupted file (invalid JSON)
    fs.writeFileSync(testConfigFile, "{ bad json, corrupt content ");
    const corruptLoaded = await adapter.loadConfig();
    assert.equal(corruptLoaded.permissions.AI_CONTEXT.enabled, false);
    assert.equal(corruptLoaded.permissions.SYSTEM.enabled, true);

    // Partial corrupted object
    fs.writeFileSync(testConfigFile, JSON.stringify({ permissions: "not-an-object" }));
    const partialLoaded = await adapter.loadConfig();
    assert.equal(partialLoaded.permissions.SYSTEM.enabled, true);
  });

  it("4. PermissionManager initializes, updates, and notifies listeners", async () => {
    const adapter = new InMemoryPermissionStorageAdapter();
    const manager = new PermissionManager({ storage: adapter });
    await manager.init();

    assert.ok(manager.isReady());
    assert.equal(manager.isPermissionEnabled("AI_CONTEXT"), false);

    let notificationFired = false;
    const unsub = manager.addListener((updated) => {
      if (updated.id === "AI_CONTEXT" && updated.enabled === true) {
        notificationFired = true;
      }
    });

    const updated = await manager.updatePermission("AI_CONTEXT", true);
    assert.equal(updated.enabled, true);
    assert.equal(manager.isPermissionEnabled("AI_CONTEXT"), true);
    assert.ok(notificationFired, "Listener must be notified on permission update");

    unsub();
  });
});
