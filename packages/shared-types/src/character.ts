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

/**
 * Visual rendering styles for character generation.
 */
export type CharacterRenderingStyle =
  | "chibi-pixel-art"
  | "retro-arcade"
  | "modern-isometric"
  | "classic-16bit";

/**
 * Anatomical proportions for character generation.
 */
export type ChibiProportions =
  | "super-deformed"
  | "subtle-chibi"
  | "standard-mascot";

/**
 * Base facial/postural expression for character generation.
 */
export type CharacterExpression =
  | "friendly-idle"
  | "happy"
  | "curious"
  | "focused"
  | "confident";

/**
 * Color palette atmosphere for character generation.
 */
export type PaletteMood =
  | "vibrant"
  | "pastel"
  | "warm"
  | "cool"
  | "original-fidelity";

/**
 * Level of visual detail for character generation.
 */
export type DetailLevel = "high-fidelity" | "simplified-iconic";

/**
 * Target background intent for generated base character asset.
 */
export type BackgroundIntent =
  | "solid-white"
  | "transparent-ready"
  | "minimal-backdrop";

/**
 * Controlled, strongly typed character style configuration.
 * User-supplied text strings are forbidden to prevent prompt injection.
 */
export interface CharacterStyleOptions {
  /** Core visual rendering aesthetic (default: 'chibi-pixel-art') */
  readonly renderingStyle?: CharacterRenderingStyle;
  /** Body and head proportion ratio (default: 'super-deformed') */
  readonly proportions?: ChibiProportions;
  /** Primary character expression (default: 'friendly-idle') */
  readonly expression?: CharacterExpression;
  /** Color mood applied to sprite palette (default: 'original-fidelity') */
  readonly paletteMood?: PaletteMood;
  /** Density of pixel details (default: 'high-fidelity') */
  readonly detailLevel?: DetailLevel;
  /** Background isolation intent (default: 'transparent-ready') */
  readonly backgroundIntent?: BackgroundIntent;
}

/**
 * Operational options for character generation execution.
 */
export interface CharacterGenerationOptions {
  /** AI provider identifier (default: 'openai') */
  readonly providerId?: string;
  /** Target image generation model (default: 'gpt-image-2.5-sunburst') */
  readonly model?: string;
  /** Request timeout in milliseconds (default: 60,000) */
  readonly timeoutMs?: number;
  /** Maximum retry attempts for transient failures (default: 0) */
  readonly maxRetries?: number;
  /** Optional deterministic random seed if supported by provider */
  readonly seed?: number;
}

/**
 * Input request for controlled character generation.
 */
export interface GenerateCharacterRequest {
  /** Reference to approved Phase 2 preprocessed image */
  readonly source:
    | PreprocessSuccessResult
    | {
        readonly processedStorageId: string;
        readonly processedFilePath: string;
      };
  /** Controlled style configuration */
  readonly style?: CharacterStyleOptions;
  /** Execution and provider options */
  readonly options?: CharacterGenerationOptions;
  /** Optional client metadata */
  readonly metadata?: {
    readonly clientRequestId?: string;
    readonly requestedAt?: number;
  };
}

/**
 * Metadata for generated intermediate character asset.
 */
export interface GeneratedImageMetadata {
  readonly format: "png";
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly hasAlpha: boolean;
  readonly sha256: string;
}

/**
 * Structured error codes for character generation failures.
 */
export type CharacterGenerationErrorCode =
  | "AI_CONFIGURATION_MISSING"
  | "AI_AUTHENTICATION_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_CONTENT_REJECTED"
  | "AI_TIMEOUT"
  | "AI_REQUEST_FAILED"
  | "AI_INVALID_RESPONSE"
  | "AI_OUTPUT_INVALID"
  | "AI_OUTPUT_UNSUPPORTED"
  | "AI_OUTPUT_STORAGE_FAILED"
  | "INVALID_SOURCE_IMAGE"
  | "INVALID_STYLE_CONFIGURATION";

/**
 * Structured error details for character generation failure.
 */
