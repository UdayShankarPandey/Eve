/**
 * PixelPal — Character Upload & Image Validation Shared Types & Contracts
 * Sprint 6 Phase 1 Foundation
 */

/**
 * Supported image formats for character upload.
 */
export type ImageFormat = "png" | "jpeg" | "webp";

/**
 * Standard MIME types for supported character upload images.
 */
export const SupportedMimeTypes: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;

/**
 * Image dimensions in pixels.
 */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Verified metadata extracted from genuine image byte stream.
 */
export interface ImageMetadata {
  /** The verified binary format */
  readonly format: ImageFormat;
  /** Canonical MIME type */
  readonly mimeType: string;
  /** Pixel width */
  readonly width: number;
  /** Pixel height */
  readonly height: number;
  /** Exact payload size in bytes */
  readonly sizeBytes: number;
  /** Cryptographic SHA-256 digest of the image bytes */
  readonly sha256: string;
}

/**
 * Structured validation error codes.
 */
export type ImageValidationErrorCode =
  | "FILE_EMPTY"
  | "FILE_TOO_SMALL"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_MAGIC_BYTES"
  | "CORRUPTED_IMAGE"
  | "DIMENSIONS_TOO_SMALL"
  | "DIMENSIONS_TOO_LARGE"
  | "INVALID_ASPECT_RATIO"
  | "PATH_TRAVERSAL_ATTEMPT"
  | "STORAGE_ERROR";

/**
 * Structured validation error with diagnostic context.
 */
export interface ImageValidationError {
  /** Machine-readable error code */
  readonly code: ImageValidationErrorCode;
  /** Human-readable explanation */
  readonly message: string;
  /** Offending field or parameter, if applicable */
  readonly field?: string;
  /** Structured context details for diagnostics */
  readonly details?: Record<string, unknown>;
}

/**
 * Result of content and structural validation.
 */
export interface ImageValidationResult {
  /** Whether the image passed all validation rules */
  readonly valid: boolean;
  /** List of structured errors encountered */
  readonly errors: readonly ImageValidationError[];
  /** Validated image metadata if valid */
  readonly metadata?: ImageMetadata;
}

/**
 * Configurable image validation constraints with safe defaults.
 */
export interface ImageValidationConstraints {
  /** Minimum allowed byte size (default: 100 bytes) */
  readonly minSizeBytes?: number;
  /** Maximum allowed byte size (default: 10 * 1024 * 1024 = 10 MB) */
  readonly maxSizeBytes?: number;
  /** Minimum allowed pixel width (default: 64 px) */
  readonly minWidth?: number;
  /** Minimum allowed pixel height (default: 64 px) */
  readonly minHeight?: number;
  /** Maximum allowed pixel width (default: 4096 px) */
  readonly maxWidth?: number;
  /** Maximum allowed pixel height (default: 4096 px) */
  readonly maxHeight?: number;
  /** Maximum allowed aspect ratio (width/height or height/width, default: 4.0) */
  readonly maxAspectRatio?: number;
  /** Whitelist of supported formats (default: ['png', 'jpeg', 'webp']) */
  readonly allowedFormats?: readonly ImageFormat[];
}

/**
 * Successful upload result contract.
 */
export interface UploadSuccessResult {
  readonly success: true;
  /** Safe unique storage identifier */
  readonly storageId: string;
  /** Absolute path to the isolated temporary storage file */
  readonly tempFilePath: string;
  /** Original client filename (for display/reference only) */
  readonly originalFileName: string;
  /** Sanitized safe filename */
  readonly sanitizedFileName: string;
  /** Verified image metadata */
  readonly metadata: ImageMetadata;
  /** Creation timestamp in milliseconds */
  readonly createdAt: number;
}

/**
 * Failed upload result contract.
 */
export interface UploadFailureResult {
  readonly success: false;
  /** Structured validation errors */
  readonly errors: readonly ImageValidationError[];
  /** Original client filename if available */
  readonly originalFileName?: string;
}

/**
 * Discriminated union of upload boundary outcomes.
 */
