/**
 * PixelPal — Character Profile Persistent Storage & Boundary Tests
 * Sprint 6 Baseline Hardening Test Suite
 *
 * Validates cross-platform desktop application-data path resolution,
 * persistent storage adapter lifecycle, adapter recreation durability,
 * atomic writes, traversal defenses, and renderer-boundary isolation.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

import {
  FileSystemProfileStorageAdapter,
  InMemoryProfileStorageAdapter,
  generateCharacterId,
  getDesktopAppDataDir,
  getDefaultProfileStorageDir,
  DEFAULT_APP_IDENTIFIER,
} from "../index.ts";

import type { CharacterProfile } from "../../../../../packages/shared-types/src/character.ts";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates a valid canonical test CharacterProfile.
 */
function createTestProfile(
  overrides: Partial<CharacterProfile> = {}
): CharacterProfile {
  const timestamp = Date.now();
  const characterId = generateCharacterId();
  return {
    characterId,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    assets: {
      generatedCharacterId: "generated_char_1725888000000_1234567890abcdef",
      spriteId: "sprite_char_1725888000000_fedcba0987654321",
    },
    style: {
      renderingStyle: "chibi-pixel-art",
      proportions: "super-deformed",
      outlineStyle: "single-color-dark",
      shadingComplexity: "flat-retro",
    },
    clothing: {
      category: "streetwear",
      top: "hoodie",
      bottom: "jeans",
      footwear: "sneakers",
      accessories: ["glasses"],
      colorTheme: "neon-cyber",
    },
    palette: {
      mood: "vibrant",
      maxOpaqueColors: 16,
      colors: [
        { r: 255, g: 0, b: 128 },
        { r: 0, g: 255, b: 255 },
        { r: 20, g: 20, b: 20 },
      ],
      transparencyPolicy: "binary-threshold",
      alphaThreshold: 128,
    },
    metadata: {
      displayName: "Pixel Sentinel",
      tag: "test-companion",
    },
    ...overrides,
  };
}

