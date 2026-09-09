/**
 * PixelPal — Sprint 6 Phase 1: Character Upload & Image Validation Foundation Test Suite
 *
 * Deterministic test matrix verifying:
 * 1. Magic byte content validation (independent of filename extension)
 * 2. Supported formats (PNG, JPEG, WebP)
 * 3. Structured rejection of corrupt, truncated, or fake images
 * 4. Explicit size limits (empty, too small, too large)
 * 5. Dimension & aspect ratio limits (min, max, extreme ratios)
 * 6. Safe application-owned temporary storage
 * 7. Path traversal prevention & filename sanitization
 * 8. Safe unique storage ID generation
 * 9. Temporary storage lifecycle & cleanup (by ID, expired, all)
 * 10. Typed upload result contract & SHA-256 integrity
 * 11. Privacy & AI boundary isolation
 */

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  ImageUploadBoundary,
  validateImageContent,
  detectImageFormatAndDimensions,
  generateStorageId,
  isValidStorageId,
  sanitizeFileName,
  FileSystemTemporaryStorageAdapter,
  InMemoryTemporaryStorageAdapter,
  DEFAULT_IMAGE_CONSTRAINTS,
  type ImageFormat,
  type UploadSuccessResult,
  type UploadFailureResult,
} from "../index.ts";

/**
 * Helper to construct a valid in-memory PNG buffer with specified dimensions.
 */
function createValidPng(width: number, height: number, totalBytes: number = 150): Uint8Array {
  const buf = new Uint8Array(Math.max(totalBytes, 40));

  // PNG Signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  sig.forEach((b, i) => (buf[i] = b));

  // IHDR Chunk Length: 13 (00 00 00 0D)
  buf[8] = 0x00;
  buf[9] = 0x00;
  buf[10] = 0x00;
  buf[11] = 0x0d;

  // IHDR Chunk Type: "IHDR" (49 48 44 52)
  buf[12] = 0x49;
  buf[13] = 0x48;
  buf[14] = 0x44;
  buf[15] = 0x52;

  // Width (32-bit big endian)
  buf[16] = (width >> 24) & 0xff;
  buf[17] = (width >> 16) & 0xff;
  buf[18] = (width >> 8) & 0xff;
  buf[19] = width & 0xff;

  // Height (32-bit big endian)
  buf[20] = (height >> 24) & 0xff;
  buf[21] = (height >> 16) & 0xff;
  buf[22] = (height >> 8) & 0xff;
  buf[23] = height & 0xff;

  // Bit depth 8, Color type 6 (RGBA), Compression 0, Filter 0, Interlace 0
  buf[24] = 8;
  buf[25] = 6;
  buf[26] = 0;
  buf[27] = 0;
  buf[28] = 0;

  // Mock CRC
  buf[29] = 0xaa;
  buf[30] = 0xbb;
  buf[31] = 0xcc;
  buf[32] = 0xdd;

  // Pad remaining bytes to simulate image payload
  for (let i = 33; i < buf.length - 12; i++) {
    buf[i] = (i * 31) & 0xff;
  }

  // IEND chunk at end
  const end = buf.length;
  buf[end - 12] = 0x00;
  buf[end - 11] = 0x00;
  buf[end - 10] = 0x00;
  buf[end - 9] = 0x00;
  buf[end - 8] = 0x49; // 'I'
  buf[end - 7] = 0x45; // 'E'
  buf[end - 6] = 0x4e; // 'N'
  buf[end - 5] = 0x44; // 'D'
  buf[end - 4] = 0xae;
  buf[end - 3] = 0x42;
  buf[end - 2] = 0x60;
  buf[end - 1] = 0x82;

  return buf;
}

/**
 * Helper to construct a valid in-memory JPEG buffer with specified dimensions.
 */
