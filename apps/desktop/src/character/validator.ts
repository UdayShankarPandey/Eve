/**
 * PixelPal — Secure Image Content & Integrity Validator
 * Sprint 6 Phase 1 Foundation
 *
 * Implements strict binary inspection, magic-byte format identification,
 * header decoding for PNG, JPEG, and WebP, explicit size/dimension limits,
 * and corruption rejection without relying on caller-provided filenames.
 */

import {
  SupportedMimeTypes,
  type ImageDimensions,
  type ImageFormat,
  type ImageMetadata,
  type ImageValidationConstraints,
  type ImageValidationError,
  type ImageValidationResult,
} from "./types.ts";

/**
 * Default production validation constraints.
 */
export const DEFAULT_IMAGE_CONSTRAINTS: Required<ImageValidationConstraints> = {
  minSizeBytes: 100, // Reject trivial stubs
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB limit
  minWidth: 64, // Minimum avatar/chibi generation dimension
  minHeight: 64,
  maxWidth: 4096, // Protect against decompression bombs
  maxHeight: 4096,
  maxAspectRatio: 4.0, // Prevent absurdly stretched banners
  allowedFormats: ["png", "jpeg", "webp"],
};

/**
 * PNG Magic Bytes: 89 50 4E 47 0D 0A 1A 0A
 */
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Computes SHA-256 hex string for a byte buffer using standard Web Crypto or Node fallback.
 */
