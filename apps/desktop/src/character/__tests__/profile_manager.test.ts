/**
 * PixelPal — CharacterProfile & Identity Foundation Tests
 * Sprint 6 Phase 5 Test Suite
 *
 * Comprehensive validation of Character ID generation, collision resistance,
 * schema validation, asset consistency, atomic persistence, lifecycle operations,
 * immutability guarantees, privacy, and complete 5-phase pipeline chaining.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";

import {
  CharacterProfileManager,
  generateCharacterId,
  isValidCharacterId,
  FileSystemProfileStorageAdapter,
  InMemoryProfileStorageAdapter,
  validateProfile,
  validateClothingConfiguration,
  validatePaletteConfiguration,
  validateStyleOptions,
  validateAssetReferences,
} from "../index.ts";

import {
  FileSystemTemporaryStorageAdapter,
  FileSystemProcessedStorageAdapter,
  FileSystemGeneratedStorageAdapter,
  FileSystemSpriteStorageAdapter,
  ImageUploadBoundary,
  ImagePreprocessor,
  CharacterGenerator,
  PixelArtProcessor,
  MockCharacterGenerationProvider,
  type CharacterProfile,
  type CreateProfileRequest,
  type UpdateProfileRequest,
  type UploadSuccessResult,
  type PreprocessSuccessResult,
  type GenerateCharacterSuccessResult,
  type PixelProcessSuccessResult,
  type ProfileSuccessResult,
  type ProfileFailureResult,
} from "../index.ts";

describe("Sprint 6 Phase 5: Character Profile & Identity Foundation", () => {
  let tempProfileDir: string;
  let tempUploadDir: string;
  let tempProcessedDir: string;
  let tempGeneratedDir: string;
  let tempSpriteDir: string;

  let profileStorage: FileSystemProfileStorageAdapter;
  let generatedStorage: FileSystemGeneratedStorageAdapter;
  let spriteStorage: FileSystemSpriteStorageAdapter;
  let profileManager: CharacterProfileManager;

  // Pipeline components for end-to-end chaining
  let uploadBoundary: ImageUploadBoundary;
  let preprocessor: ImagePreprocessor;
  let mockProvider: MockCharacterGenerationProvider;
  let generator: CharacterGenerator;
  let pixelProcessor: PixelArtProcessor;

  // Pre-created sample asset IDs
  const sampleGeneratedId = "generated_char_1725888000000_1234567890abcdef";
  const sampleSpriteId = "sprite_char_1725888000000_fedcba0987654321";

  beforeEach(async () => {
    tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_profiles_"));
    tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_uploads_"));
    tempProcessedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_processed_"));
    tempGeneratedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_generated_"));
    tempSpriteDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_sprites_"));

    profileStorage = new FileSystemProfileStorageAdapter(tempProfileDir);
    generatedStorage = new FileSystemGeneratedStorageAdapter(tempGeneratedDir);
    spriteStorage = new FileSystemSpriteStorageAdapter(tempSpriteDir);

    profileManager = new CharacterProfileManager({
      storageAdapter: profileStorage,
      generatedStorageAdapter: generatedStorage,
      spriteStorageAdapter: spriteStorage,
    });

    uploadBoundary = new ImageUploadBoundary({
      storageAdapter: new FileSystemTemporaryStorageAdapter(tempUploadDir),
    });
    preprocessor = new ImagePreprocessor({
      storageAdapter: new FileSystemProcessedStorageAdapter(tempProcessedDir),
    });
    mockProvider = new MockCharacterGenerationProvider();
    generator = new CharacterGenerator({
      storageAdapter: generatedStorage,
      provider: mockProvider,
    });
    pixelProcessor = new PixelArtProcessor({
      storageAdapter: spriteStorage,
    });

    // Populate valid on-disk sample assets for Phase 3 and Phase 4
    const sampleGenPng = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } },
    }).png().toBuffer();
    await generatedStorage.save(sampleGeneratedId, new Uint8Array(sampleGenPng));

    const sampleSpritePng = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } },
    }).png().toBuffer();
    await spriteStorage.save(sampleSpriteId, new Uint8Array(sampleSpritePng));
  });

  afterEach(async () => {
    if (fs.existsSync(tempProfileDir)) fs.rmSync(tempProfileDir, { recursive: true, force: true });
    if (fs.existsSync(tempUploadDir)) fs.rmSync(tempUploadDir, { recursive: true, force: true });
    if (fs.existsSync(tempProcessedDir)) fs.rmSync(tempProcessedDir, { recursive: true, force: true });
    if (fs.existsSync(tempGeneratedDir)) fs.rmSync(tempGeneratedDir, { recursive: true, force: true });
    if (fs.existsSync(tempSpriteDir)) fs.rmSync(tempSpriteDir, { recursive: true, force: true });
  });

  const getValidCreateRequest = (): CreateProfileRequest => ({
    assets: {
      generatedCharacterId: sampleGeneratedId,
      spriteId: sampleSpriteId,
    },
    style: {
      renderingStyle: "chibi-pixel-art",
      proportions: "super-deformed",
      expression: "friendly-idle",
      paletteMood: "vibrant",
      detailLevel: "high-fidelity",
      backgroundIntent: "transparent-ready",
    },
    clothing: {
      category: "casual",
      top: "hoodie",
      bottom: "jeans",
      footwear: "sneakers",
      accessories: ["glasses", "headphones"],
      colorTheme: "cool-slate",
    },
    palette: {
      mood: "vibrant",
      maxOpaqueColors: 16,
      colors: [
        { r: 50, g: 100, b: 150 },
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 0 },
      ],
      transparencyPolicy: "binary-threshold",
      alphaThreshold: 128,
    },
    metadata: {
      displayName: "Pixel Buddy",
      tag: "companion-v1",
    },
  });

  describe("1. Character ID Generation & Validation", () => {
    test("Generates valid canonical character ID matching pattern", () => {
      const id = generateCharacterId();
      assert.ok(isValidCharacterId(id));
      assert.ok(id.startsWith("character_"));
    });

    test("Collision resistance: 10,000 generated IDs are strictly unique", () => {
      const set = new Set<string>();
      const count = 10000;
      for (let i = 0; i < count; i++) {
        const id = generateCharacterId();
        assert.strictEqual(set.has(id), false, `Collision detected on ID: ${id}`);
        set.add(id);
      }
      assert.strictEqual(set.size, count);
    });

    test("Rejects path traversal in character ID", () => {
      assert.strictEqual(isValidCharacterId("../character_123_abc"), false);
      assert.strictEqual(isValidCharacterId("..\\character_123_abc"), false);
      assert.strictEqual(isValidCharacterId("character_123/../../etc/passwd"), false);
    });

    test("Rejects directory separators and invalid characters in ID", () => {
      assert.strictEqual(isValidCharacterId("character_123_abc/def"), false);
      assert.strictEqual(isValidCharacterId("character_123_abc\\def"), false);
      assert.strictEqual(isValidCharacterId("character_123_abc:def"), false);
      assert.strictEqual(isValidCharacterId("character 123 abc"), false);
      assert.strictEqual(isValidCharacterId(""), false);
      assert.strictEqual(isValidCharacterId(null), false);
      assert.strictEqual(isValidCharacterId(undefined), false);
    });
  });

  describe("2. Profile Creation & Domain Validation", () => {
    test("Creates valid CharacterProfile with full configuration", async () => {
      const req = getValidCreateRequest();
      const res = await profileManager.createProfile(req);

      assert.strictEqual(res.success, true);
      const profile = (res as ProfileSuccessResult<CharacterProfile>).data;

      assert.ok(isValidCharacterId(profile.characterId));
      assert.strictEqual(profile.schemaVersion, 1);
      assert.ok(profile.createdAt > 0);
      assert.strictEqual(profile.createdAt, profile.updatedAt);
      assert.strictEqual(profile.assets.generatedCharacterId, sampleGeneratedId);
      assert.strictEqual(profile.assets.spriteId, sampleSpriteId);
      assert.strictEqual(profile.clothing.top, "hoodie");
      assert.strictEqual(profile.palette.maxOpaqueColors, 16);
      assert.strictEqual(profile.metadata?.displayName, "Pixel Buddy");
    });

    test("Accepts caller-provided valid characterId", async () => {
      const customId = "character_1725888000001_aabbccddeeff0011";
      const req = {
        ...getValidCreateRequest(),
        characterId: customId,
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, true);
      assert.strictEqual((res as ProfileSuccessResult<CharacterProfile>).data.characterId, customId);
    });

    test("Rejects duplicate characterId on creation", async () => {
      const customId = "character_1725888000002_aabbccddeeff0022";
      const req = {
        ...getValidCreateRequest(),
        characterId: customId,
      };

      const res1 = await profileManager.createProfile(req);
      assert.strictEqual(res1.success, true);

      const res2 = await profileManager.createProfile(req);
      assert.strictEqual(res2.success, false);
      assert.strictEqual((res2 as ProfileFailureResult).error.code, "CHARACTER_PROFILE_STORAGE_FAILED");
    });

    test("Rejects invalid clothing configuration", async () => {
      const req = {
        ...getValidCreateRequest(),
        clothing: {
          ...getValidCreateRequest().clothing,
          // @ts-expect-error testing invalid clothing
          top: "tuxedo-with-cape-not-real",
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_CLOTHING_INVALID");
    });

    test("Rejects invalid style configuration", async () => {
      const req = {
        ...getValidCreateRequest(),
        style: {
          ...getValidCreateRequest().style,
          // @ts-expect-error testing invalid style
          renderingStyle: "hyper-realistic-photorealism",
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_STYLE_INVALID");
    });

    test("Rejects invalid palette configuration", async () => {
      const req = {
        ...getValidCreateRequest(),
        palette: {
          ...getValidCreateRequest().palette,
          maxOpaqueColors: 512, // Exceeds max 256
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_PALETTE_INVALID");
    });
  });

  describe("3. Asset Consistency & Namespace Segregation", () => {
    test("Rejects missing generated asset reference", async () => {
      const req = {
        ...getValidCreateRequest(),
        assets: {
          generatedCharacterId: "generated_char_9999999999999_deadbeef00001234",
          spriteId: sampleSpriteId,
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_ASSET_MISSING");
      assert.ok((res as ProfileFailureResult).error.message.includes("generated asset not found"));
    });

    test("Rejects missing sprite asset reference", async () => {
      const req = {
        ...getValidCreateRequest(),
        assets: {
          generatedCharacterId: sampleGeneratedId,
          spriteId: "sprite_char_9999999999999_deadbeef00005678",
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_ASSET_MISSING");
      assert.ok((res as ProfileFailureResult).error.message.includes("sprite asset not found"));
    });

    test("Rejects sprite ID used where generated ID is expected", async () => {
      const req = {
        ...getValidCreateRequest(),
        assets: {
          // Sprite ID passed into generatedCharacterId
          generatedCharacterId: sampleSpriteId,
          spriteId: sampleSpriteId,
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_ASSET_INVALID");
    });

    test("Rejects generated ID used where sprite ID is expected", async () => {
      const req = {
        ...getValidCreateRequest(),
        assets: {
          generatedCharacterId: sampleGeneratedId,
          // Generated ID passed into spriteId
          spriteId: sampleGeneratedId,
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_ASSET_INVALID");
    });

    test("Rejects arbitrary filesystem paths in asset references", async () => {
      const req = {
        ...getValidCreateRequest(),
        assets: {
          generatedCharacterId: "C:\\Windows\\System32\\calc.exe",
          spriteId: sampleSpriteId,
        },
      };

      const res = await profileManager.createProfile(req);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_ASSET_INVALID");
    });
  });

  describe("4. Persistence, Atomic Writes & Lifecycle", () => {
    test("Saves, reloads and validates profile from disk", async () => {
      const req = getValidCreateRequest();
      const createdRes = await profileManager.createProfile(req);
      assert.strictEqual(createdRes.success, true);
      const created = (createdRes as ProfileSuccessResult<CharacterProfile>).data;

      const loadedRes = await profileManager.getProfile(created.characterId);
      assert.strictEqual(loadedRes.success, true);
      const loaded = (loadedRes as ProfileSuccessResult<CharacterProfile>).data;

      assert.deepStrictEqual(loaded, created);
      assert.strictEqual(loaded.characterId, created.characterId);
      assert.strictEqual(loaded.schemaVersion, 1);
    });

    test("Updates profile mutable fields and records updatedAt", async () => {
      const req = getValidCreateRequest();
      const createdRes = await profileManager.createProfile(req);
      const created = (createdRes as ProfileSuccessResult<CharacterProfile>).data;

      const updateReq: UpdateProfileRequest = {
        clothing: {
          ...created.clothing,
          top: "sweater",
          colorTheme: "warm-autumn",
        },
        metadata: {
          displayName: "Updated Buddy",
        },
      };

      // Slight tick to ensure updatedAt > createdAt
      await new Promise((r) => setTimeout(r, 10));

      const updatedRes = await profileManager.updateProfile(created.characterId, updateReq);
      assert.strictEqual(updatedRes.success, true);
      const updated = (updatedRes as ProfileSuccessResult<CharacterProfile>).data;

      assert.strictEqual(updated.characterId, created.characterId);
      assert.strictEqual(updated.createdAt, created.createdAt);
      assert.ok(updated.updatedAt >= created.updatedAt);
      assert.strictEqual(updated.clothing.top, "sweater");
      assert.strictEqual(updated.clothing.colorTheme, "warm-autumn");
      assert.strictEqual(updated.metadata?.displayName, "Updated Buddy");

      // Verify on-disk persistence of update
      const reloadedRes = await profileManager.getProfile(created.characterId);
      assert.strictEqual(reloadedRes.success, true);
      assert.deepStrictEqual((reloadedRes as ProfileSuccessResult<CharacterProfile>).data, updated);
    });

    test("Deletes profile cleanly from disk", async () => {
      const req = getValidCreateRequest();
      const created = (await profileManager.createProfile(req) as ProfileSuccessResult<CharacterProfile>).data;

      const deleteRes = await profileManager.deleteProfile(created.characterId);
      assert.strictEqual(deleteRes.success, true);

      const reloadRes = await profileManager.getProfile(created.characterId);
      assert.strictEqual(reloadRes.success, false);
      assert.strictEqual((reloadRes as ProfileFailureResult).error.code, "CHARACTER_PROFILE_NOT_FOUND");
    });

    test("Rejects getProfile for non-existent ID", async () => {
      const nonExistentId = "character_1725888000999_9999999999999999";
      const res = await profileManager.getProfile(nonExistentId);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_PROFILE_NOT_FOUND");
    });

    test("Lists all profiles present on disk", async () => {
      await profileManager.createProfile(getValidCreateRequest());
      await profileManager.createProfile(getValidCreateRequest());

      const list = await profileManager.listProfiles();
      assert.strictEqual(list.length, 2);
      assert.ok(list[0].characterId !== list[1].characterId);
    });

    test("Rejects corrupted persisted profile JSON", async () => {
      const validId = "character_1725888000003_aabbccddeeff0033";
      const filePath = path.join(tempProfileDir, `${validId}.json`);
      fs.writeFileSync(filePath, "CORRUPTED_JSON_NOT_VALID{", "utf-8");

      const res = await profileManager.getProfile(validId);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_PROFILE_STORAGE_FAILED");
    });

    test("Rejects persisted profile with unsupported schemaVersion", async () => {
      const validId = "character_1725888000004_aabbccddeeff0044";
      const filePath = path.join(tempProfileDir, `${validId}.json`);
      const invalidVersionProfile = {
        ...getValidCreateRequest(),
        characterId: validId,
        schemaVersion: 999, // Unsupported future version
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      fs.writeFileSync(filePath, JSON.stringify(invalidVersionProfile), "utf-8");

      const res = await profileManager.getProfile(validId);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as ProfileFailureResult).error.code, "CHARACTER_PROFILE_STORAGE_FAILED");
    });

    test("Cleans up managed profiles while preserving unrelated files", async () => {
      const unrelatedPath = path.join(tempProfileDir, "unrelated_notes.txt");
      fs.writeFileSync(unrelatedPath, "IMPORTANT NOTES", "utf-8");

      await profileManager.createProfile(getValidCreateRequest());
      const cleaned = await profileStorage.cleanupAll();
      assert.ok(cleaned >= 1);

      assert.strictEqual(fs.existsSync(unrelatedPath), true);
    });
  });

  describe("5. Immutability Guarantees", () => {
    test("Character ID and createdAt cannot be mutated by updateProfile", async () => {
      const created = (await profileManager.createProfile(getValidCreateRequest()) as ProfileSuccessResult<CharacterProfile>).data;

      const originalId = created.characterId;
      const originalCreatedAt = created.createdAt;

      const updateReq: UpdateProfileRequest = {
        metadata: { displayName: "New Name" },
      };

      const updated = (await profileManager.updateProfile(originalId, updateReq) as ProfileSuccessResult<CharacterProfile>).data;

      assert.strictEqual(updated.characterId, originalId);
      assert.strictEqual(updated.createdAt, originalCreatedAt);
    });

    test("Profile operations do NOT overwrite or delete referenced source image assets", async () => {
      const genFile = path.join(tempGeneratedDir, `${sampleGeneratedId}.png`);
      const spriteFile = path.join(tempSpriteDir, `${sampleSpriteId}.png`);

      const genBytesBefore = fs.readFileSync(genFile);
      const spriteBytesBefore = fs.readFileSync(spriteFile);

      // Create profile
      const created = (await profileManager.createProfile(getValidCreateRequest()) as ProfileSuccessResult<CharacterProfile>).data;

      // Update profile
      await profileManager.updateProfile(created.characterId, {
        metadata: { displayName: "Mutated Name" },
      });

      // Delete profile
      await profileManager.deleteProfile(created.characterId);

      // Verify underlying Phase 3 and Phase 4 image assets remain byte-identical and present
      assert.strictEqual(fs.existsSync(genFile), true);
      assert.strictEqual(fs.existsSync(spriteFile), true);

      const genBytesAfter = fs.readFileSync(genFile);
      const spriteBytesAfter = fs.readFileSync(spriteFile);

      assert.deepStrictEqual(genBytesBefore, genBytesAfter);
      assert.deepStrictEqual(spriteBytesBefore, spriteBytesAfter);
    });
  });

  describe("6. Privacy & Hygiene", () => {
    test("Profile does not contain raw image buffers, base64 strings, or secrets", async () => {
      const created = (await profileManager.createProfile(getValidCreateRequest()) as ProfileSuccessResult<CharacterProfile>).data;
      const jsonStr = JSON.stringify(created);

      // Must not contain raw paths, base64 headers, or API keys
      assert.strictEqual(jsonStr.includes("data:image/png;base64"), false);
      assert.strictEqual(jsonStr.includes("sk-"), false);
      assert.strictEqual(jsonStr.includes("OPENAI_API_KEY"), false);
      assert.strictEqual(jsonStr.includes(tempGeneratedDir), false);
      assert.strictEqual(jsonStr.includes(tempSpriteDir), false);
    });
  });

  describe("7. Complete 5-Phase End-to-End Pipeline Chaining", () => {
    test("Chains Phase 1 (Upload) -> Phase 2 (Preprocess) -> Phase 3 (Generate) -> Phase 4 (Pixel Process) -> Phase 5 (CharacterProfile)", async () => {
      // 1. Phase 1: Upload
      const uploadPng = await sharp({
        create: { width: 400, height: 400, channels: 4, background: { r: 120, g: 140, b: 160, alpha: 1 } },
      }).png().toBuffer();
      const uploadRes = (await uploadBoundary.upload(
        new Uint8Array(uploadPng),
        "user_photo.png"
      )) as UploadSuccessResult;
      assert.strictEqual(uploadRes.success, true);

      // 2. Phase 2: Preprocess
      const preprocessRes = (await preprocessor.process({
        source: uploadRes,
      })) as PreprocessSuccessResult;
      assert.strictEqual(preprocessRes.success, true);
      assert.strictEqual(preprocessRes.metadata.width, 512);

      // 3. Phase 3: AI Generation (Mock Provider)
      const mockGeneratedPng = await sharp({
        create: { width: 512, height: 512, channels: 4, background: { r: 200, g: 150, b: 80, alpha: 1 } },
      }).png().toBuffer();
      mockProvider.setOptions({ mockImageBuffer: mockGeneratedPng });

      const generateRes = (await generator.generate({
        source: preprocessRes,
        style: { renderingStyle: "chibi-pixel-art" },
      })) as GenerateCharacterSuccessResult;
      assert.strictEqual(generateRes.success, true);

      // 4. Phase 4: Deterministic Pixel Processing
      const pixelRes = (await pixelProcessor.process({
        source: generateRes,
        options: { targetDimension: 64, maxOpaqueColors: 16 },
      })) as PixelProcessSuccessResult;
      assert.strictEqual(pixelRes.success, true);
      assert.strictEqual(pixelRes.metadata.width, 64);

      // 5. Phase 5: CharacterProfile Creation & Storage
      const profileRes = await profileManager.createProfile({
        assets: {
          generatedCharacterId: generateRes.generatedStorageId,
          spriteId: pixelRes.spriteStorageId,
          processedImageId: preprocessRes.processedStorageId,
          sourceUploadId: uploadRes.storageId,
        },
        style: {
          renderingStyle: "chibi-pixel-art",
          proportions: "super-deformed",
          expression: "friendly-idle",
          paletteMood: "original-fidelity",
          detailLevel: "high-fidelity",
          backgroundIntent: "transparent-ready",
        },
        clothing: {
          category: "streetwear",
          top: "jacket",
          bottom: "cargo-pants",
          footwear: "boots",
          accessories: ["cap"],
          colorTheme: "neon-cyber",
        },
        palette: {
          mood: "original-fidelity",
          maxOpaqueColors: 16,
          colors: [{ r: 200, g: 150, b: 80 }],
          transparencyPolicy: "binary-threshold",
          alphaThreshold: 128,
        },
        metadata: {
          displayName: "E2E Companion",
          tag: "e2e-verified",
        },
      });

      assert.strictEqual(profileRes.success, true);
      const profile = (profileRes as ProfileSuccessResult<CharacterProfile>).data;

      assert.ok(isValidCharacterId(profile.characterId));
      assert.strictEqual(profile.assets.generatedCharacterId, generateRes.generatedStorageId);
      assert.strictEqual(profile.assets.spriteId, pixelRes.spriteStorageId);
      assert.strictEqual(profile.assets.processedImageId, preprocessRes.processedStorageId);
      assert.strictEqual(profile.assets.sourceUploadId, uploadRes.storageId);

      // Verify on-disk persistence and reloading of the full profile
      const reloaded = await profileManager.getProfile(profile.characterId);
      assert.strictEqual(reloaded.success, true);
      assert.deepStrictEqual((reloaded as ProfileSuccessResult<CharacterProfile>).data, profile);
    });
  });
});
