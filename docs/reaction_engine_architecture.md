# PixelPal Reaction Engine Architecture

## 1. Overview & Purpose
The **Reaction Engine** is the behavioral decision and orchestration core of PixelPal. It bridges the **Event Monitoring System** (Sprint 3) and the **Animation Engine** (Sprint 2).

- **Sprint 3 (Event Engine):** Answers *"What happened on the desktop?"* (Emits normalized `DesktopEvent`).
- **Sprint 4 (Reaction Engine):** Answers *"What should PixelPal do about this event?"* (Resolves deterministic reactions with priority, cooldowns, and executes them).
- **Sprint 2 (Animation Engine):** Answers *"How do we render and play the animation?"* (Executes frame playback, loops, and transitions).

```text
OS Hardware / Native APIs
           ↓
Native Detectors (Rust Backend)
           ↓
State Transition Deduplicators
           ↓
Standardized DesktopEvent
           ↓
In-Process Event Bus
           ↓
┌────────────────────────────────────────┐
│   Reaction Engine (Sprint 4)          │
│   1. ReactionRegistry (12 MVP rules)   │
│   2. CooldownManager (Per-reaction)    │
│   3. ReactionResolver (Deterministic)  │
│   4. ReactionExecutor (Orchestrator)   │
└────────────────────────────────────────┘
     │                                │
     ▼                                ▼
AnimationManager (Sprint 2)    AutonomousIdleScheduler (Sprint 2)
(setAnimation, play, loops)    (suppressed during active reaction)
     │
     ▼
Character Renderer (Canvas / Transparent Window)
```

---

## 2. Core Reaction Model

### `ReactionDefinition`
Defined in `packages/shared-types/src/reactions.ts`:

```typescript
export interface ReactionDefinition {
  /** Unique reaction identifier (e.g. "react_battery_low") */
  id: string;
  /** Triggering canonical event type */
  eventType: EventType;
  /** Target animation ID from Sprint 2 vocabulary */
  animationId: AnimationId;
  /** Priority level (10 - 100) */
  priority: number;
  /** Cooldown duration in milliseconds */
  cooldownMs: number;
  /** Optional active reaction duration in milliseconds (for one-shot animations) */
  durationMs?: number;
  /** Whether the reaction plays once and returns to the background state */
  isOneShot: boolean;
  /** Human-readable description */
  description?: string;
}
```

### `ActiveReactionState`
Tracks the currently executing reaction:

```typescript
export interface ActiveReactionState {
  reaction: ReactionDefinition;
  event: DesktopEvent;
  startedAt: number;
  expiresAt: number;
}
```

---

## 3. Priority Hierarchy

Reactions use a standardized numerical priority model to deterministically resolve conflicting and simultaneous events:

| Level | Priority Value | Typical Events | Behavior During Active Reaction |
| :--- | :--- | :--- | :--- |
| **`CRITICAL`** | `100` | `BATTERY_CRITICAL` | Interrupts any active reaction immediately |
| **`HIGH`** | `80` | `BATTERY_LOW`, `NETWORK_DISCONNECTED` | Interrupts `NORMAL` / `LOW` active reactions |
| **`NORMAL`** | `50` | `CHARGING_STARTED`, `CHARGING_STOPPED`, `NETWORK_CONNECTED`, `DOWNLOAD_COMPLETED` | Interrupts `LOW` active reactions |
| **`LOW`** | `30` | `USER_IDLE`, `USER_ACTIVE`, `PC_LOCKED`, `PC_UNLOCKED`, `APP_OPENED` | Cannot interrupt active one-shot reactions |
| **`BACKGROUND`** | `10` | Autonomous idle actions (`blink`, `look_around`, `subtle_move`, `yawn`) | Suppressed whenever an event reaction is active |

---

## 4. Default MVP Reaction Mappings

The `ReactionRegistry` initializes with 12 canonical MVP reaction rules:

