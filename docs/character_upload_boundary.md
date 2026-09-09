# PixelPal — Character Upload Boundary & Image Validation Foundation

**Version:** 1.0.0  
**Scope:** Sprint 6 Phase 1 (Character Upload & Image Validation Foundation)

---

## 1. Executive Summary & Objective

PixelPal allows users to create personalized pixel-art companions from their own photographs. Because user-supplied photographs represent untrusted external input, the application must enforce an impermeable security and validation boundary before any downstream transformation, background removal, or AI generation occurs.

Sprint 6 Phase 1 establishes this foundation:
- **Local-first boundary**: Raw image bytes are validated and staged strictly locally on the user's machine.
- **Anti-spoofing content inspection**: True image format is determined from binary magic bytes rather than filename extensions.
- **Header parsing & structural integrity**: Decodes dimensions and verifies structure for PNG, JPEG, and WebP without external binary dependencies.
- **Safe application-owned storage**: Uploads are staged in a dedicated, application-owned temporary folder (`pixelpal_uploads`).
- **Path traversal prevention**: Client-provided filenames are never used on disk; collision-resistant, cryptographically unique storage IDs are generated.
- **Structured error reporting**: Diagnostic error codes provide explicit failure reasons.
- **Lifecycle cleanup**: Explicit routines for single file removal, TTL-based expiry, and complete storage purging.
- **Strict AI decoupling**: Validated uploads are staged locally with zero transmission to remote AI services (e.g. OpenAI).

---

## 2. Architecture & Pipeline

```text
Untrusted Client Input (Buffer / File)
          │
          ▼
┌────────────────────────────────────────────────────────┐
│  ImageUploadBoundary.upload(data, fileName, overrides) │
└────────────────────────────────────────────────────────┘
          │
          ├─► 1. Size Check (minSizeBytes, maxSizeBytes)
          │      └── Reject FILE_EMPTY, FILE_TOO_SMALL, FILE_TOO_LARGE
          │
          ├─► 2. Magic Byte & Format Detection
          │      └── PNG (89 50 4E 47 ...), JPEG (FF D8 FF ...), WebP (RIFF ... WEBP)
          │      └── Reject UNSUPPORTED_FORMAT
          │
          ├─► 3. Structural Header Decode & Integrity Check
          │      └── Parse IHDR (PNG), SOF0/1/2 (JPEG), VP8/VP8L/VP8X (WebP)
          │      └── Reject CORRUPTED_IMAGE
          │
          ├─► 4. Dimension & Aspect Ratio Verification
          │      └── minWidth, minHeight (64x64)
          │      └── maxWidth, maxHeight (4096x4096 bomb protection)
          │      └── maxAspectRatio (4.0:1)
          │      └── Reject DIMENSIONS_TOO_SMALL, DIMENSIONS_TOO_LARGE, INVALID_ASPECT_RATIO
          │
          ├─► 5. Cryptographic Hashing
          │      └── SHA-256 digest computation
          │
          ├─► 6. Filename Sanitization & Path Defense
          │      └── Strip traversal tokens (..), slashes, null bytes, Windows reserved devices
          │
          ├─► 7. Safe Unique Storage ID Generation
          │      └── Pattern: char_upload_<timestamp>_<randomHex>
          │
          ├─► 8. Safe Staging in Application-Owned Storage
          │      └── File written to <tempDir>/char_upload_<id>.<ext> with 0o600 permissions
          │
          ▼
Typed UploadResult Contract:
   ├── UploadSuccessResult (success: true, storageId, tempFilePath, metadata, sanitizedFileName)
   └── UploadFailureResult (success: false, errors: [...])
```

---

## 3. Supported Image Formats & Binary Signatures

> [!NOTE]
> **Validation Scope Clarification**: Sprint 6 Phase 1 implements **binary signature + header/metadata validation** (inspecting magic bytes, chunk tags, and segment markers to extract dimensions). It deliberately does **NOT** perform full raster image decoding (e.g. zlib decompression of PNG IDAT streams or JPEG DCT entropy decoding). Full raster processing belongs to the downstream transformation pipeline (Phase 2+), avoiding heavyweight runtime dependencies at the upload boundary.

