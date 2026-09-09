/**
 * PixelPal — Character Profile Domain Validation
 * Sprint 6 Phase 5 Foundation
 *
 * Implements strict, deterministic schema and semantic validation for CharacterProfile
 * models, requests, style configurations, clothing selections, palette representations,
 * and asset reference integrity.
 */

import type {
  CharacterProfileError,
  ClothingCategory,
  ClothingTop,
  ClothingBottom,
  ClothingFootwear,
  ClothingAccessory,
  ClothingColorTheme,
  TransparencyPolicy,
  CharacterRenderingStyle,
  ChibiProportions,
  CharacterExpression,
  PaletteMood,
  DetailLevel,
  BackgroundIntent,
} from "../../../../packages/shared-types/src/character.ts";

/**
 * Canonical Character ID regex format: character_<timestamp>_<randomHex>
 */
export const CHARACTER_ID_REGEX = /^character_\d+_[a-f0-9]{8,32}$/;

/**
 * Asset ID regexes for namespace verification
 */
export const GENERATED_STORAGE_ID_REGEX = /^generated_char_\d+_[a-f0-9]{8,32}$/;
export const SPRITE_STORAGE_ID_REGEX = /^sprite_char_\d+_[a-f0-9]{8,32}$/;
export const PROCESSED_STORAGE_ID_REGEX = /^processed_char_\d+_[a-f0-9]{8,32}$/;
export const UPLOAD_STORAGE_ID_REGEX = /^char_upload_\d+_[a-f0-9]{8,32}$/;

/**
 * Validated closed sets for clothing enums
 */
const VALID_CLOTHING_CATEGORIES = new Set<ClothingCategory>([
  "casual",
  "formal",
  "fantasy",
  "cyberpunk",
  "streetwear",
  "athletic",
  "cozy",
  "traditional",
  "uniform",
  "vintage",
]);

const VALID_CLOTHING_TOPS = new Set<ClothingTop>([
  "t-shirt",
  "hoodie",
  "jacket",
  "sweater",
  "dress-shirt",
  "blazer",
  "tank-top",
  "tunic",
  "vest",
  "robe",
  "none",
]);

const VALID_CLOTHING_BOTTOMS = new Set<ClothingBottom>([
  "jeans",
  "cargo-pants",
  "slacks",
  "shorts",
  "skirt",
  "sweatpants",
  "leggings",
  "overalls",
  "robe",
  "none",
]);

const VALID_CLOTHING_FOOTWEAR = new Set<ClothingFootwear>([
  "sneakers",
  "boots",
  "dress-shoes",
  "sandals",
  "slippers",
  "loafers",
  "barefoot",
]);

const VALID_CLOTHING_ACCESSORIES = new Set<ClothingAccessory>([
  "glasses",
  "sunglasses",
  "hat",
  "cap",
  "beanie",
  "headband",
  "scarf",
  "backpack",
  "headphones",
  "belt",
  "watch",
  "bow",
  "cape",
  "mask",
  "none",
]);

const VALID_CLOTHING_COLOR_THEMES = new Set<ClothingColorTheme>([
  "monochrome",
  "cool-slate",
  "warm-autumn",
  "vibrant-primary",
  "pastel-soft",
  "earth-tone",
  "neon-cyber",
  "midnight-navy",
  "forest-green",
  "crimson-ruby",
]);

const VALID_TRANSPARENCY_POLICIES = new Set<TransparencyPolicy>([
  "binary-threshold",
  "preserved",
]);

const VALID_RENDERING_STYLES = new Set<CharacterRenderingStyle>([
  "chibi-pixel-art",
  "retro-arcade",
  "modern-isometric",
  "classic-16bit",
]);

const VALID_PROPORTIONS = new Set<ChibiProportions>([
  "super-deformed",
  "subtle-chibi",
  "standard-mascot",
]);

const VALID_EXPRESSIONS = new Set<CharacterExpression>([
  "friendly-idle",
  "happy",
  "curious",
  "focused",
  "confident",
]);

const VALID_PALETTE_MOODS = new Set<PaletteMood>([
  "vibrant",
  "pastel",
  "warm",
  "cool",
  "original-fidelity",
]);

const VALID_DETAIL_LEVELS = new Set<DetailLevel>([
  "high-fidelity",
  "simplified-iconic",
]);

const VALID_BACKGROUND_INTENTS = new Set<BackgroundIntent>([
  "solid-white",
  "transparent-ready",
  "minimal-backdrop",
]);

/**
 * Validates that a string is a canonical, collision-resistant Character ID.
 */
export function isValidCharacterId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (id.length < 20 || id.length > 64) return false;
  return CHARACTER_ID_REGEX.test(id);
}

