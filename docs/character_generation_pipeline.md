# PixelPal — Controlled AI Character Generation Pipeline

**Version:** 1.3.0<br/>
**Scope:** Sprint 7 (Character Expressions & Asset System)<br/>
**Upstream Checkpoint:** `61b7abd` (Sprint 6 Phase 5: Character Profile & Asset Identity Foundation)

---

## 1. Executive Summary & Objective

PixelPal allows users to create personalized pixel-art companions from their own photographs. In Sprint 6 Phase 1, an impermeable upload boundary was established to validate raw bytes, magic signatures, headers, and dimensions. In Sprint 6 Phase 2, a deterministic preprocessing engine was introduced to decode rasters safely, normalize EXIF orientation, crop to a 1:1 framing, normalize dimensions to 512×512, strip camera/GPS metadata, and provide safe intermediate temporary storage. In Sprint 6 Phase 3, a controlled AI character generation engine was established behind a vendor-neutral provider abstraction using `gpt-image-2.5-sunburst` to create 1024×1024 character base images. In Sprint 6 Phase 4, a deterministic pixel-art processor was added to downscale images using nearest-neighbor semantics to 64×64, enforce binary alpha thresholding, and apply Median-Cut color quantization to 16 opaque colors.

Sprint 6 Phase 5 concludes the Sprint 6 character generation epic by introducing the **Character Profile & Asset Identity Foundation**. Phase 5 performs:
1. **Canonical Character ID Generation**: Creates collision-resistant, cryptographically strong unique identifiers (`character_<timestamp>_<randomHex>`) validated via strict regex.
2. **Canonical Profile Schema**: Establishes a strongly typed, versioned domain contract (`CharacterProfile`, `schemaVersion: 1`) binding together asset references, style options, clothing configuration, and quantized palette data.
3. **Asset Provenance & Non-Duplication**: Links to Phase 3 generated images (`generated_char_*`) and Phase 4 pixel sprites (`sprite_char_*`) by ID without duplicating raw image bytes or filesystem paths.
4. **Controlled Clothing Configuration**: Records structured attire selections using closed enums (category, top, bottom, footwear, accessories, color theme), strictly eliminating prompt injection vulnerabilities.
5. **Discrete Palette Representation**: Captures the actual extracted RGB palette colors, atmospheric mood, maximum opaque color count, and alpha threshold.
6. **Safe Atomic Persistence**: Persists profiles as durable JSON documents in the desktop application's persistent application data directory (`<appDataDir>/profiles/`) with atomic write patterns (`.tmp` write followed by rename), POSIX `0o600` permissions, and traversal defense. Pipeline image caches (upload, processed, generated, sprite) remain in temporary storage.
7. **Strict Immutability**: Enforces that `characterId` and `createdAt` can never be mutated, and ensures that profile operations never overwrite or delete underlying Phase 3 and Phase 4 image assets.

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
Validated Temporary Source Image (`char_upload_<id>.<ext>` in `pixelpal_uploads/`)

Phase 2 (Completed):
Validated Temporary Source Image Reference
      │
      ▼
Safe Raster Decode + EXIF Orientation + Center Crop + BG Removal + 512x512 Lanczos3
      │
      ▼
Sanitized Intermediate PNG (`processed_char_<id>.png` in `pixelpal_processed/`)

Phase 3 (Completed):
Sanitized Intermediate PNG Reference
      │
      ▼
Controlled Prompt Builder (Typed Style -> Template -> Injection-Free Prompt)
      │
      ▼
Provider Abstraction (OpenAIImageGenerationProvider)
      │  [External Network Boundary: Transmits sanitized PNG + controlled prompt ONLY]
      ▼
AI Image Generation API (gpt-image-2.5-sunburst / b64_json)
      │
      ▼
Output Image Validation (Raster Decode, Dimension Verification, Strip Metadata)
      │
      ▼
Generated Intermediate PNG (`generated_char_<id>.png` in `pixelpal_generated/`)

Phase 4 (Completed):
Generated Intermediate PNG Reference
      │
      ▼
Source Validation & Traversal Defense (`generated_char_<id>.png` in `pixelpal_generated/`)
      │
      ▼
Sharp Nearest-Neighbor Aspect Resampling (64×64 default, 128×128 optional) + Transparent Contain Padding
      │
      ▼
Raw RGBA Extraction & Segregated Alpha Thresholding (alphaThreshold: 128)
      │
      ▼
Deterministic Median-Cut Color Quantization (16 Opaque Colors, Zero Halos, Dither: OFF)
      │
      ▼
Metadata-Free PNG Encoding & SHA-256 Digest
      │
      ▼
