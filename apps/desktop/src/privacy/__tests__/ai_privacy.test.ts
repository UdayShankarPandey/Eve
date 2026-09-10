/**
 * PixelPal — AI Privacy & Context Filtering Tests
 * Sprint 10 Phase 4
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import type {
  ApprovedConversationContext,
  ConversationLlmRequest,
  ConversationLlmRawResponse,
} from "../../conversation/types.ts";
import {
  DEFAULT_PERMISSIONS_CONFIG,
  PermissionIds,
} from "../types.ts";
import { filterApprovedContext, describeAiContextScope } from "../ai_privacy.ts";
import { PermissionManager } from "../permission_manager.ts";
import { InMemoryPermissionStorageAdapter } from "../storage.ts";
import { ConversationManager } from "../../conversation/manager.ts";
import { InMemoryConversationStorageAdapter } from "../../conversation/storage.ts";
import type { ConversationLlmProvider } from "../../conversation/types.ts";

describe("Category F: AI Privacy & Context Boundary", () => {
  const fullContext: ApprovedConversationContext = {
    batteryPercent: 85,
    isCharging: true,
    networkConnected: true,
    networkType: "Wi-Fi",
    idleMinutes: 12,
    activeAppName: "VS Code",
    recentEvents: [
      {
        eventType: "BATTERY_LOW",
        timestamp: Date.now() - 5000,
        summary: "Battery level is at 15%",
      },
      {
        eventType: "APP_OPENED",
        timestamp: Date.now() - 3000,
        summary: "Switched to application: VS Code",
      },
      {
        eventType: "DOWNLOAD_COMPLETED",
        timestamp: Date.now() - 1000,
        summary: "Download finished: report.pdf",
      },
    ],
  };

  it("1. When AI_CONTEXT is disabled, exactly zero desktop context is permitted", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.AI_CONTEXT.enabled = false;

    const filtered = filterApprovedContext(fullContext, config);
    assert.deepEqual(filtered, {}, "When AI_CONTEXT is false, output context MUST be completely empty");
    assert.equal(Object.keys(filtered).length, 0);
  });

  it("2. When AI_CONTEXT is enabled, permitted fields pass cleanly", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.AI_CONTEXT.enabled = true;
    config.permissions.SYSTEM.enabled = true;
    config.permissions.APPLICATIONS.enabled = true;
    config.permissions.FILES.enabled = true;

    const filtered = filterApprovedContext(fullContext, config);
    assert.equal(filtered.batteryPercent, 85);
    assert.equal(filtered.isCharging, true);
    assert.equal(filtered.networkConnected, true);
    assert.equal(filtered.networkType, "Wi-Fi");
    assert.equal(filtered.idleMinutes, 12);
    assert.equal(filtered.activeAppName, "VS Code");
    assert.equal(filtered.recentEvents?.length, 3);
  });

  it("3. Disabling SYSTEM excludes battery and network even when AI_CONTEXT is true", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.AI_CONTEXT.enabled = true;
    config.permissions.SYSTEM.enabled = false; // SYSTEM disabled!
    config.permissions.APPLICATIONS.enabled = true;

    const filtered = filterApprovedContext(fullContext, config);
    assert.equal(filtered.batteryPercent, undefined);
    assert.equal(filtered.isCharging, undefined);
    assert.equal(filtered.networkConnected, undefined);
    assert.equal(filtered.idleMinutes, undefined);
    assert.equal(filtered.activeAppName, "VS Code", "Active app name passes because APPLICATIONS is enabled");

    // BATTERY_LOW event summary must be stripped because SYSTEM is disabled
    const events = filtered.recentEvents || [];
    assert.ok(!events.some((e) => e.eventType === "BATTERY_LOW"));
    assert.ok(events.some((e) => e.eventType === "APP_OPENED"));
  });

  it("4. Disabling APPLICATIONS excludes activeAppName even when AI_CONTEXT is true", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));
    config.permissions.AI_CONTEXT.enabled = true;
    config.permissions.SYSTEM.enabled = true;
    config.permissions.APPLICATIONS.enabled = false; // APPLICATIONS disabled!

    const filtered = filterApprovedContext(fullContext, config);
    assert.equal(filtered.activeAppName, undefined);
    assert.equal(filtered.batteryPercent, 85);

    // APP_OPENED event summary must be stripped because APPLICATIONS is disabled
    const events = filtered.recentEvents || [];
    assert.ok(!events.some((e) => e.eventType === "APP_OPENED"));
  });

  it("5. describeAiContextScope returns machine-readable status without sensitive values", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS_CONFIG));

    // When disabled
    config.permissions.AI_CONTEXT.enabled = false;
    const descDisabled = describeAiContextScope(config);
    assert.equal(descDisabled.aiContextEnabled, false);
    assert.deepEqual(descDisabled.allowedCategories, []);
    assert.ok(descDisabled.blockedCategories.includes("battery_and_power"));

    // When enabled with selective permissions
    config.permissions.AI_CONTEXT.enabled = true;
    config.permissions.SYSTEM.enabled = true;
    config.permissions.APPLICATIONS.enabled = false;
    const descEnabled = describeAiContextScope(config);
    assert.equal(descEnabled.aiContextEnabled, true);
    assert.ok(descEnabled.allowedCategories.includes("battery_and_power"));
    assert.ok(descEnabled.blockedCategories.includes("active_application"));
  });

  it("6. End-to-end integration: ConversationManager respects PermissionManager toggles", async () => {
    let capturedContext: ApprovedConversationContext | null = null;

    const mockProvider: ConversationLlmProvider = {
      async generateResponse(request: ConversationLlmRequest): Promise<ConversationLlmRawResponse> {
        capturedContext = request.context;
        return {
          replyText: "Hello there!",
          expression: "happy",
          notificationIntensity: "expressive",
        };
      },
    };

    const permStorage = new InMemoryPermissionStorageAdapter();
    const permManager = new PermissionManager({ storage: permStorage });
    await permManager.init();

    const convStorage = new InMemoryConversationStorageAdapter();
    const convManager = new ConversationManager({
      storage: convStorage,
      provider: mockProvider,
      permissionManager: permManager,
    });
    await convManager.init();

    // Populate context manager with state
    convManager.getContextManager().updateState({
      batteryPercent: 42,
      activeAppName: "Browser",
    });

    // Case 1: AI_CONTEXT is false (default)
    assert.equal(permManager.isPermissionEnabled("AI_CONTEXT"), false);
    await convManager.sendMessage("Hi PixelPal");
    assert.deepEqual(capturedContext, {}, "LLM must receive empty desktop context when AI_CONTEXT is disabled");

    // Case 2: Enable AI_CONTEXT
    await permManager.updatePermission("AI_CONTEXT", true);
    await convManager.sendMessage("Hi again");
    assert.ok(capturedContext !== null);
    assert.equal(capturedContext.batteryPercent, 42);
    assert.equal(capturedContext.activeAppName, "Browser");

    // Case 3: Disable NOTIFICATIONS permission
    await permManager.updatePermission("NOTIFICATIONS", false);
    const response = await convManager.sendMessage("Silent test");
    assert.equal(
      response.notificationIntensity,
      "quiet",
      "When NOTIFICATIONS permission is disabled, notificationIntensity must be quieted"
    );
  });
});
