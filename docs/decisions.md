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