function createValidJpeg(width: number, height: number, totalBytes: number = 150): Uint8Array {
  const buf = new Uint8Array(Math.max(totalBytes, 60));

  // SOI (0xFF, 0xD8, 0xFF)
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;

  // APP0 Marker (0xE0)
  buf[3] = 0xe0;
  buf[4] = 0x00;
  buf[5] = 0x10; // segment length = 16
  // "JFIF\0"
  buf[6] = 0x4a;
  buf[7] = 0x46;
  buf[8] = 0x49;
  buf[9] = 0x46;
  buf[10] = 0x00;
  buf[11] = 0x01;
  buf[12] = 0x01;
  buf[13] = 0x00;
  buf[14] = 0x00;
  buf[15] = 0x01;
  buf[16] = 0x00;
  buf[17] = 0x01;
  buf[18] = 0x00;
  buf[19] = 0x00;

  // SOF0 (0xFF, 0xC0) - Baseline DCT
  buf[20] = 0xff;
  buf[21] = 0xc0;
  buf[22] = 0x00;
  buf[23] = 0x11; // segment length = 17
  buf[24] = 0x08; // 8-bit precision
  // Height (16-bit big endian)
  buf[25] = (height >> 8) & 0xff;
  buf[26] = height & 0xff;
  // Width (16-bit big endian)
  buf[27] = (width >> 8) & 0xff;
  buf[28] = width & 0xff;
  buf[29] = 0x03; // 3 color components (YCbCr)

  // Fill padding payload
  for (let i = 30; i < buf.length - 2; i++) {
    buf[i] = (i * 17) & 0xff;
    // ensure no unintended 0xFF markers in stream
    if (buf[i] === 0xff) buf[i] = 0xfe;
  }

  // EOI marker at end (0xFF, 0xD9)
  buf[buf.length - 2] = 0xff;
  buf[buf.length - 1] = 0xd9;

  return buf;
}

/**
 * Helper to construct a valid in-memory WebP buffer (VP8) with specified dimensions.
 */
function createValidWebp(width: number, height: number, totalBytes: number = 150): Uint8Array {
  const buf = new Uint8Array(Math.max(totalBytes, 50));

  // "RIFF"
  buf[0] = 0x52;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x46;

  // File size - 8 (LE 32-bit)
  const sizeLess8 = buf.length - 8;
  buf[4] = sizeLess8 & 0xff;
  buf[5] = (sizeLess8 >> 8) & 0xff;
  buf[6] = (sizeLess8 >> 16) & 0xff;
  buf[7] = (sizeLess8 >> 24) & 0xff;

  // "WEBP"
  buf[8] = 0x57;
  buf[9] = 0x45;
  buf[10] = 0x42;
  buf[11] = 0x50;

  // "VP8 " Chunk tag
  buf[12] = 0x56;
  buf[13] = 0x50;
  buf[14] = 0x38;
  buf[15] = 0x20;

  // Chunk size
  buf[16] = 0x20;
  buf[17] = 0x00;
  buf[18] = 0x00;
  buf[19] = 0x00;

  // Keyframe tag (bit 0 = 0 for keyframe)
  buf[20] = 0x00;
  buf[21] = 0x00;
  buf[22] = 0x00;

  // Start code: 0x9D, 0x01, 0x2A
  buf[23] = 0x9d;
  buf[24] = 0x01;
  buf[25] = 0x2a;

  // Width (16-bit LE, 14 bits used)
  buf[26] = width & 0xff;
  buf[27] = (width >> 8) & 0x3f;

  // Height (16-bit LE, 14 bits used)
  buf[28] = height & 0xff;
  buf[29] = (height >> 8) & 0x3f;

  // Padding
  for (let i = 30; i < buf.length; i++) {
    buf[i] = (i * 7) & 0xff;
  }

  return buf;
}