Sprite-Ready PNG (`sprite_char_<id>.png` in `pixelpal_sprites/`)

Phase 5 (This Phase — Character Profile & Identity Foundation):
Generated Asset Reference (`generated_char_<id>`) + Sprite Asset Reference (`sprite_char_<id>`)
      │
      ▼
Asset Integrity & Storage Namespace Validation
      │
      ▼
Closed-Union Style, Clothing & Quantized Palette Ingestion
      │
      ▼
Canonical CharacterProfile Construction (`character_<id>`, schemaVersion: 1)
      │
      ▼
Atomic File-Based Persistent Storage (`<appDataDir>/profiles/<id>.json`)
```

> [!IMPORTANT]
> **Production Runtime Separation**:
> - **Headless Capability**: Phase 5 is implemented as a headless Node-side domain capability and test suite.
> - **Deferred Integration**: There is currently NO production desktop UI, NO Tauri IPC command, and NO background Node daemon/sidecar. Frontend UI integration and production IPC wiring are intentionally deferred to subsequent integration sprints.
> - **Zero Database / Zero Native Bloat**: Profile persistence uses lightweight, atomic file-based JSON storage, avoiding premature SQLite or external database dependencies at this stage. Client bundling (`tsc && vite build`) remains completely unaffected.

---

## 3. Controlled Prompt Construction & Injection Defense

To ensure reproducible, on-brand character generation and prevent arbitrary prompt injection, PixelPal completely forbids passing raw user-entered text strings into model prompts.

### 3.1. Strongly Typed Style Dimensions
Instead of a free-form prompt box, character generation is driven by typed enums:
- **`renderingStyle`**: `"chibi-pixel-art"` (default), `"retro-arcade"`, `"modern-isometric"`, `"classic-16bit"`
- **`proportions`**: `"super-deformed"` (2-head-tall, default), `"subtle-chibi"` (3-head-tall), `"standard-mascot"` (2.5-head-tall)
- **`expression`**: `"friendly-idle"` (default), `"happy"`, `"curious"`, `"focused"`, `"confident"`
- **`paletteMood`**: `"original-fidelity"` (default), `"vibrant"`, `"pastel"`, `"warm"`, `"cool"`
- **`detailLevel`**: `"high-fidelity"` (default), `"simplified-iconic"`
- **`backgroundIntent`**: `"transparent-ready"` (solid flat white, default), `"solid-white"`, `"minimal-backdrop"`

### 3.2. Template Architecture
The prompt builder (`buildCharacterPrompt`) combines fixed instructional directives:
1. **Core Mission**: Directs the model to generate a base companion portrait preserving the subject's recognizable identity (hair, skin tone, facial features, clothing).
2. **Style Directives**: Appends pre-formulated instructional blocks corresponding to the selected style enums.
3. **Negative Directives**: Enforces single-character centered framing, front/three-quarters view, and strictly forbids text, speech bubbles, letters, watermarks, UI frames, windows, extra people, and photorealistic/3D clay aesthetics.

---

## 4. OpenAI Provider Implementation

### 4.1. Model Selection & Authoritative Capability Boundary
- **Primary & Default Model**: `gpt-image-2.5-sunburst`
  - Selected as the authoritative model for reference-image character editing. Supports both `v1/images/edits` (with reference image conditioning) and `v1/images/generations`.
- **Speed-Oriented Generation Model**: `gpt-image-2.5-flare`
  - Retained strictly for direct text-to-image generation (`v1/images/generations`).
  - **Capability Boundary**: Current official OpenAI documentation documents Flare for `v1/images/generations`. Flare is strictly blocked from the reference-image `images.edit` endpoint, returning a structured `AI_REQUEST_FAILED` error if invoked with reference images.
- **Pricing Alignment**: Published token rates for the GPT-Image-2.5 family are comparable; Flare is designated as a speed-oriented alternative rather than a discounted tier.
- **Legacy Models Removed**:
  - `dall-e-3` and `dall-e-2` are not supported. `dall-e-3` does not support reference image editing (`images.edit`), preventing visual identity preservation from user photos.

### 4.2. API Surface
- **Image Editing (`client.images.edit`)**: The primary operational path for photo-to-character generation. The preprocessed 512×512 PNG image buffer is packaged via `toFile()` as `reference_subject.png` and passed alongside the instructional prompt. The request explicitly specifies:
  - `image`: The preprocessed 512×512 PNG reference buffer
  - `prompt`: The controlled character style prompt
  - `model`: `"gpt-image-2.5-sunburst"`
  - `n`: 1
  - `size`: `"1024x1024"`
  - `output_format`: `"png"`
  - `background`: `"transparent"`
- **Direct Generation (`client.images.generate`)**: Supported for text-only generation prompts (e.g. when evaluating speed-oriented `gpt-image-2.5-flare`).
- **Payload Extraction**: Inspects returned data, prioritizing base64 JSON (`b64_json`) directly to prevent secondary network latency and CDN expiration, with seamless fallback to temporary URL fetching.

### 4.3. Error Taxonomy & Sanitization
Provider errors are mapped to machine-readable domain error codes without leaking API keys or internal HTTP authorization headers:
| Error Code | HTTP / Cause | Description |
| :--- | :--- | :--- |
| `AI_CONFIGURATION_MISSING` | Environment | `OPENAI_API_KEY` is missing or empty |
| `AI_AUTHENTICATION_FAILED` | HTTP 401 / 403 | Invalid API key or unauthorized project |
| `AI_RATE_LIMITED` | HTTP 429 | Quota exhausted or rate limit triggered |
| `AI_CONTENT_REJECTED` | HTTP 400 (Safety) | Request blocked by safety / content moderation filters |
| `AI_TIMEOUT` | HTTP 408 / Timeout | Request timed out (configurable, default 60s) |
| `AI_REQUEST_FAILED` | HTTP 5xx / Network | Transient connection drops or internal server error |
| `AI_INVALID_RESPONSE` | Response structure | Missing image data or empty byte payload |
| `AI_OUTPUT_INVALID` | Validation | Returned bytes cannot be decoded as a valid raster |
| `AI_OUTPUT_UNSUPPORTED` | Validation | Output format or dimensions outside safe bounds |
| `AI_OUTPUT_STORAGE_FAILED` | Storage | I/O failure persisting output to generated storage |

### 4.4. Bounded Retry Policy
Generation calls are not retried automatically on authentication errors, content rejections, or invalid responses. Retries are strictly bounded (`maxRetries`, default 0) to prevent duplicate billing and unexpected costs.

---

## 5. Security & Privacy Guarantees

### 5.1. What Leaves the Machine
Only two pieces of data ever leave the user's computer:
1. The **Phase 2 sanitized PNG image buffer** (which has already been cropped, normalized to 512×512, stripped of all camera EXIF, GPS, and device tags, and converted to intermediate PNG).
2. The **system-controlled prompt string** describing the desired character aesthetic.

### 5.2. What NEVER Leaves the Machine
- Raw original upload photos.
- EXIF, GPS, camera model, or timestamp metadata.
- Original client filenames, storage IDs, or internal file paths.
- Local system context, OS events, or user activity logs.

### 5.3. Credential Hygiene
- `OPENAI_API_KEY` is read strictly from `process.env.OPENAI_API_KEY`.
- Keys are never stored in the repository, `.env` files, or client-side bundles.
- All error mappers explicitly sanitize and redact strings matching `sk-...` and `Bearer ...`.

---

## 6. Generated Asset Storage & Path Traversal Defense

- **Location**: Application-controlled temporary directory `pixelpal_generated` (`os.tmpdir() / "pixelpal_generated"`).
- **Storage ID**: Cryptographically generated identifier: `generated_char_<timestamp>_<randomHex>.png`.
- **Validation**: Strict regex validation (`/^generated_char_\d+_[a-f0-9]{8,32}$/`). Traversal paths containing `..` or absolute paths are rejected.
- **Permissions**: Files written with POSIX mode `0o600` (read/write by owner only).
- **Failure Cleanup**: If output validation, hashing, or storage persistence fails, any partial or uncommitted files are immediately deleted.
- **Preservation of Other Assets**: Cleanup routines (`cleanup`, `cleanupExpired`, `cleanupAll`) target only files matching the generated storage ID format, ensuring unrelated files, Phase 1 uploads, and Phase 2 assets are never touched.

---

## 7. Testing & Verification

### 7.1. Offline Hermetic Unit Tests (`npm test`)
All CI and local tests execute completely offline using `MockCharacterGenerationProvider`:
- Zero real API keys required.
- Zero network requests executed.
- Verified prompt construction, style overrides, error mapping, output validation, dimension bounds, and storage isolation.

### 7.2. Opt-In Manual Live Smoke Test
An explicitly opt-in manual verification script is available:
```powershell
$env:OPENAI_API_KEY="sk-..."
npx tsx src/character/__tests__/manual_live_smoke.ts
```
- Requires a real API key at runtime.
- Never logs or prints the key.
- Generates a synthetic test character, validates output, and cleans up temporary assets immediately.
- Safely skips when `OPENAI_API_KEY` is not set.

---

## 8. Deterministic Pixel-Art Processing & Sprite Foundation (Phase 4)

### 8.1. Architectural Scope & Invariant
Phase 4 ingests validated Phase 3 generated images (`generated_char_<timestamp>_<hex>`) and produces clean, transparent, sprite-ready pixel art (`sprite_char_<timestamp>_<hex>.png`).
- **No AI Invocations**: Phase 4 is a 100% deterministic, offline mathematical processing stage.
- **Source Preservation**: Phase 3 generated source files are strictly read-only and never modified or overwritten.
- **Zero Hallucinated Edge Halos**: Segregated alpha pipeline guarantees that transparency is never quantized into opaque colors.

### 8.2. Canonical Sprite Dimension Policy
- **Canonical Default**: `64×64` square canvas. Matches the canonical frame dimensions established by the PixelPal desktop animation engine.
- **Optional High-Resolution**: `128×128` square canvas. Supported as a validated configuration option for detailed companion profiles.
- **Aspect Ratio & Centering**: Input images that deviate from square proportions are fitted using Sharp's `fit: 'contain'` policy with transparent padding (`{ r: 0, g: 0, b: 0, alpha: 0 }`), ensuring zero subject stretching or cropping. Arbitrary non-canonical dimensions (e.g. 96×96) are rejected.

### 8.3. Alpha-Aware Segregation & Binary Cutoff
- **Alpha Isolation**: Alpha is excluded entirely from the color quantization budget. The transparent background is never assigned to a palette index.
- **Binary Alpha Thresholding**: Semi-transparent edge pixels produced by AI anti-aliasing are evaluated against `alphaThreshold` (default `128`):
  - `alpha >= 128` -> Converted to fully opaque (`alpha = 255`).
  - `alpha < 128` -> Converted to fully transparent (`rgba = (0, 0, 0, 0)`).
- **Zero Color Bleeding**: Transparent pixels are explicitly zeroed out in RGB channels (`0, 0, 0, 0`) to prevent dirty fringes when blended over desktop backgrounds.

### 8.4. Deterministic Median-Cut Color Quantization
- **Algorithm**: Deterministic Median-Cut clustering.
  - Opaque pixels are recursively split into bounding boxes along the color channel with the widest range (`max(maxR - minR, maxG - minG, maxB - minB)`).
  - Channel tie-breaking is fixed deterministically: `Red` -> `Green` -> `Blue`.
  - Splitting uses the median of sorted channel values with deterministic secondary and tertiary color sorting.
- **Palette Limits**: Default `maxOpaqueColors: 16`. Configurable between `2` and `256`.
- **Dithering Policy**: Dithering is disabled by default (`dither: false`) to preserve sharp, clean pixel-art boundaries. Optional Floyd-Steinberg error diffusion is available when explicitly requested.

### 8.5. Nearest-Neighbor Downscaling Semantics
- **Resampling Kernel**: `sharp.kernel.nearest` is enforced during downscaling.
- **No Interpolation Blur**: Downscaling with nearest-neighbor produces authentic pixel clusters rather than blurred bicubic/Lanczos gradients.

### 8.6. Sprite Storage Model & Traversal Defense
- **Location**: Application-controlled directory `pixelpal_sprites` (`os.tmpdir() / "pixelpal_sprites"`).
- **ID Format**: `sprite_char_<timestamp>_<randomHex>` (validated via `/^sprite_char_\d+_[a-f0-9]{8,32}$/`).
- **File System Permissions**: Stored with POSIX `0o600` (owner read/write only).
- **Rollback & Lifecycle**: Automatic rollback on failure; scoped cleanup (`cleanup`, `cleanupAll`) only touches files matching the sprite storage ID format, leaving other directories and unrelated files untouched.

### 8.7. Determinism & Privacy Guarantees
- **Cryptographic Reproducibility**: Given identical input bytes and options, the processor produces identical pixel buffers and identical SHA-256 digests across repeated executions.
- **Privacy**: All EXIF, IPTC, XMP, GPS, and camera metadata are stripped during PNG output.
- **Zero Network Access**: Completely offline execution.

### 8.8. Structured Error Taxonomy
| Error Code | Meaning |
| :--- | :--- |
| `PIXEL_SOURCE_INVALID` | Source reference missing, file missing, traversal attempt, or path outside generated storage |
| `PIXEL_DECODE_FAILED` | File corrupted, zero bytes, or invalid image stream |
| `PIXEL_UNSUPPORTED_FORMAT` | Unsupported image format (requires PNG/JPEG/WebP) |
| `PIXEL_RESOURCE_LIMIT` | Image exceeds dimension or pixel bounds (e.g. > 8192×8192) |
| `PIXEL_RESIZE_FAILED` | Resize processing failure or invalid dimension configuration |
| `PIXEL_QUANTIZATION_FAILED` | Quantization algorithm execution failure |
| `PIXEL_OUTPUT_FAILED` | PNG re-encoding failure |
| `PIXEL_STORAGE_FAILED` | File system persistence error |

### 8.9. Distinction Across Pipeline Phases
- **Phase 3 (Generate)**: Employs AI (`gpt-image-2.5-sunburst`) to generate a full-fidelity chibi/pixel character illustration (1024×1024).
- **Phase 4 (Pixel Process)**: Converts the high-resolution illustration into a deterministic, quantized, nearest-neighbor 64×64 sprite asset.
- **Phase 5 (Profile & Persistence)**: Links the sprite asset to a `CharacterProfile`, SQLite storage, and animation state machine.
- *Note*: Phase 4 produces the base sprite asset; it does not generate multi-frame animation sheets.

---

## 9. Canonical Character Profile & Asset Identity Foundation (Phase 5)

### 9.1. Architectural Scope & Invariants
Phase 5 establishes the canonical identity and persistence layer for PixelPal companions.
- **Metadata and Provenance Only**: The `CharacterProfile` links to Phase 3 generated images and Phase 4 pixel sprites strictly by storage ID. It contains zero raw image bytes and zero base64 buffers.
- **Underlying Asset Immutability**: Profile creation, update, and deletion operations never modify, overwrite, or delete underlying Phase 1–4 image files.
- **Portability & Privacy**: Zero device paths, zero personal GPS/EXIF data, and zero API keys are stored in the profile document.

### 9.2. Stable Character ID Specification
- **Format**: `character_<timestamp>_<randomHex>`
- **Validation**: Strict regex `/^character_\d+_[a-f0-9]{8,32}$/`
- **Collision Resistance**: Cryptographically strong random entropy (minimum 64-bit entropy via `crypto.getRandomValues`).
- **Path Traversal Defense**: Rejects directory separators (`/`, `\`), path traversal tokens (`..`), and URI schemes (`:`).

### 9.3. Profile Schema & Versioning
- **Explicit Version**: `schemaVersion: 1` enforced at runtime. Unsupported future versions are rejected without silent corruption.
- **Immutable Fields**: `characterId` and `createdAt` are strictly read-only after creation. Updates mutate only `updatedAt`, `style`, `clothing`, `palette`, `assets`, or `metadata`.

### 9.4. Controlled Clothing Configuration
Attire selections are strictly constrained to closed enums to prevent prompt injection and schema drift:
- **`category`**: `"casual"` | `"formal"` | `"fantasy"` | `"cyberpunk"` | `"streetwear"` | `"athletic"` | `"cozy"` | `"traditional"` | `"uniform"` | `"vintage"`
- **`top`**: `"t-shirt"` | `"hoodie"` | `"jacket"` | `"sweater"` | `"dress-shirt"` | `"blazer"` | `"tank-top"` | `"tunic"` | `"vest"` | `"robe"` | `"none"`
- **`bottom`**: `"jeans"` | `"cargo-pants"` | `"slacks"` | `"shorts"` | `"skirt"` | `"sweatpants"` | `"leggings"` | `"overalls"` | `"robe"` | `"none"`
- **`footwear`**: `"sneakers"` | `"boots"` | `"dress-shoes"` | `"sandals"` | `"slippers"` | `"loafers"` | `"barefoot"`
- **`accessories`**: Optional array from closed set (`"glasses"`, `"headphones"`, `"backpack"`, `"hat"`, `"scarf"`, etc.)
- **`colorTheme`**: `"monochrome"` | `"cool-slate"` | `"warm-autumn"` | `"vibrant-primary"` | `"pastel-soft"` | `"earth-tone"` | `"neon-cyber"` | `"midnight-navy"` | `"forest-green"` | `"crimson-ruby"`

### 9.5. Structured Palette Configuration
Directly captures the discrete quantized palette produced in Phase 4:
- **`mood`**: Reused from Phase 3/4 (`"original-fidelity"`, `"vibrant"`, `"pastel"`, `"warm"`, `"cool"`).
- **`maxOpaqueColors`**: Integer between 2 and 256 (default 16).
- **`colors`**: Array of distinct `{ r, g, b }` color values extracted from the quantized sprite.
- **`transparencyPolicy`**: `"binary-threshold"` | `"preserved"`.
- **`alphaThreshold`**: Integer between 0 and 255 (default 128).

### 9.6. Safe Atomic Persistence Model
- **Storage Directory**: Persistent application-controlled directory `<appDataDir>/profiles/` (resolved cross-platform via standard desktop conventions: Windows `%APPDATA%\com.pixelpal.desktop\profiles`, macOS `~/Library/Application Support/com.pixelpal.desktop/profiles`, Linux `$XDG_DATA_HOME/com.pixelpal.desktop/profiles` or `~/.local/share/com.pixelpal.desktop/profiles`). Mode `0o700`.
- **Pipeline Intermediates vs. Profile Durability**: Upload (`pixelpal_uploads/`), preprocessed (`pixelpal_processed/`), generated (`pixelpal_generated/`), and sprite (`pixelpal_sprites/`) image assets reside in application-managed temporary storage (`os.tmpdir()`), whereas CharacterProfile documents represent persistent companion identity and are stored durably across OS restarts and temp maintenance cycles.
- **File Naming**: `${characterId}.json` with POSIX mode `0o600` (owner read/write only).
- **Atomic Write Pattern**:
  1. Profile is validated against `validateProfile()`.
  2. JSON is serialized and written to temporary file `${characterId}.tmp.<randomHex>`.
  3. Atomic file rename moves the temp file to `${characterId}.json`.
  4. On failure, temporary files are immediately cleaned up, preventing partially written or corrupted profiles.
- **Schema Validation on Read**: Every profile loaded from disk is validated against the active schema before being returned.

### 9.7. Structured Error Taxonomy
| Error Code | Meaning |
| :--- | :--- |
| `CHARACTER_PROFILE_INVALID` | Profile payload or field structure fails validation |
| `CHARACTER_ID_INVALID` | Malformed character ID, path traversal attempt, or invalid format |
| `CHARACTER_SCHEMA_UNSUPPORTED` | Profile schema version not supported (requires version 1) |
| `CHARACTER_ASSET_MISSING` | Referenced Phase 3 generated asset or Phase 4 sprite asset not found in storage |
| `CHARACTER_ASSET_INVALID` | Asset reference ID format invalid or storage namespace mismatch |
| `CHARACTER_STYLE_INVALID` | Style option contains invalid or unapproved enum value |
| `CHARACTER_CLOTHING_INVALID` | Clothing option contains invalid category, top, bottom, or footwear enum |
| `CHARACTER_PALETTE_INVALID` | Palette configuration has invalid color count, threshold, or RGB values |
| `CHARACTER_PROFILE_NOT_FOUND` | Profile ID not found during get, update, or delete operations |
| `CHARACTER_PROFILE_STORAGE_FAILED` | File system I/O error or collision on creation |
| `CHARACTER_PROFILE_DELETE_FAILED` | File system deletion failure |

### 9.8. Sprint 6 Complete Retrospective
With Phase 5 complete, the entire 5-phase character generation pipeline is functional, headless, deterministic, and fully covered by hermetic tests:
1. **Phase 1 (Upload)**: Anti-spoofing signature validation and safe staging.
2. **Phase 2 (Preprocess)**: 512×512 normalization, EXIF orientation correction, local background removal.
3. **Phase 3 (Generate)**: Controlled prompt synthesis and `gpt-image-2.5-sunburst` reference editing.
4. **Phase 4 (Pixel Process)**: Nearest-neighbor 64×64 downscaling, binary alpha cutoff, 16-color Median-Cut quantization.
5. **Phase 5 (Profile)**: Canonical identity, asset binding, structured clothing/palette models, and atomic persistence.

---

## 10. Sprint 7: Character Expressions & Asset System

Sprint 7 transitions PixelPal from a single generated base companion character into a complete multi-expression animation pack.

```
+─────────────────────────────────────────────────────────────────────────────+
|                         SPRINT 7 EXPRESSION PIPELINE                        |
+─────────────────────────────────────────────────────────────────────────────+

       CharacterProfile (Identity Authority)
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
Controlled Prompt         Base Character
Builder (9 Expressions)   Sprite Reference
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
          AI Generation Provider
     (OpenAI / MockProvider in Tests)
                     │
                     ▼
             PixelArtProcessor
      (64x64, Alpha Threshold, Quantize)
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
Consistency Validator    Quality Validator
 (Identity, Attire,     (PNG, Transparency,
  Palette, Dimensions)   No Halos, Crisp Edges)
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
        CharacterExpressionRegistry
     (Sprint 2 AnimationManifest Integration
       + Deterministic Fallback Strategy)