| Format | Magic Bytes / Signature | Header Chunk / Marker | Supported Variants |
| :--- | :--- | :--- | :--- |
| **PNG** | `89 50 4E 47 0D 0A 1A 0A` | `IHDR` chunk (offset 12..15) | Standard PNG (Grayscale, RGB, RGBA, Indexed) |
| **JPEG** | `FF D8 FF` | `SOF0`, `SOF1`, `SOF2` (`FF C0..C2`) | Baseline, Extended Sequential, Progressive |
| **WebP** | `52 49 46 46` ... `57 45 42 50` | `VP8 ` (Lossy), `VP8L` (Lossless), `VP8X` (Extended) | Simple lossy, lossless, alpha/canvas |

---

## 4. Default Validation Constraints

| Constraint | Default Value | Rationale | Error Code |
| :--- | :--- | :--- | :--- |
| `minSizeBytes` | `100 bytes` | Rejects trivial empty/stub files | `FILE_TOO_SMALL` / `FILE_EMPTY` |
| `maxSizeBytes` | `10 MB` (`10,485,760 bytes`) | Prevents high-memory exhaustion attacks | `FILE_TOO_LARGE` |
| `minWidth` | `64 px` | Minimum viable resolution for chibi avatar | `DIMENSIONS_TOO_SMALL` |
| `minHeight` | `64 px` | Minimum viable resolution for chibi avatar | `DIMENSIONS_TOO_SMALL` |
| `maxWidth` | `4096 px` | Decompression bomb protection | `DIMENSIONS_TOO_LARGE` |
| `maxHeight` | `4096 px` | Decompression bomb protection | `DIMENSIONS_TOO_LARGE` |
| `maxAspectRatio` | `4.0:1` | Prevents absurd ribbons / extreme banners | `INVALID_ASPECT_RATIO` |
| `allowedFormats` | `["png", "jpeg", "webp"]` | High-fidelity photographic formats | `UNSUPPORTED_FORMAT` |

---

## 5. Security & Path Traversal Prevention

1. **Untrusted Filename Handling:**
   - Client filenames are passed through `sanitizeFileName()`.
   - Strips directory traversal tokens (`..`), path separators (`/`, `\`), null bytes (`\0`), control codes (`0x00`-`0x1F`), and colons.
   - Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) are prefixed with `safe_`.
   - Client filenames are stored only for reference in metadata; they are **never** used as filesystem targets.
2. **Deterministic Isolated On-Disk Names:**
   - Stored files always follow `<storageId>.<ext>`, where `storageId` matches `/^char_upload_\d+_[a-f0-9]{8,32}$/`.
3. **Boundary Verification:**
   - All filesystem paths are canonicalized with `path.resolve()`.
   - The resolved target path is checked against the canonical temporary base directory using `path.relative()`. If the path escapes the base directory, a `PATH_TRAVERSAL_ATTEMPT` error is thrown.
4. **Restricted File Permissions:**
   - Files are written with restricted file mode (`0o600`), preventing access by unauthorized local users.

---

## 6. Temporary Storage Lifecycle & Cleanup

The `TemporaryStorageAdapter` interface provides automated lifecycle maintenance:

```typescript
// Single file deletion
await boundary.cleanup(storageId);

// Purge expired files (e.g., older than 1 hour)
await boundary.cleanupExpired(3600_000);

// Full purge (e.g. on application exit or user reset)
await boundary.cleanupAll();
```

---

## 7. Privacy & AI Decoupling Contract

- **Zero Remote Calls in Phase 1**: All validation and temporary staging happens purely on-device.
- **Decoupled from AI Generation**: The upload boundary does not invoke OpenAI API, rembg, OpenCV, or external network services.
- **Local SQLite / Profile Ready**: Emits clean `UploadSuccessResult` containing `storageId`, `tempFilePath`, SHA-256 hash, and dimensions ready for Phase 2/3 persistence without database coupling.