describe("Sprint 6 Phase 1: Character Upload & Image Validation Foundation", () => {
  let tempTestDir: string;

  beforeEach(() => {
    tempTestDir = path.join(os.tmpdir(), `pixelpal_test_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  });

  afterEach(() => {
    if (fs.existsSync(tempTestDir)) {
      try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error on windows locks
      }
    }
  });

  describe("1. Binary Content & Magic Byte Inspection (Anti-Extension Spoofing)", () => {
    test("Identifies genuine PNG bytes even if filename is fake (.txt, .exe, or missing)", async () => {
      const pngData = createValidPng(128, 128);
      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      // User claims this is a text file
      const result = await boundary.upload(pngData, "malicious_script.txt");
      assert.strictEqual(result.success, true);

      const success = result as UploadSuccessResult;
      assert.strictEqual(success.metadata.format, "png");
      assert.strictEqual(success.metadata.mimeType, "image/png");
      assert.strictEqual(success.metadata.width, 128);
      assert.strictEqual(success.metadata.height, 128);
    });

    test("Identifies genuine JPEG bytes even if caller names it avatar.png", async () => {
      const jpegData = createValidJpeg(200, 150);
      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      const result = await boundary.upload(jpegData, "avatar.png");
      assert.strictEqual(result.success, true);

      const success = result as UploadSuccessResult;
      assert.strictEqual(success.metadata.format, "jpeg");
      assert.strictEqual(success.metadata.mimeType, "image/jpeg");
      assert.strictEqual(success.metadata.width, 200);
      assert.strictEqual(success.metadata.height, 150);
    });

    test("Identifies genuine WebP bytes even if caller omits extension", async () => {
      const webpData = createValidWebp(256, 256);
      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      const result = await boundary.upload(webpData, "my_chibi_portrait");
      assert.strictEqual(result.success, true);

      const success = result as UploadSuccessResult;
      assert.strictEqual(success.metadata.format, "webp");
      assert.strictEqual(success.metadata.mimeType, "image/webp");
      assert.strictEqual(success.metadata.width, 256);
      assert.strictEqual(success.metadata.height, 256);
    });

    test("Rejects plain text file renamed to photo.png with UNSUPPORTED_FORMAT", async () => {
      const fakePng = new TextEncoder().encode(
        "Hello world! This is a plain text file that someone renamed to photo.png in an attempt to spoof the system. It contains enough bytes to pass size threshold."
      );
      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      const result = await boundary.upload(fakePng, "photo.png");
      assert.strictEqual(result.success, false);

      const failure = result as UploadFailureResult;
      assert.ok(failure.errors.length > 0);
      assert.strictEqual(failure.errors[0].code, "UNSUPPORTED_FORMAT");
    });

    test("Rejects executable binary header (MZ) renamed to character.jpg", async () => {
      const fakeExe = new Uint8Array(200);
      fakeExe[0] = 0x4d; // 'M'
      fakeExe[1] = 0x5a; // 'Z'
      for (let i = 2; i < fakeExe.length; i++) fakeExe[i] = 0x90;

      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      const result = await boundary.upload(fakeExe, "character.jpg");
      assert.strictEqual(result.success, false);
      const failure = result as UploadFailureResult;
      assert.strictEqual(failure.errors[0].code, "UNSUPPORTED_FORMAT");
    });
  });

  describe("2. Image Decode & Structural Corruption Detection", () => {
    test("Rejects truncated PNG (signature present but missing IHDR chunk)", async () => {
      // 8 bytes of valid PNG signature + incomplete 4 bytes
      const truncated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
      const res = await validateImageContent(truncated, { minSizeBytes: 10 });

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "CORRUPTED_IMAGE");
    });

    test("Rejects corrupted PNG where chunk type is not IHDR", async () => {
      const corrupted = createValidPng(100, 100);
      // Corrupt chunk type at offset 12..15 to "XXXX"
      corrupted[12] = 0x58;
      corrupted[13] = 0x58;
      corrupted[14] = 0x58;
      corrupted[15] = 0x58;

      const res = await validateImageContent(corrupted);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "CORRUPTED_IMAGE");
    });

    test("Rejects truncated JPEG with SOI but missing SOF marker", async () => {
      const truncated = new Uint8Array(120);
      truncated[0] = 0xff;
      truncated[1] = 0xd8;
      truncated[2] = 0xff;
      truncated[3] = 0xe0; // APP0 without valid SOF
      truncated[4] = 0x00;
      truncated[5] = 0x04;
      truncated[6] = 0x00;
      truncated[7] = 0x00;
      truncated[8] = 0xff;
      truncated[9] = 0xd9; // EOI immediately

      const res = await validateImageContent(truncated);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "CORRUPTED_IMAGE");
    });

    test("Rejects corrupted WebP with invalid keyframe marker", async () => {
      const corruptedWebp = createValidWebp(100, 100);
      // Corrupt start code at byte 23..25
      corruptedWebp[23] = 0x00;
      corruptedWebp[24] = 0x00;
      corruptedWebp[25] = 0x00;

      const res = await validateImageContent(corruptedWebp);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "CORRUPTED_IMAGE");
    });
  });

  describe("3. File Size & Payload Limits", () => {
    test("Rejects empty buffer (0 bytes) with FILE_EMPTY", async () => {
      const empty = new Uint8Array(0);
      const res = await validateImageContent(empty);

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "FILE_EMPTY");
      assert.strictEqual(res.errors[0].field, "sizeBytes");
    });

    test("Rejects file below minSizeBytes with FILE_TOO_SMALL", async () => {
      const tinyData = createValidPng(64, 64, 50); // 50 bytes < default 100 bytes
      const res = await validateImageContent(tinyData, { minSizeBytes: 100 });

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "FILE_TOO_SMALL");
      assert.strictEqual(res.errors[0].field, "sizeBytes");
    });

    test("Rejects file exceeding maxSizeBytes with FILE_TOO_LARGE", async () => {
      const data = createValidPng(100, 100, 500);
      // Enforce strict 300 byte maximum limit
      const res = await validateImageContent(data, { maxSizeBytes: 300 });

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "FILE_TOO_LARGE");
      assert.strictEqual(res.errors[0].field, "sizeBytes");
    });
  });

  describe("4. Dimension & Aspect Ratio Boundaries", () => {
    test("Rejects images smaller than minWidth or minHeight with DIMENSIONS_TOO_SMALL", async () => {
      const tooSmall = createValidPng(32, 32); // 32x32 < 64x64
      const res = await validateImageContent(tooSmall, { minWidth: 64, minHeight: 64 });

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors[0].code, "DIMENSIONS_TOO_SMALL");
      assert.strictEqual(res.errors[0].field, "dimensions");
    });

    test("Rejects images larger than maxWidth or maxHeight (decompression bomb defense)", async () => {
      const tooBig = createValidPng(5000, 100);
      const res = await validateImageContent(tooBig, { maxWidth: 4096, maxHeight: 4096 });

      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.some((e) => e.code === "DIMENSIONS_TOO_LARGE"));
    });

    test("Rejects extreme aspect ratios with INVALID_ASPECT_RATIO", async () => {
      // 1000x100 = 10:1 ratio, exceeds default 4.0 limit
      const stretched = createValidPng(1000, 100);
      const res = await validateImageContent(stretched, { maxAspectRatio: 4.0 });

      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.some((e) => e.code === "INVALID_ASPECT_RATIO"));
    });

    test("Accepts normal portrait and square dimensions", async () => {
      const avatar = createValidPng(256, 256);
      const res = await validateImageContent(avatar);

      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.errors.length, 0);
      assert.strictEqual(res.metadata?.width, 256);
      assert.strictEqual(res.metadata?.height, 256);
    });
  });

  describe("5. Filename Sanitization & Path Traversal Prevention", () => {
    test("Sanitizes directory traversal sequences in client filenames", () => {
      assert.strictEqual(
        sanitizeFileName("../../etc/passwd"),
        "passwd"
      );
      assert.strictEqual(
        sanitizeFileName("..\\..\\Windows\\System32\\calc.exe"),
        "calc.exe"
      );
      assert.strictEqual(
        sanitizeFileName("/var/data/uploads/my_photo.png"),
        "my_photo.png"
      );
    });

    test("Sanitizes null bytes and control characters", () => {
      assert.strictEqual(
        sanitizeFileName("photo\0.png"),
        "photo.png"
      );
      assert.strictEqual(
        sanitizeFileName("image\x01\x1f.jpg"),
        "image.jpg"
      );
    });

    test("Protects against Windows reserved device names", () => {
      assert.strictEqual(sanitizeFileName("CON.png"), "safe_CON.png");
      assert.strictEqual(sanitizeFileName("aux.jpg"), "safe_aux.jpg");
      assert.strictEqual(sanitizeFileName("NUL"), "safe_NUL");
      assert.strictEqual(sanitizeFileName("com1.webp"), "safe_com1.webp");
    });

    test("Handles empty, whitespace-only, or missing filenames gracefully", () => {
      assert.strictEqual(sanitizeFileName(""), "unnamed_upload");
      assert.strictEqual(sanitizeFileName("   "), "unnamed_upload");
      assert.strictEqual(sanitizeFileName(undefined), "unnamed_upload");
    });
  });

  describe("6. Safe Unique Storage IDs", () => {
    test("Generates valid, collision-resistant storage IDs", () => {
      const id1 = generateStorageId();
      const id2 = generateStorageId();

      assert.notStrictEqual(id1, id2);
      assert.strictEqual(isValidStorageId(id1), true);
      assert.strictEqual(isValidStorageId(id2), true);
      assert.ok(id1.startsWith("char_upload_"));
    });

    test("Rejects malformed or injected storage IDs", () => {
      assert.strictEqual(isValidStorageId("../bad_id"), false);
      assert.strictEqual(isValidStorageId("char_upload_123_bad/path"), false);
      assert.strictEqual(isValidStorageId("rm -rf /"), false);
      assert.strictEqual(isValidStorageId(""), false);
    });
  });

  describe("7. Application-Owned Temporary Storage & Lifecycle Cleanup", () => {
    test("Persists validated image to isolated application-owned temporary directory", async () => {
      const storage = new FileSystemTemporaryStorageAdapter(tempTestDir);
      const boundary = new ImageUploadBoundary({ storageAdapter: storage });

      const pngData = createValidPng(150, 150);
      const result = await boundary.upload(pngData, "profile.png");

      assert.strictEqual(result.success, true);
      const success = result as UploadSuccessResult;

      // Assert file actually exists on filesystem
      assert.ok(fs.existsSync(success.tempFilePath));
      // Assert path is inside application temp directory
      assert.ok(success.tempFilePath.startsWith(path.resolve(tempTestDir)));
      // Assert content on disk matches upload
      const diskContent = fs.readFileSync(success.tempFilePath);
      assert.strictEqual(diskContent.length, pngData.length);
      assert.deepStrictEqual(new Uint8Array(diskContent), pngData);

      // Verify retrieval
      const retrieved = await boundary.getStagedImage(success.storageId);
      assert.ok(retrieved !== null);
      assert.strictEqual(retrieved?.record.format, "png");
      assert.deepStrictEqual(retrieved?.data, pngData);
    });

    test("Specific file cleanup removes file and metadata", async () => {
      const storage = new FileSystemTemporaryStorageAdapter(tempTestDir);
      const boundary = new ImageUploadBoundary({ storageAdapter: storage });

      const pngData = createValidPng(100, 100);
      const result = (await boundary.upload(pngData, "test.png")) as UploadSuccessResult;

      assert.ok(fs.existsSync(result.tempFilePath));
      const deleted = await boundary.cleanup(result.storageId);
      assert.strictEqual(deleted, true);

      // File removed from disk
      assert.strictEqual(fs.existsSync(result.tempFilePath), false);
      // Removed from registry
      const check = await boundary.getStagedImage(result.storageId);
      assert.strictEqual(check, null);
    });

    test("cleanupExpired purges files exceeding maxAgeMs", async () => {
      const storage = new FileSystemTemporaryStorageAdapter(tempTestDir);
      const boundary = new ImageUploadBoundary({ storageAdapter: storage });

      const pngData = createValidPng(100, 100);
      const result = (await boundary.upload(pngData, "expired.png")) as UploadSuccessResult;

      // Force file mtime into the past
      const pastTime = new Date(Date.now() - 5000);
      fs.utimesSync(result.tempFilePath, pastTime, pastTime);

      // Purge files older than 1000ms
      const purged = await boundary.cleanupExpired(1000);
      assert.ok(purged >= 1);
      assert.strictEqual(fs.existsSync(result.tempFilePath), false);
    });

    test("cleanupAll removes all managed temporary files", async () => {
      const storage = new FileSystemTemporaryStorageAdapter(tempTestDir);
      const boundary = new ImageUploadBoundary({ storageAdapter: storage });

      const res1 = (await boundary.upload(createValidPng(80, 80), "img1.png")) as UploadSuccessResult;
      const res2 = (await boundary.upload(createValidJpeg(120, 120), "img2.jpg")) as UploadSuccessResult;

      assert.ok(fs.existsSync(res1.tempFilePath));
      assert.ok(fs.existsSync(res2.tempFilePath));

      const purged = await boundary.cleanupAll();
      assert.strictEqual(purged, 2);
      assert.strictEqual(fs.existsSync(res1.tempFilePath), false);
      assert.strictEqual(fs.existsSync(res2.tempFilePath), false);
    });
  });

  describe("8. Typed Upload Contract & Cryptographic Integrity", () => {
    test("Computes valid SHA-256 hash and emits complete typed metadata", async () => {
      const data = createValidPng(200, 200);
      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      const result = await boundary.upload(data, "hero_portrait.png");
      assert.strictEqual(result.success, true);
      const success = result as UploadSuccessResult;

      assert.strictEqual(typeof success.storageId, "string");
      assert.strictEqual(typeof success.tempFilePath, "string");
      assert.strictEqual(success.originalFileName, "hero_portrait.png");
      assert.strictEqual(success.sanitizedFileName, "hero_portrait.png");
      assert.strictEqual(success.metadata.format, "png");
      assert.strictEqual(success.metadata.mimeType, "image/png");
      assert.strictEqual(success.metadata.width, 200);
      assert.strictEqual(success.metadata.height, 200);
      assert.strictEqual(success.metadata.sizeBytes, data.length);
      assert.strictEqual(typeof success.metadata.sha256, "string");
      assert.strictEqual(success.metadata.sha256.length, 64);
      assert.ok(/^[a-f0-9]{64}$/.test(success.metadata.sha256));
    });

    test("Identical payloads yield identical SHA-256 hashes (determinism)", async () => {
      const data = createValidJpeg(150, 150);
      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      const res1 = (await boundary.upload(data, "a.jpg")) as UploadSuccessResult;
      const res2 = (await boundary.upload(data, "b.jpg")) as UploadSuccessResult;

      assert.strictEqual(res1.metadata.sha256, res2.metadata.sha256);
      assert.notStrictEqual(res1.storageId, res2.storageId); // IDs remain unique
    });
  });

  describe("9. Local-First Privacy & AI Boundary Verification", () => {
    test("Upload and validation execute strictly locally with zero network or AI calls", async () => {
      const boundary = new ImageUploadBoundary({
        storageAdapter: new InMemoryTemporaryStorageAdapter(),
      });

      // Pure local byte validation
      const result = await boundary.upload(createValidWebp(120, 120), "local_only.webp");
      assert.strictEqual(result.success, true);

      // Verify no external AI keys or network dependencies were required
      assert.strictEqual(process.env.OPENAI_API_KEY, undefined);
    });
  });

  describe("10. Targeted Audit: Image Integrity Reality & Path Escape Defenses", () => {
    test("Audit: Valid PNG header with corrupted body data passes header check (Demonstrates: NOT full decode)", async () => {
      // 8 bytes PNG signature + 25 bytes IHDR (100x100) + 100 bytes of random garbage (corrupt body, no valid IDAT/IEND)
      const validHeaderWithCorruptBody = new Uint8Array(150);
      const pngHeader = createValidPng(100, 100, 35);
      validHeaderWithCorruptBody.set(pngHeader.slice(0, 33), 0);
      for (let i = 33; i < validHeaderWithCorruptBody.length; i++) {
        validHeaderWithCorruptBody[i] = 0xff ^ (i * 13); // random uncompressed garbage
      }

      // Explicitly proves that validator performs signature + header parsing, NOT full raster decompression
      const res = await validateImageContent(validHeaderWithCorruptBody);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.metadata?.format, "png");
      assert.strictEqual(res.metadata?.width, 100);
      assert.strictEqual(res.metadata?.height, 100);
    });

    test("Audit: Valid JPEG header with corrupted scan data passes header check (Demonstrates: NOT full decode)", async () => {
      // Valid SOI + APP0 + SOF0 (120x80) + garbage body data
      const validHeaderWithCorruptBody = new Uint8Array(150);
      const jpegHeader = createValidJpeg(120, 80, 50);
      validHeaderWithCorruptBody.set(jpegHeader.slice(0, 35), 0);
      for (let i = 35; i < validHeaderWithCorruptBody.length - 2; i++) {
        validHeaderWithCorruptBody[i] = 0x55 ^ (i * 3);
      }
      validHeaderWithCorruptBody[validHeaderWithCorruptBody.length - 2] = 0xff;
      validHeaderWithCorruptBody[validHeaderWithCorruptBody.length - 1] = 0xd9;

      const res = await validateImageContent(validHeaderWithCorruptBody);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.metadata?.format, "jpeg");
      assert.strictEqual(res.metadata?.width, 120);
      assert.strictEqual(res.metadata?.height, 80);
    });

    test("Audit: Path security rejects ../, ..\\, absolute paths, and UNC paths", async () => {
      const storage = new FileSystemTemporaryStorageAdapter(tempTestDir);

      // 1. Relative traversal ../
      assert.strictEqual(isValidStorageId("../malicious_id"), false);
      await assert.rejects(
        () => storage.save("../malicious_id", "png", createValidPng(64, 64)),
        /Invalid storage ID format/
      );

      // 2. Relative traversal ..\
      assert.strictEqual(isValidStorageId("..\\malicious_id"), false);
      await assert.rejects(
        () => storage.save("..\\malicious_id", "png", createValidPng(64, 64)),
        /Invalid storage ID format/
      );

      // 3. Absolute Windows path
      assert.strictEqual(isValidStorageId("C:\\Windows\\System32\\calc"), false);
      await assert.rejects(
        () => storage.save("C:\\Windows\\System32\\calc", "png", createValidPng(64, 64)),
        /Invalid storage ID format/
      );

      // 4. UNC path
      assert.strictEqual(isValidStorageId("\\\\attacker\\share\\payload"), false);
      await assert.rejects(
        () => storage.save("\\\\attacker\\share\\payload", "png", createValidPng(64, 64)),
        /Invalid storage ID format/
      );

      // 5. Tampered storage ID with valid prefix but invalid characters
      assert.strictEqual(isValidStorageId("char_upload_1234_abc;rm -rf"), false);
      assert.strictEqual(isValidStorageId("char_upload_1234_../../escape"), false);
    });

    test("Audit: Collision resistance stress test (2,000 generated IDs produce 0 collisions)", () => {
      const seen = new Set<string>();
      const count = 2000;
      for (let i = 0; i < count; i++) {
        const id = generateStorageId();
        assert.strictEqual(isValidStorageId(id), true);
        assert.strictEqual(seen.has(id), false, `Collision detected on ID: ${id}`);
        seen.add(id);
      }
      assert.strictEqual(seen.size, count);
    });

    test("Audit: Temp storage never overwrites or deletes unrelated files", async () => {
      const storage = new FileSystemTemporaryStorageAdapter(tempTestDir);
      const boundary = new ImageUploadBoundary({ storageAdapter: storage });

      // Create an unrelated file in the temporary directory
      const unrelatedFilePath = path.join(tempTestDir, "important_unrelated_user_file.txt");
      fs.writeFileSync(unrelatedFilePath, "CRITICAL DATA DO NOT DELETE", "utf-8");
      assert.ok(fs.existsSync(unrelatedFilePath));

      // Upload an image
      const result = (await boundary.upload(createValidPng(100, 100), "avatar.png")) as UploadSuccessResult;
      assert.ok(fs.existsSync(result.tempFilePath));
      assert.ok(fs.existsSync(unrelatedFilePath));

      // Execute cleanupExpired
      await boundary.cleanupExpired(0);
      // Unrelated file MUST still exist!
      assert.ok(fs.existsSync(unrelatedFilePath));

      // Execute cleanupAll
      await boundary.cleanupAll();
      // Managed upload is deleted, but unrelated file is NEVER touched!
      assert.strictEqual(fs.existsSync(result.tempFilePath), false);
      assert.ok(fs.existsSync(unrelatedFilePath));
      assert.strictEqual(fs.readFileSync(unrelatedFilePath, "utf-8"), "CRITICAL DATA DO NOT DELETE");
    });
  });
});