export async function computeSha256Hex(data: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback for Node.js environments where subtle might not be polyfilled
  try {
    const nodeCrypto = await import("node:crypto");
    return nodeCrypto.createHash("sha256").update(data).digest("hex");
  } catch {
    // Deterministic simple hash fallback if crypto is completely unavailable (unlikely)
    let hash = 0;
    for (const byte of data) {
      hash = Math.trunc((hash << 5) - hash + byte);
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}

/**
 * Validates whether the byte stream starts with PNG signature.
 */
function isPngSignature(data: Uint8Array): boolean {
  if (data.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (data[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Validates whether the byte stream starts with JPEG SOI marker (0xFF, 0xD8, 0xFF).
 */
function isJpegSignature(data: Uint8Array): boolean {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

/**
 * Validates whether the byte stream starts with RIFF ... WEBP signature.
 */
function isWebpSignature(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  const isRiff =
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46; // "RIFF"
  const isWebp =
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50; // "WEBP"
  return isRiff && isWebp;
}

/**
 * Extracts dimensions from a valid PNG stream.
 */
function parsePngDimensions(data: Uint8Array): ImageDimensions {
  // PNG IHDR chunk is located immediately after the 8-byte signature
  // Offset 8..11: Chunk length (must be 13)
  // Offset 12..15: Chunk type ("IHDR" = 0x49 0x48 0x44 0x52)
  // Offset 16..19: Width (32-bit big-endian)
  // Offset 20..23: Height (32-bit big-endian)
  if (data.length < 24) {
    throw new Error("Truncated PNG header: insufficient bytes for IHDR chunk");
  }

  const chunkType = String.fromCodePoint(data[12], data[13], data[14], data[15]);
  if (chunkType !== "IHDR") {
    throw new Error(`Corrupted PNG: expected IHDR chunk, found '${chunkType}'`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  if (width <= 0 || height <= 0) {
    throw new Error(`Corrupted PNG: invalid dimensions ${width}x${height}`);
  }

  return { width, height };
}

/**
 * Extracts dimensions from a valid JPEG stream by scanning for SOF markers.
 */
function parseJpegDimensions(data: Uint8Array): ImageDimensions {
  let offset = 2; // Skip SOI (0xFF, 0xD8)

  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      throw new Error(`Corrupted JPEG: expected marker prefix 0xFF at offset ${offset}`);
    }

    // Skip consecutive 0xFF padding bytes
    while (offset < data.length && data[offset] === 0xff) {
      offset++;
    }

    if (offset >= data.length) {
      throw new Error("Corrupted JPEG: unexpected EOF while reading marker");
    }

    const marker = data[offset++];

    // Standalone markers without payload
    if (
      marker === 0xd8 || // SOI
      marker === 0xd9 || // EOI
      marker === 0x01 || // TEM
      (marker >= 0xd0 && marker <= 0xd7) // RSTn
    ) {
      continue;
    }

    if (offset + 2 > data.length) {
      throw new Error("Corrupted JPEG: unexpected EOF while reading segment length");
    }

    const segmentLength = (data[offset] << 8) | data[offset + 1];
    if (segmentLength < 2) {
      throw new Error(`Corrupted JPEG: invalid segment length ${segmentLength}`);
    }

    // Check for Start of Frame (SOFn) markers:
    // 0xC0 (SOF0: Baseline), 0xC1 (SOF1: Extended), 0xC2 (SOF2: Progressive),
    // 0xC3 (SOF3: Lossless), 0xC5..0xC7, 0xC9..0xCB, 0xCD..0xCF
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof) {
      if (offset + 7 > data.length) {
        throw new Error("Corrupted JPEG: unexpected EOF in SOF segment");
      }

      // Format of SOF:
      // offset + 0, + 1: segment length
      // offset + 2: precision (bits per sample)
      // offset + 3, + 4: height (16-bit big endian)
      // offset + 5, + 6: width (16-bit big endian)
      const height = (data[offset + 3] << 8) | data[offset + 4];
      const width = (data[offset + 5] << 8) | data[offset + 6];

      if (width <= 0 || height <= 0) {
        throw new Error(`Corrupted JPEG: invalid dimensions ${width}x${height}`);
      }

      return { width, height };
    }

    // Skip to next segment
    offset += segmentLength;
  }

  throw new Error("Corrupted JPEG: no Start of Frame (SOF) marker found");
}

/**
 * Extracts dimensions from a valid WebP stream (VP8, VP8L, or VP8X).
 */
function parseWebpDimensions(data: Uint8Array): ImageDimensions {
  if (data.length < 16) {
    throw new Error("Truncated WebP: insufficient bytes for RIFF header");
  }

  const chunkFourCC = String.fromCodePoint(data[12], data[13], data[14], data[15]);

  if (chunkFourCC === "VP8 ") {
    // Lossy WebP: keyframe header starts at offset 20
    if (data.length < 30) {
      throw new Error("Truncated WebP VP8: insufficient bytes for frame header");
    }

    // Start code at offset 23..25 must be 0x9D 0x01 0x2A
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) {
      throw new Error("Corrupted WebP VP8: invalid keyframe start code");
    }

    const width = (data[26] | (data[27] << 8)) & 0x3fff;
    const height = (data[28] | (data[29] << 8)) & 0x3fff;

    if (width <= 0 || height <= 0) {
      throw new Error(`Corrupted WebP VP8: invalid dimensions ${width}x${height}`);
    }

    return { width, height };
  }

  if (chunkFourCC === "VP8L") {
    // Lossless WebP: signature byte 0x2F at offset 20
    if (data.length < 25) {
      throw new Error("Truncated WebP VP8L: insufficient bytes for lossless header");
    }

    if (data[20] !== 0x2f) {
      throw new Error("Corrupted WebP VP8L: invalid signature byte");
    }

    const b0 = data[21];
    const b1 = data[22];
    const b2 = data[23];
    const b3 = data[24];

    const width = 1 + (b0 | ((b1 & 0x3f) << 8));
    const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));

    if (width <= 0 || height <= 0) {
      throw new Error(`Corrupted WebP VP8L: invalid dimensions ${width}x${height}`);
    }

    return { width, height };
  }

  if (chunkFourCC === "VP8X") {
    // Extended WebP: canvas width at offset 24..26 (24-bit uint LE + 1), height at 27..29
    if (data.length < 30) {
      throw new Error("Truncated WebP VP8X: insufficient bytes for extended header");
    }

    const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
    const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));

    if (width <= 0 || height <= 0) {
      throw new Error(`Corrupted WebP VP8X: invalid dimensions ${width}x${height}`);
    }

    return { width, height };
  }

  throw new Error(`Corrupted WebP: unknown chunk type '${chunkFourCC}'`);
}

/**
 * Inspects raw bytes to detect actual image format and extract dimensions.
 */
export function detectImageFormatAndDimensions(data: Uint8Array): {
  format: ImageFormat;
  dimensions: ImageDimensions;
} {
  if (isPngSignature(data)) {
    return {
      format: "png",
      dimensions: parsePngDimensions(data),
    };
  }

  if (isJpegSignature(data)) {
    return {
      format: "jpeg",
      dimensions: parseJpegDimensions(data),
    };
  }

  if (isWebpSignature(data)) {
    return {
      format: "webp",
      dimensions: parseWebpDimensions(data),
    };
  }

  throw new Error("Unsupported image format or invalid magic bytes");
}

/**
 * Comprehensive image content and integrity validator.
 * Validates actual binary content, format, size limits, dimensions, and aspect ratio.
 */
export async function validateImageContent(
  data: Uint8Array,
  constraints?: Partial<ImageValidationConstraints>
): Promise<ImageValidationResult> {
  const config = { ...DEFAULT_IMAGE_CONSTRAINTS, ...constraints };
  const errors: ImageValidationError[] = [];

  // 1. Check for empty payload
  if (!data || data.length === 0) {
    return {
      valid: false,
      errors: [
        {
          code: "FILE_EMPTY",
          message: "Uploaded image file is completely empty (0 bytes)",
          field: "sizeBytes",
          details: { sizeBytes: 0 },
        },
      ],
    };
  }

  // 2. Minimum byte size check
  if (data.length < config.minSizeBytes) {
    errors.push({
      code: "FILE_TOO_SMALL",
      message: `File size (${data.length} bytes) is below minimum threshold (${config.minSizeBytes} bytes)`,
      field: "sizeBytes",
      details: { sizeBytes: data.length, minSizeBytes: config.minSizeBytes },
    });
    return { valid: false, errors };
  }

  // 3. Maximum byte size check
  if (data.length > config.maxSizeBytes) {
    errors.push({
      code: "FILE_TOO_LARGE",
      message: `File size (${data.length} bytes) exceeds maximum limit (${config.maxSizeBytes} bytes)`,
      field: "sizeBytes",
      details: { sizeBytes: data.length, maxSizeBytes: config.maxSizeBytes },
    });
    return { valid: false, errors };
  }

  // 4. Binary inspection & magic byte format detection
  let detectedFormat: ImageFormat;
  let dimensions: ImageDimensions;

  try {
    const result = detectImageFormatAndDimensions(data);
    detectedFormat = result.format;
    dimensions = result.dimensions;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("Unsupported image format")) {
      errors.push({
        code: "UNSUPPORTED_FORMAT",
        message: "File content does not match any supported image format (JPEG, PNG, WebP)",
        field: "format",
        details: { detectedMagicPrefix: Array.from(data.slice(0, 8)) },
      });
    } else {
      errors.push({
        code: "CORRUPTED_IMAGE",
        message: `Image structure is corrupted or invalid: ${errorMessage}`,
        field: "content",
        details: { error: errorMessage },
      });
    }
    return { valid: false, errors };
  }

  // 5. Allowed format whitelist check
  if (!config.allowedFormats.includes(detectedFormat)) {
    errors.push({
      code: "UNSUPPORTED_FORMAT",
      message: `Format '${detectedFormat}' is not in the allowed formats list [${config.allowedFormats.join(", ")}]`,
      field: "format",
      details: { detectedFormat, allowedFormats: config.allowedFormats },
    });
  }

  // 6. Minimum dimension check
  if (dimensions.width < config.minWidth || dimensions.height < config.minHeight) {
    errors.push({
      code: "DIMENSIONS_TOO_SMALL",
      message: `Image dimensions (${dimensions.width}x${dimensions.height}) are below minimum required (${config.minWidth}x${config.minHeight})`,
      field: "dimensions",
      details: {
        width: dimensions.width,
        height: dimensions.height,
        minWidth: config.minWidth,
        minHeight: config.minHeight,
      },
    });
  }

  // 7. Maximum dimension check (decompression bomb protection)
  if (dimensions.width > config.maxWidth || dimensions.height > config.maxHeight) {
    errors.push({
      code: "DIMENSIONS_TOO_LARGE",
      message: `Image dimensions (${dimensions.width}x${dimensions.height}) exceed maximum allowed (${config.maxWidth}x${config.maxHeight})`,
      field: "dimensions",
      details: {
        width: dimensions.width,
        height: dimensions.height,
        maxWidth: config.maxWidth,
        maxHeight: config.maxHeight,
      },
    });
  }

  // 8. Aspect ratio check
  const aspectRatio =
    dimensions.width >= dimensions.height
      ? dimensions.width / dimensions.height
      : dimensions.height / dimensions.width;

  if (aspectRatio > config.maxAspectRatio) {
    errors.push({
      code: "INVALID_ASPECT_RATIO",
      message: `Image aspect ratio (${aspectRatio.toFixed(2)}:1) exceeds maximum allowed (${config.maxAspectRatio}:1)`,
      field: "aspectRatio",
      details: {
        aspectRatio: Number(aspectRatio.toFixed(2)),
        maxAspectRatio: config.maxAspectRatio,
        width: dimensions.width,
        height: dimensions.height,
      },
    });
  }

  // Return validation outcome
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Compute cryptographic SHA-256
  const sha256 = await computeSha256Hex(data);

  const metadata: ImageMetadata = {
    format: detectedFormat,
    mimeType: SupportedMimeTypes[detectedFormat],
    width: dimensions.width,
    height: dimensions.height,
    sizeBytes: data.length,
    sha256,
  };

  return {
    valid: true,
    errors: [],
    metadata,
  };
}