```

### 10.1. Nine-Expression MVP Taxonomy
Sprint 7 defines a canonical, closed-union 9-expression taxonomy (`CharacterExpressionId`):
1. **`idle`**: Resting neutral demeanor, calm breathing posture, soft smiling eyes (ambient state).
2. **`happy`**: Joyful, radiant smile, smiling curved eyes, energetic cheerful stance.
3. **`sad`**: Visibly sorrowful downcast eyes, drooping mouth, subtle slumped posture.
4. **`worried`**: Anxious furrowed brow, concerned wide eyes, nervous glance, slight hesitation.
5. **`sleepy`**: Closed or half-lidded resting eyes, peaceful drowsy expression, cozy posture.
6. **`surprised`**: Wide astonished circular eyes, open-mouthed startled expression, alert posture.
7. **`panic`**: High-distress alarm, wide fearful eyes, distressed hand reaction, startled pose.
8. **`celebrate`**: Triumphant cheering expression, beaming smile, hands raised, celebratory hop.
9. **`thinking`**: Contemplative thoughtful gaze, hand to chin or cheek, curious pensive expression.

### 10.2. Character Consistency Contract
To prevent nine loosely related AI characters from being generated, `CharacterProfile` serves as the strict identity authority:
- **Hairstyle & Facial Identity**: Injected directives mandate identical hairstyle, hair color, skin tone, eye color, and face shape from the reference base.
- **Clothing Binding**: Exact clothing top, bottom, footwear, accessories, and color theme from `profile.clothing` are enforced.
- **Palette Budget**: Extracted palette colors and `profile.palette.maxOpaqueColors` are enforced during quantization and verified via `validateExpressionConsistency()`.
- **Dimension Uniformity**: Canonical 64×64 frame dimensions are verified at both record and raster levels.
- **Asset Identity**: Stable naming format `expr_asset_<characterId>_<expression>_<hash>` links character and expression with SHA-256 integrity verification.

### 10.3. Controlled Expression Prompt Generation
Prompts are synthesized entirely internally from strongly typed domain contracts via `buildExpressionPrompt()`. Arbitrary user-supplied prompt text, filesystem paths, storage IDs, EXIF, and device metadata are strictly excluded, eliminating prompt injection risks.

### 10.4. Animation Manifest & Asset Registry Integration
`CharacterExpressionRegistry` integrates directly with Sprint 2 animation contracts:
- Reuses `AnimationDefinition`, `AnimationManifest`, `FrameDimensions`, `LoopMode`, `ValidationResult`, and `ResolvedAnimation`.
- Maps each expression to playback metadata: FPS, frame count, duration in milliseconds, and loop mode (`loop` vs `one-shot`).
- Supports JSON serialization and round-trip reloading via `toJSON()` and `fromJSON()`.

### 10.5. Deterministic Fallback Strategy
When a consumer requests an expression asset:
```
Requested Expression
        │
        ▼
