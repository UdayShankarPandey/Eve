/**
 * PixelPal — Character Profile Manager Domain Service
 * Sprint 6 Phase 5 Foundation
 *
 * Provides high-level lifecycle operations for CharacterProfiles:
 * creation, retrieval, updates, deletion, listing, asset verification,
 * immutability enforcement, and atomic persistence.
 */

import type {
  CharacterProfile,
  CreateProfileRequest,
  UpdateProfileRequest,
  ProfileOperationResult,
} from "../../../../packages/shared-types/src/character.ts";
import type { GeneratedStorageAdapter } from "./generated_storage.ts";
import type { SpriteStorageAdapter } from "./sprite_storage.ts";
import {
  type ProfileStorageAdapter,
  FileSystemProfileStorageAdapter,
  generateCharacterId,
} from "./profile_storage.ts";
import {
  isValidCharacterId,
  validateProfile,
  validateAssetReferences,
  validateStyleOptions,
  validateClothingConfiguration,
  validatePaletteConfiguration,
} from "./profile_validator.ts";

/**
 * Options for configuring the CharacterProfileManager.
 */
export interface CharacterProfileManagerOptions {
  /** Persistence adapter for profiles (defaults to FileSystemProfileStorageAdapter) */
  readonly storageAdapter?: ProfileStorageAdapter;
  /** Storage adapter to verify existence of Phase 3 generated assets */
  readonly generatedStorageAdapter?: GeneratedStorageAdapter;
  /** Storage adapter to verify existence of Phase 4 sprite assets */
  readonly spriteStorageAdapter?: SpriteStorageAdapter;
  /** Custom storage directory */
  readonly profileStorageDir?: string;
}

/**
 * CharacterProfileManager orchestrates profile creation, validation, storage,
 * updates, and integrity checks against pipeline asset references.
 */
export class CharacterProfileManager {
  private readonly storageAdapter: ProfileStorageAdapter;
  private readonly generatedStorageAdapter?: GeneratedStorageAdapter;
  private readonly spriteStorageAdapter?: SpriteStorageAdapter;

  constructor(options: CharacterProfileManagerOptions = {}) {
    this.storageAdapter =
      options.storageAdapter ??
      new FileSystemProfileStorageAdapter(options.profileStorageDir);
    this.generatedStorageAdapter = options.generatedStorageAdapter;
    this.spriteStorageAdapter = options.spriteStorageAdapter;
  }

  public getStorageAdapter(): ProfileStorageAdapter {
    return this.storageAdapter;
  }

