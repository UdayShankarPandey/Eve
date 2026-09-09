/**
 * PixelPal — Controlled AI Character Generator Test Suite
 * Sprint 6 Phase 3 Foundation
 *
 * Hermetic, offline test suite covering:
 * - Controlled prompt construction and injection immunity
 * - Provider abstraction and dependency injection
 * - Error mapping (missing config, auth, rate limit, timeout, safety rejection)
 * - Output validation and metadata stripping
 * - Secure generated asset storage and traversal defense
 * - Source asset preservation and failure cleanup
 * - Zero network access and zero real credentials required
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";
import {
  CharacterGenerator,
  buildCharacterPrompt,
  DEFAULT_CHARACTER_STYLE,
  MockCharacterGenerationProvider,
  FileSystemGeneratedStorageAdapter,
  FileSystemProcessedStorageAdapter,
  FileSystemTemporaryStorageAdapter,
  ImageUploadBoundary,
  ImagePreprocessor,
  OpenAIImageGenerationProvider,
  isValidGeneratedStorageId,
  type CharacterStyleOptions,
  type GenerateCharacterSuccessResult,
  type GenerateCharacterFailureResult,
  type PreprocessSuccessResult,
  type UploadSuccessResult,
} from "../index.ts";

/**
 * Creates a synthetic solid-color PNG image buffer for testing.
 */
