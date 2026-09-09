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
  type CropMode,
  type BackgroundRemovalMode,
  type PreprocessOptions,
  type ProcessedImageMetadata,
  type PreprocessExecutionInfo,
  type ImageProcessingErrorCode,
  type ImageProcessingError,
  type PreprocessImageRequest,
  type PreprocessSuccessResult,
  type PreprocessFailureResult,
  type PreprocessResult,
  type CharacterRenderingStyle,
  type ChibiProportions,
  type CharacterExpression,
  type PaletteMood,
  type DetailLevel,
  type BackgroundIntent,
  type CharacterStyleOptions,
  type CharacterGenerationOptions,
  type GenerateCharacterRequest,
  type GeneratedImageMetadata,
  type CharacterGenerationErrorCode,
  type CharacterGenerationError,
  type GenerateCharacterSuccessResult,
  type GenerateCharacterFailureResult,
  type GenerateCharacterResult,
  type SpriteDimension,
  type PixelProcessOptions,
  type PixelProcessRequest,
  type SpriteImageMetadata,
  type PixelProcessExecutionInfo,
  type PixelProcessErrorCode,
  type PixelProcessError,
  type PixelProcessSuccessResult,
  type PixelProcessFailureResult,
  type PixelProcessResult,
  type RgbColor,
  type ClothingCategory,
  type ClothingTop,
  type ClothingBottom,
  type ClothingFootwear,
  type ClothingAccessory,
  type ClothingColorTheme,
  type ClothingConfiguration,
  type TransparencyPolicy,
  type PaletteConfiguration,
  type CharacterProfileAssetReferences,
  type CharacterProfileMetadata,
  type CharacterProfile,
  type CreateProfileRequest,
  type UpdateProfileRequest,
  type CharacterProfileErrorCode,
  type CharacterProfileError,
  type ProfileSuccessResult,
  type ProfileFailureResult,
  type ProfileOperationResult,
  CharacterExpressionIds,
  type CharacterExpressionId,
  ALL_CHARACTER_EXPRESSION_IDS,
  type ExpressionGenerationContract,
  type ExpressionGenerationRequest,
  type ExpressionAssetRecord,
  type ExpressionConsistencyErrorCode,
  type ExpressionConsistencyError,
  type ExpressionConsistencyReport,
  type ExpressionQualityErrorCode,
  type ExpressionQualityError,
  type ExpressionQualityReport,
} from "../../../../packages/shared-types/src/character.ts";


import type {
  ImageFormat,
  ImageValidationConstraints,
  StagedImageRecord,
  PreprocessOptions,
  BackgroundRemovalMode,
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

/**
 * Strategy interface for isolated background removal implementations.
 */
export interface BackgroundRemovalStrategy {
  /** The operational mode name */
  readonly mode: BackgroundRemovalMode;
  /**
   * Process decoded raw RGBA raster buffer.
   * Returns modified raw RGBA buffer with background made transparent.
   */
  removeBackground(
    rawPixels: Uint8Array,
    width: number,
    height: number,
    channels: number,
    threshold?: number
  ): Promise<{ rawPixels: Uint8Array; backgroundRemoved: boolean }>;
}

/**
 * Storage record for an intermediate normalized processed image asset.
 */
export interface ProcessedStorageRecord {
  readonly processedStorageId: string;
  readonly processedFilePath: string;
  readonly sizeBytes: number;
  readonly createdAt: number;
}

/**
 * Storage adapter interface for managed processed image output.
 */
export interface ProcessedStorageAdapter {
  save(processedStorageId: string, data: Uint8Array): Promise<string>;
  get(
    processedStorageId: string
  ): Promise<{ record: ProcessedStorageRecord; data: Uint8Array } | null>;
  delete(processedStorageId: string): Promise<boolean>;
  cleanupExpired(maxAgeMs: number): Promise<number>;
  cleanupAll(): Promise<number>;
  list(): Promise<readonly ProcessedStorageRecord[]>;
}

/**
 * Options for configuring the ImagePreprocessor engine.
 */
export interface ImagePreprocessorOptions {
  /** Storage adapter for persisting processed assets */
  readonly storageAdapter?: ProcessedStorageAdapter;
  /** Default preprocessing options */
  readonly defaultOptions?: Partial<PreprocessOptions>;
  /** Temporary directory base path for processed storage */
  readonly processedStorageDir?: string;
  /** Custom background removal strategy */
  readonly backgroundRemovalStrategy?: BackgroundRemovalStrategy;
}

export type {
  CharacterGenerationProvider,
  ProviderGenerationRequest,
  ProviderGenerationResponse,
} from "./generation_provider.ts";

export type {
  GeneratedStorageRecord,
  GeneratedStorageAdapter,
} from "./generated_storage.ts";

export type {
  CharacterGeneratorOptions,
} from "./generator.ts";

export type {
  OpenAIProviderOptions,
} from "./openai_provider.ts";

export type {
  CharacterPromptBuildResult,
} from "./prompt_builder.ts";

export type {
  SpriteStorageRecord,
  SpriteStorageAdapter,
} from "./sprite_storage.ts";

export type {
  QuantizeOptions,
  QuantizeResult,
} from "./color_quantizer.ts";

export type {
  PixelArtProcessorOptions,
} from "./pixel_processor.ts";

export type {
  ProfileStorageRecord,
  ProfileStorageAdapter,
} from "./profile_storage.ts";

export type {
  CharacterProfileManagerOptions,
} from "./profile_manager.ts";
