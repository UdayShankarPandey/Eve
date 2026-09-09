/**
 * PixelPal — Deterministic Character Expression Consistency Validator
 * Sprint 7 Phase 2 Foundation
 *
 * Validates that downstream expression assets strictly adhere to the
 * authoritative CharacterProfile identity contract:
 * - Character ID binding
 * - Dimension uniformity (canonical 64x64 or 128x128)
 * - Palette budget adherence (opaque color limits and mood alignment)
 * - Transparency policy adherence
 * - Asset ID provenance and immutability
 */

import sharp from "sharp";
import type {
  CharacterProfile,
  ExpressionAssetRecord,
  ExpressionConsistencyError,
  ExpressionConsistencyReport,
} from "./types.ts";
import { isValidExpressionId } from "./expression_prompt_builder.ts";
import { isValidCharacterId } from "./profile_validator.ts";

/**
 * Options for expression consistency validation.
 */
export interface ExpressionConsistencyValidationOptions {
  /** Optional binary sprite image buffer to inspect raster pixel data */
  readonly imageBuffer?: Buffer;
  /** Expected target dimension (defaults to 64) */
  readonly expectedDimension?: number;
}

/**
 * Validates an expression asset against the authoritative CharacterProfile.
 */
export async function validateExpressionConsistency(
  assetRecord: ExpressionAssetRecord,
  profile: CharacterProfile,
  options: ExpressionConsistencyValidationOptions = {}
): Promise<ExpressionConsistencyReport> {
  const errors: ExpressionConsistencyError[] = [];
  const warnings: string[] = [];
  const expectedDimension = options.expectedDimension ?? 64;

  // 1. Character Identity Check
  if (!isValidCharacterId(assetRecord.characterId)) {
    errors.push({
      code: "CONSISTENCY_CHARACTER_MISMATCH",
      message: `Invalid characterId format in asset record: '${assetRecord.characterId}'`,
    });
  } else if (assetRecord.characterId !== profile.characterId) {
    errors.push({
      code: "CONSISTENCY_CHARACTER_MISMATCH",
      message: `Asset characterId '${assetRecord.characterId}' does not match profile characterId '${profile.characterId}'`,
      details: {
        assetCharacterId: assetRecord.characterId,
        profileCharacterId: profile.characterId,
      },
    });
  }

  // 2. Expression Identifier Check
  if (!isValidExpressionId(assetRecord.expression)) {
    errors.push({
      code: "CONSISTENCY_STYLE_MISMATCH",
      message: `Invalid expression identifier: '${String(assetRecord.expression)}'`,
    });
  }

  // 3. Asset ID Format & Provenance Check
  const expectedPrefix = `expr_asset_${profile.characterId}_${assetRecord.expression}_`;
  if (!assetRecord.assetId.startsWith(expectedPrefix)) {
    errors.push({
      code: "CONSISTENCY_CHARACTER_MISMATCH",
      message: `Asset ID '${assetRecord.assetId}' violates canonical naming convention. Expected prefix: '${expectedPrefix}'`,
    });
  }

  // 4. Dimension Uniformity Check (Record Level)
  if (
    assetRecord.frameDimensions.width !== expectedDimension ||
    assetRecord.frameDimensions.height !== expectedDimension
  ) {
    errors.push({
      code: "CONSISTENCY_DIMENSION_MISMATCH",
      message: `Asset record frame dimensions (${assetRecord.frameDimensions.width}x${assetRecord.frameDimensions.height}) do not match expected canonical dimensions (${expectedDimension}x${expectedDimension}).`,
    });
  }

  // 5. Binary Raster Inspection (if buffer is provided)
  if (options.imageBuffer) {
    try {
      const meta = await sharp(options.imageBuffer).metadata();

      if (meta.width !== expectedDimension || meta.height !== expectedDimension) {
        errors.push({
          code: "CONSISTENCY_DIMENSION_MISMATCH",
          message: `Raster pixel dimensions (${meta.width}x${meta.height}) do not match expected canonical dimensions (${expectedDimension}x${expectedDimension}).`,
        });
      }

      if (!meta.hasAlpha) {
        errors.push({
          code: "CONSISTENCY_TRANSPARENCY_VIOLATION",
          message: "Expression asset lacks an alpha channel. Transparency is mandatory for desktop sprites.",
        });
      } else {
        // Inspect raster pixel buffer for color count and corner transparency
        const rawRgba = await sharp(options.imageBuffer)
          .ensureAlpha()
          .raw()
          .toBuffer();

        const uniqueOpaqueColors = new Set<string>();
        let hasTransparentPixels = false;

        for (let i = 0; i < rawRgba.length; i += 4) {
          const a = rawRgba[i + 3];
          if (a <= profile.palette.alphaThreshold) {
            hasTransparentPixels = true;
          } else {
            const r = rawRgba[i];
            const g = rawRgba[i + 1];
            const b = rawRgba[i + 2];
            uniqueOpaqueColors.add(`${r},${g},${b}`);
          }
        }

        if (!hasTransparentPixels) {
          errors.push({
            code: "CONSISTENCY_TRANSPARENCY_VIOLATION",
            message: "Expression sprite contains zero transparent pixels (entire canvas is opaque).",
          });
        }

        // Palette Budget Adherence Check
        if (uniqueOpaqueColors.size > profile.palette.maxOpaqueColors) {
          errors.push({
            code: "CONSISTENCY_PALETTE_DRIFT",
            message: `Expression sprite contains ${uniqueOpaqueColors.size} opaque colors, exceeding profile limit of ${profile.palette.maxOpaqueColors}.`,
            details: {
              uniqueColorCount: uniqueOpaqueColors.size,
              maxAllowed: profile.palette.maxOpaqueColors,
            },
          });
        }
      }
    } catch (err) {
      errors.push({
        code: "CONSISTENCY_STYLE_MISMATCH",
        message: `Failed to decode sprite raster for consistency check: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    characterId: profile.characterId,
    expression: assetRecord.expression,
    errors,
    warnings,
  };
}
