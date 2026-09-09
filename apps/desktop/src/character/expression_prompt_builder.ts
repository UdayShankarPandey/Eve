/**
 * PixelPal — Controlled AI Expression Prompt Builder
 * Sprint 7 Phase 1 Foundation
 *
 * Constructs deterministic, injection-immune generation prompts for companion
 * expressions derived strictly from a canonical CharacterProfile.
 *
 * Ensures all nine MVP expressions maintain character identity (hairstyle,
 * clothing, palette, proportions, silhouette) while modulating facial and
 * postural emotional presentation.
 */

import type {
  CharacterExpressionId,
  CharacterProfile,
  ExpressionGenerationContract,
} from "./types.ts";
import { ALL_CHARACTER_EXPRESSION_IDS } from "./types.ts";

/**
 * Validates whether an unknown value is a valid canonical CharacterExpressionId.
 */
export function isValidExpressionId(id: unknown): id is CharacterExpressionId {
  return typeof id === "string" && (ALL_CHARACTER_EXPRESSION_IDS as readonly string[]).includes(id);
}

/**
 * Predefined expression directives for the nine MVP expressions.
 */
export const EXPRESSION_DIRECTIVES: Record<CharacterExpressionId, string> = {
  idle:
    "Expression & Mood: Calm, resting, neutral-friendly idle demeanor with soft smiling eyes and relaxed companion posture.",
  happy:
    "Expression & Mood: Joyful, radiant smile with vibrant curved happy eyes, upbeat cheerful personality, and lively presence.",
  sad:
    "Expression & Mood: Visibly downcast, sorrowful expression with gently lowered eyebrows, drooping mouth, and quiet melancholy.",
  worried:
    "Expression & Mood: Anxious concerned expression with furrowed brow, wide apprehensive eyes, and nervous hesitant posture.",
  sleepy:
    "Expression & Mood: Tired peaceful expression with closed or half-lidded resting eyes, gentle relaxed posture, and drowsy calm.",
  surprised:
    "Expression & Mood: Astonished startled expression with wide circular eyes, open mouth, and dynamic sudden alertness.",
  panic:
    "Expression & Mood: High-distress alarmed expression with wide frantic eyes, distressed reaction, and urgent startled posture.",
  celebrate:
    "Expression & Mood: Triumphant ecstatic celebration with beaming joyful grin, animated pose, and exuberant cheering victory aura.",
  thinking:
    "Expression & Mood: Deeply contemplative, pensive expression with hand toward chin or cheek, focused observant eyes, and thoughtful stance.",
};

/**
 * Result of expression prompt construction.
 */
export interface ExpressionPromptBuildResult {
  readonly prompt: string;
  readonly contract: ExpressionGenerationContract;
}

/**
 * Builds a deterministic, injection-immune prompt for a specific companion expression.
 *
 * Identity Invariants:
 * - Anchors to the provided CharacterProfile as the sole authority.
 * - Enforces identical hairstyle, clothing, palette colors, and proportions.
 * - Forbids arbitrary user-supplied strings or raw filesystem paths.
 */
export function buildExpressionPrompt(
  profile: CharacterProfile,
  expression: CharacterExpressionId
): ExpressionPromptBuildResult {
  if (!isValidExpressionId(expression)) {
    throw new Error(`[ExpressionPromptBuilder] Invalid expression identifier: '${String(expression)}'`);
  }

  const { style, clothing, palette } = profile;

  // Build structured clothing description from closed enums
  const accessoriesDesc =
    clothing.accessories && clothing.accessories.length > 0
      ? `Accessories: ${clothing.accessories.join(", ")}.`
      : "No extra accessories.";

  const clothingSummary = [
    `Category: ${clothing.category}`,
    `Top: ${clothing.top}`,
    `Bottom: ${clothing.bottom}`,
    `Footwear: ${clothing.footwear}`,
    accessoriesDesc,
    `Color Harmony: ${clothing.colorTheme}`,
  ].join("; ");

  // Build structured palette constraints
  const paletteSummary = [
    `Mood: ${palette.mood}`,
    `Max Opaque Colors: ${palette.maxOpaqueColors}`,
    palette.colors.length > 0
      ? `Key Palette Hex Hues: ${palette.colors.slice(0, 8).map((c) => `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`).join(", ")}`
      : "Preserve reference image palette",
  ].join("; ");

  const sections: string[] = [
    // 1. Core Mission & Strict Identity Binding
    `Generate an alternate emotional expression variation for the companion character (${profile.characterId}).`,
    "CRITICAL IDENTITY REQUIREMENT: The character must remain the EXACT SAME individual depicted in the reference image. Preserve identical hairstyle, hair color, skin tone, eye color, facial features, body proportions, and outfit.",

    // 2. Target Expression Directive
    `TARGET EMOTION [${expression.toUpperCase()}]:`,
    EXPRESSION_DIRECTIVES[expression],

    // 3. Inherited Profile Aesthetic & Proportions
    "Inherited Character Specifications:",
    `- Rendering Aesthetic: ${style.renderingStyle ?? "chibi-pixel-art"}`,
    `- Body Proportions: ${style.proportions ?? "super-deformed"} (maintain exact same head-to-body ratio)`,
    `- Attire Constraints: ${clothingSummary}`,
    `- Palette Constraints: ${paletteSummary}`,

    // 4. Composition & Negative Constraints
    "Composition & Negative Constraints:",
    "- Maintain exact same camera distance, framing, and orientation as the reference base.",
    "- Single character only, centered in canvas, isolated on a pure flat solid white background (#FFFFFF).",
    "- Crisp clean silhouette with zero shadows and zero ground planes, perfectly suited for alpha transparency.",
    "- Absolutely NO text, NO speech bubbles, NO words, NO letters, NO watermarks.",
    "- Absolutely NO UI elements, NO windows, NO extra characters or background scenery.",
    "- The character must remain a 2D digital illustration/pixel sprite.",
  ];

  const prompt = sections.join("\n\n");

  const contract: ExpressionGenerationContract = {
    characterId: profile.characterId,
    expression,
    renderingStyle: style.renderingStyle ?? "chibi-pixel-art",
    proportions: style.proportions ?? "super-deformed",
    clothing,
    palette,
    frameDimensions: { width: 64, height: 64 },
    prompt,
  };

  return { prompt, contract };
}
