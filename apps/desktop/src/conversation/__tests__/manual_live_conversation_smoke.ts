/**
 * PixelPal — Manual Live OpenAI Conversation Smoke Test
 * Sprint 9 Opt-in Verification
 *
 * Usage:
 *   npx tsx src/conversation/__tests__/manual_live_conversation_smoke.ts
 *
 * Rules:
 * - Requires OPENAI_API_KEY environment variable.
 * - If key is missing, skips cleanly without failing.
 * - Never prints or leaks the API key.
 * - Excluded from automated npm test runs (does not match *.test.ts).
 */

import { PersonalityIds } from "../../../../../packages/shared-types/src/personality.ts";
import {
  OpenAIConversationLlmProvider,
  ConversationManager,
} from "../index.ts";

async function runLiveSmokeTest(): Promise<void> {
  console.log("=== PIXELPAL SPRINT 9 — MANUAL LIVE CONVERSATION SMOKE TEST ===");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.log("[SKIPPED] OPENAI_API_KEY is not set in environment.");
    console.log("To run live verification, set OPENAI_API_KEY and run:");
    console.log("  npx tsx src/conversation/__tests__/manual_live_conversation_smoke.ts");
    process.exit(0);
  }

  console.log("[INFO] OPENAI_API_KEY detected. Initializing OpenAIConversationLlmProvider...");

  try {
    const provider = new OpenAIConversationLlmProvider({
      apiKey,
      timeoutMs: 5000,
    });

    const manager = new ConversationManager({
      provider,
      getPersonalityId: () => PersonalityIds.FRIENDLY,
    });

    await manager.init();

    console.log("[INFO] Sending test message: 'Hello! I am testing our new conversation system.'");
    const response = await manager.sendMessage("Hello! I am testing our new conversation system.");

    console.log("\n--- RESULT ---");
    console.log(`Source:     ${response.source}`);
    console.log(`Expression: ${response.expressionId}`);
    console.log(`Intensity:  ${response.notificationIntensity}`);
    console.log(`Reply:      "${response.replyText}"`);

    if (response.source === "llm") {
      console.log("\n[SUCCESS] Live conversation smoke test passed!");
    } else {
      console.warn(`\n[WARNING] Response returned from fallback. Reason: ${response.fallbackReason}`);
    }
  } catch (err) {
    console.error("\n[ERROR] Live conversation smoke test failed:", err);
    process.exit(1);
  }
}

runLiveSmokeTest().catch((err) => {
  console.error("[FATAL] Live smoke test crashed:", err);
  process.exit(1);
});
