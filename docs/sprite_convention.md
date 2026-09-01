# PixelPal — Sprite & Animation Asset Convention

**Version:** 1.0.0
**Scope:** Sprint 2 (Character Rendering & Animation)

---

## 1. Overview & Purpose
PixelPal uses lightweight, metadata-driven sprite-sheet animations to render responsive pixel-art chibi desktop companions. This specification establishes conventions for directory layout, file naming, frame geometries, metadata manifests, and fallback handling, ensuring seamless compatibility between:
1. **Sprint 2 placeholder / test assets**
2. **Future AI-generated personalized character assets (Sprint 6+)**

---

## 2. Directory Structure Convention

```text
EVE/
├── assets/
│   ├── animations/
│   │   └── manifest.json            # Canonical repository-wide animation manifest
│   └── sprites/
│       └── <character_id>/           # e.g., 'placeholder', 'char_001'
│           ├── idle.svg / .png       # Base idle loop sprite sheet
│           ├── happy.svg / .png      # Happy celebration sprite sheet
│           ├── sad.svg / .png        # Sad reaction sprite sheet
│           ├── sleepy.svg / .png     # Sleepy / resting sprite sheet
│           ├── worried.svg / .png    # Worried / warning reaction sprite sheet
│           └── surprised.svg / .png  # Surprised / alert reaction sprite sheet
└── apps/desktop/public/
    └── assets/
        └── sprites/
            └── <character_id>/       # Webview-accessible static assets
                └── *.svg / *.png
```

---

## 3. Frame & Sprite Sheet Dimensions

- **Standard Frame Size:** `64 × 64` pixels (or scaled multiples: `128 × 128`, `256 × 256` preserving 1:1 aspect ratio).
- **Layout Format:** `strip-horizontal` (default standard).
  - A 4-frame animation at 64×64 is stored as a single `256 × 64` image.
  - Frame index $0$: $x \in [0, 64)$
  - Frame index $1$: $x \in [64, 128)$
  - Frame index $2$: $x \in [128, 192)$
  - Frame index $3$: $x \in [192, 256)$
- **Color & Transparency:**
  - Full alpha transparency (`rgba(0, 0, 0, 0)`) for background.
  - Pixel-perfect edges without blurred anti-aliasing on character contours (`image-rendering: pixelated; shape-rendering: crispEdges;`).

---

## 4. Standard Animation IDs & Semantics

| Animation ID | Display Name | Frame Count | Target FPS | Duration | Loop Mode | Primary Trigger / Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `idle` | Idle | 4 | 4 | 1000ms | `loop` | Default background state, gentle breathing |
| `happy` | Happy | 4 | 6 | 667ms | `loop` | Charging started, celebrations, positive events |
| `sad` | Sad | 4 | 3 | 1333ms | `loop` | Disconnections, deletions, negative feedback |
| `sleepy` | Sleepy | 4 | 2 | 2000ms | `loop` | Prolonged idle time, high screen time |
| `worried` | Worried | 4 | 5 | 800ms | `one-shot` | Low battery warnings, errors (returns to `idle`) |
| `surprised` | Surprised | 4 | 6 | 667ms | `one-shot` | Wake-up, lock/unlock transition, immediate alert |

---

## 5. Animation Definition Schema

```json
{
  "id": "idle",
  "name": "Idle",
  "description": "Default ambient breathing and standing animation",
  "assetPath": "/assets/sprites/placeholder/idle.svg",
  "frameCount": 4,
  "frameDimensions": { "width": 64, "height": 64 },
  "fps": 4,
  "durationMs": 1000,
  "loopMode": "loop",
  "fallbackId": "idle",
  "transitionTo": "idle",
  "layout": { "type": "strip-horizontal", "columns": 4, "rows": 1 },
  "tags": ["default", "ambient", "neutral"]
}
```

---

## 6. Fallback & Resilience Strategy

1. **Direct Lookup:** Requested `animation_id` is queried from the `AnimationRegistry`.
2. **Definition Fallback:** If the requested ID is missing or invalid, the registry checks the definition's specific `fallbackId`.
3. **Global Fallback:** If `fallbackId` is missing/invalid or unconfigured, the registry falls back to `defaultAnimationId` (`idle`).
4. **Crash Prevention:** If even the default animation asset is corrupt/missing, the system raises an `AnimationResolutionError` with diagnostic logs without taking down the desktop process.

---

## 7. Future Generated Character Compatibility (Sprint 6+)

When the AI character generation pipeline converts photos into chibi spritesheets:
- Sprites will be outputted to `assets/sprites/<character_id>/` matching the same 6 IDs and frame strip layouts.
- The manifest will be updated with `"characterStyle": "<character_id>"`.
- The animation playback system will seamlessly consume custom character packs with zero changes to rendering logic.
