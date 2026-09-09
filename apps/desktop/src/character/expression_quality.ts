/**
 * PixelPal — Deterministic Asset Quality Validation Pipeline
 * Sprint 7 Phase 4 Foundation
 *
 * Enforces rigorous quality gates on expression sprite assets:
 * 1. Image format integrity (PNG signature, valid RGBA decode).
 * 2. Exact canvas dimensions (default 64x64).
 * 3. Transparent background verification (zero unwanted solid backdrops).
 * 4. Corner transparency inspection (silhouette isolation).
 * 5. Binary alpha thresholding (crisp pixel edges, zero blurry halos).
 * 6. Non-empty sprite content (rejection of pure transparent canvases).
 * 7. Corrupt/truncated payload rejection.
 */

import sharp, { type Metadata } from "sharp";
import type {
  ExpressionQualityError,
  ExpressionQualityReport,
} from "./types.ts";
import type { FrameDimensions } from "../animation/types.ts";

/**
 * Expected PNG file magic header bytes.
 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Quality validation configuration options.
 */
export interface QualityValidationOptions {
  /** Expected frame dimensions (defaults to 64x64) */
  readonly expectedDimensions?: FrameDimensions;
  /** Maximum allowable semi-transparent boundary pixels (defaults to 0 for crisp pixel art) */
  readonly maxSemiTransparentPixels?: number;
  /** Whether corner pixels must be transparent (defaults to true) */
  readonly requireTransparentCorners?: boolean;
}

/**
 * Validates the technical quality and pixel-art integrity of an expression asset buffer.
 */
export async function validateExpressionAssetQuality(
  buffer: Buffer,
  options: QualityValidationOptions = {}
): Promise<ExpressionQualityReport> {
  const errors: ExpressionQualityError[] = [];
  const warnings: string[] = [];
  const expectedDimensions = options.expectedDimensions ?? { width: 64, height: 64 };
  const maxSemiTransparent = options.maxSemiTransparentPixels ?? 0;
  const requireTransparentCorners = options.requireTransparentCorners ?? true;

  // 1. Buffer existence & minimal size
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 8) {
    errors.push({
      code: "QUALITY_ASSET_CORRUPTED",
      message: "Asset buffer is missing, empty, or smaller than minimal header size.",
    });
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // 2. PNG Magic Signature Verification
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    errors.push({
      code: "QUALITY_INVALID_FORMAT",
      message: "Asset does not match the PNG file signature (magic header bytes).",
    });
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // 3. Raster Metadata & Decode Verification
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    errors.push({
      code: "QUALITY_DECODE_FAILED",
      message: `Raster decode failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  if (metadata.format !== "png") {
    errors.push({
      code: "QUALITY_INVALID_FORMAT",
      message: `Expected 'png' format, but received '${metadata.format}'.`,
    });
  }

  // 4. Exact Canvas Dimensions Check
  if (
    metadata.width !== expectedDimensions.width ||
    metadata.height !== expectedDimensions.height
  ) {
    errors.push({
      code: "QUALITY_DIMENSION_MISMATCH",
      message: `Canvas dimensions (${metadata.width}x${metadata.height}) do not match expected canonical dimensions (${expectedDimensions.width}x${expectedDimensions.height}).`,
    });
  }

  // 5. Alpha Channel Presence
  if (!metadata.hasAlpha) {
    errors.push({
      code: "QUALITY_ALPHA_MISSING",
      message: "Asset does not have an alpha transparency channel.",
    });
  }

  // 6. Deep Raw RGBA Pixel Inspection
  if (metadata.width && metadata.height && metadata.hasAlpha) {
    try {
      const { data, info } = await sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const totalPixels = info.width * info.height;
      let transparentCount = 0;
      let opaqueCount = 0;
      let semiTransparentCount = 0;

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) {
          transparentCount++;
        } else if (a === 255) {
          opaqueCount++;
        } else {
          semiTransparentCount++;
        }
      }

      // 6a. Pure transparent image check (empty canvas)
      if (transparentCount === totalPixels) {
        errors.push({
          code: "QUALITY_TRANSPARENCY_EMPTY",
          message: "Asset canvas is 100% transparent with zero visible character pixels.",
        });
      }

      // 6b. Pure opaque image check (missing transparency)
      if (transparentCount === 0) {
        errors.push({
          code: "QUALITY_OPAQUE_BACKGROUND",
          message: "Asset canvas contains zero transparent pixels (entire image is completely opaque).",
        });
      }

      // 6c. Corner Transparency Check (silhouette boundary isolation)
      if (requireTransparentCorners && info.width >= 2 && info.height >= 2) {
        const getAlphaAt = (x: number, y: number): number => {
          const idx = (y * info.width + x) * 4 + 3;
          return data[idx];
        };

        const topLeftAlpha = getAlphaAt(0, 0);
        const topRightAlpha = getAlphaAt(info.width - 1, 0);
        const bottomLeftAlpha = getAlphaAt(0, info.height - 1);
        const bottomRightAlpha = getAlphaAt(info.width - 1, info.height - 1);

        // If all 4 corners are fully opaque, the background was not removed
        if (
          topLeftAlpha === 255 &&
          topRightAlpha === 255 &&
          bottomLeftAlpha === 255 &&
          bottomRightAlpha === 255
        ) {
          errors.push({
            code: "QUALITY_OPAQUE_BACKGROUND",
            message: "All four corners of the canvas are fully opaque, indicating an unremoved solid background.",
          });
        }
      }

      // 6d. Crisp Pixel Edges / Blurry Halo Check
      if (semiTransparentCount > maxSemiTransparent) {
        errors.push({
          code: "QUALITY_BLURRED_EDGES",
          message: `Asset contains ${semiTransparentCount} semi-transparent anti-aliased pixels (exceeds threshold of ${maxSemiTransparent}). Pixel art requires binary thresholded alpha.`,
        });
      }
    } catch (pixelErr) {
      errors.push({
        code: "QUALITY_DECODE_FAILED",
        message: `Failed to inspect raw pixel buffer: ${pixelErr instanceof Error ? pixelErr.message : String(pixelErr)}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha,
    errors,
    warnings,
  };
}