Registered in Manifest?
 ├── YES ──► Valid Asset?
 │            ├── YES ──► Return Asset (resolvedFromFallback: false)
 │            └── NO  ──► Custom Fallback (if defined) or Default Fallback ('idle')
 └── NO  ──► Custom Fallback (if defined) or Default Fallback ('idle')
```
- Missing optional expressions fall back safely to `idle` without throwing unhandled exceptions into the renderer.
- Fallbacks are explicitly tracked via `resolvedFromFallback: true` and descriptive `fallbackReason`.

### 10.6. Asset Quality Validation Pipeline
`validateExpressionAssetQuality()` enforces automated quality gates:
1. **Format**: Valid PNG magic bytes (`0x89504E470D0A1A0A`) and clean raster decode.
2. **Dimensions**: Exact match against expected canvas size (64×64).
3. **Alpha Channel**: Required 4-channel RGBA with active transparency.
4. **Silhouette Isolation**: Inspects all four canvas corners; rejects assets where corners are fully opaque (indicating unremoved backgrounds).
5. **Content Verification**: Rejects 100% transparent empty canvases.
6. **Pixel Crispness**: Rejects semi-transparent anti-aliased edge halos (`maxSemiTransparentPixels: 0`) to guarantee authentic pixel-art rendering.

### 10.7. Manual Aseprite Refinement Workflow
While the pipeline is fully automated and headless, pixel artists can manually touch up expression assets:
1. **Export**: Export validated expression PNG (`expr_asset_*.png`).
2. **Aseprite Touch-Up**: Open in Aseprite to manually refine pixel clusters, adjust dithering, clean silhouette outlines, or align frame sequences.
3. **Save**: Save as standard 32-bit RGBA PNG with transparency preserved.
4. **Re-Validation**: Pass the edited sprite back through `validateExpressionConsistency()` and `validateExpressionAssetQuality()`.
5. **Zero Runtime Dependency**: Aseprite is treated strictly as an external authoring tool. The desktop runtime has zero dependency on Aseprite being installed.

### 10.8. Storage Architecture
- **Durable Identity**: `CharacterProfile` JSON documents reside in `<appDataDir>/profiles/`.
- **Companion Asset Packs**: Final validated expression assets are indexed by stable asset ID and referenced via application sprite paths (`/assets/sprites/<characterId>/<expression>.png`).
- **Temporary Cache**: Raw upload, preprocessed, generated, and scratch files remain in temporary storage (`os.tmpdir()`).

---

## 11. Sprint 8 — Personality Engine & Behavioral Integration

Sprint 8 achieves the roadmap goal: *"Make the same event feel different depending on the selected personality."*

```text
Desktop Event (Native OS Detectors)
        │
        ▼
