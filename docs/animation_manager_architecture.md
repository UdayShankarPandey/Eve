# PixelPal — Animation Manager & Autonomous Idle Architecture

**Version:** 1.0.0
**Scope:** Sprint 2 (Character Rendering & Animation)

---

## 1. Overview & Architectural Role

The **Animation Engine** is the visual execution layer of PixelPal. It sits between high-level behavioral decisions and the webview renderer:

```text
OS Monitors (Sprint 3)
      ↓
Event Bus (Sprint 3)
      ↓
Reaction Engine (Sprint 4) [Decides WHAT to do]
      ↓
Animation Manager (Sprint 2) [Decides HOW to display it]
      ↓
Character View / Webview Canvas (Frontend)
```

The Animation Manager and Autonomous Idle System are designed to be **headless, data-driven, and completely isolated** from operating system monitoring and event detection.

---

## 2. Animation Manager Responsibilities

The `AnimationManager` class (`src/animation/manager.ts`) provides:
1. **Metadata-Driven Playback:** Consumes `AnimationDefinition` objects to drive frame progression without hardcoded frame counts or FPS values.
2. **Loop vs One-Shot Lifecycle:**
   - **Loop (`loop`):** $0 \to 1 \to \dots \to N-1 \to 0$ continuously.
   - **One-Shot (`one-shot`):** $0 \to 1 \to \dots \to N-1 \to \text{complete} \to \text{transitionTo}$ (defaults to `idle`).
3. **Safe Fallback Resolution:** Delegates to `AnimationRegistry.resolve()`. If an asset or ID is invalid, it safely falls back to `idle` without throwing uncaught exceptions.
4. **Clean Lifecycle & Resource Management:** Explicit ticker control (`play()`, `pause()`, `resume()`, `stop()`, `destroy()`) preventing duplicate animation loops or orphaned timers.
5. **Deterministic Stepping:** Exposes `step(deltaMs)` allowing time-travel testing and frame advance without relying on wall-clock timers.

---

## 3. Autonomous Idle Scheduler Responsibilities

The `AutonomousIdleScheduler` class (`src/animation/idle.ts`) operates when the character is sitting in the background `idle` state:

### Supported Autonomous Behaviors
1. **Blink:** Occasional natural eye blink ($\sim 250\text{ms}$).
2. **Subtle Movement:** Gentle breathing / posture sway adjustment ($\sim 800\text{ms}$).
3. **Look Around:** Curious glance left / right ($\sim 600\text{ms}$).
4. **Yawn:** Sleepy yawn stretch ($\sim 1200\text{ms}$), transitioning briefly to `sleepy` and returning to `idle`.

### Scheduling & Variable Intervals
- Uses randomized intervals between configured bounds (`minIntervalMs = 3000ms`, `maxIntervalMs = 8000ms`).
- Computes variable delays:
  $$\text{interval} = \text{minIntervalMs} + \text{random}() \times (\text{maxIntervalMs} - \text{minIntervalMs})$$
- Avoids rigid, predictable timing while maintaining lightweight execution without high-frequency CPU polling.

### Interruptibility & Priority Hierarchy
- When an external system (e.g. Reaction Engine in Sprint 4) switches the animation to a reaction (e.g. `HAPPY`, `WORRIED`, `SAD`), the idle scheduler automatically **pauses** autonomous triggers.
- Once the reaction completes and the character returns to `idle`, the scheduler automatically **resumes** natural ambient scheduling.

---

## 4. Lifecycle & Performance Guarantees

- **Low CPU Footprint:** While idle, only the active frame interval timer (e.g., 4 FPS = 250ms interval) and the single randomized idle delay timer are active.
- **Explicit Teardown:** Both `AnimationManager.destroy()` and `AutonomousIdleScheduler.destroy()` clear all internal timers, listeners, and references.
- **Crash Immunity:** Malformed animation IDs or missing assets resolve to standard fallbacks rather than crashing the companion process.
