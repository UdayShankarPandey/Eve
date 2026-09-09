# PixelPal — Character Image Preprocessing Foundation

**Version:** 1.1.0  
**Scope:** Sprint 6 Phase 2 (Character Image Preprocessing Foundation)  
**Upstream Checkpoint:** `79c637b` (Sprint 6 Phase 1: Character Upload & Image Validation Foundation)

---

## 1. Executive Summary & Objective

PixelPal allows users to create personalized pixel-art companions from their own photographs. In Sprint 6 Phase 1, an impermeable upload boundary was established to validate raw bytes, magic signatures, headers, dimensions, and stage valid uploads locally in application-owned temporary storage without full raster decoding.

Sprint 6 Phase 2 builds strictly on top of Phase 1 by introducing the **Intermediate Character Image Preprocessing Pipeline**. Phase 2 performs:
1. **Safe raster decoding** of validated Phase 1 image sources (PNG, JPEG, WebP) using Sharp with memory safety guards (`limitInputPixels: 16,777,216`).
2. **Deterministic EXIF orientation normalization** (auto-rotating transposed rasters to upright viewport space and stripping raw camera EXIF tags).
3. **Conservative crop & framing cleanup** (deterministic center-crop to 1:1 aspect ratio without stretching, supporting even and odd input dimensions, or fit-preserve-aspect mode).
4. **Pluggable, local background-removal abstraction** (isolated behind `BackgroundRemovalStrategy`, supporting passthrough `NoBackgroundRemoval` or local deterministic baseline `CornerChromaBackgroundRemoval`, with zero network calls and transparent alpha support).
5. **Deterministic dimension normalization** (canonical 512×512 resolution via Lanczos3 high-order resampling, preserving transparency).
6. **Transparent intermediate asset generation** (producing clean PNG output with all camera metadata, EXIF, GPS, IPTC, and XMP stripped).
7. **Application-owned temporary processed storage** (`pixelpal_processed/`) with cryptographically secure storage IDs (`processed_char_<timestamp>_<randomHex>.png`) and strict path-traversal prevention.

---

## 2. Multi-Phase Pipeline Architecture & Runtime Boundary

```text
Phase 1 (Completed):
Raw Upload Bytes
      │
      ▼
Signature & Header Validation (Magic bytes, IHDR/SOF/VP8, 64px–4096px)
      │
      ▼
Validated Temporary Source Image (`char_upload_<id>.<ext>`)

Phase 2 (This Phase — Backend/Service Domain):
Validated Temporary Source Image Reference
      │
      ▼
Safe Raster Decode (Sharp, limitInputPixels: 16M, Format & Single-Frame Guards)
      │
      ▼
Orientation Normalization (.rotate() / EXIF normalization)
      │
      ▼
Conservative Crop / Framing Cleanup (Center-crop 1:1, aspect preservation)
      │
      ▼
Optional Background Removal (Local strategy, transparent alpha channel)
      │
      ▼
Dimension Normalization (Canonical 512×512, Lanczos3 filter)
      │
      ▼
Metadata Stripping & PNG Serialization (Zero GPS/EXIF/IPTC/XMP leakage)
      │
      ▼
Processed Temporary Asset (`processed_char_<id>.png` in `pixelpal_processed/`)

Phase 3 (Future):
Processed Intermediate PNG ──► Controlled AI Character Generation (Chibi Portrait)

Phase 4 (Future):
Generated Character Asset ──► Pixel Art Conversion & Palette Reduction (Sprite Sheet)
```

> [!IMPORTANT]
> **Runtime Environment Boundary**:
> - **Execution Runtime**: Phase 2 image preprocessing executes in a **Node.js service/domain environment** (represented by `services/character-generation` and test runners).
> - **Renderer Isolation**: The Tauri browser/WebView2 renderer (`apps/desktop/src/App.tsx`, `main.tsx`) does **NOT** execute Sharp or Node.js native addons. When frontend UI is introduced in future phases, communication with image processing will occur across the native IPC bridge, keeping native C++ binaries strictly outside the browser context.
> - **Phase Decoupling Guarantee**: Phase 2 does NOT execute AI image generation, prompt synthesis, OpenAI API calls, database persistence (SQLite CharacterProfile), or pixel-art downsampling. Phase 2 produces exclusively a standardized, high-fidelity intermediate PNG asset ready for future consumption by Phase 3.

---

## 3. Preprocessing Stages & Technical Details