EventBus (Typed Dispatches)
        │
        ▼
ReactionResolver (Deterministic Priority, Cooldown, Active State)
        │
        ▼  [Accepted Reaction Rule]
PersonalityEngine (Config-Driven Presentation Shaping)
   ├── Personality Profiles (Cute, Friendly, Sarcastic, Chaotic, Calm, Professional)
   ├── Preferred Expression Modulation (Sprint 7 Expression Mapping)
   ├── Reaction Frequency Gating (Critical priority >= 80 NEVER suppressed)
   ├── Local Deterministic Dialogue Templates (Safe regex interpolation: {var})
   └── Offline-First AI Boundary (Optional LLM enhancement with guaranteed local fallback)
        │
        ▼
Presentation Contract (AnimationId, DialogueText, NotificationIntensity)
```

### 11.1. Conceptual Separation: Identity vs. Behavior
- **CharacterProfile (Sprint 6)**: Answers *"WHO is this character?"* (hair, clothing, palette, proportions, asset references).
- **PersonalityConfig (Sprint 8)**: Answers *"HOW does this character behave?"* (dialogue tone, preferred expression choice, reaction frequency, notification intensity).
Changing personality never alters the character's immutable identity or regenerates a new `characterId`.

### 11.2. Canonical 6 MVP Personality Taxonomy
1. **Cute**: Cheerful, highly expressive, affectionate, playful.
2. **Friendly (Default)**: Supportive, warm, balanced, welcoming.
3. **Sarcastic**: Dry humor, witty, context-sensitive playful teasing (strictly non-abusive).
4. **Chaotic**: High-energy, dramatic, eccentric, high expressive variety.
5. **Calm**: Composed, gentle, peaceful, low notification intensity.
6. **Professional**: Concise, formal, structured, productivity-focused.

### 11.3. Local Dialogue Templates & Safe Interpolation
- **Event Coverage**: 12 canonical MVP events across all 6 personalities (72 deterministic combinations).
- **Variables**: Bounded variables (`battery_percent`, `ac_line_status`, `network_connected`, `network_type`, `app_name`, `filename`, `idle_minutes`).
- **Template Security**: Controlled regex interpolation (`/\{([a-zA-Z0-9_]+)\}/g`). Zero `eval()` or `new Function()`. Prototype properties disbarred. Unknown variables remain inert (`[var]`).

### 11.4. Behavioral Shaping & Critical Safety Invariant
- **Expression Modulation**: Active profile's `preferredExpressions` refines standard animation to a specific Sprint 7 expression (e.g., Cute uses `celebrate` on downloads; Chaotic uses `panic` on battery warnings).
- **Reaction Frequency**:
  - `high`: All reactions presented.
  - `normal`: Routine pacing.
  - `low`: Routine/low-priority reactions (priority $\le 30$, e.g. user idle, app opened) are suppressed.
  - **CRITICAL SAFETY INVARIANT**: Reactions with priority $\ge 80$ (`BATTERY_CRITICAL`, `BATTERY_LOW`, `NETWORK_DISCONNECTED`) are **NEVER** suppressed by frequency configuration.
- **Notification Intensity**: Typed visual/audio presentation intent (`quiet`, `normal`, `expressive`) without hijacking arbitrary OS APIs.

### 11.5. Offline-First AI Boundary
- **Local Fallback Priority**: Local templates are always evaluated first. AI is 100% opt-in.
- **Resilience**: If the AI provider throws, times out (2500ms), or returns malformed text, the engine immediately and seamlessly returns the local template fallback.
- **Security**: Renderer bundles never receive `OPENAI_API_KEY`. AI output cannot execute OS actions.

### 11.6. Durable Persistence
- Persisted in `<appDataDir>/personality.json` using atomic write patterns (`.tmp` write followed by rename) with mode `0o600`.
- Corrupt or missing configuration safely recovers to `DEFAULT_PERSONALITY_CONFIG` without crashing.