/**
 * Validates style options against allowed closed enums.
 */
export function validateStyleOptions(style: unknown): CharacterProfileError[] {
  const errors: CharacterProfileError[] = [];
  if (!style || typeof style !== "object") {
    errors.push({
      code: "CHARACTER_STYLE_INVALID",
      message: "Style configuration must be a non-null object",
    });
    return errors;
  }

  const s = style as Record<string, unknown>;

  if (s.renderingStyle !== undefined && !VALID_RENDERING_STYLES.has(s.renderingStyle as CharacterRenderingStyle)) {
    errors.push({
      code: "CHARACTER_STYLE_INVALID",
      message: `Invalid renderingStyle: '${String(s.renderingStyle)}'`,
      details: { allowed: Array.from(VALID_RENDERING_STYLES) },
    });
  }

  if (s.proportions !== undefined && !VALID_PROPORTIONS.has(s.proportions as ChibiProportions)) {
    errors.push({
      code: "CHARACTER_STYLE_INVALID",
      message: `Invalid proportions: '${String(s.proportions)}'`,
      details: { allowed: Array.from(VALID_PROPORTIONS) },
    });
  }

  if (s.expression !== undefined && !VALID_EXPRESSIONS.has(s.expression as CharacterExpression)) {
    errors.push({
      code: "CHARACTER_STYLE_INVALID",
      message: `Invalid expression: '${String(s.expression)}'`,
      details: { allowed: Array.from(VALID_EXPRESSIONS) },
    });
  }

  if (s.paletteMood !== undefined && !VALID_PALETTE_MOODS.has(s.paletteMood as PaletteMood)) {
    errors.push({
      code: "CHARACTER_STYLE_INVALID",
      message: `Invalid paletteMood: '${String(s.paletteMood)}'`,
      details: { allowed: Array.from(VALID_PALETTE_MOODS) },
    });
  }

  if (s.detailLevel !== undefined && !VALID_DETAIL_LEVELS.has(s.detailLevel as DetailLevel)) {
    errors.push({
      code: "CHARACTER_STYLE_INVALID",
      message: `Invalid detailLevel: '${String(s.detailLevel)}'`,
      details: { allowed: Array.from(VALID_DETAIL_LEVELS) },
    });
  }

  if (s.backgroundIntent !== undefined && !VALID_BACKGROUND_INTENTS.has(s.backgroundIntent as BackgroundIntent)) {
    errors.push({
      code: "CHARACTER_STYLE_INVALID",
      message: `Invalid backgroundIntent: '${String(s.backgroundIntent)}'`,
      details: { allowed: Array.from(VALID_BACKGROUND_INTENTS) },
    });
  }

  return errors;
}

/**
 * Validates clothing configuration against closed unions.
 */
export function validateClothingConfiguration(clothing: unknown): CharacterProfileError[] {
  const errors: CharacterProfileError[] = [];
  if (!clothing || typeof clothing !== "object") {
    errors.push({
      code: "CHARACTER_CLOTHING_INVALID",
      message: "Clothing configuration must be a non-null object",
    });
    return errors;
  }

  const c = clothing as Record<string, unknown>;

  if (!c.category || !VALID_CLOTHING_CATEGORIES.has(c.category as ClothingCategory)) {
    errors.push({
      code: "CHARACTER_CLOTHING_INVALID",
      message: `Invalid or missing clothing category: '${String(c.category)}'`,
      details: { allowed: Array.from(VALID_CLOTHING_CATEGORIES) },
    });
  }

  if (!c.top || !VALID_CLOTHING_TOPS.has(c.top as ClothingTop)) {
    errors.push({
      code: "CHARACTER_CLOTHING_INVALID",
      message: `Invalid or missing clothing top: '${String(c.top)}'`,
      details: { allowed: Array.from(VALID_CLOTHING_TOPS) },
    });
  }

  if (!c.bottom || !VALID_CLOTHING_BOTTOMS.has(c.bottom as ClothingBottom)) {
    errors.push({
      code: "CHARACTER_CLOTHING_INVALID",
      message: `Invalid or missing clothing bottom: '${String(c.bottom)}'`,
      details: { allowed: Array.from(VALID_CLOTHING_BOTTOMS) },
    });
  }

  if (!c.footwear || !VALID_CLOTHING_FOOTWEAR.has(c.footwear as ClothingFootwear)) {
    errors.push({
      code: "CHARACTER_CLOTHING_INVALID",
      message: `Invalid or missing clothing footwear: '${String(c.footwear)}'`,
      details: { allowed: Array.from(VALID_CLOTHING_FOOTWEAR) },
    });
  }

  if (!c.colorTheme || !VALID_CLOTHING_COLOR_THEMES.has(c.colorTheme as ClothingColorTheme)) {
    errors.push({
      code: "CHARACTER_CLOTHING_INVALID",
      message: `Invalid or missing clothing colorTheme: '${String(c.colorTheme)}'`,
      details: { allowed: Array.from(VALID_CLOTHING_COLOR_THEMES) },
    });
  }

  if (c.accessories !== undefined) {
    if (!Array.isArray(c.accessories)) {
      errors.push({
        code: "CHARACTER_CLOTHING_INVALID",
        message: "Accessories must be an array if provided",
      });
    } else {
      for (const acc of c.accessories) {
        if (!VALID_CLOTHING_ACCESSORIES.has(acc as ClothingAccessory)) {
          errors.push({
            code: "CHARACTER_CLOTHING_INVALID",
            message: `Invalid accessory: '${String(acc)}'`,
            details: { allowed: Array.from(VALID_CLOTHING_ACCESSORIES) },
          });
          break;
        }
      }
    }
  }

  return errors;
}

