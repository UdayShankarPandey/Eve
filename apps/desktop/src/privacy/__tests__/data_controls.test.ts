/**
 * PixelPal — Data Controls & Deletion Tests
 * Sprint 10 Phase 3
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { EventBus } from "../../events/event_bus.ts";
import { EventTypes } from "../../events/types.ts";
import { FileSystemConversationStorageAdapter } from "../../conversation/storage.ts";
import { FileSystemProfileStorageAdapter } from "../../character/profile_storage.ts";
import { FileSystemGeneratedStorageAdapter } from "../../character/generated_storage.ts";
import { FileSystemSpriteStorageAdapter } from "../../character/sprite_storage.ts";
import { FileSystemPersonalityStorageAdapter } from "../../personality/storage.ts";
import { FileSystemPermissionStorageAdapter } from "../storage.ts";
import { DataControlsManager } from "../data_controls.ts";
import type { CharacterProfile } from "../../character/types.ts";

describe("Category E: Data Controls & Deletion Engine", () => {
  let testRoot: string;
  let convFile: string;
  let profileDir: string;
  let genDir: string;
  let spriteDir: string;
  let personalityFile: string;
  let permissionFile: string;

  let convStorage: FileSystemConversationStorageAdapter;
  let profileStorage: FileSystemProfileStorageAdapter;
  let genStorage: FileSystemGeneratedStorageAdapter;
  let spriteStorage: FileSystemSpriteStorageAdapter;
  let personalityStorage: FileSystemPersonalityStorageAdapter;
  let permissionStorage: FileSystemPermissionStorageAdapter;
  let dataControls: DataControlsManager;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal-data-control-test-"));
    convFile = path.join(testRoot, "conversation_history.json");
    profileDir = path.join(testRoot, "profiles");
    genDir = path.join(testRoot, "generated");
    spriteDir = path.join(testRoot, "sprites");
    personalityFile = path.join(testRoot, "personality.json");
    permissionFile = path.join(testRoot, "permissions.json");

    convStorage = new FileSystemConversationStorageAdapter(convFile);
    profileStorage = new FileSystemProfileStorageAdapter(profileDir);
    genStorage = new FileSystemGeneratedStorageAdapter(genDir);
    spriteStorage = new FileSystemSpriteStorageAdapter(spriteDir);
    personalityStorage = new FileSystemPersonalityStorageAdapter(personalityFile);
    permissionStorage = new FileSystemPermissionStorageAdapter(permissionFile);

    dataControls = new DataControlsManager({
      conversationStorage: convStorage,
      profileStorage: profileStorage,
      generatedStorage: genStorage,
      spriteStorage: spriteStorage,
      personalityStorage: personalityStorage,
      permissionStorage: permissionStorage,
    });
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("1. clearEventHistory empties the EventBus in-memory rolling history", async () => {
    const bus = new EventBus();
    bus.publish({
      id: "ev_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: Date.now(),
      source: "battery",
      payload: {},
    });
    bus.publish({
      id: "ev_2",
      type: EventTypes.NETWORK_CONNECTED,
      timestamp: Date.now(),
      source: "network",
      payload: {},
    });

    assert.equal(bus.getHistory().length, 2);

    const result = await dataControls.clearEventHistory(bus);
    assert.equal(result.success, true);
    assert.equal(result.itemsDeleted, 2);
    assert.equal(bus.getHistory().length, 0);
  });

  it("2. deleteConversationHistory wipes conversation files durably from disk", async () => {
    await convStorage.saveHistory([
      {
        id: "msg_1",
        role: "user",
        content: "Hello PixelPal",
        timestamp: Date.now(),
      },
    ]);
    assert.ok(fs.existsSync(convFile));
    assert.equal((await convStorage.loadHistory()).length, 1);

    const result = await dataControls.deleteConversationHistory();
    assert.equal(result.success, true);
    assert.equal(fs.existsSync(convFile), false, "File must be removed from disk");

    // Subsequent fresh load returns empty array
    const freshStorage = new FileSystemConversationStorageAdapter(convFile);
    const messages = await freshStorage.loadHistory();
    assert.deepEqual(messages, []);
  });

  it("3. deleteCharacter deletes target profile and owned assets while preserving unrelated data", async () => {
    const targetCharId = "character_1725888000000_1a2b3c4d5e6f7890";
    const targetGenId = "generated_char_1725888000000_1a2b3c4d5e6f7890";
    const targetSpriteId = "sprite_char_1725888000000_1a2b3c4d5e6f7890";

    const unrelatedCharId = "character_1725888000000_9f8e7d6c5b4a3210";
    const unrelatedGenId = "generated_char_1725888000000_9f8e7d6c5b4a3210";
    const unrelatedSpriteId = "sprite_char_1725888000000_9f8e7d6c5b4a3210";

    // Create dummy image assets
    const dummyPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    await genStorage.save(targetGenId, dummyPng);
    await spriteStorage.save(targetSpriteId, dummyPng);

    await genStorage.save(unrelatedGenId, dummyPng);
    await spriteStorage.save(unrelatedSpriteId, dummyPng);

    // Create external unrelated file
    const externalFile = path.join(testRoot, "external_user_doc.txt");
    fs.writeFileSync(externalFile, "Important user document");

    // Create target character profile
    const targetProfile: CharacterProfile = {
      characterId: targetCharId,
      schemaVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: {
        generatedCharacterId: targetGenId,
        spriteId: targetSpriteId,
      },
      style: {
        proportions: "standard-mascot",
        renderingStyle: "chibi-pixel-art",
        detailLevel: "simplified-iconic",
        backgroundIntent: "transparent-ready",
      },
      clothing: {
        category: "casual",
        top: "hoodie",
        bottom: "jeans",
        footwear: "sneakers",
        accessory: "glasses",
        colorTheme: "pastel-soft",
      },
      palette: {
        mood: "warm",
        maxOpaqueColors: 16,
        colors: [
          { r: 255, g: 100, b: 50 },
          { r: 0, g: 0, b: 0 },
        ],
        transparencyPolicy: "binary-threshold",
        alphaThreshold: 128,
      },
    };
    await profileStorage.save(targetProfile);

    // Create unrelated character profile
    const unrelatedProfile: CharacterProfile = {
      ...targetProfile,
      characterId: unrelatedCharId,
      assets: {
        generatedCharacterId: unrelatedGenId,
        spriteId: unrelatedSpriteId,
      },
    };
    await profileStorage.save(unrelatedProfile);

    // Verify all files exist before deletion
    assert.ok(await genStorage.get(targetGenId));
    assert.ok(await spriteStorage.get(targetSpriteId));
    assert.ok(await profileStorage.get(targetCharId));

    assert.ok(await genStorage.get(unrelatedGenId));
    assert.ok(await spriteStorage.get(unrelatedSpriteId));
    assert.ok(await profileStorage.get(unrelatedCharId));
    assert.ok(fs.existsSync(externalFile));

    // Execute deletion of target character
    const deletionResult = await dataControls.deleteCharacter(targetCharId);
    assert.equal(deletionResult.success, true);
    assert.equal(deletionResult.itemsDeleted, 3); // generated + sprite + profile

    // Verify target assets were removed
    assert.equal(await genStorage.get(targetGenId), null);
    assert.equal(await spriteStorage.get(targetSpriteId), null);
    assert.equal(await profileStorage.get(targetCharId), null);

    // STRICT INVARIANT: Unrelated character assets and profile MUST be intact!
    assert.ok(await genStorage.get(unrelatedGenId), "Unrelated generated asset must be preserved");
    assert.ok(await spriteStorage.get(unrelatedSpriteId), "Unrelated sprite asset must be preserved");
    assert.ok(await profileStorage.get(unrelatedCharId), "Unrelated profile must be preserved");

    // STRICT INVARIANT: External file must be untouched!
    assert.ok(fs.existsSync(externalFile), "External files must never be touched");
  });

  it("4. deleteCharacter rejects path traversal attempts without touching files", async () => {
    const traversal1 = await dataControls.deleteCharacter("../../../etc/passwd");
    assert.equal(traversal1.success, false);
    assert.ok(traversal1.error?.includes("Invalid character ID format"));

    const traversal2 = await dataControls.deleteCharacter("character_123/../../bad");
    assert.equal(traversal2.success, false);

    const nonExistent = await dataControls.deleteCharacter("character_1725888000000_ffffffffffffffff");
    assert.equal(nonExistent.success, false);
    assert.ok(nonExistent.error?.includes("not found"));
  });

  it("5. resetSettings restores default permissions and personality while preserving character identity", async () => {
    // 1. Mutate permissions and personality
    await permissionStorage.saveConfig({
      schemaVersion: 1,
      updatedAt: Date.now(),
      permissions: {
        ...permissionStorage.loadConfig(),
        AI_CONTEXT: {
          id: "AI_CONTEXT",
          name: "AI",
          enabled: true, // mutated to true
          description: "desc",
        },
      } as any,
    });

    await personalityStorage.saveConfig({
      personalityId: "chaotic",
      frequency: "high",
      intensity: "expressive",
      aiDialogueEnabled: true,
      schemaVersion: 1,
      updatedAt: Date.now(),
    });

    // 2. Perform reset
    const result = await dataControls.resetSettings();
    assert.equal(result.success, true);

    // 3. Verify defaults restored
    const resetPerms = await permissionStorage.loadConfig();
    assert.equal(resetPerms.permissions.AI_CONTEXT.enabled, false, "AI_CONTEXT must reset to false");

    const resetPers = await personalityStorage.loadConfig();
    assert.equal(resetPers.personalityId, "friendly", "Personality must reset to friendly");
    assert.equal(resetPers.aiDialogueEnabled, false, "AI dialogue must reset to false");
  });
});
