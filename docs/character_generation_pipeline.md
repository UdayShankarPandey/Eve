# PixelPal — Controlled AI Character Generation Pipeline

**Version:** 1.0.0  
**Scope:** Sprint 6 Phase 3 (Controlled AI Character Generation Foundation)  
**Upstream Checkpoint:** `00e6d24` (Sprint 6 Phase 2: Character Image Preprocessing Foundation)

---

## 1. Executive Summary & Objective

PixelPal allows users to create personalized pixel-art companions from their own photographs. In Sprint 6 Phase 1, an impermeable upload boundary was established to validate raw bytes, magic signatures, headers, and dimensions. In Sprint 6 Phase 2, a deterministic preprocessing engine was introduced to decode rasters safely, normalize EXIF orientation, crop to a 1:1 framing, normalize dimensions to 512×512, strip camera/GPS metadata, and provide safe intermediate temporary storage.

Sprint 6 Phase 3 builds strictly on top of Phase 2 by introducing the **Controlled AI Character Generation Foundation**. Phase 3 performs:
1. **Vendor-Neutral Provider Abstraction**: Decouples character generation behind `CharacterGenerationProvider`, enabling test doubles, local on-device generation, and multi-provider extensibility.
2. **Official OpenAI Provider Implementation**: Connects to the modern OpenAI image generation & editing API surface (`images.edit` / `images.generate`) using `gpt-image-2.5-flare` (with `gpt-image-2.5-sunburst` and `dall-e-3` supported).
3. **Controlled, Injection-Proof Prompt Builder**: Synthesizes structured instructional prompts exclusively from strongly typed style enums, eliminating user prompt injection, path leakage, and metadata disclosure.
4. **Strict Server-Side Credential Handling**: Reads `OPENAI_API_KEY` strictly from the server/Node execution environment. Never exposes keys to browser webviews, client bundles, or logged diagnostics.
5. **Controlled Network Boundary & Privacy**: Transmits exclusively the sanitized Phase 2 preprocessed image and controlled prompt. Never transmits raw user photos, filenames, GPS, or unrelated desktop context.
6. **Rigorous Output Validation**: Validates AI outputs before storage—decoding rasters, enforcing sane dimensions (64×64 to 2048×2048), rejecting corrupted/unsupported formats, and stripping all provider metadata.
7. **Application-Owned Generated Asset Storage**: Staged in `pixelpal_generated/` with collision-resistant unique identifiers (`generated_char_<timestamp>_<randomHex>.png`), POSIX `0o600` permissions, traversal defense, and automatic cleanup.

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

Phase 3 (This Phase — Headless AI Generation Capability):
Sanitized Intermediate PNG Reference
      │
      ▼
Controlled Prompt Builder (Typed Style -> Template -> Injection-Free Prompt)
      │
      ▼
Provider Abstraction (OpenAIImageGenerationProvider)
      │  [External Network Boundary: Transmits sanitized PNG + controlled prompt ONLY]
      ▼
AI Image Generation API (gpt-image-2.5-flare / b64_json / URL)
      │
      ▼
Output Image Validation (Raster Decode, Dimension Verification, Strip Metadata)
      │
      ▼
Generated Intermediate PNG (`generated_char_<id>.png` in `pixelpal_generated/`)

Phase 4 (Future Scope):
Generated Intermediate PNG ──► Pixel Art Conversion & Palette Reduction (Final Sprite Sheet)
```

> [!IMPORTANT]
> **Production Runtime Separation**:
> - **Headless Capability**: Phase 3 is implemented as a headless Node-side domain capability and test suite.
> - **Deferred Integration**: There is currently NO production desktop UI, NO Tauri IPC command, and NO background Node daemon/sidecar. Frontend UI integration and production IPC wiring are intentionally deferred to subsequent integration sprints.
> - **Browser Bundle Isolation**: The OpenAI SDK is installed strictly as a host Node dependency in `apps/desktop/package.json` and is never imported by protected frontend files (`App.tsx`, `App.css`, `index.css`, `main.tsx`, `components/*`). Client bundling (`tsc && vite build`) remains completely free of AI SDK code or secrets.

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