describe("Sprint 6 Hardening: CharacterProfile Persistent Storage", () => {
  let tempTestDir: string;

  beforeEach(() => {
    tempTestDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pixelpal_storage_test_")
    );
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error on test teardown
    }
  });

  // --------------------------------------------------------------------------
  // 1. Cross-Platform App-Data Path Resolution
  // --------------------------------------------------------------------------
  describe("Desktop Application Data Path Resolution", () => {
    test("1. Production profile path does NOT resolve under os.tmpdir()", () => {
      // Save and clear any test env override
      const originalEnv = process.env.PIXELPAL_DATA_DIR;
      delete process.env.PIXELPAL_DATA_DIR;

      try {
        const appDataDir = getDesktopAppDataDir();
        const profileDir = getDefaultProfileStorageDir();
        const tempDir = os.tmpdir();

        // Must not be empty or root
        assert.ok(appDataDir.length > 0, "appDataDir must not be empty");
        assert.ok(profileDir.length > 0, "profileDir must not be empty");

        // Must contain app identifier and 'profiles' subdirectory
        assert.ok(
          appDataDir.includes(DEFAULT_APP_IDENTIFIER),
          `appDataDir (${appDataDir}) must contain ${DEFAULT_APP_IDENTIFIER}`
        );
        assert.ok(
          profileDir.endsWith(path.join(DEFAULT_APP_IDENTIFIER, "profiles")),
          `profileDir (${profileDir}) must end with ${DEFAULT_APP_IDENTIFIER}/profiles`
        );

        // Crucial requirement: Must NOT be inside os.tmpdir()
        const relativeToTemp = path.relative(tempDir, profileDir);
        const isUnderTemp =
          !relativeToTemp.startsWith("..") && !path.isAbsolute(relativeToTemp);

        assert.strictEqual(
          isUnderTemp,
          false,
          `Production profile dir (${profileDir}) must NOT reside below os.tmpdir() (${tempDir})`
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.PIXELPAL_DATA_DIR = originalEnv;
        }
      }
    });

    test("2. Environment variable override (PIXELPAL_DATA_DIR) takes precedence", () => {
      const originalEnv = process.env.PIXELPAL_DATA_DIR;
      const customOverride = path.join(tempTestDir, "custom_override_location");

      try {
        process.env.PIXELPAL_DATA_DIR = customOverride;
        const resolvedAppData = getDesktopAppDataDir();
        const resolvedProfiles = getDefaultProfileStorageDir();

        assert.strictEqual(resolvedAppData, path.resolve(customOverride));
        assert.strictEqual(
          resolvedProfiles,
          path.join(path.resolve(customOverride), "profiles")
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.PIXELPAL_DATA_DIR = originalEnv;
        } else {
          delete process.env.PIXELPAL_DATA_DIR;
        }
      }
    });

    test("3. Default FileSystemProfileStorageAdapter uses getDefaultProfileStorageDir() when customBaseDir is omitted", () => {
      const originalEnv = process.env.PIXELPAL_DATA_DIR;
      delete process.env.PIXELPAL_DATA_DIR;

      try {
        const adapter = new FileSystemProfileStorageAdapter();
        const expectedBaseDir = getDefaultProfileStorageDir();

        assert.strictEqual(adapter.getBaseDir(), expectedBaseDir);
        assert.ok(
          !adapter.getBaseDir().startsWith(os.tmpdir()),
          "Default adapter baseDir must not start with os.tmpdir()"
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.PIXELPAL_DATA_DIR = originalEnv;
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Durability Across Storage Adapter Recreation (No In-Memory Singleton)
  // --------------------------------------------------------------------------
  describe("Persistence Across Adapter Recreation", () => {
    test("4. Profile persists across fresh storage adapter recreation at the same path", async () => {
      const storageDir = path.join(tempTestDir, "persistent_store");

      // 1. Instantiate adapter 1 and write a profile
      const adapter1 = new FileSystemProfileStorageAdapter(storageDir);
      const originalProfile = createTestProfile({
        metadata: { displayName: "Durable Pal" },
      });

      const savedPath = await adapter1.save(originalProfile);
      assert.ok(fs.existsSync(savedPath), "Profile file must exist on disk");

      // 2. Instantiate a completely fresh adapter 2 pointed at the same directory
      // (This verifies that adapter 2 has an empty in-memory registry and must read from disk)
      const adapter2 = new FileSystemProfileStorageAdapter(storageDir);

      // 3. Read profile through adapter 2
      const result = await adapter2.get(originalProfile.characterId);
      assert.ok(
        result !== null,
        "Profile must be retrieved by fresh adapter instance"
      );
      assert.strictEqual(
        result.profile.characterId,
        originalProfile.characterId
      );
      assert.strictEqual(
        result.profile.metadata?.displayName,
        "Durable Pal"
      );
      assert.strictEqual(result.profile.schemaVersion, 1);
      assert.strictEqual(
        result.profile.style.renderingStyle,
        "chibi-pixel-art"
      );
      assert.deepStrictEqual(
        result.profile.palette.colors,
        originalProfile.palette.colors
      );
      assert.strictEqual(result.record.filePath, savedPath);
      assert.ok(result.record.sizeBytes > 0);

      // 4. Instantiate a third adapter and verify list() returns the persisted profile
      const adapter3 = new FileSystemProfileStorageAdapter(storageDir);
      const list = await adapter3.list();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].characterId, originalProfile.characterId);
      assert.strictEqual(list[0].metadata?.displayName, "Durable Pal");
    });

    test("5. Fresh adapter instance reflects external deletions and disk modifications", async () => {
      const storageDir = path.join(tempTestDir, "external_mutation_store");
      const adapter1 = new FileSystemProfileStorageAdapter(storageDir);
      const profile = createTestProfile({
        metadata: { displayName: "Will Delete" },
      });

      const filePath = await adapter1.save(profile);
      assert.ok(fs.existsSync(filePath));

      // Externally unlink file from disk
      fs.unlinkSync(filePath);

      // Fresh adapter must see that the file is gone
      const adapter2 = new FileSystemProfileStorageAdapter(storageDir);
      const result = await adapter2.get(profile.characterId);
      assert.strictEqual(result, null);

      const list = await adapter2.list();
      assert.strictEqual(list.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Atomic Write Behavior & Corruption Defense
  // --------------------------------------------------------------------------
  describe("Atomic Write Guarantees & Integrity", () => {
    test("6. Atomic write creates temporary file and renames to final .json without leaving residue", async () => {
      const storageDir = path.join(tempTestDir, "atomic_store");
      const adapter = new FileSystemProfileStorageAdapter(storageDir);
      const profile = createTestProfile();

      const savedPath = await adapter.save(profile);
      assert.ok(savedPath.endsWith(`${profile.characterId}.json`));
      assert.ok(fs.existsSync(savedPath));

      // Inspect directory: only the final .json should exist, no leftover .tmp files
      const files = fs.readdirSync(storageDir);
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0], `${profile.characterId}.json`);
      assert.ok(!files[0].includes(".tmp."));
    });

    test("7. Corrupted JSON file throws descriptive corruption error on read", async () => {
      const storageDir = path.join(tempTestDir, "corrupted_store");
      const adapter = new FileSystemProfileStorageAdapter(storageDir);
      const profile = createTestProfile();

      const filePath = await adapter.save(profile);

      // Overwrite file with invalid JSON syntax
      fs.writeFileSync(filePath, "{ invalid_json_syntax !!!", "utf-8");

      const freshAdapter = new FileSystemProfileStorageAdapter(storageDir);
      await assert.rejects(
        async () => {
          await freshAdapter.get(profile.characterId);
        },
        /Persisted profile JSON is corrupted/
      );
    });

    test("8. Profile violating schema throws validation error and writes zero bytes to disk", async () => {
      const storageDir = path.join(tempTestDir, "invalid_schema_store");
      const adapter = new FileSystemProfileStorageAdapter(storageDir);

      const invalidProfile = createTestProfile({
        schemaVersion: 2 as unknown as 1, // Unsupported schema version
      });

      await assert.rejects(
        async () => {
          await adapter.save(invalidProfile);
        },
        /Profile validation failed/
      );

      // Directory must be empty
      const files = fs.readdirSync(storageDir);
      assert.strictEqual(files.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Security & Path Traversal Protections
  // --------------------------------------------------------------------------
  describe("Security & Path Traversal Protections", () => {
    test("9. Path traversal attempts via character ID are strictly rejected", () => {
      const adapter = new FileSystemProfileStorageAdapter(tempTestDir);

      const traversalAttempts = [
        "../etc/passwd",
        "..\\windows\\system32",
        "character_1725888000000_1a2b/../../evil",
        "../../outside",
        "/absolute/path/attempt",
      ];

      for (const attempt of traversalAttempts) {
        assert.throws(
          () => {
            adapter.resolveSecurePath(attempt);
          },
          /Invalid character ID format|Path traversal attempt detected/
        );
      }
    });

    test("10. Delete operation cleanly unlinks file and returns true; second delete returns false", async () => {
      const storageDir = path.join(tempTestDir, "delete_store");
      const adapter = new FileSystemProfileStorageAdapter(storageDir);
      const profile = createTestProfile();

      await adapter.save(profile);
      const deletedFirst = await adapter.delete(profile.characterId);
      assert.strictEqual(deletedFirst, true);

      const deletedSecond = await adapter.delete(profile.characterId);
      assert.strictEqual(deletedSecond, false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. In-Memory Adapter Contract Equivalence
  // --------------------------------------------------------------------------
  describe("InMemoryProfileStorageAdapter", () => {
    test("11. In-memory adapter satisfies full ProfileStorageAdapter contract with deep cloning", async () => {
      const memoryAdapter = new InMemoryProfileStorageAdapter();
      const profile = createTestProfile({
        metadata: { displayName: "Memory Pal" },
      });

      const virtualPath = await memoryAdapter.save(profile);
      assert.ok(virtualPath.includes(profile.characterId));

      const retrieved = await memoryAdapter.get(profile.characterId);
      assert.ok(retrieved !== null);
      assert.strictEqual(retrieved.profile.metadata?.displayName, "Memory Pal");

      // Verify deep clone immutability
      if (retrieved.profile.metadata) {
        (retrieved.profile.metadata as { displayName?: string }).displayName =
          "Mutated In Place";
      }
      const freshRetrieved = await memoryAdapter.get(profile.characterId);
      assert.strictEqual(
        freshRetrieved?.profile.metadata?.displayName,
        "Memory Pal"
      );

      const deleted = await memoryAdapter.delete(profile.characterId);
      assert.strictEqual(deleted, true);

      const afterDelete = await memoryAdapter.get(profile.characterId);
      assert.strictEqual(afterDelete, null);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Architectural Boundary: OpenAI Isolation Verification
  // --------------------------------------------------------------------------
  describe("Architectural Boundary: OpenAI Isolation", () => {
    test("12. Frontend/renderer source files do NOT import OpenAI SDK", () => {
      const desktopSrcDir = path.resolve(currentDir, "../../");
      const files = ["main.tsx", "App.tsx", "index.css", "App.css"];

      for (const file of files) {
        const fullPath = path.join(desktopSrcDir, file);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          assert.strictEqual(
            content.includes('from "openai"'),
            false,
            `${file} must not import from 'openai'`
          );
          assert.strictEqual(
            content.includes("require('openai')"),
            false,
            `${file} must not require 'openai'`
          );
          assert.strictEqual(
            content.includes("OPENAI_API_KEY"),
            false,
            `${file} must not reference OPENAI_API_KEY`
          );
        }
      }
    });

    test("13. Production dist bundle (if built) contains zero OpenAI SDK code or API keys", () => {
      const distAssetsDir = path.resolve(currentDir, "../../../dist/assets");
      if (!fs.existsSync(distAssetsDir)) {
        // If dist hasn't been built in this environment yet, skip this assertion
        return;
      }

      const files = fs.readdirSync(distAssetsDir);
      const jsBundleFiles = files.filter((f) => f.endsWith(".js"));

      assert.ok(
        jsBundleFiles.length > 0,
        "Must find at least one production JS bundle in dist/assets"
      );

      for (const jsFile of jsBundleFiles) {
        const bundleContent = fs.readFileSync(
          path.join(distAssetsDir, jsFile),
          "utf-8"
        );

        assert.strictEqual(
          bundleContent.includes("OPENAI_API_KEY"),
          false,
          `Bundle ${jsFile} must not contain OPENAI_API_KEY`
        );
        assert.strictEqual(
          bundleContent.toLowerCase().includes("openai"),
          false,
          `Bundle ${jsFile} must not contain OpenAI SDK code`
        );
        assert.strictEqual(
          bundleContent.toLowerCase().includes("dall-e"),
          false,
          `Bundle ${jsFile} must not contain DALL-E model references`
        );
      }
    });
  });
});
