/**
 * PixelPal — Desktop Character & Upload Types
 * Sprint 6 Phase 1 Foundation
 */

export {
  SupportedMimeTypes,
  type ImageFormat,
  type ImageDimensions,
  type ImageMetadata,
  type ImageValidationErrorCode,
  type ImageValidationError,
  type ImageValidationResult,
  type ImageValidationConstraints,
  type UploadSuccessResult,
  type UploadFailureResult,
  type UploadResult,
  type UploadRequest,
  type StagedImageRecord,
} from "../../../../packages/shared-types/src/character.ts";

import type {
  ImageFormat,
  ImageValidationConstraints,
  StagedImageRecord,
} from "../../../../packages/shared-types/src/character.ts";

/**
 * Storage adapter interface decoupling storage mechanism from validation.
 */
export interface TemporaryStorageAdapter {
  /**
   * Save validated image bytes to isolated temporary storage.
   * Returns the absolute path where the file was safely persisted.
   */
  save(
    storageId: string,
    format: ImageFormat,
    data: Uint8Array
  ): Promise<string>;

  /**
   * Retrieve stored image data and record by unique storage ID.
   */
  get(
    storageId: string
  ): Promise<{ record: StagedImageRecord; data: Uint8Array } | null>;

  /**
   * Delete a specific temporary image file by unique storage ID.
   * Returns true if deleted, false if not found.
   */
  delete(storageId: string): Promise<boolean>;

  /**
   * Cleanup all stored files older than the specified max age in milliseconds.
   * Returns the count of deleted files.
   */
  cleanupExpired(maxAgeMs: number): Promise<number>;

  /**
   * Purge all temporary character upload files managed by this adapter.
   * Returns the count of deleted files.
   */
  cleanupAll(): Promise<number>;

  /**
   * List all currently active temporary storage records.
   */
  list(): Promise<readonly StagedImageRecord[]>;
}

/**
 * Options for configuring the ImageUploadBoundary.
 */
export interface ImageUploadBoundaryOptions {
  /** Optional custom storage adapter (defaults to FileSystemTemporaryStorage or InMemoryTemporaryStorage) */
  storageAdapter?: TemporaryStorageAdapter;
  /** Global default validation constraints */
  defaultConstraints?: Partial<ImageValidationConstraints>;
  /** Optional base path for temporary disk storage */
  tempStorageDir?: string;
}