| Reaction ID | Event Type | Animation ID | Priority | Cooldown | Duration | Mode |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `react_battery_critical` | `BATTERY_CRITICAL` | `sad` | 100 (CRITICAL) | 60,000 ms | — | Loop |
| `react_battery_low` | `BATTERY_LOW` | `worried` | 80 (HIGH) | 180,000 ms | 4,000 ms | One-shot |
| `react_network_disconnected`| `NETWORK_DISCONNECTED`| `worried` | 80 (HIGH) | 60,000 ms | 3,000 ms | One-shot |
| `react_charging_started` | `CHARGING_STARTED` | `happy` | 50 (NORMAL) | 30,000 ms | 3,000 ms | One-shot |
| `react_charging_stopped` | `CHARGING_STOPPED` | `worried` | 50 (NORMAL) | 30,000 ms | 3,000 ms | One-shot |
| `react_network_connected` | `NETWORK_CONNECTED` | `happy` | 50 (NORMAL) | 30,000 ms | 3,000 ms | One-shot |
| `react_download_completed` | `DOWNLOAD_COMPLETED` | `happy` | 50 (NORMAL) | 10,000 ms | 4,000 ms | One-shot |
| `react_user_idle` | `USER_IDLE` | `sleepy` | 30 (LOW) | 10,000 ms | — | Loop |
| `react_user_active` | `USER_ACTIVE` | `happy` | 30 (LOW) | 10,000 ms | 3,000 ms | One-shot |
| `react_pc_locked` | `PC_LOCKED` | `sleepy` | 30 (LOW) | 5,000 ms | — | Loop |
| `react_pc_unlocked` | `PC_UNLOCKED` | `surprised` | 30 (LOW) | 5,000 ms | 3,000 ms | One-shot |
| `react_app_opened` | `APP_OPENED` | `surprised` | 30 (LOW) | 15,000 ms | 2,000 ms | One-shot |

---

## 5. Resolution & Suppression Logic

The `ReactionResolver` evaluates incoming events through a pure decision pipeline:

```text
Incoming DesktopEvent
         │
         ▼
1. Lookup in ReactionRegistry
   ├─ None found ────────────────────────► NO_REACTION
   └─ ReactionDefinition matched
         │
         ▼
2. Check CooldownManager
   ├─ now < cooldownExpiresAt ───────────► SUPPRESSED_ON_COOLDOWN
   └─ Eligible (not on cooldown)
         │
         ▼
3. Check Active Reaction Priority
   ├─ No active reaction ────────────────► RESOLVED (Accept)
   ├─ Active expired (now >= expiresAt) ─► RESOLVED (Accept)
   ├─ Active is One-Shot:
   │    ├─ candidate.priority > active.priority ► RESOLVED (Interrupt active)
   │    └─ candidate.priority <= active.priority ► SUPPRESSED_BY_PRIORITY
   └─ Active is Loop State (e.g. USER_IDLE, PC_LOCKED):
        ├─ candidate.id === active.id ─────────► SUPPRESSED_BY_PRIORITY (Already looping)
        ├─ candidate.priority >= active.priority ► RESOLVED (State transition / wake)
        └─ candidate.priority < active.priority ──► SUPPRESSED_BY_PRIORITY
```

---

## 6. Reaction Executor & Lifecycle Orchestration

The `ReactionExecutor` is responsible for executing reactions without altering decision logic:

1. **EventBus Subscription:** Listens to `*` wildcard event feed safely; unhooks on `stop()` or `destroy()`.
2. **Stale Callback Protection:** Uses a monotonic `currentExecutionToken` generation counter. If Reaction A is interrupted by Reaction B, A's subsequent completion callback or duration timer check observes `token !== currentExecutionToken` and silently discards.
3. **Autonomous Idle Suppression:** Calls `AutonomousIdleScheduler.stop()` immediately when an event reaction starts, and calls `AutonomousIdleScheduler.start()` when the reaction finishes.
4. **AnimationManager Delegation:** Directs `AnimationManager.setAnimation(reaction.animationId)` and hooks `onAnimationComplete` for one-shot transitions back to `idle`.
5. **Cooldown Commit Integrity:** Cooldowns are committed only when an event is actually accepted and executed; suppressed events do not consume cooldowns.
6. **Error Isolation:** If `AnimationManager` or a subscriber throws, the executor logs an error and maintains runtime stability.

---

## 7. Sprint 4 Phase Boundaries

### Phase 1 & 2 Completed (Current)
- Complete headless reaction engine pipeline: `ReactionRegistry`, `CooldownManager`, `ReactionResolver`, `ReactionExecutor`.
- Verified integration with `EventBus`, `AnimationManager`, and `AutonomousIdleScheduler`.
- 100% deterministic unit and integration test suite passing.

### Phase 3 Boundary (Next)
- Stress testing, burst simulation, lifecycle hardening audit, and Sprint 5 handoff documentation.

### Future Personality & AI Layer (Sprint 8 & 9)
- The Reaction Engine remains 100% deterministic and functional offline without LLMs.
- Future personality layers will modify dialogue templates and contextual expressions on top of the resolved reaction.