### 3.1. Safe Raster Decoding & Resource Protection
- **Library**: `sharp` (v0.35.4) powered by libvips (v8.18.6).
- **Decoded Pixel-Count Limit**: Configured with `limitInputPixels: 16_777_216` (16 megapixels, max 4096×4096). Attempting to decode rasters exceeding this limit fails gracefully with `RESOURCE_LIMIT`. This enforces an upper bound on decoded raster memory allocation rather than claiming absolute decompression bomb immunity.
- **Format Constraint**: Constrains raster decoding strictly to Phase 1-approved formats (`png`, `jpeg`, `webp`). Any other format detected during decode is rejected with `UNSUPPORTED_RASTER`.
- **Single-Frame Guard**: Rejects multi-frame / animated images (e.g. animated WebP with `pages > 1`) with `UNSUPPORTED_RASTER` to guarantee deterministic single-frame portrait generation.
- **Integrity Verification**: While Phase 1 validates signatures and structural headers, Phase 2 decodes the actual compressed raster stream (IDAT chunks in PNG, scan data in JPEG, VP8 frames in WebP). Corrupted or truncated payloads that pass header checks fail safely during decode with `DECODE_FAILED`.

### 3.2. Orientation Normalization
- Cameras and mobile smartphones frequently record portrait photos with landscape raster geometry and an EXIF `Orientation` tag (values 1–8).
- `ImagePreprocessor` invokes Sharp's `.rotate()` pipeline operation, which reads orientation metadata, applies the appropriate affine rotation/flip to the raster, and resets EXIF orientation to 1 (normal).
- If EXIF orientation is missing or standard (1), natural orientation is preserved without modification.
- If orientation data is malformed, Sharp handles it safely without crashing.

### 3.3. Conservative Crop & Framing Strategy
- **Default Strategy (`center-crop`)**:
  - Calculates the largest square sub-region centered within the image (`cropSize = min(width, height)`).
  - Extracts the region `left = round((width - cropSize) / 2)`, `top = round((height - cropSize) / 2)`.
  - Guarantees 1:1 aspect ratio without stretching, squeezing, or distortion.
  - Accommodates portrait, landscape, square, and odd dimensions deterministically, ensuring coordinates strictly remain within bounds.
- **Fit Strategy (`fit-preserve-aspect`)**:
  - Preserves entire subject area and scales within the canonical bounding box without cropping.
- **No Advanced AI Face Crop**: No heavy facial recognition or ML landmark models are introduced in this phase. The center-crop algorithm is deterministic, fast, and transparent.

### 3.4. Background Removal Strategy & Transparency
- **Isolated Abstraction**: Preprocessing operates against the `BackgroundRemovalStrategy` interface:
  ```typescript
  export interface BackgroundRemovalStrategy {
    readonly mode: BackgroundRemovalMode;
    removeBackground(rawPixels: Uint8Array, width: number, height: number, channels: number, threshold?: number): Promise<{ rawPixels: Uint8Array; backgroundRemoved: boolean }>;
  }
  ```
- **Implementations**:
  - `NoBackgroundRemovalStrategy` (`mode: "none"`): Standard passthrough. Does not alter pixels; guarantees unmodified photographic fidelity.
  - `CornerChromaBackgroundRemovalStrategy` (`mode: "corner-chroma"`): Local deterministic baseline algorithm for uniform/solid backgrounds (e.g. green screen, studio white/black backdrops). Samples the four corner pixels of the image, computes Euclidean RGB color distance, and sets matching pixels to transparent alpha with a feathering threshold.
- **Safety & Privacy**: 100% offline and deterministic. Never sends images over a network. If background corner variance is high (e.g. natural outdoor scenes), it safely falls back to unmodified input without aborting the entire pipeline.
- **Explicit Known Limitation**: Corner chroma is a color-distance heuristic, not semantic AI segmentation. If a subject's clothing or hair closely matches the corner backdrop color within the threshold distance, those subject pixels will also be made transparent. Full semantic matting is deferred to future AI phases.

### 3.5. Dimension Normalization
- **Canonical Output Dimensions**: `512 × 512` pixels (configurable up to 1024×1024 via `targetDimensions`).
- **Resampling Filter**: High-order `Lanczos3` kernel (`kernel: sharp.kernel.lanczos3`). Provides optimal sharpness and photographic downsampling without aliasing.
- **Upscaling Policy**: Dimensions are scaled directly to canonical targets using Lanczos3 resampling.