export type UploadResult = UploadSuccessResult | UploadFailureResult;

/**
 * Input request to the upload boundary.
 */
export interface UploadRequest {
  /** Raw binary data of the uploaded image */
  readonly data: Uint8Array;
  /** Original filename supplied by user or client */
  readonly fileName?: string;
  /** Optional custom validation overrides */
  readonly constraints?: Partial<ImageValidationConstraints>;
}

/**
 * Metadata record for a staged temporary file in storage.
 */
export interface StagedImageRecord {
  readonly storageId: string;
  readonly tempFilePath: string;
  readonly format: ImageFormat;
  readonly sizeBytes: number;
  readonly createdAt: number;
}

/**
 * Framing and crop strategies for portrait normalization.
 */
export type CropMode = "center-crop-square" | "fit-preserve-aspect" | "none";

/**
 * Isolated background removal operational modes.
 */
export type BackgroundRemovalMode = "none" | "corner-chroma";

/**
 * Configuration options for image preprocessing.
 */
export interface PreprocessOptions {
  /** Target bounding box or square dimensions (default: 512x512) */
  readonly targetDimensions?: ImageDimensions;
  /** Crop strategy (default: 'center-crop-square') */
  readonly cropMode?: CropMode;
  /** Background removal strategy mode (default: 'none') */
  readonly backgroundRemovalMode?: BackgroundRemovalMode;
  /** Sensitivity threshold for color-key removal (0-255, default: 25) */
  readonly backgroundRemovalThreshold?: number;
  /** Whether to normalize orientation using EXIF (default: true) */
  readonly normalizeOrientation?: boolean;
  /** Whether to strip GPS and camera metadata for privacy (default: true) */
  readonly stripMetadata?: boolean;
}

/**
 * Metadata for intermediate normalized processed image asset.
 */
export interface ProcessedImageMetadata {
  readonly format: "png";
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly hasAlpha: boolean;
  readonly sha256: string;
}

/**
 * Diagnostics and execution metrics from the preprocessing pipeline.
 */
export interface PreprocessExecutionInfo {
  readonly originalDimensions: ImageDimensions;
  readonly cropApplied?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly orientationApplied?: number;
  readonly backgroundRemoved: boolean;
  readonly resampled: boolean;
}

/**
 * Machine-readable error codes for image preprocessing failures.
 */
export type ImageProcessingErrorCode =
  | "INVALID_SOURCE"
  | "DECODE_FAILED"
  | "UNSUPPORTED_RASTER"
  | "ORIENTATION_FAILED"
  | "CROP_FAILED"
  | "BACKGROUND_REMOVAL_FAILED"
  | "DIMENSION_NORMALIZATION_FAILED"
  | "OUTPUT_WRITE_FAILED"
  | "RESOURCE_LIMIT"
  | "PROCESSING_TIMEOUT";

/**
 * Structured diagnostic error for preprocessing.
 */
export interface ImageProcessingError {
  readonly code: ImageProcessingErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Input request to ImagePreprocessor.
 */
export interface PreprocessImageRequest {
  /** Validated Phase 1 upload reference */
  readonly source:
    | UploadSuccessResult
    | {
        readonly storageId: string;
        readonly tempFilePath: string;
        readonly format: ImageFormat;
      };
  /** Custom preprocessing overrides */
  readonly options?: PreprocessOptions;
}

/**
 * Successful outcome of image preprocessing.
 */
export interface PreprocessSuccessResult {
  readonly success: true;
  readonly processedStorageId: string;
  readonly processedFilePath: string;
  readonly sourceStorageId: string;
  readonly metadata: ProcessedImageMetadata;
  readonly processingInfo: PreprocessExecutionInfo;
  readonly createdAt: number;
}

/**
 * Failed outcome of image preprocessing.
 */
export interface PreprocessFailureResult {
  readonly success: false;
  readonly errors: readonly ImageProcessingError[];
  readonly sourceStorageId?: string;
}

/**
 * Complete result union for preprocessing boundary.
 */
export type PreprocessResult = PreprocessSuccessResult | PreprocessFailureResult;
