import type { AnimationDefinition, AnimationManifest } from "./types.ts";
import { AnimationIds } from "./types.ts";

/**
 * Standard frame dimensions for placeholder chibi/pixel characters.
 */
export const DEFAULT_FRAME_DIMENSIONS = {
  width: 64,
  height: 64,
} as const;

/**
 * Baseline Core 6 Animation Definitions for PixelPal Sprint 2.
 */
export const CORE_ANIMATIONS: Record<string, AnimationDefinition> = {
  [AnimationIds.IDLE]: {
    id: AnimationIds.IDLE,
    name: "Idle",
    description: "Default ambient breathing and standing animation",
    assetPath: "/assets/sprites/placeholder/idle.svg",
    frameCount: 4,
    frameDimensions: DEFAULT_FRAME_DIMENSIONS,
    fps: 4,
    durationMs: 1000,
    loopMode: "loop",
    fallbackId: AnimationIds.IDLE,
    layout: { type: "strip-horizontal", columns: 4, rows: 1 },
    tags: ["default", "ambient", "neutral"],
  },
  [AnimationIds.HAPPY]: {
    id: AnimationIds.HAPPY,
    name: "Happy",
    description: "Bouncing and smiling celebration animation",
    assetPath: "/assets/sprites/placeholder/happy.svg",
    frameCount: 4,
    frameDimensions: DEFAULT_FRAME_DIMENSIONS,
    fps: 6,
    durationMs: 667,
    loopMode: "loop",
    fallbackId: AnimationIds.IDLE,
    layout: { type: "strip-horizontal", columns: 4, rows: 1 },
    tags: ["positive", "reaction", "charging"],
  },
  [AnimationIds.SAD]: {
    id: AnimationIds.SAD,
    name: "Sad",
    description: "Drooping posture and downcast expression",
    assetPath: "/assets/sprites/placeholder/sad.svg",
    frameCount: 4,
    frameDimensions: DEFAULT_FRAME_DIMENSIONS,
    fps: 3,
    durationMs: 1333,
    loopMode: "loop",
    fallbackId: AnimationIds.IDLE,
    layout: { type: "strip-horizontal", columns: 4, rows: 1 },
    tags: ["negative", "reaction", "file-deleted"],
  },
  [AnimationIds.SLEEPY]: {
    id: AnimationIds.SLEEPY,
    name: "Sleepy",
    description: "Gentle breathing with eyes closed and rising sleep bubbles",
    assetPath: "/assets/sprites/placeholder/sleepy.svg",
    frameCount: 4,
    frameDimensions: DEFAULT_FRAME_DIMENSIONS,
    fps: 2,
    durationMs: 2000,
    loopMode: "loop",
    fallbackId: AnimationIds.IDLE,
    layout: { type: "strip-horizontal", columns: 4, rows: 1 },
    tags: ["idle-state", "sleepy", "screen-time"],
  },
  [AnimationIds.WORRIED]: {
    id: AnimationIds.WORRIED,
    name: "Worried",
    description: "Nervous glance and sweat drop one-shot reaction",
    assetPath: "/assets/sprites/placeholder/worried.svg",
    frameCount: 4,
    frameDimensions: DEFAULT_FRAME_DIMENSIONS,
    fps: 5,
    durationMs: 800,
    loopMode: "one-shot",
    fallbackId: AnimationIds.IDLE,
    transitionTo: AnimationIds.IDLE,
    layout: { type: "strip-horizontal", columns: 4, rows: 1 },
    tags: ["warning", "battery-low", "reaction"],
  },
  [AnimationIds.SURPRISED]: {
    id: AnimationIds.SURPRISED,
    name: "Surprised",
    description: "Startled hop with exclamation mark reaction",
    assetPath: "/assets/sprites/placeholder/surprised.svg",
    frameCount: 4,
    frameDimensions: DEFAULT_FRAME_DIMENSIONS,
    fps: 6,
    durationMs: 667,
    loopMode: "one-shot",
    fallbackId: AnimationIds.IDLE,
    transitionTo: AnimationIds.IDLE,
    layout: { type: "strip-horizontal", columns: 4, rows: 1 },
    tags: ["alert", "wake-up", "reaction"],
  },
};

/**
 * Default Animation Manifest for PixelPal Sprint 2.
 */
export const DEFAULT_ANIMATION_MANIFEST: AnimationManifest = {
  version: "1.0.0",
  characterStyle: "chibi-pixel-placeholder",
  defaultAnimationId: AnimationIds.IDLE,
  frameWidth: DEFAULT_FRAME_DIMENSIONS.width,
  frameHeight: DEFAULT_FRAME_DIMENSIONS.height,
  animations: CORE_ANIMATIONS,
};
