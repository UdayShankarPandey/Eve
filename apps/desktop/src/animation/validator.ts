import type {
  AnimationDefinition,
  AnimationManifest,
  LoopMode,
  ValidationResult,
} from "./types.ts";

const VALID_LOOP_MODES: ReadonlySet<LoopMode> = new Set([
  "loop",
  "one-shot",
  "ping-pong",
]);

function validateNonEmptyString(
  val: unknown,
  fieldName: string,
  prefix: string,
  errors: string[]
): void {
  if (!val || typeof val !== "string" || val.trim().length === 0) {
    errors.push(`${prefix} '${fieldName}' must be a non-empty string`);
  }
}

function validateOptionalString(
  val: unknown,
  fieldName: string,
  prefix: string,
  errors: string[]
): void {
  if (val !== undefined && (typeof val !== "string" || val.trim().length === 0)) {
    errors.push(`${prefix} '${fieldName}' when provided must be a non-empty string`);
  }
}

function validatePositiveNumber(
  val: unknown,
  fieldName: string,
  prefix: string,
  errors: string[]
): void {
  if (typeof val !== "number" || val <= 0 || !Number.isFinite(val)) {
    errors.push(`${prefix} '${fieldName}' must be a positive number (received: ${val})`);
  }
}

function validateFrameDimensions(
  dimensions: unknown,
  prefix: string,
  errors: string[]
): void {
  if (!dimensions || typeof dimensions !== "object") {
    errors.push(`${prefix} 'frameDimensions' must be an object with width and height`);
    return;
  }
  const dims = dimensions as { width?: unknown; height?: unknown };
  validatePositiveNumber(dims.width, "frameDimensions.width", prefix, errors);
  validatePositiveNumber(dims.height, "frameDimensions.height", prefix, errors);
}

function validateDuration(
  def: Partial<AnimationDefinition>,
  prefix: string,
  errors: string[],
  warnings: string[]
): void {
  if (typeof def.durationMs !== "number" || def.durationMs <= 0 || !Number.isFinite(def.durationMs)) {
    errors.push(`${prefix} 'durationMs' must be a positive number (received: ${def.durationMs})`);
  } else if (def.frameCount && def.fps && def.frameCount > 0 && def.fps > 0) {
    const expectedDuration = (def.frameCount / def.fps) * 1000;
    if (Math.abs(expectedDuration - def.durationMs) > 50) {
      warnings.push(
        `${prefix} 'durationMs' (${def.durationMs}ms) differs from expected calculation (${expectedDuration.toFixed(0)}ms based on ${def.frameCount} frames @ ${def.fps} FPS)`
      );
    }
  }
}

/**
 * Validates a single AnimationDefinition object.
 */
export function validateAnimationDefinition(
  input: unknown,
  contextPrefix = "Animation"
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [`${contextPrefix} definition must be a valid non-null object`],
      warnings: [],
    };
  }

  const def = input as Partial<AnimationDefinition>;

  validateNonEmptyString(def.id, "id", contextPrefix, errors);
  validateNonEmptyString(def.name, "name", contextPrefix, errors);
  validateNonEmptyString(def.assetPath, "assetPath", contextPrefix, errors);

  if (typeof def.frameCount !== "number" || !Number.isInteger(def.frameCount) || def.frameCount < 1) {
    errors.push(`${contextPrefix} 'frameCount' must be a positive integer (received: ${def.frameCount})`);
  }

  validatePositiveNumber(def.fps, "fps", contextPrefix, errors);
  validateFrameDimensions(def.frameDimensions, contextPrefix, errors);
  validateDuration(def, contextPrefix, errors, warnings);

  if (!def.loopMode || !VALID_LOOP_MODES.has(def.loopMode as LoopMode)) {
    errors.push(
      `${contextPrefix} 'loopMode' must be one of: ${Array.from(VALID_LOOP_MODES).join(", ")} (received: ${def.loopMode})`
    );
  }

  validateOptionalString(def.fallbackId, "fallbackId", contextPrefix, errors);
  validateOptionalString(def.transitionTo, "transitionTo", contextPrefix, errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateManifestAnimations(
  manifest: Partial<AnimationManifest>,
  errors: string[],
  warnings: string[]
): void {
  if (!manifest.animations || typeof manifest.animations !== "object") {
    errors.push("Manifest 'animations' map is required");
    return;
  }

  const animMap = manifest.animations as Record<string, unknown>;
  const keys = Object.keys(animMap);

  if (keys.length === 0) {
    errors.push("Manifest 'animations' map cannot be empty");
  }

  if (
    manifest.defaultAnimationId &&
    typeof manifest.defaultAnimationId === "string" &&
    !animMap[manifest.defaultAnimationId]
  ) {
    errors.push(`Default animation '${manifest.defaultAnimationId}' not found in manifest 'animations'`);
  }

  for (const [key, animDef] of Object.entries(animMap)) {
    const result = validateAnimationDefinition(animDef, `Animation[${key}]`);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
}

/**
 * Validates a complete AnimationManifest.
 */
export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: ["Manifest must be a non-null object"],
      warnings: [],
    };
  }

  const manifest = input as Partial<AnimationManifest>;

  validateNonEmptyString(manifest.version, "version", "Manifest", errors);
  validatePositiveNumber(manifest.frameWidth, "frameWidth", "Manifest", errors);
  validatePositiveNumber(manifest.frameHeight, "frameHeight", "Manifest", errors);
  validateNonEmptyString(manifest.defaultAnimationId, "defaultAnimationId", "Manifest", errors);

  validateManifestAnimations(manifest, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
