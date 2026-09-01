# PixelPal — Frontend Animation Integration Contract

**Document Purpose:** Clear, unambiguous contract for the Frontend Developer working on the companion UI.
**Scope:** Sprint 2 (Character Rendering & Animation)

---

## 1. Architectural Boundary & Ownership

- **Frontend Scope (Your Responsibility):**
  - UI layout, window aesthetics, character view, speech bubbles, dragging interactions.
  - Consuming the headless `AnimationManager` and `AutonomousIdleScheduler` from `src/animation/`.
- **Engine Scope (This Subsystem):**
  - Headless frame progression, FPS timing, looping, one-shots, fallback resolution, and randomized autonomous idle scheduling.

---

## 2. Available Imports

You can import all animation contracts, registries, managers, and schedulers directly:

```typescript
import {
  AnimationIds,
  type AnimationId,
  type AnimationDefinition,
  type AnimationPlaybackState,
  type ResolvedAnimation,
  type IdleAction,
  AnimationManager,
  AutonomousIdleScheduler,
  globalAnimationRegistry,
} from "./animation";
```

---

## 3. Core Animation IDs

```typescript
export const AnimationIds = {
  IDLE: "idle",       // Loop (4 FPS, 4 frames)
  HAPPY: "happy",     // Loop (6 FPS, 4 frames)
  SAD: "sad",         // Loop (3 FPS, 4 frames)
  SLEEPY: "sleepy",   // Loop (2 FPS, 4 frames)
  WORRIED: "worried", // One-shot (5 FPS, 4 frames) -> returns to 'idle'
  SURPRISED: "surprised", // One-shot (6 FPS, 4 frames) -> returns to 'idle'
} as const;
```

---

## 4. Headless AnimationManager Usage

### A. Initializing & Starting Playback
```typescript
const manager = new AnimationManager({
  initialAnimationId: AnimationIds.IDLE,
  autoStart: true,
});
```

### B. Triggering Reactions / Changing Animations
```typescript
// Plays a one-shot reaction (e.g. low battery alert)
manager.setAnimation(AnimationIds.WORRIED);
// When finished, the manager automatically returns to 'idle'!

// Plays a looping emotion
manager.setAnimation(AnimationIds.HAPPY);
```

### C. Listening to Frame Changes & State
```typescript
// Listen to every frame advance (to update CSS background or canvas)
const unsubscribeFrame = manager.onFrameChange((frameIndex, animation) => {
  console.log(`Current Frame: ${frameIndex} for ${animation.name}`);
});

// Listen to one-shot completion
const unsubscribeComplete = manager.onAnimationComplete((completedAnim) => {
  console.log(`One-shot completed: ${completedAnim.name}`);
});

// Listen to overall playback state changes
const unsubscribeState = manager.onStateChange((state) => {
  console.log("State:", state);
});
```

---

## 5. Autonomous Idle Scheduler Usage

The `AutonomousIdleScheduler` adds natural life (blinking, breathing sway, looking around, yawning) when the character is sitting in `idle`:

```typescript
const idleScheduler = new AutonomousIdleScheduler(manager, {
  minIntervalMs: 3000,
  maxIntervalMs: 8000,
  autoStart: true,
});

// Listen to autonomous actions (e.g., to trigger a UI speech bubble or eye highlight)
idleScheduler.onAction((action: IdleAction) => {
  console.log(`Autonomous behavior triggered: ${action.description}`);
});
```

---

## 6. React Hook Integration Example

Here is a recommended, ready-to-use pattern for your React component:

```tsx
import { useEffect, useState, useRef } from "react";
import {
  AnimationManager,
  AutonomousIdleScheduler,
  AnimationIds,
  type AnimationPlaybackState,
} from "./animation";

export function useCharacterAnimation() {
  const managerRef = useRef<AnimationManager | null>(null);
  const schedulerRef = useRef<AutonomousIdleScheduler | null>(null);
  const [state, setState] = useState<AnimationPlaybackState | null>(null);

  useEffect(() => {
    const manager = new AnimationManager({
      initialAnimationId: AnimationIds.IDLE,
      autoStart: true,
    });
    const scheduler = new AutonomousIdleScheduler(manager, {
      autoStart: true,
    });

    managerRef.current = manager;
    schedulerRef.current = scheduler;
    setState(manager.getPlaybackState());

    const unsub = manager.onStateChange((newState) => {
      setState(newState);
    });

    return () => {
      unsub();
      scheduler.destroy();
      manager.destroy();
    };
  }, []);

  const playReaction = (id: string) => {
    managerRef.current?.setAnimation(id);
  };

  return { state, playReaction };
}
```

---

## 7. Rendering the Sprite

Each placeholder sprite asset is stored as a 4-frame horizontal strip ($256 \times 64\text{px}$, each frame $64 \times 64\text{px}$):

```tsx
function CharacterSprite({ assetPath, frameIndex }: { assetPath: string; frameIndex: number }) {
  const frameWidth = 64;
  const frameHeight = 64;

  return (
    <div
      style={{
        width: `${frameWidth}px`,
        height: `${frameHeight}px`,
        backgroundImage: `url(${assetPath})`,
        backgroundPosition: `-${frameIndex * frameWidth}px 0px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
      }}
    />
  );
}
```
