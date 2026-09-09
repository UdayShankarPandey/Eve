/**
 * PixelPal — Controlled AI Character Prompt Builder
 * Sprint 6 Phase 3 Foundation
 *
 * Constructs deterministic, injection-immune generation prompts from strictly
 * typed style options. Completely prevents arbitrary user string injection,
 * path leakage, and metadata disclosure.
 */

import type {
  BackgroundIntent,
  CharacterExpression,
  CharacterRenderingStyle,
  CharacterStyleOptions,
  ChibiProportions,
  DetailLevel,
  PaletteMood,
} from "./types.ts";

/**
 * Authoritative default style configuration for character generation.
 */
export const DEFAULT_CHARACTER_STYLE: Required<CharacterStyleOptions> = {
  renderingStyle: "chibi-pixel-art",
  proportions: "super-deformed",
  expression: "friendly-idle",
  paletteMood: "original-fidelity",
  detailLevel: "high-fidelity",
  backgroundIntent: "transparent-ready",
};

/**
 * Predefined instructional directives mapped from strongly typed rendering styles.
 */
const RENDERING_STYLE_DIRECTIVES: Record<CharacterRenderingStyle, string> = {
  "chibi-pixel-art":
    "Render as a clean, high-precision chibi pixel-art character portrait with crisp outlines and readable silhouette.",
  "retro-arcade":
    "Render in a vibrant 90s retro arcade character aesthetic with bold outlining and expressive sprites.",
  "modern-isometric":
    "Render as a polished modern mascot with subtle depth and isometric-ready sprite framing.",
  "classic-16bit":
    "Render in a classic 16-bit JRPG sprite portrait visual style with nostalgic color clusters.",
};

/**
 * Predefined anatomical proportion directives.
 */
const PROPORTION_DIRECTIVES: Record<ChibiProportions, string> = {
  "super-deformed":
    "Anatomy: Classic 2-head-tall super-deformed chibi proportions, featuring an oversized expressive head, large anime-inspired eyes, and a cute compact body.",
  "subtle-chibi":
    "Anatomy: Mild 3-head-tall stylized chibi proportions balancing recognizable human features with playful mascot styling.",
  "standard-mascot":
    "Anatomy: Stylized 2.5-head-tall companion mascot anatomy optimized for expressive desktop reactions.",
};

/**
 * Predefined expression directives.
 */
const EXPRESSION_DIRECTIVES: Record<CharacterExpression, string> = {
  "friendly-idle":
    "Expression & Mood: Calm, welcoming, neutral-friendly idle demeanor with soft smiling eyes.",
  happy:
    "Expression & Mood: Joyful, cheerful, radiant smile with vibrant animated personality.",
  curious:
    "Expression & Mood: Inquisitive head tilt, wide observant eyes, and engaging personality.",
  focused:
    "Expression & Mood: Determined, thoughtful gaze showing attentive companion presence.",
  confident:
    "Expression & Mood: Self-assured, playful grin with lively character posture.",
};

/**
 * Predefined palette mood directives.
 */
const PALETTE_MOOD_DIRECTIVES: Record<PaletteMood, string> = {
  "original-fidelity":
    "Color Palette: Strictly preserve the subject's original hair color, skin tone, eye color, and clothing hues from the reference photo.",
  vibrant:
    "Color Palette: Saturated, lively anime color palette while keeping core subject recognizability.",
  pastel:
    "Color Palette: Soft, soothing pastel aesthetic with gentle tonal transitions.",
  warm:
    "Color Palette: Warm cozy color grading emphasizing amber, peach, and friendly highlights.",
  cool:
    "Color Palette: Cool tranquil color grading with gentle blue, violet, and crisp accents.",
};

/**
 * Predefined detail level directives.
 */
const DETAIL_LEVEL_DIRECTIVES: Record<DetailLevel, string> = {
  "high-fidelity":
    "Detail Fidelity: Preserve recognizable accessories, hairstyle nuances, glasses, and clothing patterns accurately.",
  "simplified-iconic":
    "Detail Fidelity: Streamline intricate clothing into bold, iconic, readable character shapes.",
};

/**
 * Predefined background framing directives.
 */
const BACKGROUND_INTENT_DIRECTIVES: Record<BackgroundIntent, string> = {
  "transparent-ready":
    "Background & Framing: Pure solid flat white background (#FFFFFF) with zero shadows, zero floor gradients, perfectly suited for alpha transparency extraction.",
  "solid-white":
    "Background & Framing: Clean studio seamless white backdrop with isolated character silhouette.",
  "minimal-backdrop":
    "Background & Framing: Subtle uniform backdrop isolating the character subject with zero clutter.",
};

/**
 * Result of prompt construction.
 */
export interface CharacterPromptBuildResult {
  readonly prompt: string;
  readonly styleApplied: Required<CharacterStyleOptions>;
}

/**
 * Builds a deterministic, injection-proof instructional prompt for base character generation.
 *
 * Strict security guarantees:
 * - Uses ONLY hardcoded instructional templates.
 * - Resolves ONLY through typed union maps.
 * - Never includes filenames, storage IDs, filesystem paths, or EXIF metadata.
 * - Completely immune to prompt injection attacks.
 */
export function buildCharacterPrompt(
  style?: CharacterStyleOptions
): CharacterPromptBuildResult {
  const styleApplied: Required<CharacterStyleOptions> = {
    renderingStyle: style?.renderingStyle ?? DEFAULT_CHARACTER_STYLE.renderingStyle,
    proportions: style?.proportions ?? DEFAULT_CHARACTER_STYLE.proportions,
    expression: style?.expression ?? DEFAULT_CHARACTER_STYLE.expression,
    paletteMood: style?.paletteMood ?? DEFAULT_CHARACTER_STYLE.paletteMood,
    detailLevel: style?.detailLevel ?? DEFAULT_CHARACTER_STYLE.detailLevel,
    backgroundIntent: style?.backgroundIntent ?? DEFAULT_CHARACTER_STYLE.backgroundIntent,
  };

  const sections: string[] = [
    // 1. Core Mission & Identity Preservation
    "Generate a personalized base companion character portrait based on the provided reference subject image.",
    "The character must clearly maintain the subject's key visual identity including hairstyle, facial structure, skin tone, eye shape, and clothing style.",

    // 2. Controlled Aesthetic & Proportion Directives
    RENDERING_STYLE_DIRECTIVES[styleApplied.renderingStyle],
    PROPORTION_DIRECTIVES[styleApplied.proportions],
    EXPRESSION_DIRECTIVES[styleApplied.expression],
    PALETTE_MOOD_DIRECTIVES[styleApplied.paletteMood],
    DETAIL_LEVEL_DIRECTIVES[styleApplied.detailLevel],
    BACKGROUND_INTENT_DIRECTIVES[styleApplied.backgroundIntent],

    // 3. Strict Negative & Boundary Constraints
    "Composition & Negative Constraints:",
    "- Single character only, centered in frame, front-facing or slight three-quarter view.",
    "- Full upper body / bust portrait framing with space around the character.",
    "- Absolutely NO text, NO speech bubbles, NO words, NO letters, NO watermarks.",
    "- Absolutely NO UI elements, NO windows, NO buttons, NO desktop frames.",
    "- Absolutely NO complex scenery, NO photorealistic clutter, NO extra people.",
    "- The subject must be an artistic 2D digital illustration/sprite, not a 3D clay or realistic render.",
  ];

  const prompt = sections.join("\n\n");
  return { prompt, styleApplied };
}