### 3.6. Output Format & Metadata Sanitization
- **Format**: Lossless 8-bit RGBA `PNG` (`format: "png"`).
- **Compression**: Level 9 with adaptive filtering for optimal local file size.
- **Privacy & Metadata Sanitization**: All camera EXIF tags, GPS latitude/longitude coordinates, IPTC tags, XMP blocks, device identifiers, and ICC profiles are stripped during PNG serialization. The processed output contains zero tracking metadata.

---

## 4. Temporary Processed Storage & Security

- **Location**: Isolated, application-owned folder `pixelpal_processed` inside the OS temporary directory (`os.tmpdir() / "pixelpal_processed"`).
- **Storage ID Generation**: Cryptographically generated identifier:
  `processed_char_<timestamp>_<randomHex>`
- **Path Traversal Defense**: Rejects any attempt to use traversal tokens (`..`), path separators (`/`, `\`), or absolute external paths. Callers cannot specify arbitrary output file paths.
- **File System Permissions**: Written with POSIX `0o600` mode (read/write by owner only).
- **Cleanup Capabilities**:
  - `deleteProcessed(storageId)`: Removes specific processed asset.
  - `cleanupExpired(ttlMs)`: Cleans up orphaned processing artifacts older than TTL (default 2 hours), strictly ignoring unrelated files.
  - `clearAll()`: Purges processed cache upon application shutdown or session termination, strictly ignoring non-conforming filenames.
  - **Failure Cleanup**: If any stage of preprocessing fails, any partial or uncommitted output files are immediately cleaned up.

---

## 5. Contract Definitions

### Request Contract
```typescript
export interface PreprocessImageRequest {
  readonly source:
    | UploadSuccessResult
    | {
        readonly storageId: string;
        readonly tempFilePath: string;
        readonly format: ImageFormat;
      };
  readonly options?: PreprocessOptions;
}

export interface PreprocessOptions {
  readonly targetDimensions?: ImageDimensions; // Default: 512x512
  readonly cropMode?: CropMode;                 // Default: "center-crop-square"
  readonly backgroundRemovalMode?: BackgroundRemovalMode; // Default: "none"
  readonly backgroundRemovalThreshold?: number; // Default: 25
  readonly normalizeOrientation?: boolean;      // Default: true
  readonly stripMetadata?: boolean;             // Default: true
}
```

### Result Contracts
```typescript
export interface PreprocessSuccessResult {
  readonly success: true;
  readonly processedStorageId: string;
  readonly processedFilePath: string;
  readonly sourceStorageId: string;
  readonly metadata: ProcessedImageMetadata;
  readonly processingInfo: PreprocessExecutionInfo;
  readonly createdAt: number;
}

export interface PreprocessFailureResult {
  readonly success: false;
  readonly errors: readonly ImageProcessingError[];
  readonly sourceStorageId?: string;
}

export type PreprocessResult = PreprocessSuccessResult | PreprocessFailureResult;
```

### Structured Diagnostic Errors
| Code | Category | Cause |
| :--- | :--- | :--- |
| `INVALID_SOURCE` | Input validation | Missing source file, unvalidated path, or corrupted Phase 1 reference |
| `DECODE_FAILED` | Raster decode | Malformed image payload, corrupted IDAT/scan stream, unsupported bit depth |
| `UNSUPPORTED_RASTER` | Decoder compatibility | Non-approved format (not png/jpeg/webp) or multi-frame animated image |
| `ORIENTATION_FAILED` | Geometry | Malformed EXIF orientation matrix |
| `CROP_FAILED` | Geometry | Target crop region exceeds image bounds or calculations underflow |
| `BACKGROUND_REMOVAL_FAILED` | Matting | Background removal filter error |
| `DIMENSION_NORMALIZATION_FAILED` | Resampling | Resizing error or invalid target dimensions |
| `OUTPUT_WRITE_FAILED` | Storage | I/O error writing PNG to application-owned storage |
| `RESOURCE_LIMIT` | Resource safety | Image exceeds maximum decoded pixel limit (16 MP) |
| `PROCESSING_TIMEOUT` | Timeouts | Pipeline step exceeded allocated execution time |

---

## 6. Determinism & Quality Guarantees

- **Deterministic Dimensions**: For any given input and `targetDimensions`, the output image has exact, verifiable width and height.
- **Deterministic Checksum**: For the same input bytes and options, Sharp produces identical PNG byte arrays with identical SHA-256 hashes.
- **Offline & Local**: Zero remote API dependencies, zero external network sockets, zero telemetry.
- **No Shared State**: Processors and storage adapters are fully re-entrant and thread-safe.
