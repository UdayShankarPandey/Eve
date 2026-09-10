/**
 * PixelPal — Conversation History Persistent Storage Adapters
 * Sprint 9
 *
 * Implements durable atomic persistence adhering to desktop security standards:
 * - Application data directory resolution (no os.tmpdir() in production)
 * - Atomic write-and-rename pattern to prevent file corruption
 * - Mode 0o600 file permissions and mode 0o700 directory permissions
 * - Corrupted or missing history recovery safely falls back to empty array
 * - In-memory adapter for fast hermetic unit testing
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getDesktopAppDataDir } from "../character/paths.ts";
import {
  type ConversationMessage,
  type ConversationStorageAdapter,
} from "./types.ts";
import { isValidConversationMessage } from "./history.ts";

export const CONVERSATION_HISTORY_FILENAME = "conversation_history.json";

/**
 * FileSystem-backed atomic persistent storage adapter for ConversationMessage[].
 */
export class FileSystemConversationStorageAdapter implements ConversationStorageAdapter {
  private readonly filePath: string;
  private readonly baseDir: string;

  constructor(customFilePath?: string) {
    if (customFilePath && customFilePath.trim() !== "") {
      this.filePath = path.resolve(customFilePath.trim());
      this.baseDir = path.dirname(this.filePath);
    } else {
      this.baseDir = getDesktopAppDataDir();
      this.filePath = path.join(this.baseDir, CONVERSATION_HISTORY_FILENAME);
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
  }

  public async loadHistory(): Promise<ConversationMessage[]> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }

      const content = fs.readFileSync(this.filePath, "utf-8");
      if (!content || content.trim() === "") {
        return [];
      }

      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return [];
      }

      const validMessages: ConversationMessage[] = [];
      for (const item of parsed) {
        if (isValidConversationMessage(item)) {
          validMessages.push(item);
        }
      }
      return validMessages;
    } catch {
      // Safe fallback on read error, parse error, or corruption
      return [];
    }
  }

  public async saveHistory(messages: readonly ConversationMessage[]): Promise<void> {
    this.ensureDirectory();

    const randomSuffix = crypto.randomBytes(4).toString("hex");
    const tempPath = path.resolve(
      this.baseDir,
      `${path.basename(this.filePath)}.tmp.${randomSuffix}`
    );

    const serialized = JSON.stringify(messages, null, 2);

    try {
      fs.writeFileSync(tempPath, serialized, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "w",
      });

      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Cleanup best-effort
        }
      }
      throw err;
    }
  }

  public async clearHistory(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * In-memory storage adapter for fast hermetic unit testing.
 */
export class InMemoryConversationStorageAdapter implements ConversationStorageAdapter {
  private history: ConversationMessage[] = [];

  constructor(initialMessages?: readonly ConversationMessage[]) {
    if (initialMessages) {
      this.history = [...initialMessages];
    }
  }

  public async loadHistory(): Promise<ConversationMessage[]> {
    return [...this.history];
  }

  public async saveHistory(messages: readonly ConversationMessage[]): Promise<void> {
    this.history = [...messages];
  }

  public async clearHistory(): Promise<void> {
    this.history = [];
  }
}
