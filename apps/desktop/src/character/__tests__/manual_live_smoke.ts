/**
 * PixelPal — Manual Live OpenAI Smoke Test
 * Sprint 6 Phase 3
 *
 * NOTE: This is an EXPLICITLY OPT-IN manual verification script.
 * It is NOT executed by `npm test` (filename does not match *.test.ts).
 *
 * Requirements:
 * - Requires OPENAI_API_KEY environment variable.
 * - Does NOT print or log the API key.
 * - Uses a synthetic test image (never personal photos).
 * - Saves output to an isolated temporary folder and cleans up afterward.
 *
 * Usage:
 *   $env:OPENAI_API_KEY="sk-..."
 *   npx tsx src/character/__tests__/manual_live_smoke.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";
import {
  CharacterGenerator,
  FileSystemGeneratedStorageAdapter,
  FileSystemProcessedStorageAdapter,
  FileSystemTemporaryStorageAdapter,
  ImagePreprocessor,
  ImageUploadBoundary,
  OpenAIImageGenerationProvider,
  type GenerateCharacterSuccessResult,
  type PreprocessSuccessResult,
  type UploadSuccessResult,
} from "../index.ts";

async function runLiveSmokeTest() {
  console.log("==================================================");
  console.log("PIXELPAL — MANUAL LIVE OPENAI SMOKE TEST");
  console.log("==================================================");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.log("[SKIPPED] OPENAI_API_KEY environment variable is not set.");
    console.log("To run live verification, set OPENAI_API_KEY and re-run this script.");
    process.exit(0);
  }

  console.log("[INFO] OPENAI_API_KEY detected (redacted). Initializing pipeline...");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal_live_smoke_"));
  const uploadDir = path.join(tempDir, "uploads");
  const processedDir = path.join(tempDir, "processed");
  const generatedDir = path.join(tempDir, "generated");

  try {
    const uploadStorage = new FileSystemTemporaryStorageAdapter(uploadDir);
    const processedStorage = new FileSystemProcessedStorageAdapter(processedDir);
    const generatedStorage = new FileSystemGeneratedStorageAdapter(generatedDir);

    const uploadBoundary = new ImageUploadBoundary({ storageAdapter: uploadStorage });
    const preprocessor = new ImagePreprocessor({ storageAdapter: processedStorage });

    const openAIProvider = new OpenAIImageGenerationProvider({
      apiKey,
      timeoutMs: 90_000,
    });

    const generator = new CharacterGenerator({
      storageAdapter: generatedStorage,
      provider: openAIProvider,
    });

    // 1. Create synthetic portrait subject (green circle avatar on white)
    console.log("[1/4] Creating synthetic test portrait image...");
    const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="#FFFFFF"/>
      <circle cx="256" cy="200" r="100" fill="#2E7D32"/>
      <rect x="180" y="320" width="152" height="150" rx="40" fill="#1565C0"/>
    </svg>`;
    const syntheticBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // 2. Upload through Phase 1 boundary
    console.log("[2/4] Validating and staging upload (Phase 1)...");
    const uploadResult = (await uploadBoundary.upload(
      new Uint8Array(syntheticBuffer),
      "synthetic_test.png"
    )) as UploadSuccessResult;

    if (!uploadResult.success) {
      throw new Error(`Upload failed: ${JSON.stringify(uploadResult)}`);
    }

    // 3. Preprocess through Phase 2 pipeline
    console.log("[3/4] Preprocessing image (Phase 2)...");
    const preprocessResult = (await preprocessor.process({
      source: uploadResult,
      options: { cropMode: "center-crop-square", targetDimensions: { width: 512, height: 512 } },
    })) as PreprocessSuccessResult;

    if (!preprocessResult.success) {
      throw new Error(`Preprocessing failed: ${JSON.stringify(preprocessResult)}`);
    }

    // 4. Generate character via live OpenAI provider
    console.log("[4/4] Sending request to OpenAI image generation API (Phase 3)...");
    const startTime = Date.now();

    const generateResult = await generator.generate({
      source: preprocessResult,
      style: {
        renderingStyle: "chibi-pixel-art",
        proportions: "super-deformed",
        expression: "happy",
      },
    });

    const elapsedMs = Date.now() - startTime;

    if (!generateResult.success) {
      console.error("[FAILED] Live generation failed with error:", generateResult.error);
      process.exit(1);
    }

    const success = generateResult as GenerateCharacterSuccessResult;
    console.log("--------------------------------------------------");
    console.log("[SUCCESS] Live generation completed successfully!");
    console.log(`- Generation ID:   ${success.generationId}`);
    console.log(`- Provider:        ${success.provider}`);
    console.log(`- Model:           ${success.model}`);
    console.log(`- Output format:   ${success.metadata.format}`);
    console.log(`- Output dimensions: ${success.metadata.width}x${success.metadata.height}`);
    console.log(`- Output file:     ${success.generatedFilePath}`);
    console.log(`- Elapsed time:    ${elapsedMs} ms`);
    console.log("--------------------------------------------------");

    // Cleanup live test artifacts
    await generator.cleanup(success.generatedStorageId);
    console.log("[CLEANUP] Cleaned up temporary generated asset.");
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

runLiveSmokeTest().catch((err) => {
  console.error("[FATAL] Live smoke test crashed:", err);
  process.exit(1);
});
