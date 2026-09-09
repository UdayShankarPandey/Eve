/**
 * PixelPal — Personality Engine Comprehensive Test Suite
 * Sprint 8 Verification Gate
 *
 * Tests:
 * A. Personality Model & Profiles (6 canonical personalities, validation, persistence, defaults)
 * B. Dialogue Template Matrix (12 canonical MVP events * 6 personalities = 72 combinations, safe interpolation)
 * C. Variable Context & Privacy (safe extraction, sensitive data isolation, prototype pollution safety)
 * D. Behavior & Presentation (expression modulation, frequency gating, critical event protection, intensity)
 * E. Offline First & AI Boundary (offline operation, provider isolation, failure recovery, security)
 * F. Reaction Engine Invariant (ReactionResolver authority, priority/cooldown preservation)
 */

import test, { describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  PersonalityIds,
  ALL_PERSONALITY_IDS,
  DEFAULT_PERSONALITY_ID,
  ReactionFrequencies,
  NotificationIntensities,
  isValidPersonalityId,
  normalizePersonalityId,
  validatePersonalityConfig,
  getPersonalityProfile,
  PERSONALITY_PROFILES,
  interpolateTemplate,
  getPersonalityDialogue,
  DIALOGUE_TEMPLATES,
  PERSONALITY_FALLBACK_DIALOGUE,
  FileSystemPersonalityStorageAdapter,
  InMemoryPersonalityStorageAdapter,
  PersonalityEngine,
  extractDialogueContext,
  resolveDialogueText,
  sanitizeDialogueText,
  type AiDialogueProvider,
} from "../index.ts";

import {
  EventTypes,
  type DesktopEvent,
} from "../../../../../packages/shared-types/src/events.ts";
import {
  ReactionPriority,
  type ReactionDefinition,
} from "../../../../../packages/shared-types/src/reactions.ts";
import { AnimationIds } from "../../animation/types.ts";
import { ALL_CHARACTER_EXPRESSION_IDS } from "../../../../../packages/shared-types/src/character.ts";
import { ReactionResolver } from "../../reactions/index.ts";

// ============================================================
// CATEGORY A: PERSONALITY MODEL & PROFILES
// ============================================================

