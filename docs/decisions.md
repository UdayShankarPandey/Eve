# Architecture & Technical Decisions (ADR)

## 1. Desktop Shell: Tauri 2 instead of Electron
- **Decision**: Use Tauri 2 for the desktop shell.
- **Reason**: Tauri produces significantly smaller, lighter-weight binaries by using the OS's native webview. It also uses Rust for the backend, which aligns with our performance and resource efficiency goals for an always-on desktop application.
- **Consequences**: We must write native integrations in Rust rather than Node.js.
- **Alternatives**: Electron (too heavy/resource intensive), Qt/C++ (slower UI development velocity).

## 2. Frontend: React + TypeScript + Tailwind CSS
- **Decision**: Use React with TypeScript and Tailwind CSS.
- **Reason**: React provides a vast ecosystem and component model. TypeScript ensures type safety across the frontend and backend boundaries. Tailwind CSS allows for rapid, consistent styling without maintaining separate CSS files.
- **Consequences**: Standard React SPA architecture within the Tauri webview.
- **Alternatives**: Vue, Svelte (React chosen for ecosystem size and developer familiarity).

## 3. Native Layer: Rust
- **Decision**: Use Rust for the backend/native layer.
- **Reason**: Rust offers memory safety, high performance, and excellent low-level OS API bindings, making it ideal for the deterministic event monitoring engine.
- **Consequences**: Steeper learning curve for native code, but fewer runtime memory bugs.

## 4. Local Persistence: SQLite
- **Decision**: Use SQLite for local data storage.
- **Reason**: SQLite is a lightweight, serverless database that requires zero configuration. It is perfect for storing character states, events, and offline conversations in a local-first application.
- **Consequences**: Data remains local. Concurrency is limited but sufficient for a single-user desktop app.
- **Alternatives**: JSON files (harder to query), IndexedDB (tied to webview, harder to access from Rust).

## 5. Event-Driven Architecture
- **Decision**: Adopt a strict event-driven architecture using an Event Bus.
- **Reason**: Decouples the OS monitors from the reaction logic. It allows us to easily add new event detectors in the future without touching the core character rendering or reaction engine.
- **Consequences**: Must define a clear, platform-independent `DesktopEvent` schema.

## 6. Privacy: Local-First
- **Decision**: All routine monitoring and reactions must be executed locally.
- **Reason**: Users are highly sensitive to desktop applications monitoring their activity. By ensuring the core engine runs locally and only relies on AI as an opt-in enhancement, we build trust.
- **Consequences**: The core logic must function completely offline.

## 7. Deterministic Reaction Engine
- **Decision**: Use a deterministic State Machine for reactions.
- **Reason**: AI inference is too slow and resource-intensive for instantaneous, constant reactions (e.g., blinking, idle animations). A deterministic engine guarantees fast, reliable responses.
- **Consequences**: We must build a priority and cooldown system to manage conflicting events.

## 8. AI as an Enhancement Layer
- **Decision**: AI (character generation, advanced chat) is strictly an enhancement, not the foundation.
- **Reason**: Prevents the application from becoming useless if the AI service is unreachable or if the user revokes AI context permissions.
- **Consequences**: The app must have a baseline set of pre-rendered or generative offline assets.

## 9. OS Adapter Architecture
- **Decision**: Isolate Windows-specific code behind common interfaces.
- **Reason**: Ensures future portability to macOS and Linux without rewriting the core Event Bus and Reaction Engine.
- **Consequences**: Requires upfront design of a generic `DesktopEvent` model.

## 10. Sprite-Based Animation as Initial Approach
- **Decision**: Use sprite sheets and CSS/canvas for animations.
- **Reason**: Simple to implement, low overhead, and aligns perfectly with the "pixel character" aesthetic.
- **Consequences**: Animations are discrete rather than procedurally generated skeletal animations.

## 11. Secure Local Image Upload Boundary & Anti-Spoofing Validation
- **Decision**: Implement a strict local upload boundary enforcing magic-byte inspection, dimension/size limits, path traversal defenses, and application-owned temporary staging before any processing.
- **Reason**: User-provided image uploads represent untrusted external input. Relying on file extensions is vulnerable to spoofing, malware execution, or decompression bomb DoS attacks. Staging files locally in isolated temporary storage protects user privacy and preserves the local-first architecture.
- **Consequences**: Uploads require upfront binary decoding of JPEG, PNG, and WebP headers. Corrupted or malicious files are rejected immediately with structured diagnostics.