export interface CharacterGenerationError {
  readonly code: CharacterGenerationErrorCode;
  readonly message: string;
  readonly provider?: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Successful outcome of character generation.
 */
export interface GenerateCharacterSuccessResult {
  readonly success: true;
  readonly generationId: string;
  readonly sourceStorageId: string;
  readonly generatedStorageId: string;
  readonly generatedFilePath: string;
  readonly metadata: GeneratedImageMetadata;
  readonly provider: string;
  readonly model: string;
  readonly promptUsed: string;
  readonly createdAt: number;
}

/**
 * Failed outcome of character generation.
 */
export interface GenerateCharacterFailureResult {
  readonly success: false;
  readonly error: CharacterGenerationError;
  readonly sourceStorageId?: string;
  readonly provider?: string;
}

/**
 * Complete result union for character generation boundary.
 */
export type GenerateCharacterResult =
  | GenerateCharacterSuccessResult
  | GenerateCharacterFailureResult;

/**
 * Supported canonical pixel-art sprite dimensions.
 * Canonical animation engine standard is 64x64; optional 128x128 for high-res sprite view.
 */
export type SpriteDimension = 64 | 128;

/**
 * Options controlling deterministic pixel processing.
 */
export interface PixelProcessOptions {
  /** Target square canvas dimension (default: 64) */
  readonly targetDimension?: SpriteDimension;
  /** Maximum number of opaque colors allowed in quantized palette (default: 16, min: 2, max: 256) */
  readonly maxOpaqueColors?: number;
  /** Alpha cutoff threshold for binary transparency (0-255, default: 128) */
  readonly alphaThreshold?: number;
  /** Dithering toggle (default: false for crisp pixel art) */
  readonly dithering?: boolean;
}

/**
 * Input request for pixel-art sprite processing.
 */
export interface PixelProcessRequest {
  /** Reference to approved Phase 3 generated image asset */
  readonly source:
    | GenerateCharacterSuccessResult
    | {
        readonly generatedStorageId: string;
        readonly generatedFilePath: string;
      };
  /** Processing options */
  readonly options?: PixelProcessOptions;
  /** Optional client metadata */
  readonly metadata?: {
    readonly clientRequestId?: string;
    readonly requestedAt?: number;
  };
}

/**
 * Verified metadata for the processed pixel-art sprite asset.
 */
export interface SpriteImageMetadata {
  readonly format: "png";
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly hasAlpha: boolean;
  readonly opaqueColorCount: number;
  readonly sha256: string;
}

/**
 * Execution metrics for pixel processing.
 */
export interface PixelProcessExecutionInfo {
  readonly sourceDimensions: { readonly width: number; readonly height: number };
  readonly targetDimensions: { readonly width: number; readonly height: number };
  readonly colorsUsed: number;
  readonly alphaThreshold: number;
  readonly durationMs: number;
}

/**
 * Structured error codes for pixel processing failures.
 */
export type PixelProcessErrorCode =
  | "PIXEL_SOURCE_INVALID"
  | "PIXEL_DECODE_FAILED"
  | "PIXEL_RESOURCE_LIMIT"
  | "PIXEL_UNSUPPORTED_FORMAT"
  | "PIXEL_QUANTIZATION_FAILED"
  | "PIXEL_RESIZE_FAILED"
  | "PIXEL_OUTPUT_FAILED"
  | "PIXEL_STORAGE_FAILED";

/**
 * Structured error details for pixel processing failure.
 */
export interface PixelProcessError {
  readonly code: PixelProcessErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Successful outcome of pixel processing.
 */
export interface PixelProcessSuccessResult {
  readonly success: true;
  readonly spriteStorageId: string;
  readonly sourceStorageId: string;
  readonly spriteFilePath: string;
  readonly metadata: SpriteImageMetadata;
  readonly processingInfo: PixelProcessExecutionInfo;
  readonly createdAt: number;
}

/**
 * Failed outcome of pixel processing.
 */
export interface PixelProcessFailureResult {
  readonly success: false;
  readonly error: PixelProcessError;
  readonly sourceStorageId?: string;
}

/**
 * Complete result union for pixel-art processing boundary.
 */
export type PixelProcessResult =
  | PixelProcessSuccessResult
  | PixelProcessFailureResult;
