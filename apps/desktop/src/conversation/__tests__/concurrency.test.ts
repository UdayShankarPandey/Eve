/**
 * PixelPal — Conversation Concurrency & Lifecycle Resilience Tests
 * Sprint 11 Phase 4: CONV-01 Verification
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  ConversationManager,
  MockConversationLlmProvider,
  InMemoryConversationStorageAdapter,
  ConversationLlmError,
} from "../index.ts";
import { PermissionManager, InMemoryPermissionStorageAdapter } from "../../privacy/index.ts";
import { PermissionIds } from "../../../../../packages/shared-types/src/permissions.ts";
import { CharacterExpressionIds } from "../../../../../packages/shared-types/src/character.ts";

describe("CONV-01: Conversation Concurrency & Queue Serialization", () => {
  // 1. Two rapid sendMessage() calls -> FIFO ordering
  test("1. Two rapid sendMessage() calls execute in strict FIFO turn order", async () => {
    const executionOrder: string[] = [];

    const mockProvider = new MockConversationLlmProvider(async (req) => {
      executionOrder.push(`start:${req.userMessage}`);
      const delay = req.userMessage === "first" ? 30 : 5;
      await new Promise((resolve) => setTimeout(resolve, delay));
      executionOrder.push(`finish:${req.userMessage}`);
      return {
        replyText: `Reply to ${req.userMessage}`,
        expression: "happy",
        notificationIntensity: "standard",
      };
    });

    const manager = new ConversationManager({
      provider: mockProvider,
      storage: new InMemoryConversationStorageAdapter(),
    });

    // Launch both concurrently
    const [resp1, resp2] = await Promise.all([
      manager.sendMessage("first"),
      manager.sendMessage("second"),
    ]);

    assert.equal(resp1.replyText, "Reply to first");
    assert.equal(resp2.replyText, "Reply to second");

    // Must be serialized FIFO: first starts and finishes before second starts
    assert.deepEqual(executionOrder, [
      "start:first",
      "finish:first",
      "start:second",
      "finish:second",
    ]);

    // History order must be user1, assistant1, user2, assistant2
    const history = manager.getHistory();
    assert.equal(history.length, 4);
    assert.equal(history[0].content, "first");
    assert.equal(history[1].content, "Reply to first");
    assert.equal(history[2].content, "second");
    assert.equal(history[3].content, "Reply to second");
  });

  // 2. Three concurrent sendMessage() calls -> deterministic ordering
  test("2. Three concurrent sendMessage() calls execute deterministically", async () => {
    const executed: string[] = [];

    const mockProvider = new MockConversationLlmProvider(async (req) => {
      executed.push(req.userMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        replyText: `Answer: ${req.userMessage}`,
        expression: "neutral",
        notificationIntensity: "standard",
      };
    });

    const manager = new ConversationManager({
      provider: mockProvider,
      storage: new InMemoryConversationStorageAdapter(),
    });

    const [r1, r2, r3] = await Promise.all([
      manager.sendMessage("A"),
      manager.sendMessage("B"),
      manager.sendMessage("C"),
    ]);

    assert.deepEqual(executed, ["A", "B", "C"]);
    assert.equal(r1.replyText, "Answer: A");
    assert.equal(r2.replyText, "Answer: B");
    assert.equal(r3.replyText, "Answer: C");

    const history = manager.getHistory();
    assert.equal(history.length, 6);
    assert.equal(history[0].content, "A");
    assert.equal(history[2].content, "B");
    assert.equal(history[4].content, "C");
  });

  // 3. First provider failure -> second queued request still executes
  test("3. First provider failure returns fallback and does not block second queued turn", async () => {
    let callCount = 0;
    const mockProvider = new MockConversationLlmProvider(async (req) => {
      callCount++;
      if (req.userMessage === "will_fail") {
        throw new ConversationLlmError("Simulated LLM network error", "provider_error");
      }
      return {
        replyText: "Recovered successfully",
        expression: "happy",
        notificationIntensity: "standard",
      };
    });

    const manager = new ConversationManager({
      provider: mockProvider,
      storage: new InMemoryConversationStorageAdapter(),
    });

    const [resp1, resp2] = await Promise.all([
      manager.sendMessage("will_fail"),
      manager.sendMessage("will_succeed"),
    ]);

    // Turn 1 returns fallback
    assert.ok(resp1.replyText.length > 0);
    assert.equal(resp1.source, "fallback");

    // Turn 2 executed cleanly despite turn 1 error
    assert.equal(resp2.replyText, "Recovered successfully");
    assert.equal(resp2.source, "llm");
    assert.equal(callCount, 2);

    const history = manager.getHistory();
    assert.equal(history.length, 4);
    assert.equal(history[0].content, "will_fail");
    assert.equal(history[2].content, "will_succeed");
    assert.equal(history[3].content, "Recovered successfully");
  });

  // 4. First provider timeout -> second queued request still executes
  test("4. First provider timeout gracefully resolves fallback and allows subsequent turns", async () => {
    const mockProvider = new MockConversationLlmProvider(async (req) => {
      if (req.userMessage === "timeout_me") {
        throw new ConversationLlmError("Request timed out after 3000ms", "timeout");
      }
      return {
        replyText: "Prompt reply",
        expression: "wave",
        notificationIntensity: "standard",
      };
    });

    const manager = new ConversationManager({
      provider: mockProvider,
      storage: new InMemoryConversationStorageAdapter(),
    });

    const [resp1, resp2] = await Promise.all([
      manager.sendMessage("timeout_me"),
      manager.sendMessage("subsequent"),
    ]);

    assert.equal(resp1.source, "fallback");
    assert.equal(resp2.replyText, "Prompt reply");
  });

  // 5. History remains bounded (20 messages) under concurrent stress
  test("5. Bounded history remains strictly <= 20 messages under serialized turn bursts", async () => {
    const mockProvider = new MockConversationLlmProvider({
      defaultReplyText: "Short response",
    });

    const manager = new ConversationManager({
      provider: mockProvider,
      storage: new InMemoryConversationStorageAdapter(),
    });

    const messages = Array.from({ length: 15 }, (_, i) => `Message ${i + 1}`);
    await Promise.all(messages.map((m) => manager.sendMessage(m)));

    const history = manager.getHistory();
    // 15 user turns + 15 assistant turns = 30 turns total -> bounded strictly to 20
    assert.ok(history.length <= 20, `History length ${history.length} must not exceed 20`);
    assert.equal(history.length, 20);
  });

  // 6. Simultaneous calls do not duplicate messages
  test("6. Simultaneous identical calls do not duplicate messages or corrupt message IDs", async () => {
    const mockProvider = new MockConversationLlmProvider({
      defaultReplyText: "Echo response",
    });

    const manager = new ConversationManager({
      provider: mockProvider,
      storage: new InMemoryConversationStorageAdapter(),
    });

    await Promise.all([
      manager.sendMessage("identical"),
      manager.sendMessage("identical"),
    ]);

    const history = manager.getHistory();
    assert.equal(history.length, 4);
    const ids = new Set(history.map((h) => h.id));
    assert.equal(ids.size, 4, "All message IDs must be distinct");
  });

  // 7. deleteConversationHistory / clearHistory during in-flight turn
  test("7. clearHistory() during an in-flight LLM call prevents resurrecting deleted history", async () => {
    let turn1Resolve: () => void;
    const turn1Pending = new Promise<void>((r) => {
      turn1Resolve = r;
    });

    const mockProvider = new MockConversationLlmProvider(async (req) => {
      if (req.userMessage === "in_flight") {
        await turn1Pending;
      }
      return {
        replyText: "Reply from stale turn",
        expression: "smile",
        notificationIntensity: "standard",
      };
    });

    const storage = new InMemoryConversationStorageAdapter();
    const manager = new ConversationManager({
      provider: mockProvider,
      storage,
    });

    // Start turn 1 (it will hang on turn1Pending)
    const turn1Promise = manager.sendMessage("in_flight");

    // Yield tick to allow turn 1 to start executing
    await new Promise((r) => setTimeout(r, 10));

    // Clear history while turn 1 is in-flight
    await manager.clearHistory();

    // Verify history is empty now
    assert.equal(manager.getHistory().length, 0);

    // Now unblock turn 1
    turn1Resolve!();
    const turn1Result = await turn1Promise;

    // Turn 1 returns result to its caller
    assert.equal(turn1Result.replyText, "Reply from stale turn");

    // BUT history must NOT have resurrected the stale assistant reply!
    const currentHistory = manager.getHistory();
    assert.equal(
      currentHistory.length,
      0,
      "Deleted history must not be resurrected by an in-flight response completed after deletion"
    );

    const persisted = await storage.loadHistory();
    assert.equal(persisted.length, 0, "Persisted storage must remain empty");
  });

  // 8. AI_CONTEXT=false remains enforced for every queued request
  test("8. AI_CONTEXT=false results in zero context for all queued requests", async () => {
    const receivedContexts: any[] = [];

    const mockProvider = new MockConversationLlmProvider(async (req) => {
      receivedContexts.push(req.context);
      return {
        replyText: "OK",
        expression: "neutral",
        notificationIntensity: "standard",
      };
    });

    const permStorage = new InMemoryPermissionStorageAdapter();
    const permManager = new PermissionManager({ storage: permStorage });
    // Disable AI_CONTEXT
    await permManager.updatePermission(PermissionIds.AI_CONTEXT, false);

    const manager = new ConversationManager({
      provider: mockProvider,
      permissionManager: permManager,
      storage: new InMemoryConversationStorageAdapter(),
    });

    // Feed some active app activity into context
    manager.getContextManager().updateState({ activeAppName: "Visual Studio Code" });

    await Promise.all([
      manager.sendMessage("query 1"),
      manager.sendMessage("query 2"),
    ]);

    assert.equal(receivedContexts.length, 2);
    for (const ctx of receivedContexts) {
      assert.deepEqual(ctx, {}, "AI_CONTEXT=false must produce empty context for all queued requests");
    }
  });
});
