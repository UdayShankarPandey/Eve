# PixelPal — Event Engine & Native OS Integration Architecture

**Version:** 1.2.0
**Scope:** Sprint 3 (Event Engine & Native OS Integration — Complete)

---

## 1. Overview & Architectural Role

The **Event Engine** is the native sensory layer of PixelPal. It converts raw operating-system signals into standardized, in-process `DesktopEvent` notifications without deciding what emotional or animated reaction should take place:

```text
Native OS Signals (Windows APIs & Filesystem)
      ↓
Detector Adapters (Battery, Idle, Session, Network, App, Downloads)
      ↓
State Transition Deduplicators & Debounce Filters
      ↓
Standardized DesktopEvent Normalization
      ↓
In-Process Event Bus (Rust & TypeScript Bridge)
      ↓
Future Reaction Engine (Sprint 4) [Decides WHAT to do]
      ↓
Animation Manager (Sprint 2) [Decides HOW to display it]
```

The Event Engine answers: **"What happened?"**
It must **NOT** answer: **"What should PixelPal do?"** (which is the sole responsibility of the future Reaction Engine in Sprint 4).

---

## 2. Standardized DesktopEvent Model

Every native detector emits a common, serializable `DesktopEvent` structure:

```typescript
export interface DesktopEvent<T = Record<string, unknown>> {
  id: string;              // Unique event identifier (e.g. "1725200000000_123456")
  type: EventType;         // Canonical Event Type (e.g. "BATTERY_LOW", "USER_IDLE", "NETWORK_CONNECTED")
  timestamp: number;       // Epoch timestamp in milliseconds
  source: EventSource;     // Category ("battery", "user_activity", "session", "network", "application", "filesystem")
  payload: T;              // Strongly typed metadata payload
  metadata?: Record<string, unknown>; // Optional diagnostic / session data
}
```

---

## 3. Implemented Native Detectors

### A. Battery & Power Detector (`apps/desktop/src-tauri/src/detectors/battery.rs`)
- **Native Mechanism:** Win32 `GetSystemPowerStatus` API (`kernel32.dll`).
- **Thresholds:**
  - $\le 15\%$ $\to$ `BATTERY_LOW`
  - $\le 8\%$ $\to$ `BATTERY_CRITICAL`
- **Charging Transitions:**
  - Discharging $\to$ Charging $\to$ `CHARGING_STARTED`
  - Charging $\to$ Discharging $\to$ `CHARGING_STOPPED`
- **Deduplication:** State band tracking suppresses identical percentage repeats.

### B. User Activity / Idle Detector (`apps/desktop/src-tauri/src/detectors/idle.rs`)
- **Native Mechanism:** Win32 `GetLastInputInfo` and `GetTickCount` (`user32.dll` / `kernel32.dll`).
- **Threshold:** Configurable duration threshold (default: $120\text{s} = 120,000\text{ms}$).
- **State Transitions:**
  - `Active` and $\text{idle\_time} \ge \text{threshold}$ $\to$ `USER_IDLE`.
  - `Idle` and new keyboard/mouse hardware input $\to$ `USER_ACTIVE`.
- **Privacy Guarantee:** Only hardware input tick timestamps are read. No keystrokes, mouse coordinates, window titles, or text contents are captured.

### C. Session Lock / Unlock Detector (`apps/desktop/src-tauri/src/detectors/session.rs`)
- **Native Mechanism:** Workstation session lock state tracking.
- **State Transitions:**
  - Unlocked $\to$ Locked $\to$ `PC_LOCKED`.
  - Locked $\to$ Unlocked $\to$ `PC_UNLOCKED`.
- **Deduplication:** Only emits upon actual workstation lock/unlock state changes.

### D. Network Connectivity Detector (`apps/desktop/src-tauri/src/detectors/network.rs`)
- **Native Mechanism:** Win32 `InternetGetConnectedState` API (`wininet.dll`).
- **State Transitions:**
  - Offline $\to$ Online $\to$ `NETWORK_CONNECTED`.
  - Online $\to$ Offline $\to$ `NETWORK_DISCONNECTED`.
- **Deduplication:** Consecutive identical states suppress duplicate emissions.

### E. Application Activity Detector (`apps/desktop/src-tauri/src/detectors/app_activity.rs`)
- **Native Mechanism:** Win32 `GetForegroundWindow`, `GetWindowTextW`, and `GetWindowThreadProcessId` (`user32.dll`).
- **Semantics:** `APP_OPENED` denotes a **foreground window focus transition** to a different application, not a low-level process creation hook.
- **Throttling & Debounce:** 500ms debounce threshold to prevent event floods during rapid window cycling.
- **Privacy Guarantee:** Sanitizes window title into a clean application label (e.g. "VS Code", "Google Chrome", "Spotify"). Never inspects or transmits window contents, typed text, or internal data.

### F. Download / File Detector (`apps/desktop/src-tauri/src/detectors/downloads.rs`)
- **Scope Restriction:** Strictly restricted to the user's Downloads directory (`%USERPROFILE%\Downloads`).
- **Temporary Extension Handling:** Ignores active in-progress browser download files (`.crdownload`, `.part`, `.tmp`, `.download`, `.opdownload`).
- **Size Stabilization Heuristic:** Emits `DOWNLOAD_COMPLETED` only when a candidate file's size is $> 0$ and unchanged across observation cycles.
- **Deduplication:** Tracks completed file paths to guarantee exactly one event per download.
- **Known Limitations:**
  1. If a file is downloaded and immediately deleted before the stabilization cycle, no event is emitted.
  2. If a non-browser file is manually copied into Downloads, it is treated as a completed download once its size stabilizes.
- **Privacy Guarantee:** Only file metadata (name, size, extension) is read. File contents are **NEVER** opened or read.

---

## 4. Detector Configuration Matrix

The `DetectorConfig` model allows enabling/disabling individual detectors independently:

```rust
pub struct DetectorConfig {
    pub battery_enabled: bool,
    pub user_activity_enabled: bool,
    pub session_enabled: bool,
    pub network_enabled: bool,
    pub app_activity_enabled: bool,
    pub downloads_enabled: bool,
    pub idle_threshold_ms: u64,
    pub downloads_dir: Option<String>,
}
```

---

## 5. Error Isolation & Concurrency

- **Error Isolation:** In `DetectorManager.check_all()`, each detector is polled inside an isolated `match` block. A failure in one native API logs a warning without disrupting other detectors.
- **Concurrency & Lifecycle:** `NativeEventEngine` uses an `Arc<AtomicBool>` stop signal and joins its background worker thread on `stop()`, preventing orphan threads or race conditions.

---

## 6. Sprint 4 Handoff Contract

In Sprint 4, the **Reaction Engine** will subscribe to `DesktopEvent` notifications from `globalEventBus` and Tauri IPC:

```typescript
// Incoming Event Schema for Sprint 4:
interface DesktopEvent<T> {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: T;
  metadata?: Record<string, unknown>;
}
```

The Sprint 4 Reaction Engine will be responsible for:
1. **Rule Evaluation:** Evaluating whether an incoming `DesktopEvent` triggers a character reaction.
2. **Emotion & Animation Selection:** Mapping events to character emotions and animation states (e.g. `BATTERY_LOW` $\to$ `WORRIED` / `SLEEPY`).
3. **Priority & Cooldown Management:** Resolving conflicting simultaneous events and preventing reaction fatigue.
4. **Dialogue Generation:** Dispatching conversational prompts or contextual speech bubbles.
