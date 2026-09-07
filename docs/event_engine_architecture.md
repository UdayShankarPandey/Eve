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
- **Selected Application Allow-List:** Configurable allow-list (e.g. `["VS Code", "Google Chrome"]`). If empty, no application events are emitted.
- **Semantics:**
  - `APP_OPENED`: Denotes a **foreground window focus transition** where a selected application enters focus.
  - `APP_CLOSED`: Denotes a **foreground window focus transition** where the currently active selected application exits focus (user switches to an unselected app, desktop, or another selected app).
  - Unselected applications do not emit `APP_OPENED`.
- **Throttling & Debounce:** 500ms debounce threshold prevents event floods during rapid window cycling (e.g. Alt-Tab).
- **Deduplication:** Repeated polling ticks while remaining in the same application produce 0 duplicate events.
- **Privacy Guarantee:** Derives clean, sanitized application identities (e.g. "VS Code", "Google Chrome", "Spotify"). Never inspects, stores, or transmits window contents, typed text, document names, or internal application data. Payload contains only `app_name`, `app_id`, `process_id`, and `previous_app`.

### F. Download / File Detector (`apps/desktop/src-tauri/src/detectors/downloads.rs`)
- **Scope Restriction:** Strictly restricted to the user's Downloads directory (`%USERPROFILE%\Downloads`).
- **Temporary Extension Handling:** Ignores active in-progress browser download files (`.crdownload`, `.part`, `.tmp`, `.download`, `.opdownload`).
- **Size Stabilization Heuristic:** Emits `DOWNLOAD_COMPLETED` only when a candidate file's size is $> 0$ and unchanged across observation cycles.
- **Deduplication:** Tracks completed file paths to guarantee exactly one event per download.
- **Privacy Guarantee:** Only file metadata (name, size, extension) is read. File contents are **NEVER** opened or read.

### G. Filesystem Lifecycle Detector (`apps/desktop/src-tauri/src/detectors/filesystem.rs`)
- **Scope Restriction:** Strictly scoped to user-configured directories (`monitored_directories`). If empty, no filesystem events are emitted.
- **Lifecycle Events:**
  - `FILE_CREATED`: Emitted when a new non-temporary file appears within a monitored directory.
  - `FILE_MODIFIED`: Emitted when an existing monitored file changes size across polling cycles.
  - `FILE_DELETED`: Emitted when a previously tracked file disappears from a monitored directory.
- **Noise Suppression & Filtering:** Automatically ignores active temporary/in-progress files (`.crdownload`, `.part`, `.tmp`, `.download`, `.swp`, or prefix `~`).
- **Deduplication:** Stable file size produces 0 duplicate `FILE_MODIFIED` events.
- **Privacy Guarantee:** Reads file names, sizes, and extensions only. File contents are **NEVER** accessed or inspected.

### H. Screen Time Awareness Detector (`apps/desktop/src-tauri/src/detectors/screen_time.rs`)
- **Active-Session Model:** Tracks continuous user active duration without interruptions.
- **Cross-Detector Coupling:**
  - `USER_IDLE`: Immediately resets active session duration to 0 and clears the high-alert latch.
  - `PC_LOCKED`: Immediately resets active session duration to 0 and clears the high-alert latch.
  - `USER_ACTIVE` / `PC_UNLOCKED`: Begins tracking a fresh continuous active session.
- **Threshold Alert (`SCREEN_TIME_HIGH`):** Emitted exactly once when continuous active session duration exceeds `screen_time_threshold_ms` (default: 60 minutes).
- **Deduplication:** Latch flag suppresses continuous or repeated `SCREEN_TIME_HIGH` emissions during the same uninterrupted session.

---

## 4. Detector Configuration Matrix

The `DetectorConfig` model allows enabling/disabling individual detectors independently and dynamically configuring thresholds:

```rust
pub struct DetectorConfig {
    pub battery_enabled: bool,
    pub user_activity_enabled: bool,
    pub session_enabled: bool,
    pub network_enabled: bool,
    pub app_activity_enabled: bool,
    pub downloads_enabled: bool,
    pub filesystem_enabled: bool,
    pub screen_time_enabled: bool,
    pub idle_threshold_ms: u64,
    pub screen_time_threshold_ms: u64,
    pub downloads_dir: Option<String>,
    pub monitored_directories: Vec<String>,
    pub selected_applications: Vec<String>,
}
```

- When a detector category is disabled (`enabled == false`), its polling checks are completely bypassed and produce zero events.
- Calling `update_config()` dynamically updates runtime thresholds, directory paths, and allow-lists without spawning redundant worker threads or leaking listeners.
- Calling `reset_all()` cleanly resets internal baseline states across all 8 detectors.

---

## 5. Error Isolation & Concurrency

- **Error Isolation:** In `DetectorManager.check_all()`, each detector is polled inside an isolated `match` block. A failure or unexpected error in any single native provider (e.g. Win32 `InternetGetConnectedState` failure) logs a diagnostic warning to stderr without disrupting or disabling other detectors.
- **Concurrency & Lifecycle:** `NativeEventEngine` uses an `Arc<AtomicBool>` stop signal and joins its background worker thread on `stop()`, preventing orphan threads, duplicate watchers, or memory leaks.

---

## 6. Reaction Engine Compatibility & Normalization

All 8 awareness detectors emit the standardized `DesktopEvent` structure with normalized properties:
- `id`: Unique timestamp-based event identifier.
- `type`: One of the 17 canonical `EventType` strings.
- `timestamp`: Epoch milliseconds.
- `source`: Standardized category (`"battery"`, `"user_activity"`, `"session"`, `"network"`, `"application"`, `"filesystem"`).
- `payload`: Strongly-typed JSON payload.

### Reaction Engine Resolution:
- **Mapped Events (Sprint 3 & 4):** Events such as `BATTERY_CRITICAL`, `BATTERY_LOW`, `NETWORK_DISCONNECTED`, `NETWORK_CONNECTED`, `APP_OPENED`, `DOWNLOAD_COMPLETED`, `USER_IDLE`, `USER_ACTIVE`, `PC_LOCKED`, `PC_UNLOCKED`, `CHARGING_STARTED`, `CHARGING_STOPPED` resolve to their canonical animations (`SAD`, `WORRIED`, `HAPPY`, `SLEEPY`, `SURPRISED`).
- **Unmapped Awareness Events (Sprint 5):** Events such as `FILE_CREATED`, `FILE_MODIFIED`, `FILE_DELETED`, `SCREEN_TIME_HIGH`, and `APP_CLOSED` have no registered reaction rules and cleanly evaluate to `status: "NO_REACTION"` without triggering animations, errors, or reaction executor disruptions.