async function createSyntheticPng(
  width: number,
  height: number,
  r = 100,
  g = 150,
  b = 200
): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="rgb(${r},${g},${b})" /></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("Sprint 6 Phase 3 — Controlled AI Character Generation Foundation", () => {
  let tempUploadDir: string;
  let tempProcessedDir: string;
  let tempGeneratedDir: string;

  let uploadStorage: FileSystemTemporaryStorageAdapter;
  let processedStorage: FileSystemProcessedStorageAdapter;
  let generatedStorage: FileSystemGeneratedStorageAdapter;

  let uploadBoundary: ImageUploadBoundary;
  let preprocessor: ImagePreprocessor;
  let mockProvider: MockCharacterGenerationProvider;
  let generator: CharacterGenerator;

  let samplePreprocessedResult: PreprocessSuccessResult;

  beforeEach(async () => {
    // Isolated application-owned temporary directories
    tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_uploads_"));
    tempProcessedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_processed_"));
    tempGeneratedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_test_generated_"));

    uploadStorage = new FileSystemTemporaryStorageAdapter(tempUploadDir);
    processedStorage = new FileSystemProcessedStorageAdapter(tempProcessedDir);
    generatedStorage = new FileSystemGeneratedStorageAdapter(tempGeneratedDir);

    uploadBoundary = new ImageUploadBoundary({ storageAdapter: uploadStorage });
    preprocessor = new ImagePreprocessor({ storageAdapter: processedStorage });
    mockProvider = new MockCharacterGenerationProvider();

    generator = new CharacterGenerator({
      storageAdapter: generatedStorage,
      provider: mockProvider,
    });

    // Create a real preprocessed asset from Phase 1 + Phase 2 for end-to-end chaining
    const rawPng = await createSyntheticPng(400, 400);
    const uploadRes = (await uploadBoundary.upload(
      new Uint8Array(rawPng),
      "subject.png"
    )) as UploadSuccessResult;
    samplePreprocessedResult = (await preprocessor.process({
      source: uploadRes,
    })) as PreprocessSuccessResult;

    // Configure mock provider with a valid 512x512 synthetic character image by default
    const mockCharacter = await createSyntheticPng(512, 512, 255, 200, 150);
    mockProvider.setOptions({ mockImageBuffer: mockCharacter });
  });

  afterEach(async () => {
    // Hermetic cleanup of test directories
    if (fs.existsSync(tempUploadDir)) {
      fs.rmSync(tempUploadDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempProcessedDir)) {
      fs.rmSync(tempProcessedDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempGeneratedDir)) {
      fs.rmSync(tempGeneratedDir, { recursive: true, force: true });
    }
  });

  describe("1. Controlled Prompt Construction & Injection Immunity", () => {
    test("Builds prompt with canonical default style options", () => {
      const result = buildCharacterPrompt();
      assert.ok(result.prompt.length > 100);
      assert.strictEqual(result.styleApplied.renderingStyle, "chibi-pixel-art");
      assert.strictEqual(result.styleApplied.proportions, "super-deformed");
      assert.strictEqual(result.styleApplied.expression, "friendly-idle");
      assert.strictEqual(result.styleApplied.paletteMood, "original-fidelity");
      assert.strictEqual(result.styleApplied.detailLevel, "high-fidelity");
      assert.strictEqual(result.styleApplied.backgroundIntent, "transparent-ready");

      // Verify essential negative constraints
      assert.ok(result.prompt.includes("NO text"));
      assert.ok(result.prompt.includes("NO UI elements"));
      assert.ok(result.prompt.includes("Single character only"));
    });

    test("Overrides style options deterministically through typed union values", () => {
      const customStyle: CharacterStyleOptions = {
        renderingStyle: "retro-arcade",
        proportions: "subtle-chibi",
        expression: "happy",
        paletteMood: "vibrant",
        detailLevel: "simplified-iconic",
        backgroundIntent: "solid-white",
      };

      const result = buildCharacterPrompt(customStyle);
      assert.ok(result.prompt.includes("retro arcade"));
      assert.ok(result.prompt.includes("3-head-tall"));
      assert.ok(result.prompt.includes("Joyful, cheerful"));
      assert.ok(result.prompt.includes("Saturated, lively anime"));
      assert.ok(result.prompt.includes("Streamline intricate clothing"));
    });

    test("Prompt is strictly immune to arbitrary string injection", () => {
      // The prompt builder accepts only typed values; filesystem paths or filenames never enter
      const result = buildCharacterPrompt(DEFAULT_CHARACTER_STYLE);
      assert.strictEqual(result.prompt.includes("C:\\"), false);
      assert.strictEqual(result.prompt.includes("/etc/"), false);
      assert.strictEqual(result.prompt.includes("storageId"), false);
      assert.strictEqual(result.prompt.includes("char_upload"), false);
      assert.strictEqual(result.prompt.includes("gps"), false);
    });

    test("Produces identical prompt for identical style options (Determinism)", () => {
      const res1 = buildCharacterPrompt({ expression: "confident" });
      const res2 = buildCharacterPrompt({ expression: "confident" });
      assert.strictEqual(res1.prompt, res2.prompt);
    });
  });

  describe("2. Provider Abstraction & Generation Execution", () => {
    test("Successfully generates and stores character asset via provider abstraction", async () => {
      const result = await generator.generate({
        source: samplePreprocessedResult,
        style: { expression: "happy" },
      });

      assert.strictEqual(result.success, true);
      const success = result as GenerateCharacterSuccessResult;

      assert.ok(success.generationId.startsWith("gen_"));
      assert.strictEqual(success.sourceStorageId, samplePreprocessedResult.processedStorageId);
      assert.ok(isValidGeneratedStorageId(success.generatedStorageId));
      assert.ok(fs.existsSync(success.generatedFilePath));

      // Metadata verification
      assert.strictEqual(success.metadata.format, "png");
      assert.strictEqual(success.metadata.mimeType, "image/png");
      assert.strictEqual(success.metadata.hasAlpha, true);
      assert.ok(success.metadata.sha256.length === 64);
      assert.strictEqual(success.provider, "mock-openai");

      // Verify provider was called with preprocessed image bytes and prompt
      assert.strictEqual(mockProvider.generateCalls.length, 1);
      const call = mockProvider.generateCalls[0];
      assert.ok(call.imageBuffer.length > 0);
      assert.ok(call.prompt.includes("personalized base companion"));
    });

    test("Fails safely when source preprocessed asset does not exist (INVALID_SOURCE_IMAGE)", async () => {
      const result = await generator.generate({
        source: {
          processedStorageId: "non_existent_id",
          processedFilePath: path.join(tempProcessedDir, "ghost.png"),
        },
      });

      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "INVALID_SOURCE_IMAGE");
      assert.strictEqual(mockProvider.generateCalls.length, 0); // Did not make AI call
    });

    test("Preserves source Phase 2 asset unmodified during generation", async () => {
      const sourceBefore = fs.readFileSync(samplePreprocessedResult.processedFilePath);
      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, true);

      const sourceAfter = fs.readFileSync(samplePreprocessedResult.processedFilePath);
      assert.deepStrictEqual(sourceBefore, sourceAfter);
    });
  });

  describe("3. Structured Provider Error Handling", () => {
    test("Maps simulated AI_RATE_LIMITED from provider", async () => {
      mockProvider.setOptions({ simulatedErrorCode: "AI_RATE_LIMITED" });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_RATE_LIMITED");
      assert.ok(failure.error.message.includes("AI_RATE_LIMITED"));
    });

    test("Maps simulated AI_AUTHENTICATION_FAILED from provider", async () => {
      mockProvider.setOptions({ simulatedErrorCode: "AI_AUTHENTICATION_FAILED" });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_AUTHENTICATION_FAILED");
    });

    test("Maps simulated AI_CONTENT_REJECTED from provider", async () => {
      mockProvider.setOptions({ simulatedErrorCode: "AI_CONTENT_REJECTED" });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_CONTENT_REJECTED");
    });

    test("Maps simulated AI_TIMEOUT from provider", async () => {
      mockProvider.setOptions({ simulatedErrorCode: "AI_TIMEOUT" });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_TIMEOUT");
    });

    test("Maps simulated AI_INVALID_RESPONSE from provider", async () => {
      mockProvider.setOptions({ simulatedErrorCode: "AI_INVALID_RESPONSE" });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_INVALID_RESPONSE");
    });
  });

  describe("4. OpenAI Provider Credential & Configuration Defense", () => {
    test("OpenAI provider throws AI_CONFIGURATION_MISSING when API key is missing", async () => {
      // Create OpenAI provider with explicitly missing key
      const realProvider = new OpenAIImageGenerationProvider({ apiKey: "" });

      await assert.rejects(
        async () => {
          await realProvider.generate({
            imageBuffer: Buffer.from("dummy"),
            prompt: "test",
            model: "gpt-image-2.5-sunburst",
            timeoutMs: 1000,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.strictEqual((err as { code?: string }).code, "AI_CONFIGURATION_MISSING");
          return true;
        }
      );
    });

    test("OpenAI provider rejects unsupported legacy model dall-e-3 with structured error", async () => {
      const provider = new OpenAIImageGenerationProvider({ apiKey: "fake-key-for-test" });

      await assert.rejects(
        async () => {
          await provider.generate({
            imageBuffer: Buffer.from("dummy-png"),
            prompt: "test",
            model: "dall-e-3",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.strictEqual((err as { code?: string }).code, "AI_REQUEST_FAILED");
          assert.ok((err as Error).message.includes("Model 'dall-e-3' is not supported"));
          return true;
        }
      );
    });

    test("Sunburst + images.edit + reference image: allowed and invokes images.edit with correct params", async () => {
      let capturedArgs: any = null;
      const syntheticPng = await createSyntheticPng(512, 512, 200, 100, 50);
      const fakeClient = {
        images: {
          edit: async (args: any) => {
            capturedArgs = args;
            return {
              created: 123456789,
              data: [
                {
                  b64_json: syntheticPng.toString("base64"),
                },
              ],
            };
          },
        },
      };

      const provider = new OpenAIImageGenerationProvider({
        client: fakeClient as any,
      });

      const response = await provider.generate({
        imageBuffer: syntheticPng,
        prompt: "A chibi pixel companion",
        model: "gpt-image-2.5-sunburst",
      });

      assert.ok(capturedArgs !== null);
      assert.strictEqual(capturedArgs.model, "gpt-image-2.5-sunburst");
      assert.strictEqual(capturedArgs.prompt, "A chibi pixel companion");
      assert.strictEqual(capturedArgs.output_format, "png");
      assert.strictEqual(capturedArgs.background, "transparent");
      assert.strictEqual(capturedArgs.size, "1024x1024");
      assert.strictEqual(capturedArgs.n, 1);
      assert.ok(capturedArgs.image !== undefined);
      assert.strictEqual(response.providerId, "openai");
      assert.strictEqual(response.model, "gpt-image-2.5-sunburst");
      assert.ok(response.imageBuffer.length > 0);
    });

    test("Flare + images.edit (reference image): rejected because Flare does not support reference-image editing", async () => {
      const provider = new OpenAIImageGenerationProvider({ apiKey: "fake-key-for-test" });
      const syntheticPng = await createSyntheticPng(512, 512, 100, 100, 100);

      await assert.rejects(
        async () => {
          await provider.generate({
            imageBuffer: syntheticPng,
            prompt: "A chibi pixel companion",
            model: "gpt-image-2.5-flare",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.strictEqual((err as { code?: string }).code, "AI_REQUEST_FAILED");
          assert.ok(
            (err as Error).message.includes(
              "Model 'gpt-image-2.5-flare' does not support reference-image editing"
            )
          );
          return true;
        }
      );
    });

    test("Flare + images.generate (text only): allowed and invokes images.generate", async () => {
      let capturedArgs: any = null;
      const syntheticPng = await createSyntheticPng(512, 512, 100, 150, 200);
      const fakeClient = {
        images: {
          generate: async (args: any) => {
            capturedArgs = args;
            return {
              created: 123456789,
              data: [
                {
                  b64_json: syntheticPng.toString("base64"),
                },
              ],
            };
          },
        },
      };

      const provider = new OpenAIImageGenerationProvider({
        client: fakeClient as any,
      });

      const response = await provider.generate({
        prompt: "A chibi pixel mascot generated from text",
        model: "gpt-image-2.5-flare",
      });

      assert.ok(capturedArgs !== null);
      assert.strictEqual(capturedArgs.model, "gpt-image-2.5-flare");
      assert.strictEqual(capturedArgs.prompt, "A chibi pixel mascot generated from text");
      assert.strictEqual(capturedArgs.output_format, "png");
      assert.strictEqual(capturedArgs.background, "transparent");
      assert.strictEqual(capturedArgs.size, "1024x1024");
      assert.strictEqual(capturedArgs.n, 1);
      assert.strictEqual(capturedArgs.image, undefined); // No reference image passed to generate
      assert.strictEqual(response.model, "gpt-image-2.5-flare");
      assert.ok(response.imageBuffer.length > 0);
    });

    test("OpenAI provider sanitizes error messages and redacts keys", () => {
      const provider = new OpenAIImageGenerationProvider({ apiKey: "" });
      // Access internal sanitization via error mapping
      const fakeErrorWithSecret = new Error(
        "Request failed with token sk-abcdef1234567890abcdef1234567890 and Bearer secret_xyz"
      );
      // @ts-expect-error accessing private method for unit verification
      const mapped = provider.mapOpenAIError(fakeErrorWithSecret);
      assert.strictEqual(mapped.message.includes("sk-abcdef1234567890"), false);
      assert.ok(mapped.message.includes("[REDACTED_API_KEY]"));
      assert.ok(mapped.message.includes("[REDACTED_TOKEN]"));
    });
  });

  describe("5. Output Image Validation & Sanitization", () => {
    test("Rejects corrupt or non-image byte stream from provider with AI_OUTPUT_INVALID", async () => {
      // Mock provider returns random non-image bytes
      mockProvider.setOptions({
        mockImageBuffer: Buffer.from("this is definitely not a valid image byte stream"),
      });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_OUTPUT_INVALID");
    });

    test("Rejects empty byte stream from provider with AI_OUTPUT_INVALID", async () => {
      mockProvider.setOptions({ mockImageBuffer: Buffer.alloc(0) });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_OUTPUT_INVALID");
    });

    test("Rejects image with pathological dimensions outside safe bounds (AI_OUTPUT_INVALID)", async () => {
      // Create an image smaller than minimum 64x64 (e.g. 32x32)
      const tinyImage = await createSyntheticPng(32, 32);
      mockProvider.setOptions({ mockImageBuffer: tinyImage });

      const result = await generator.generate({ source: samplePreprocessedResult });
      assert.strictEqual(result.success, false);
      const failure = result as GenerateCharacterFailureResult;
      assert.strictEqual(failure.error.code, "AI_OUTPUT_INVALID");
      assert.ok(failure.error.message.includes("outside acceptable bounds"));
    });

    test("Strips any provider metadata and produces clean PNG output", async () => {
      const result = (await generator.generate({
        source: samplePreprocessedResult,
      })) as GenerateCharacterSuccessResult;

      assert.strictEqual(result.success, true);
      const meta = await sharp(result.generatedFilePath).metadata();

      assert.strictEqual(meta.format, "png");
      assert.strictEqual(meta.exif, undefined);
      assert.strictEqual(meta.iptc, undefined);
      assert.strictEqual(meta.xmp, undefined);
      assert.strictEqual(meta.orientation, undefined);
    });
  });

  describe("6. Generated Storage & Path Security", () => {
    test("Prevents path traversal when attempting to resolve storage paths", () => {
      assert.throws(
        () => {
          // @ts-expect-error testing private path resolution with traversal
          generatedStorage.resolveSecurePath("../../../etc/passwd");
        },
        /Invalid generated storage ID format/
      );
    });

    test("Generated storage cleanup preserves unrelated files in directory", async () => {
      const unrelatedFile = path.join(tempGeneratedDir, "important_backup.txt");
      fs.writeFileSync(unrelatedFile, "DO NOT DELETE", "utf-8");

      const result = (await generator.generate({
        source: samplePreprocessedResult,
      })) as GenerateCharacterSuccessResult;
      assert.strictEqual(fs.existsSync(result.generatedFilePath), true);

      // Perform cleanupAll
      await generator.cleanupAll();

      assert.strictEqual(fs.existsSync(result.generatedFilePath), false);
      assert.strictEqual(fs.existsSync(unrelatedFile), true);
      assert.strictEqual(fs.readFileSync(unrelatedFile, "utf-8"), "DO NOT DELETE");
    });

    test("Single asset cleanup deletes generated file and unregisters record", async () => {
      const result = (await generator.generate({
        source: samplePreprocessedResult,
      })) as GenerateCharacterSuccessResult;
      assert.strictEqual(fs.existsSync(result.generatedFilePath), true);

      const deleted = await generator.cleanup(result.generatedStorageId);
      assert.strictEqual(deleted, true);
      assert.strictEqual(fs.existsSync(result.generatedFilePath), false);
    });
  });
});
