/**
 * PixelPal — Character Upload Boundary Orchestrator
 * Sprint 6 Phase 1 Foundation
 *
 * Implements the secure, local-first image upload boundary that encapsulates
 * binary validation, path traversal defense, safe application-owned temporary
 * storage, and typed lifecycle management.
 */

import {
  FileSystemTemporaryStorageAdapter,
  generateStorageId,
  sanitizeFileName,
} from "./storage.ts";
import {
  DEFAULT_IMAGE_CONSTRAINTS,
  validateImageContent,
} from "./validator.ts";
import type {
  ImageUploadBoundaryOptions,
  StagedImageRecord,
  TemporaryStorageAdapter,
  UploadFailureResult,
  UploadRequest,
  UploadResult,
  UploadSuccessResult,
} from "./types.ts";

/**
 * Character Image Upload Boundary.
 * The authoritative gatekeeper for user-provided character portrait assets.
 */
export class ImageUploadBoundary {
  private readonly storage: TemporaryStorageAdapter;
  private readonly defaultConstraints: typeof DEFAULT_IMAGE_CONSTRAINTS;

  constructor(options: ImageUploadBoundaryOptions = {}) {
    this.storage =
      options.storageAdapter ??
      new FileSystemTemporaryStorageAdapter(options.tempStorageDir);
    this.defaultConstraints = {
      ...DEFAULT_IMAGE_CONSTRAINTS,
      ...options.defaultConstraints,
    };
  }

  /**
   * Returns the active storage adapter instance.
   */
  public getStorageAdapter(): TemporaryStorageAdapter {
    return this.storage;
  }

  /**
   * Main entry point for uploading and validating a character image.
   * Performs end-to-end:
   * 1. Binary validation & magic byte inspection
   * 2. Header parsing & dimension / aspect-ratio verification
   * 3. SHA-256 cryptographic hashing
   * 4. Filename sanitization & path traversal defense
   * 5. Collision-resistant safe unique ID generation
   * 6. Safe temporary disk isolation (application-owned)
   * 7. Structured contract emission
   */
  public async upload(
    requestOrData: UploadRequest | Uint8Array,
    optionalFileName?: string
  ): Promise<UploadResult> {
    let data: Uint8Array;
    let fileName: string | undefined;
    let constraints = this.defaultConstraints;

    if (requestOrData instanceof Uint8Array) {
      data = requestOrData;
      fileName = optionalFileName;
    } else {
      data = requestOrData.data;
      fileName = requestOrData.fileName ?? optionalFileName;
      if (requestOrData.constraints) {
        constraints = { ...this.defaultConstraints, ...requestOrData.constraints };
      }
    }

    const rawFileName = fileName ?? "upload";
    const sanitized = sanitizeFileName(rawFileName);

    // 1. Content & integrity validation
    const validationResult = await validateImageContent(data, constraints);

    if (!validationResult.valid || !validationResult.metadata) {
      const failure: UploadFailureResult = {
        success: false,
        errors: validationResult.errors,
        originalFileName: rawFileName,
      };
      return failure;
    }

    const metadata = validationResult.metadata;

    // 2. Generate safe storage identifier
    const storageId = generateStorageId();

    // 3. Persist to isolated application-owned temporary storage
    let tempFilePath: string;
    try {
      tempFilePath = await this.storage.save(storageId, metadata.format, data);
    } catch (storageErr) {
      const failure: UploadFailureResult = {
        success: false,
        errors: [
          {
            code: "STORAGE_ERROR",
            message: `Failed to stage image into temporary storage: ${
              storageErr instanceof Error ? storageErr.message : String(storageErr)
            }`,
            field: "storage",
          },
        ],
        originalFileName: rawFileName,
      };
      return failure;
    }

    // 4. Return typed success contract
    const success: UploadSuccessResult = {
      success: true,
      storageId,
      tempFilePath,
      originalFileName: rawFileName,
      sanitizedFileName: sanitized,
      metadata,
      createdAt: Date.now(),
    };

    return success;
  }

  /**
   * Retrieves a staged temporary image by its storage ID.
   */
  public async getStagedImage(
    storageId: string
  ): Promise<{ record: StagedImageRecord; data: Uint8Array } | null> {
    return this.storage.get(storageId);
  }

  /**
   * Deletes a staged temporary image by its storage ID.
   */
  public async cleanup(storageId: string): Promise<boolean> {
    return this.storage.delete(storageId);
  }

  /**
   * Cleans up all temporary files older than the specified age in milliseconds.
   */
  public async cleanupExpired(maxAgeMs: number = 3600_000): Promise<number> {
    return this.storage.cleanupExpired(maxAgeMs);
  }

  /**
   * Completely removes all staged temporary upload files.
   */
  public async cleanupAll(): Promise<number> {
    return this.storage.cleanupAll();
  }

  /**
   * Lists all staged temporary records.
   */
  public async listStaged(): Promise<readonly StagedImageRecord[]> {
    return this.storage.list();
  }
}