## 12. Deterministic Intermediate Image Preprocessing Pipeline
- **Decision**: Implement an intermediate image preprocessing pipeline using Sharp that ingests validated Phase 1 upload references, normalizes EXIF orientation, applies conservative center cropping, supports local transparent background removal behind an isolated strategy abstraction, resamples to canonical 512×512 dimensions via Lanczos3 filtering, strips all camera/GPS EXIF metadata, and outputs standardized PNG assets in application-owned temporary storage.
- **Reason**: Decouples untrusted image uploads from downstream AI character generation and pixelization. Ensures that downstream stages receive uniform, deterministic, orientation-corrected, and privacy-sanitized inputs without dragging heavy ML matting models (e.g. rembg, ONNX) or remote network dependencies into the baseline desktop shell.
- **Consequences**: Requires native libvips bindings via Sharp on the desktop host runtime (zero client webview bundle bloat). AI generation (Phase 3) and pixel conversion (Phase 4) can operate on a guaranteed 512×512 transparent PNG contract.

## 13. Controlled AI Character Generation Provider Architecture
- **Decision**: Isolate AI image generation behind a vendor-neutral `CharacterGenerationProvider` abstraction with a dedicated `OpenAIImageGenerationProvider` implementation targeting modern models (`gpt-image-2.5-sunburst` for reference-image editing and speed-oriented `gpt-image-2.5-flare` for text-to-image generation), controlled prompt construction derived strictly from typed style options, server-side-only credential management (`OPENAI_API_KEY`), and rigorous output validation before persisting to application-owned temporary storage (`pixelpal_generated/`).
- **Reason**: Protects user privacy and security by strictly controlling what leaves the machine (only sanitized Phase 2 PNG and system-controlled prompts). Prevents prompt injection, ensures zero credential exposure to webviews or client bundles, and allows offline hermetic testing via mock providers without incurring API billing or network dependencies.
- **Consequences**: External AI network calls are strictly quarantined within the provider implementation. The core character domain remains vendor-neutral and independently testable. Production desktop UI and IPC integration remain intentionally deferred to subsequent integration phases.

## 14. Deterministic Pixel-Art Processing & Sprite Foundation
- **Decision**: Convert validated Phase 3 generated character images into crisp, transparent, sprite-ready assets via a deterministic two-stage pipeline: (1) aspect-preserving downscaling to canonical 64×64 (or optional 128×128) using nearest-neighbor resampling (`sharp.kernel.nearest`) with transparent padding, followed by (2) segregated binary alpha thresholding (`alphaThreshold: 128`) and deterministic Median-Cut color quantization (`maxOpaqueColors: 16`, dithering disabled by default). Output is saved as metadata-free RGBA PNG in application-owned storage (`pixelpal_sprites/`).
- **Reason**: Downscaling alone produces blurry photographic icons rather than authentic pixel art. Full color palettes create visual noise and lack retro sprite coherence. Separating alpha from color quantization prevents color bleeding and semi-transparent halos around character silhouettes. Deterministic median-cut with fixed channel tie-breaking ensures byte-identical SHA-256 reproducibility across repeated runs with zero random seeding.
- **Consequences**: Pure local computation utilizing existing Sharp/libvips infrastructure without external ML models, Python, or network dependencies. Phase 3 generated sources are preserved unmodified. The output sprite asset provides a standardized 64×64 base ready for subsequent CharacterProfile and animation states.

## 15. Canonical Character Profile & Asset Identity Foundation
- **Decision**: Establish a canonical, strongly typed `CharacterProfile` domain model that binds together a collision-resistant unique identifier (`character_<timestamp>_<hex>`), explicit schema versioning (`schemaVersion: 1`), pipeline asset references (Phase 3 generated character and Phase 4 pixel sprite), typed style options, structured closed-union clothing selections, and discrete quantized palette configurations. Profiles are persisted locally via atomic file writes (write-to-temporary then rename) in an application-managed directory (`pixelpal_profiles/`) with POSIX `0o600` permissions.
- **Reason**: Decouples the companion's identity and metadata from raw pixel storage, ensuring zero image byte duplication while preserving full provenance across pipeline stages. Enforces strict immutability of character ID and creation timestamp while supporting safe updates. Closed-union clothing and palette models prevent arbitrary prompt injection or schema drift. Atomic local file persistence avoids premature SQLite or cloud database complexity while providing robust crash-resilient persistence.
- **Consequences**: Profile persistence is fully self-contained, portable, and offline. Image assets are referenced strictly by storage ID and remain immutable. Production desktop UI and IPC integration remain deferred to subsequent integration phases.