  /**
   * Creates and persists a new CharacterProfile.
   * Enforces asset existence checks, schema validation, and collision-resistant ID generation.
   */
  public async createProfile(
    request: CreateProfileRequest
  ): Promise<ProfileOperationResult<CharacterProfile>> {
    if (!request || typeof request !== "object") {
      return {
        success: false,
        error: {
          code: "CHARACTER_PROFILE_INVALID",
          message: "Profile creation request must be a non-null object",
        },
      };
    }

    // 1. Resolve Character ID
    let characterId: string;
    if (request.characterId !== undefined) {
      if (!isValidCharacterId(request.characterId)) {
        return {
          success: false,
          error: {
            code: "CHARACTER_ID_INVALID",
            message: `Provided character ID format is invalid: '${request.characterId}'`,
            details: { pattern: "character_<timestamp>_<hex>" },
          },
        };
      }
      characterId = request.characterId;

      // Ensure ID is not already in use
      const existing = await this.storageAdapter.get(characterId);
      if (existing) {
        return {
          success: false,
          error: {
            code: "CHARACTER_PROFILE_STORAGE_FAILED",
            message: `A profile with character ID '${characterId}' already exists`,
          },
        };
      }
    } else {
      characterId = generateCharacterId();
    }

    // 2. Validate Asset References format
    const assetErrors = validateAssetReferences(request.assets);
    if (assetErrors.length > 0) {
      return { success: false, error: assetErrors[0] };
    }

    // 3. Verify referenced assets exist if storage adapters are provided
    if (this.generatedStorageAdapter) {
      const genRecord = await this.generatedStorageAdapter.get(
        request.assets.generatedCharacterId
      );
      if (!genRecord) {
        return {
          success: false,
          error: {
            code: "CHARACTER_ASSET_MISSING",
            message: `Referenced generated asset not found in storage: '${request.assets.generatedCharacterId}'`,
            details: { assetId: request.assets.generatedCharacterId },
          },
        };
      }
    }

    if (this.spriteStorageAdapter) {
      const spriteRecord = await this.spriteStorageAdapter.get(
        request.assets.spriteId
      );
      if (!spriteRecord) {
        return {
          success: false,
          error: {
            code: "CHARACTER_ASSET_MISSING",
            message: `Referenced sprite asset not found in storage: '${request.assets.spriteId}'`,
            details: { assetId: request.assets.spriteId },
          },
        };
      }
    }

    // 4. Validate style, clothing, palette
    const styleErrors = validateStyleOptions(request.style);
    if (styleErrors.length > 0) {
      return { success: false, error: styleErrors[0] };
    }

    const clothingErrors = validateClothingConfiguration(request.clothing);
    if (clothingErrors.length > 0) {
      return { success: false, error: clothingErrors[0] };
    }

    const paletteErrors = validatePaletteConfiguration(request.palette);
    if (paletteErrors.length > 0) {
      return { success: false, error: paletteErrors[0] };
    }

    // 5. Build Canonical Profile Model
    const now = Date.now();
    const profile: CharacterProfile = {
      characterId,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      assets: request.assets,
      style: request.style,
      clothing: request.clothing,
      palette: request.palette,
      metadata: request.metadata,
    };

    // 6. Complete Profile Validation
    const validation = validateProfile(profile);
    if (!validation.valid) {
      return { success: false, error: validation.errors[0] };
    }

    // 7. Atomic Persistence
    try {
      await this.storageAdapter.save(profile);
      return { success: true, data: profile };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "CHARACTER_PROFILE_STORAGE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Failed to persist character profile",
        },
      };
    }
  }

  /**
   * Retrieves an existing CharacterProfile by character ID.
   */
  public async getProfile(
    characterId: string
  ): Promise<ProfileOperationResult<CharacterProfile>> {
    if (!isValidCharacterId(characterId)) {
      return {
        success: false,
        error: {
          code: "CHARACTER_ID_INVALID",
          message: `Invalid character ID format: '${characterId}'`,
        },
      };
    }

    try {
      const stored = await this.storageAdapter.get(characterId);
      if (!stored) {
        return {
          success: false,
          error: {
            code: "CHARACTER_PROFILE_NOT_FOUND",
            message: `Character profile not found: '${characterId}'`,
          },
        };
      }
      return { success: true, data: stored.profile };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "CHARACTER_PROFILE_STORAGE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load character profile from disk",
        },
      };
    }
  }

  /**
   * Updates an existing CharacterProfile.
   * characterId and createdAt are strictly immutable.
   */
  public async updateProfile(
    characterId: string,
    updates: UpdateProfileRequest
  ): Promise<ProfileOperationResult<CharacterProfile>> {
    if (!isValidCharacterId(characterId)) {
      return {
        success: false,
        error: {
          code: "CHARACTER_ID_INVALID",
          message: `Invalid character ID format: '${characterId}'`,
        },
      };
    }

    if (!updates || typeof updates !== "object") {
      return {
        success: false,
        error: {
          code: "CHARACTER_PROFILE_INVALID",
          message: "Profile update request must be a non-null object",
        },
      };
    }

    // Load existing profile
    const existingResult = await this.getProfile(characterId);
    if (!existingResult.success) {
      return existingResult;
    }
    const current = existingResult.data;

    // Verify updated asset references if provided
    let mergedAssets = current.assets;
    if (updates.assets) {
      mergedAssets = {
        ...current.assets,
        ...updates.assets,
      };

      const assetErrors = validateAssetReferences(mergedAssets);
      if (assetErrors.length > 0) {
        return { success: false, error: assetErrors[0] };
      }

      if (this.generatedStorageAdapter && updates.assets.generatedCharacterId) {
        const genRecord = await this.generatedStorageAdapter.get(
          updates.assets.generatedCharacterId
        );
        if (!genRecord) {
          return {
            success: false,
            error: {
              code: "CHARACTER_ASSET_MISSING",
              message: `Referenced generated asset not found in storage: '${updates.assets.generatedCharacterId}'`,
            },
          };
        }
      }

      if (this.spriteStorageAdapter && updates.assets.spriteId) {
        const spriteRecord = await this.spriteStorageAdapter.get(
          updates.assets.spriteId
        );
        if (!spriteRecord) {
          return {
            success: false,
            error: {
              code: "CHARACTER_ASSET_MISSING",
              message: `Referenced sprite asset not found in storage: '${updates.assets.spriteId}'`,
            },
          };
        }
      }
    }

    // Validate style if updated
    const mergedStyle = updates.style ?? current.style;
    if (updates.style) {
      const styleErrors = validateStyleOptions(mergedStyle);
      if (styleErrors.length > 0) {
        return { success: false, error: styleErrors[0] };
      }
    }

    // Validate clothing if updated
    const mergedClothing = updates.clothing ?? current.clothing;
    if (updates.clothing) {
      const clothingErrors = validateClothingConfiguration(mergedClothing);
      if (clothingErrors.length > 0) {
        return { success: false, error: clothingErrors[0] };
      }
    }

    // Validate palette if updated
    const mergedPalette = updates.palette ?? current.palette;
    if (updates.palette) {
      const paletteErrors = validatePaletteConfiguration(mergedPalette);
      if (paletteErrors.length > 0) {
        return { success: false, error: paletteErrors[0] };
      }
    }

    const mergedMetadata = updates.metadata ?? current.metadata;

    // Construct updated profile ensuring immutability of characterId and createdAt
    const updatedProfile: CharacterProfile = {
      characterId: current.characterId, // IMMUTABLE
      schemaVersion: current.schemaVersion,
      createdAt: current.createdAt, // IMMUTABLE
      updatedAt: Date.now(),
      assets: mergedAssets,
      style: mergedStyle,
      clothing: mergedClothing,
      palette: mergedPalette,
      metadata: mergedMetadata,
    };

    const validation = validateProfile(updatedProfile);
    if (!validation.valid) {
      return { success: false, error: validation.errors[0] };
    }

    try {
      await this.storageAdapter.save(updatedProfile);
      return { success: true, data: updatedProfile };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "CHARACTER_PROFILE_STORAGE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Failed to persist updated character profile",
        },
      };
    }
  }

  /**
   * Deletes a CharacterProfile from persistence.
   * Underlying generated and sprite image assets are strictly preserved and never deleted.
   */
  public async deleteProfile(
    characterId: string
  ): Promise<ProfileOperationResult<boolean>> {
    if (!isValidCharacterId(characterId)) {
      return {
        success: false,
        error: {
          code: "CHARACTER_ID_INVALID",
          message: `Invalid character ID format: '${characterId}'`,
        },
      };
    }

    try {
      const deleted = await this.storageAdapter.delete(characterId);
      if (!deleted) {
        return {
          success: false,
          error: {
            code: "CHARACTER_PROFILE_NOT_FOUND",
            message: `Cannot delete: Character profile not found: '${characterId}'`,
          },
        };
      }
      return { success: true, data: true };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "CHARACTER_PROFILE_DELETE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Failed to delete character profile",
        },
      };
    }
  }

  /**
   * Lists all existing profiles in storage.
   */
  public async listProfiles(): Promise<readonly CharacterProfile[]> {
    return this.storageAdapter.list();
  }
}
