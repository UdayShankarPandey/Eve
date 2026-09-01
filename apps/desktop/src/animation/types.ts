/**
 * Core Animation IDs required for PixelPal MVP and Sprint 2.
 */
export const AnimationIds = {
  IDLE: "idle",
  HAPPY: "happy",
  SAD: "sad",
  SLEEPY: "sleepy",
  WORRIED: "worried",
  SURPRISED: "surprised",
} as const;

export type CoreAnimationId = (typeof AnimationIds)[keyof typeof AnimationIds];
export type AnimationId = CoreAnimationId | (string & {});

/**
 * Playback loop modes.
 */
export type LoopMode = "loop" | "one-shot" | "ping-pong";

/**
 * Pixel dimensions for an individual frame.
 */
export interface FrameDimensions {
  width: number;
  height: number;
}

/**
 * Layout structure of the sprite asset.
 */
export type SpriteLayoutType = "strip-horizontal" | "strip-vertical" | "grid";

export interface SpriteLayout {
  type: SpriteLayoutType;
  columns?: number;
  rows?: number;
}

/**
 * Strongly typed animation metadata definition.
 */
export interface AnimationDefinition {
  /** Unique stable animation identifier (e.g. 'idle', 'happy') */
  id: AnimationId;
  /** Human-readable display name */
  name: string;
  /** Optional description for debugging and documentation */
  description?: string;
  /** Path or URL to the sprite sheet asset */
  assetPath: string;
  /** Total number of frames in the animation */
  frameCount: number;
  /** Dimensions of each frame in pixels */
  frameDimensions: FrameDimensions;
  /** Playback speed in frames per second */
  fps: number;
  /** Total duration in milliseconds for one full cycle */
  durationMs: number;
  /** Loop mode: 'loop' (repeats indefinitely) or 'one-shot' (plays once) */
  loopMode: LoopMode;
  /** Fallback animation ID if this asset fails to load (defaults to 'idle') */
  fallbackId?: AnimationId;
  /** Animation ID to transition to after a one-shot completes (typically 'idle') */
  transitionTo?: AnimationId;
  /** Optional layout details for sprite sheet positioning */
  layout?: SpriteLayout;
  /** Optional tags for filtering or emotional categorization */
  tags?: string[];
}

/**
 * Comprehensive animation manifest.
 */
export interface AnimationManifest {
  /** Schema version */
  version: string;
  /** Character or theme identifier */
  characterStyle: string;
  /** Default animation to fall back to when nothing else matches */
  defaultAnimationId: AnimationId;
  /** Base width for all character frames */
  frameWidth: number;
  /** Base height for all character frames */
  frameHeight: number;
  /** Map of animation definitions indexed by AnimationId */
  animations: Record<string, AnimationDefinition>;
}

/**
 * Validation result object.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Result of resolving an animation from registry.
 */
export interface ResolvedAnimation {
  definition: AnimationDefinition;
  requestedId: string;
  resolvedFromFallback: boolean;
  fallbackReason?: string;
}