/**
 * Validates discrete palette configuration.
 */
export function validatePaletteConfiguration(palette: unknown): CharacterProfileError[] {
  const errors: CharacterProfileError[] = [];
  if (!palette || typeof palette !== "object") {
    errors.push({
      code: "CHARACTER_PALETTE_INVALID",
      message: "Palette configuration must be a non-null object",
    });
    return errors;
  }

  const p = palette as Record<string, unknown>;

  if (!p.mood || !VALID_PALETTE_MOODS.has(p.mood as PaletteMood)) {
    errors.push({
      code: "CHARACTER_PALETTE_INVALID",
      message: `Invalid or missing palette mood: '${String(p.mood)}'`,
      details: { allowed: Array.from(VALID_PALETTE_MOODS) },
    });
  }

  if (typeof p.maxOpaqueColors !== "number" || !Number.isInteger(p.maxOpaqueColors) || p.maxOpaqueColors < 2 || p.maxOpaqueColors > 256) {
    errors.push({
      code: "CHARACTER_PALETTE_INVALID",
      message: `Invalid maxOpaqueColors: must be an integer between 2 and 256, got '${String(p.maxOpaqueColors)}'`,
    });
  }

  if (!p.transparencyPolicy || !VALID_TRANSPARENCY_POLICIES.has(p.transparencyPolicy as TransparencyPolicy)) {
    errors.push({
      code: "CHARACTER_PALETTE_INVALID",
      message: `Invalid transparencyPolicy: '${String(p.transparencyPolicy)}'`,
      details: { allowed: Array.from(VALID_TRANSPARENCY_POLICIES) },
    });
  }

  if (typeof p.alphaThreshold !== "number" || !Number.isInteger(p.alphaThreshold) || p.alphaThreshold < 0 || p.alphaThreshold > 255) {
    errors.push({
      code: "CHARACTER_PALETTE_INVALID",
      message: `Invalid alphaThreshold: must be an integer between 0 and 255, got '${String(p.alphaThreshold)}'`,
    });
  }

  if (!Array.isArray(p.colors)) {
    errors.push({
      code: "CHARACTER_PALETTE_INVALID",
      message: "Palette colors must be an array of RGB objects",
    });
  } else {
    for (let i = 0; i < p.colors.length; i++) {
      const col = p.colors[i];
      if (
        !col ||
        typeof col !== "object" ||
        typeof col.r !== "number" || col.r < 0 || col.r > 255 ||
        typeof col.g !== "number" || col.g < 0 || col.g > 255 ||
        typeof col.b !== "number" || col.b < 0 || col.b > 255
      ) {
        errors.push({
          code: "CHARACTER_PALETTE_INVALID",
          message: `Invalid RGB color at index ${i}: channels must be integers between 0 and 255`,
        });
        break;
      }
    }
  }

  return errors;
}

/**
 * Validates asset references and namespace segregation.
 */
