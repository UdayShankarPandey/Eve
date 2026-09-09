/**
 * PixelPal — Canonical Character Expression & Asset Registry
 * Sprint 7 Phase 3 Foundation
 *
 * Extends and integrates seamlessly with Sprint 2 animation contracts:
 * - Maps canonical expressions to AnimationDefinitions.
 * - Enforces FPS, frame dimensions, duration, and loop modes.
 * - Implements deterministic fallback mechanics without throwing uncaught exceptions.
 * - Provides round-trip JSON manifest serialization.
 */

import {
  AnimationRegistry,
  AnimationResolutionError,
} from "../animation/registry.ts";
import type {
  AnimationDefinition,
  AnimationManifest,
  ResolvedAnimation,
  ValidationResult,
} from "../animation/types.ts";
import type {
  CharacterExpressionId,
  ExpressionAssetRecord,
} from "./types.ts";
import {
  isValidExpressionId,
} from "./expression_prompt_builder.ts";

/**
 * Registry configuration options.
 */
export interface CharacterExpressionRegistryOptions {
  /** Character profile or theme identifier */
  readonly characterId: string;
  /** Default fallback expression (defaults to 'idle') */
  readonly defaultExpressionId?: CharacterExpressionId;
  /** Manifest version string */
  readonly version?: string;
  /** Initial manifest to preload */
  readonly manifest?: AnimationManifest;
}

/**
 * Centralized expression asset registry for companion characters.
 * Built directly on top of the Sprint 2 AnimationRegistry engine.
 */
export class CharacterExpressionRegistry {
  private readonly innerRegistry: AnimationRegistry;
  private readonly characterId: string;

  constructor(options: CharacterExpressionRegistryOptions) {
    this.characterId = options.characterId;
    const defaultId = options.defaultExpressionId ?? "idle";

    const baseManifest: AnimationManifest = options.manifest ?? {
      version: options.version ?? "1.0.0",
      characterStyle: `character-${this.characterId}`,
      defaultAnimationId: defaultId,
      frameWidth: 64,
      frameHeight: 64,
      animations: {},
    };

    this.innerRegistry = new AnimationRegistry(baseManifest);
  }

  /**
   * Registers an ExpressionAssetRecord into the animation registry.
   */
  public registerExpressionAsset(
    record: ExpressionAssetRecord,
    options: {
      readonly name?: string;
      readonly description?: string;
      readonly tags?: string[];
      readonly transitionTo?: string;
    } = {}
  ): ValidationResult {
    if (!isValidExpressionId(record.expression)) {
      return {
        valid: false,
        errors: [`Invalid canonical expression identifier: '${String(record.expression)}'`],
        warnings: [],
      };
    }

    const animDef: AnimationDefinition = {
      id: record.expression,
      name: options.name ?? `${record.expression.charAt(0).toUpperCase() + record.expression.slice(1)} Expression`,
      description: options.description ?? `Companion ${record.expression} state for ${this.characterId}`,
      assetPath: record.assetPath,
      frameCount: record.frameCount,
      frameDimensions: record.frameDimensions,
      fps: record.fps,
      durationMs: record.durationMs,
      loopMode: record.loopMode,
      fallbackId: record.fallbackExpressionId ?? "idle",
      transitionTo: options.transitionTo ?? (record.loopMode === "one-shot" ? "idle" : undefined),
      tags: options.tags ?? ["companion", "expression", record.expression],
    };

    return this.innerRegistry.register(animDef);
  }

  /**
   * Resolves an expression asset, returning the validated definition or safe fallback.
   * Never throws unhandled exceptions for missing or invalid expression requests.
   */
  public resolveExpression(expressionId: string): ResolvedAnimation {
    try {
      return this.innerRegistry.resolve(expressionId);
    } catch (err) {
      if (err instanceof AnimationResolutionError) {
        // Construct emergency safe fallback representation if even the default is unresolvable
        return {
          definition: {
            id: "idle",
            name: "Emergency Fallback Idle",
            assetPath: `/assets/sprites/${this.characterId}/idle.png`,
            frameCount: 1,
            frameDimensions: { width: 64, height: 64 },
            fps: 4,
            durationMs: 1000,
            loopMode: "loop",
          },
          requestedId: expressionId,
          resolvedFromFallback: true,
          fallbackReason: `Emergency fallback: ${err.message}`,
        };
      }
      throw err;
    }
  }

  /**
   * Checks if an expression is explicitly registered and valid.
   */
  public hasExpression(expressionId: string): boolean {
    return this.innerRegistry.has(expressionId);
  }

  /**
   * Returns all registered expression IDs.
   */
  public getRegisteredExpressions(): string[] {
    return this.innerRegistry.getIds();
  }

  /**
   * Returns all registered animation definitions.
   */
  public getAllDefinitions(): AnimationDefinition[] {
    return this.innerRegistry.getAll();
  }

  /**
   * Validates all definitions currently registered.
   */
  public validate(): ValidationResult {
    return this.innerRegistry.validate();
  }

  /**
   * Exports the current registry state as a standard AnimationManifest.
   */
  public exportManifest(): AnimationManifest {
    const animMap: Record<string, AnimationDefinition> = {};
    for (const def of this.innerRegistry.getAll()) {
      animMap[def.id] = def;
    }

    return {
      version: this.innerRegistry.getManifestVersion(),
      characterStyle: this.innerRegistry.getCharacterStyle(),
      defaultAnimationId: this.innerRegistry.getDefaultId(),
      frameWidth: 64,
      frameHeight: 64,
      animations: animMap,
    };
  }

  /**
   * Loads an existing AnimationManifest.
   */
  public loadManifest(manifest: AnimationManifest): ValidationResult {
    return this.innerRegistry.loadManifest(manifest);
  }

  /**
   * Serializes the registry to a formatted JSON string.
   */
  public toJSON(): string {
    return JSON.stringify(this.exportManifest(), null, 2);
  }

  /**
   * Recreates a CharacterExpressionRegistry from a serialized JSON manifest.
   */
  public static fromJSON(jsonStr: string, characterId: string): CharacterExpressionRegistry {
    const parsed = JSON.parse(jsonStr) as AnimationManifest;
    return new CharacterExpressionRegistry({
      characterId,
      manifest: parsed,
    });
  }
}
