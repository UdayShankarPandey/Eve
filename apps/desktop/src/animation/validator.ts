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

  // ID validation
  if (!def.id || typeof def.id !== "string" || def.id.trim().length === 0) {
    errors.push(`${contextPrefix} 'id' must be a non-empty string`);
  }

  // Name validation
  if (!def.name || typeof def.name !== "string" || def.name.trim().length === 0) {
    errors.push(`${contextPrefix} 'name' must be a non-empty string`);
  }

  // AssetPath validation
  if (
    !def.assetPath ||
    typeof def.assetPath !== "string" ||
    def.assetPath.trim().length === 0
  ) {
    errors.push(`${contextPrefix} 'assetPath' must be a non-empty string`);
  }

  // Frame count validation
  if (
    typeof def.frameCount !== "number" ||
    !Number.isInteger(def.frameCount) ||
    def.frameCount < 1
  ) {
    errors.push(
      `${contextPrefix} 'frameCount' must be a positive integer (received: ${def.frameCount})`
    );
  }

  // FPS validation
  if (typeof def.fps !== "number" || def.fps <= 0 || !Number.isFinite(def.fps)) {
    errors.push(`${contextPrefix} 'fps' must be a positive number (received: ${def.fps})`);
  }

  // Frame dimensions validation
  if (!def.frameDimensions || typeof def.frameDimensions !== "object") {
    errors.push(`${contextPrefix} 'frameDimensions' must be an object with width and height`);
  } else {
    if (
      typeof def.frameDimensions.width !== "number" ||
      def.frameDimensions.width <= 0 ||
      !Number.isFinite(def.frameDimensions.width)
    ) {
      errors.push(
        `${contextPrefix} 'frameDimensions.width' must be a positive number (received: ${def.frameDimensions.width})`
      );
    }
    if (
      typeof def.frameDimensions.height !== "number" ||
      def.frameDimensions.height <= 0 ||
      !Number.isFinite(def.frameDimensions.height)
    ) {
      errors.push(
        `${contextPrefix} 'frameDimensions.height' must be a positive number (received: ${def.frameDimensions.height})`
      );
    }
  }

  // Duration validation
  if (
    typeof def.durationMs !== "number" ||
    def.durationMs <= 0 ||
    !Number.isFinite(def.durationMs)
  ) {
    errors.push(
      `${contextPrefix} 'durationMs' must be a positive number (received: ${def.durationMs})`
    );
  } else if (
    def.frameCount &&
    def.fps &&
    def.frameCount > 0 &&
    def.fps > 0
  ) {
    const expectedDuration = (def.frameCount / def.fps) * 1000;
    // Warn if duration is significantly out of sync with frameCount / fps
    if (Math.abs(expectedDuration - def.durationMs) > 50) {
      warnings.push(
        `${contextPrefix} 'durationMs' (${def.durationMs}ms) differs from expected calculation (${expectedDuration.toFixed(0)}ms based on ${def.frameCount} frames @ ${def.fps} FPS)`
      );
    }
  }

  // Loop mode validation
  if (!def.loopMode || !VALID_LOOP_MODES.has(def.loopMode as LoopMode)) {
    errors.push(
      `${contextPrefix} 'loopMode' must be one of: ${Array.from(VALID_LOOP_MODES).join(", ")} (received: ${def.loopMode})`
    );
  }

  // Fallback ID validation (optional, but if present must be non-empty string)
  if (def.fallbackId !== undefined) {
    if (typeof def.fallbackId !== "string" || def.fallbackId.trim().length === 0) {
      errors.push(`${contextPrefix} 'fallbackId' when provided must be a non-empty string`);
    }
  }

  // TransitionTo validation (optional, but if present must be non-empty string)
  if (def.transitionTo !== undefined) {
    if (typeof def.transitionTo !== "string" || def.transitionTo.trim().length === 0) {
      errors.push(`${contextPrefix} 'transitionTo' when provided must be a non-empty string`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
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

  if (
    !manifest.version ||
    typeof manifest.version !== "string" ||
    manifest.version.trim().length === 0
  ) {
    errors.push("Manifest 'version' must be a non-empty string");
  }

  if (
    typeof manifest.frameWidth !== "number" ||
    manifest.frameWidth <= 0 ||
    !Number.isFinite(manifest.frameWidth)
  ) {
    errors.push(`Manifest 'frameWidth' must be a positive number (received: ${manifest.frameWidth})`);
  }

  if (
    typeof manifest.frameHeight !== "number" ||
    manifest.frameHeight <= 0 ||
    !Number.isFinite(manifest.frameHeight)
  ) {
    errors.push(`Manifest 'frameHeight' must be a positive number (received: ${manifest.frameHeight})`);
  }

  if (
    !manifest.defaultAnimationId ||
    typeof manifest.defaultAnimationId !== "string" ||
    manifest.defaultAnimationId.trim().length === 0
  ) {
    errors.push("Manifest 'defaultAnimationId' must be a non-empty string");
  }

  if (!manifest.animations || typeof manifest.animations !== "object") {
    errors.push("Manifest 'animations' map is required");
  } else {
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
      errors.push(
        `Default animation '${manifest.defaultAnimationId}' not found in manifest 'animations'`
      );
    }

    for (const [key, animDef] of Object.entries(animMap)) {
      const result = validateAnimationDefinition(animDef, `Animation[${key}]`);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