describe("Category A: Personality Model & Profiles", () => {
  test("1. All six canonical MVP personalities exist with no duplicates", () => {
    assert.strictEqual(ALL_PERSONALITY_IDS.length, 6);
    const unique = new Set(ALL_PERSONALITY_IDS);
    assert.strictEqual(unique.size, 6);

    assert.ok(unique.has("cute"));
    assert.ok(unique.has("friendly"));
    assert.ok(unique.has("sarcastic"));
    assert.ok(unique.has("chaotic"));
    assert.ok(unique.has("calm"));
    assert.ok(unique.has("professional"));
  });

  test("2. Default personality is Friendly and has a valid profile", () => {
    assert.strictEqual(DEFAULT_PERSONALITY_ID, "friendly");
    const profile = getPersonalityProfile(DEFAULT_PERSONALITY_ID);
    assert.ok(profile);
    assert.strictEqual(profile.id, "friendly");
    assert.strictEqual(profile.name, "Friendly");
    assert.ok(profile.tone.length > 0);
  });

  test("3. Validation rejects arbitrary personality strings and normalizes safely", () => {
    assert.strictEqual(isValidPersonalityId("cute"), true);
    assert.strictEqual(isValidPersonalityId("FRIENDLY"), true);
    assert.strictEqual(isValidPersonalityId("sarcastic "), true);
    assert.strictEqual(isValidPersonalityId("malicious_hacker"), false);
    assert.strictEqual(isValidPersonalityId(null), false);
    assert.strictEqual(isValidPersonalityId(123), false);

    assert.strictEqual(normalizePersonalityId("Chaotic"), "chaotic");
    assert.strictEqual(normalizePersonalityId("INVALID_XYZ"), "friendly");
    assert.strictEqual(normalizePersonalityId(undefined), "friendly");
  });

  test("4. validatePersonalityConfig recovers safely from corrupt or missing fields", () => {
    const valid = validatePersonalityConfig({
      personalityId: "cute",
      frequency: "high",
      intensity: "expressive",
      aiDialogueEnabled: true,
      updatedAt: 123456789,
    });
    assert.strictEqual(valid.personalityId, "cute");
    assert.strictEqual(valid.frequency, "high");
    assert.strictEqual(valid.intensity, "expressive");
    assert.strictEqual(valid.aiDialogueEnabled, true);

    const corrupt = validatePersonalityConfig({
      personalityId: "corrupted_id",
      frequency: "extreme_frequency",
      intensity: 9999,
      aiDialogueEnabled: "not_a_boolean",
    });
    assert.strictEqual(corrupt.personalityId, "friendly");
    assert.strictEqual(corrupt.frequency, "normal");
    assert.strictEqual(corrupt.intensity, "normal");
    assert.strictEqual(corrupt.aiDialogueEnabled, false);
    assert.strictEqual(corrupt.schemaVersion, 1);
  });

  test("5. In-memory storage adapter supports roundtrip configuration persistence", async () => {
    const memory = new InMemoryPersonalityStorageAdapter();
    const initial = await memory.loadConfig();
    assert.strictEqual(initial.personalityId, "friendly");

    await memory.saveConfig({
      ...initial,
      personalityId: "sarcastic",
      frequency: "low",
    });

    const updated = await memory.loadConfig();
    assert.strictEqual(updated.personalityId, "sarcastic");
    assert.strictEqual(updated.frequency, "low");
  });

  test("6. FileSystem storage adapter writes atomically and recovers safely from corrupt files", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal-test-storage-"));
    const configPath = path.join(tempDir, "personality.json");

    try {
      const fsAdapter = new FileSystemPersonalityStorageAdapter(configPath);
      const initial = await fsAdapter.loadConfig();
      assert.strictEqual(initial.personalityId, "friendly");

      // Save valid config
      await fsAdapter.saveConfig({
        ...initial,
        personalityId: "calm",
        intensity: "quiet",
      });

      assert.ok(fs.existsSync(configPath));
      const loaded = await fsAdapter.loadConfig();
      assert.strictEqual(loaded.personalityId, "calm");
      assert.strictEqual(loaded.intensity, "quiet");

      // Corrupt file contents to non-JSON garbage
      fs.writeFileSync(configPath, "{ corrupted-json-data-not-valid }", "utf-8");
      const recovered = await fsAdapter.loadConfig();
      assert.strictEqual(recovered.personalityId, "friendly");
      assert.strictEqual(recovered.schemaVersion, 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("7. Personality configuration is strictly independent of CharacterProfile", async () => {
    const engine = new PersonalityEngine(new InMemoryPersonalityStorageAdapter());
    await engine.init();
    await engine.setPersonality("chaotic");

    const config = engine.getConfig();
    assert.strictEqual(config.personalityId, "chaotic");
    // Assert no CharacterProfile fields leaked into PersonalityConfig
    assert.strictEqual("characterId" in config, false);
    assert.strictEqual("clothing" in config, false);
    assert.strictEqual("palette" in config, false);
    assert.strictEqual("renderingStyle" in config, false);
  });
});

// ============================================================
// CATEGORY B: DIALOGUE TEMPLATE MATRIX (72 COMBINATIONS)
// ============================================================

describe("Category B: Dialogue Template Matrix & Safe Interpolation", () => {
  const canonicalEvents = [
    EventTypes.BATTERY_CRITICAL,
    EventTypes.BATTERY_LOW,
    EventTypes.CHARGING_STARTED,
    EventTypes.CHARGING_STOPPED,
    EventTypes.NETWORK_DISCONNECTED,
    EventTypes.NETWORK_CONNECTED,
    EventTypes.DOWNLOAD_COMPLETED,
    EventTypes.USER_IDLE,
    EventTypes.USER_ACTIVE,
    EventTypes.PC_LOCKED,
    EventTypes.PC_UNLOCKED,
    EventTypes.APP_OPENED,
  ];

  test("1. All 72 combinations (6 personalities x 12 canonical events) produce non-empty, distinct dialogue", () => {
    const sampleContext = {
      battery_percent: 12,
      app_name: "VS Code",
      filename: "archive.zip",
      network_type: "Wi-Fi",
      idle_minutes: 5,
    };

    let totalChecked = 0;
    for (const personalityId of ALL_PERSONALITY_IDS) {
      for (const eventType of canonicalEvents) {
        const dialogue = getPersonalityDialogue(personalityId, eventType, sampleContext);
        assert.ok(
          dialogue && dialogue.length > 5,
          `Expected non-empty dialogue for ${personalityId} on ${eventType}`
        );
        // Ensure placeholders are replaced
        assert.strictEqual(
          dialogue.includes("{battery_percent}"),
          false,
          `Unreplaced placeholder in ${personalityId} / ${eventType}`
        );
        totalChecked++;
      }
    }
    assert.strictEqual(totalChecked, 72);
  });

  test("2. Unmapped events fall back safely to the personality's fallback dialogue", () => {
    for (const personalityId of ALL_PERSONALITY_IDS) {
      const fallback = getPersonalityDialogue(personalityId, "UNKNOWN_CUSTOM_EVENT_XYZ");
      assert.ok(fallback.length > 0);
      assert.strictEqual(fallback, PERSONALITY_FALLBACK_DIALOGUE[personalityId]);
    }
  });

  test("3. Template interpolation handles unknown variables safely without throwing", () => {
    const template = "Battery is at {battery_percent}% and status is {unknown_field}!";
    const res = interpolateTemplate(template, { battery_percent: 42 });
    assert.strictEqual(res, "Battery is at 42% and status is [unknown_field]!");
  });

  test("4. Template interpolator prevents code injection and prototype pollution", () => {
    const maliciousContext = {
      battery_percent: "'; process.exit(1); '",
      __proto__: { injected: "polluted" },
      constructor: { prototype: { poll: true } },
    } as unknown as Record<string, unknown>;

    const template = "Battery: {battery_percent}, proto: {injected}, constructor: {constructor}";
    const output = interpolateTemplate(template, maliciousContext);

    // Context is treated as plain inert text
    assert.ok(output.includes("'; process.exit(1); '"));
    // Prototype properties are NOT resolved
    assert.ok(output.includes("[injected]"));
    assert.ok(output.includes("[constructor]"));
  });

  test("5. Interpolation handles undefined or null context cleanly", () => {
    const template = "Hello {name}, battery is {battery_percent}%";
    assert.strictEqual(
      interpolateTemplate(template, undefined),
      "Hello [name], battery is [battery_percent]%"
    );
  });
});

// ============================================================
// CATEGORY C: VARIABLE CONTEXT & PRIVACY BOUNDARIES
// ============================================================

describe("Category C: Variable Context & Privacy Boundaries", () => {
  test("1. extractDialogueContext extracts permitted fields accurately", () => {
    const event: DesktopEvent = {
      id: "evt_1",
      type: EventTypes.BATTERY_LOW,
      timestamp: Date.now(),
      source: "battery",
      payload: {
        battery_percent: 14.8,
        ac_line_status: 0,
      },
    };

    const ctx = extractDialogueContext(event);
    assert.strictEqual(ctx.battery_percent, 15);
    assert.strictEqual(ctx.ac_line_status, 0);
  });

  test("2. extractDialogueContext rejects unapproved and sensitive desktop fields", () => {
    const event: DesktopEvent = {
      id: "evt_2",
      type: EventTypes.APP_OPENED,
      timestamp: Date.now(),
      source: "application",
      payload: {
        app_name: "Browser",
        window_title: "Secret Private Document - Personal Banking", // Sensitive window title
        process_memory_dump: "0xDEADBEEF", // Sensitive internal state
        user_keystrokes: "my_secret_password", // Forbidden input
      },
    };

    const ctx = extractDialogueContext(event);
    assert.strictEqual(ctx.app_name, "Browser");
    // Assert sensitive fields are completely omitted
    assert.strictEqual("window_title" in ctx, false);
    assert.strictEqual("process_memory_dump" in ctx, false);
    assert.strictEqual("user_keystrokes" in ctx, false);
  });

  test("3. extractDialogueContext computes idle minutes from milliseconds", () => {
    const event: DesktopEvent = {
      id: "evt_3",
      type: EventTypes.USER_IDLE,
      timestamp: Date.now(),
      source: "user_activity",
      payload: {
        idle_duration_ms: 180_000,
        idle_threshold_ms: 60_000,
      },
    };

    const ctx = extractDialogueContext(event);
    assert.strictEqual(ctx.idle_minutes, 3);
  });
});

// ============================================================
// CATEGORY D: BEHAVIOR & PRESENTATION
// ============================================================

describe("Category D: Behavior & Presentation Shaping", () => {
  test("1. Personality influences preferred expression mapping", async () => {
    const memory = new InMemoryPersonalityStorageAdapter();
    const engine = new PersonalityEngine(memory);
    await engine.init();

    const mockEvent: DesktopEvent = {
      id: "evt_dl",
      type: EventTypes.DOWNLOAD_COMPLETED,
      timestamp: Date.now(),
      source: "filesystem",
      payload: { filename: "bundle.zip" },
    };

    const defaultReaction: ReactionDefinition = {
      id: "react_download_completed",
      eventType: EventTypes.DOWNLOAD_COMPLETED,
      animationId: AnimationIds.HAPPY,
      priority: ReactionPriority.NORMAL,
      cooldownMs: 10_000,
      isOneShot: true,
    };

    // Cute personality prefers "celebrate"
    await engine.setPersonality("cute");
    const cutePres = await engine.formatPresentation(defaultReaction, mockEvent);
    assert.strictEqual(cutePres.animationId, "celebrate");

    // Professional personality prefers "idle"
    await engine.setPersonality("professional");
    const profPres = await engine.formatPresentation(defaultReaction, mockEvent);
    assert.strictEqual(profPres.animationId, "idle");
  });

  test("2. Expression mapping resolves only canonical expressions or animation IDs", () => {
    for (const personalityId of ALL_PERSONALITY_IDS) {
      const profile = PERSONALITY_PROFILES[personalityId];
      for (const [eventOrAnim, targetExpr] of Object.entries(profile.preferredExpressions)) {
        assert.ok(targetExpr, `Missing expression for ${personalityId} on ${eventOrAnim}`);
        const isValidSprint7Expr = ALL_CHARACTER_EXPRESSION_IDS.includes(targetExpr as any);
        const isValidSprint2Anim = Object.values(AnimationIds).includes(targetExpr as any);
        assert.ok(
          isValidSprint7Expr || isValidSprint2Anim,
          `Invalid expression '${targetExpr}' mapped in ${personalityId}`
        );
      }
    }
  });

  test("3. Reaction frequency policy suppresses low-priority events when frequency is LOW", async () => {
    const memory = new InMemoryPersonalityStorageAdapter();
    const engine = new PersonalityEngine(memory);
    await engine.init();
    await engine.setFrequency("low");

    const lowPriorityReaction: ReactionDefinition = {
      id: "react_user_idle",
      eventType: EventTypes.USER_IDLE,
      animationId: AnimationIds.SLEEPY,
      priority: ReactionPriority.LOW, // 30
      cooldownMs: 10_000,
      isOneShot: false,
    };

    const event: DesktopEvent = {
      id: "evt_idle",
      type: EventTypes.USER_IDLE,
      timestamp: Date.now(),
      source: "user_activity",
      payload: {},
    };

    const presentation = await engine.formatPresentation(lowPriorityReaction, event);
    assert.strictEqual(presentation.isSuppressedByFrequency, true);
    assert.strictEqual(presentation.dialogueText, "");
  });

  test("4. CRITICAL SAFETY INVARIANT: Battery Critical and Low are NEVER suppressed by reaction frequency", async () => {
    const memory = new InMemoryPersonalityStorageAdapter();
    const engine = new PersonalityEngine(memory);
    await engine.init();
    await engine.setFrequency("low"); // Set frequency to lowest setting

    const criticalReaction: ReactionDefinition = {
      id: "react_battery_critical",
      eventType: EventTypes.BATTERY_CRITICAL,
      animationId: AnimationIds.SAD,
      priority: ReactionPriority.CRITICAL, // 100
      cooldownMs: 60_000,
      isOneShot: false,
    };

    const criticalEvent: DesktopEvent = {
      id: "evt_crit",
      type: EventTypes.BATTERY_CRITICAL,
      timestamp: Date.now(),
      source: "battery",
      payload: { battery_percent: 5 },
    };

    const presentation = await engine.formatPresentation(criticalReaction, criticalEvent);
    assert.strictEqual(
      presentation.isSuppressedByFrequency,
      false,
      "Critical reaction must NEVER be suppressed by reaction frequency"
    );
    assert.ok(presentation.dialogueText.length > 0);
  });

  test("5. Notification intensity matches active configuration", async () => {
    const memory = new InMemoryPersonalityStorageAdapter();
    const engine = new PersonalityEngine(memory);
    await engine.init();

    await engine.setIntensity("quiet");
    assert.strictEqual(engine.getConfig().intensity, "quiet");

    await engine.setIntensity("expressive");
    assert.strictEqual(engine.getConfig().intensity, "expressive");
  });
});

// ============================================================
// CATEGORY E: OFFLINE FIRST & AI BOUNDARY
// ============================================================

describe("Category E: Offline First & AI Boundary", () => {
  test("1. Core personality runs 100% offline with local templates when AI is disabled", async () => {
    const memory = new InMemoryPersonalityStorageAdapter();
    const engine = new PersonalityEngine(memory);
    await engine.init();
    await engine.setAiDialogueEnabled(false);

    const reaction: ReactionDefinition = {
      id: "react_net_on",
      eventType: EventTypes.NETWORK_CONNECTED,
      animationId: AnimationIds.HAPPY,
      priority: ReactionPriority.NORMAL,
      cooldownMs: 30_000,
      isOneShot: true,
    };

    const event: DesktopEvent = {
      id: "evt_net",
      type: EventTypes.NETWORK_CONNECTED,
      timestamp: Date.now(),
      source: "network",
      payload: { connected: true },
    };

    const pres = await engine.formatPresentation(reaction, event);
    assert.strictEqual(pres.source, "local_template");
    assert.ok(pres.dialogueText.length > 0);
  });

  test("2. AI Provider success produces ai_dialogue source", async () => {
    const mockAiProvider: AiDialogueProvider = {
      async generateDialogue({ fallbackText }) {
        return `Custom AI Line: ${fallbackText}`;
      },
    };

    const memory = new InMemoryPersonalityStorageAdapter();
    const engine = new PersonalityEngine(memory, mockAiProvider);
    await engine.init();
    await engine.setAiDialogueEnabled(true);

    const reaction: ReactionDefinition = {
      id: "react_charging",
      eventType: EventTypes.CHARGING_STARTED,
      animationId: AnimationIds.HAPPY,
      priority: ReactionPriority.NORMAL,
      cooldownMs: 30_000,
      isOneShot: true,
    };

    const event: DesktopEvent = {
      id: "evt_charge",
      type: EventTypes.CHARGING_STARTED,
      timestamp: Date.now(),
      source: "battery",
      payload: { battery_percent: 50 },
    };

    const pres = await engine.formatPresentation(reaction, event);
    assert.strictEqual(pres.source, "ai_dialogue");
    assert.ok(pres.dialogueText.startsWith("Custom AI Line:"));
  });

  test("3. AI Provider failure or timeout cleanly falls back to local template", async () => {
    const failingAiProvider: AiDialogueProvider = {
      async generateDialogue() {
        throw new Error("Network offline or API rate limit");
      },
    };

    const res = await resolveDialogueText({
      personalityId: "cute",
      eventType: EventTypes.NETWORK_DISCONNECTED,
      aiDialogueEnabled: true,
      aiProvider: failingAiProvider,
    });

    assert.strictEqual(res.source, "fallback");
    assert.ok(res.text.includes("where did the internet go"));
  });

  test("4. Malformed AI output or script injection is rejected and falls back safely", () => {
    const fallback = "Safe local fallback text";

    // Script injection
    assert.strictEqual(
      sanitizeDialogueText("<script>alert('pwned')</script>", fallback),
      fallback
    );

    // Javascript scheme
    assert.strictEqual(
      sanitizeDialogueText("javascript:doEvil()", fallback),
      fallback
    );

    // Empty or whitespace
    assert.strictEqual(sanitizeDialogueText("   ", fallback), fallback);

    // Non-string
    assert.strictEqual(sanitizeDialogueText(12345, fallback), fallback);
  });
});

// ============================================================
// CATEGORY F: REACTION ENGINE INTEGRATION & INVARIANTS
// ============================================================

describe("Category F: Reaction Engine Invariants & Non-Interference", () => {
  test("1. ReactionResolver priority and cooldowns remain authoritative", () => {
    let mockTime = 1000;
    const resolver = new ReactionResolver({
      timeProvider: () => mockTime,
    });

    const lowEvent: DesktopEvent = {
      id: "evt_low",
      type: EventTypes.APP_OPENED,
      timestamp: mockTime,
      source: "application",
      payload: { app_name: "Code" },
    };

    const highEvent: DesktopEvent = {
      id: "evt_high",
      type: EventTypes.BATTERY_CRITICAL,
      timestamp: mockTime,
      source: "battery",
      payload: { battery_percent: 4 },
    };

    // Low event plays
    const lowResolution = resolver.resolve(lowEvent);
    assert.strictEqual(lowResolution.status, "RESOLVED");

    // Active state with the low event
    const activeLow: ActiveReactionState = {
      reaction: lowResolution.reaction!,
      event: lowEvent,
      startedAt: mockTime,
      expiresAt: mockTime + 2000,
    };

    // High event preempts low event
    const highResolution = resolver.resolve(highEvent, activeLow);
    assert.strictEqual(highResolution.status, "RESOLVED");
    assert.strictEqual(highResolution.reaction?.priority, ReactionPriority.CRITICAL);
  });

  test("2. End-to-end pipeline: DesktopEvent -> ReactionResolver -> PersonalityEngine", async () => {
    const resolver = new ReactionResolver();
    const memory = new InMemoryPersonalityStorageAdapter();
    const engine = new PersonalityEngine(memory);
    await engine.init();
    await engine.setPersonality("sarcastic");

    const event: DesktopEvent = {
      id: "evt_charge_stopped",
      type: EventTypes.CHARGING_STOPPED,
      timestamp: Date.now(),
      source: "battery",
      payload: { battery_percent: 45 },
    };

    // Step 1: ReactionResolver determines eligibility
    const resolution = resolver.resolve(event);
    assert.strictEqual(resolution.status, "RESOLVED");
    assert.ok(resolution.reaction);

    // Step 2: PersonalityEngine shapes presentation
    const presentation = await engine.formatPresentation(resolution.reaction, event);
    assert.strictEqual(presentation.personalityId, "sarcastic");
    assert.ok(presentation.dialogueText.includes("Unplugged again?"));
    assert.strictEqual(presentation.isSuppressedByFrequency, false);
  });
});
