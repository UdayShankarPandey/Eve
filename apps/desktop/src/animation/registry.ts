import type {
  AnimationDefinition,
  AnimationManifest,
  ResolvedAnimation,
  ValidationResult,
} from "./types.ts";
import { validateAnimationDefinition, validateManifest } from "./validator.ts";
import { DEFAULT_ANIMATION_MANIFEST } from "./manifest.ts";

/**
 * Custom error thrown when an animation cannot be resolved even after fallback.
 */
export class AnimationResolutionError extends Error {
  public readonly requestedId: string;
  public readonly fallbackId: string;

  constructor(requestedId: string, fallbackId: string, message: string) {
    super(message);
    this.name = "AnimationResolutionError";
    this.requestedId = requestedId;
    this.fallbackId = fallbackId;
  }
}

/**
 * Centralized Animation Registry for managing, validating, and resolving animation definitions.
 */
export class AnimationRegistry {
  private readonly animations: Map<string, AnimationDefinition> = new Map();
  private defaultId: string;
  private manifestVersion: string;
  private characterStyle: string;

  constructor(manifest: AnimationManifest = DEFAULT_ANIMATION_MANIFEST) {
    this.defaultId = manifest.defaultAnimationId;
    this.manifestVersion = manifest.version;
    this.characterStyle = manifest.characterStyle;
    this.loadManifest(manifest);
  }

  /**
   * Returns the manifest version string.
   */
  public getManifestVersion(): string {
    return this.manifestVersion;
  }

  /**
   * Returns the current character style identifier.
   */
  public getCharacterStyle(): string {
    return this.characterStyle;
  }

  /**
   * Loads or reloads an AnimationManifest into the registry.
   */
  public loadManifest(manifest: AnimationManifest): ValidationResult {
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      console.warn(
        `[AnimationRegistry] Manifest validation encountered errors:\n${validation.errors.join("\n")}`
      );
    }

    this.animations.clear();
    this.defaultId = manifest.defaultAnimationId;
    this.manifestVersion = manifest.version;
    this.characterStyle = manifest.characterStyle;

    for (const [key, def] of Object.entries(manifest.animations)) {
      this.animations.set(key, def);
    }

    return validation;
  }

  /**
   * Registers or updates a single animation definition.
   */
  public register(definition: AnimationDefinition): ValidationResult {
    const validation = validateAnimationDefinition(definition, `Animation[${definition.id}]`);
    if (validation.valid) {
      this.animations.set(definition.id, definition);
    } else {
      console.warn(
        `[AnimationRegistry] Failed to register animation '${definition.id}':\n${validation.errors.join("\n")}`
      );
    }
    return validation;
  }

  /**
   * Checks if an animation ID exists in the registry.
   */
  public has(id: string): boolean {
    return this.animations.has(id);
  }

  /**
   * Retrieves an animation definition directly without fallback.
   */
  public get(id: string): AnimationDefinition | undefined {
    return this.animations.get(id);
  }

  /**
   * Returns all registered animation definitions.
   */
  public getAll(): AnimationDefinition[] {
    return Array.from(this.animations.values());
  }

  /**
   * Returns all registered animation IDs.
   */
  public getIds(): string[] {
    return Array.from(this.animations.keys());
  }

  /**
   * Gets the default animation ID.
   */
  public getDefaultId(): string {
    return this.defaultId;
  }

  /**
   * Sets the default animation ID.
   */
  public setDefaultId(id: string): void {
    this.defaultId = id;
  }

  /**
   * Safely resolves an animation by ID, applying fallback logic if not found or invalid.
   */
  public resolve(id: string): ResolvedAnimation {
    const requested = this.animations.get(id);

    // 1. Direct hit
    if (requested) {
      const validation = validateAnimationDefinition(requested, `Animation[${id}]`);
      if (validation.valid) {
        return {
          definition: requested,
          requestedId: id,
          resolvedFromFallback: false,
        };
      }
      // If requested definition is invalid, fall through to fallback
    }

    // 2. Custom fallback specified on the requested animation (if it existed but was invalid)
    const customFallbackId = requested?.fallbackId;
    if (customFallbackId && customFallbackId !== id && this.animations.has(customFallbackId)) {
      const customFallback = this.animations.get(customFallbackId)!;
      const customVal = validateAnimationDefinition(customFallback, `Animation[${customFallbackId}]`);
      if (customVal.valid) {
        return {
          definition: customFallback,
          requestedId: id,
          resolvedFromFallback: true,
          fallbackReason: requested
            ? `Requested animation '${id}' was invalid; resolved to custom fallback '${customFallbackId}'`
            : `Requested animation '${id}' was missing; resolved to custom fallback '${customFallbackId}'`,
        };
      }
    }

    // 3. Global default fallback (e.g. 'idle')
    const defaultFallback = this.animations.get(this.defaultId);
    if (defaultFallback) {
      const defaultVal = validateAnimationDefinition(defaultFallback, `Animation[${this.defaultId}]`);
      if (defaultVal.valid) {
        return {
          definition: defaultFallback,
          requestedId: id,
          resolvedFromFallback: true,
          fallbackReason: `Animation '${id}' not found or invalid; falling back to default '${this.defaultId}'`,
        };
      }
    }

    // 4. Critical failure: even the default fallback is missing or corrupt
    throw new AnimationResolutionError(
      id,
      this.defaultId,
      `[AnimationRegistry] Critical: Neither requested animation '${id}' nor default fallback '${this.defaultId}' could be resolved.`
    );
  }

  /**
   * Validates all definitions currently in the registry.
   */
  public validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (this.animations.size === 0) {
      errors.push("Registry is empty");
    }

    if (!this.animations.has(this.defaultId)) {
      errors.push(`Default fallback animation '${this.defaultId}' is not registered`);
    }

    for (const [id, def] of this.animations.entries()) {
      const res = validateAnimationDefinition(def, `Animation[${id}]`);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

/**
 * Singleton default registry instance for the application.
 */
export const globalAnimationRegistry = new AnimationRegistry(DEFAULT_ANIMATION_MANIFEST);