export function validateAssetReferences(assets: unknown): CharacterProfileError[] {
  const errors: CharacterProfileError[] = [];
  if (!assets || typeof assets !== "object") {
    errors.push({
      code: "CHARACTER_ASSET_INVALID",
      message: "Asset references must be a non-null object",
    });
    return errors;
  }

  const a = assets as Record<string, unknown>;

  // Generated character ID is strictly required
  if (typeof a.generatedCharacterId !== "string" || !GENERATED_STORAGE_ID_REGEX.test(a.generatedCharacterId)) {
    errors.push({
      code: "CHARACTER_ASSET_INVALID",
      message: `Invalid or missing generatedCharacterId: '${String(a.generatedCharacterId)}'`,
      details: { pattern: "generated_char_<timestamp>_<hex>" },
    });
  }

  // Sprite ID is strictly required
  if (typeof a.spriteId !== "string" || !SPRITE_STORAGE_ID_REGEX.test(a.spriteId)) {
    errors.push({
      code: "CHARACTER_ASSET_INVALID",
      message: `Invalid or missing spriteId: '${String(a.spriteId)}'`,
      details: { pattern: "sprite_char_<timestamp>_<hex>" },
    });
  }

  // Optional processedImageId
  if (a.processedImageId !== undefined) {
    if (typeof a.processedImageId !== "string" || !PROCESSED_STORAGE_ID_REGEX.test(a.processedImageId)) {
      errors.push({
        code: "CHARACTER_ASSET_INVALID",
        message: `Invalid processedImageId format: '${String(a.processedImageId)}'`,
      });
    }
  }

  // Optional sourceUploadId
  if (a.sourceUploadId !== undefined) {
    if (typeof a.sourceUploadId !== "string" || !UPLOAD_STORAGE_ID_REGEX.test(a.sourceUploadId)) {
      errors.push({
        code: "CHARACTER_ASSET_INVALID",
        message: `Invalid sourceUploadId format: '${String(a.sourceUploadId)}'`,
      });
    }
  }

  // Path traversal check: verify no IDs contain path separators or traversal tokens
  for (const [key, val] of Object.entries(a)) {
    if (typeof val === "string") {
      if (val.includes("..") || val.includes("/") || val.includes("\\") || val.includes(":")) {
        errors.push({
          code: "CHARACTER_ASSET_INVALID",
          message: `Path traversal or directory separator detected in asset reference '${key}': '${val}'`,
        });
      }
    }
  }

  return errors;
}

/**
 * Validates a complete CharacterProfile object against schema and business invariants.
 */
export function validateProfile(profile: unknown): { valid: boolean; errors: CharacterProfileError[] } {
  const errors: CharacterProfileError[] = [];

  if (!profile || typeof profile !== "object") {
    return {
      valid: false,
      errors: [
        {
          code: "CHARACTER_PROFILE_INVALID",
          message: "Profile payload must be a non-null object",
        },
      ],
    };
  }

  const p = profile as Record<string, unknown>;

  // 1. Character ID
  if (!isValidCharacterId(p.characterId)) {
    errors.push({
      code: "CHARACTER_ID_INVALID",
      message: `Invalid characterId: '${String(p.characterId)}'`,
      details: { pattern: "character_<timestamp>_<hex>" },
    });
  }

  // 2. Schema Version
  if (p.schemaVersion !== 1) {
    errors.push({
      code: "CHARACTER_SCHEMA_UNSUPPORTED",
      message: `Unsupported schema version: '${String(p.schemaVersion)}'. Supported versions: [1]`,
    });
  }

  // 3. Timestamps
  if (typeof p.createdAt !== "number" || !Number.isFinite(p.createdAt) || p.createdAt <= 0) {
    errors.push({
      code: "CHARACTER_PROFILE_INVALID",
      message: "createdAt must be a valid positive timestamp",
    });
  }

  if (typeof p.updatedAt !== "number" || !Number.isFinite(p.updatedAt) || p.updatedAt <= 0) {
    errors.push({
      code: "CHARACTER_PROFILE_INVALID",
      message: "updatedAt must be a valid positive timestamp",
    });
  }

  if (typeof p.createdAt === "number" && typeof p.updatedAt === "number" && p.updatedAt < p.createdAt) {
    errors.push({
      code: "CHARACTER_PROFILE_INVALID",
      message: "updatedAt cannot be earlier than createdAt",
    });
  }

  // 4. Asset References
  errors.push(...validateAssetReferences(p.assets));

  // 5. Style Options
  errors.push(...validateStyleOptions(p.style));

  // 6. Clothing Configuration
  errors.push(...validateClothingConfiguration(p.clothing));

  // 7. Palette Configuration
  errors.push(...validatePaletteConfiguration(p.palette));

  // 8. Metadata (optional)
  if (p.metadata !== undefined) {
    if (!p.metadata || typeof p.metadata !== "object") {
      errors.push({
        code: "CHARACTER_PROFILE_INVALID",
        message: "Profile metadata must be an object if provided",
      });
    } else {
      const meta = p.metadata as Record<string, unknown>;
      if (meta.displayName !== undefined && (typeof meta.displayName !== "string" || meta.displayName.length > 100)) {
        errors.push({
          code: "CHARACTER_PROFILE_INVALID",
          message: "Metadata displayName must be a string <= 100 characters",
        });
      }
      if (meta.tag !== undefined && (typeof meta.tag !== "string" || meta.tag.length > 50)) {
        errors.push({
          code: "CHARACTER_PROFILE_INVALID",
          message: "Metadata tag must be a string <= 50 characters",
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
