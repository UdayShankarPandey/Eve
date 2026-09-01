# PixelPal — Frontend & Event Consumer Contract

**Document Purpose:** Clear contract for subscribing to desktop events.
**Scope:** Sprint 3 (Phase 1 & Phase 2 Complete)

---

## 1. Available Event Imports

```typescript
import {
  EventTypes,
  type EventType,
  type EventSource,
  type DesktopEvent,
  type BatteryEventPayload,
  type UserActivityEventPayload,
  type SessionEventPayload,
  type NetworkEventPayload,
  type AppEventPayload,
  type DownloadEventPayload,
  EventBus,
  globalEventBus,
} from "./events";
```

---

## 2. Canonical Event Types

```typescript
export const EventTypes = {
  // Battery & Power
  BATTERY_LOW: "BATTERY_LOW",           // Battery <= 15%
  BATTERY_CRITICAL: "BATTERY_CRITICAL", // Battery <= 8%
  CHARGING_STARTED: "CHARGING_STARTED", // Plugged into AC power
  CHARGING_STOPPED: "CHARGING_STOPPED", // Disconnected from AC power

  // User Activity
  USER_IDLE: "USER_IDLE",               // Inactivity threshold reached
  USER_ACTIVE: "USER_ACTIVE",           // User resumed keyboard/mouse input

  // Session
  PC_LOCKED: "PC_LOCKED",               // Windows workstation locked
  PC_UNLOCKED: "PC_UNLOCKED",           // Windows workstation unlocked

  // Network
  NETWORK_CONNECTED: "NETWORK_CONNECTED",       // Network state became online
  NETWORK_DISCONNECTED: "NETWORK_DISCONNECTED", // Network state became offline

  // Application Activity
  APP_OPENED: "APP_OPENED",             // Foreground application switched
  APP_CLOSED: "APP_CLOSED",             // Application closed

  // Filesystem
  DOWNLOAD_COMPLETED: "DOWNLOAD_COMPLETED", // File download finished in Downloads directory
} as const;
```

---

## 3. Subscribing to Events

### Subscribing via EventBus
```typescript
import { globalEventBus, EventTypes, type DesktopEvent, type DownloadEventPayload } from "./events";

// Subscribe to download events
const unsubscribeDownload = globalEventBus.subscribe<DownloadEventPayload>(
  EventTypes.DOWNLOAD_COMPLETED,
  (event) => {
    console.log(`Download finished: ${event.payload.filename} (${event.payload.size_bytes} bytes)`);
  }
);

// Clean up when no longer needed
unsubscribeDownload();
```
