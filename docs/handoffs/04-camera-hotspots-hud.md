# Handoff 04: Spatial Camera, Red-Dot Hotspots & Presentation HUD

## 1. Public APIs

### `SpaceCamera` (`src/interaction/SpaceCamera.ts`)
Owns the `THREE.PerspectiveCamera` (`fov = 38`, `near = 0.1`, `far = 120`), cinematic intro choreography, smooth spatial free-roam navigation, section focus flight, and overview-veil readability calculation.

```ts
export interface SpaceCameraOptions {
  fov?: number;  // default 38
  near?: number; // default 0.1
  far?: number;  // default 120
}

export class SpaceCamera {
  public readonly camera: THREE.PerspectiveCamera;
  constructor(domElement: HTMLElement, options?: SpaceCameraOptions);
  update(dt: number, timeline: TimelineState): void;
  focusSection(section: NewspaperSection): void;
  exitFocus(): void;
  getActiveSectionId(): string | null;
  getReadabilityFactor(): number;
  resetOverview(): void;
  resetForReplay(): void;
  onFocusChange(cb: (sectionId: string | null) => void): () => void;
  resize(width: number, height: number): void;
  dispose(): void;
}
```

### `HotspotOverlay` (`src/interaction/HotspotOverlay.ts`)
Projects each section's 3D anchor (`pageUVToWorld(s.page, s.dotAnchor.u, s.dotAnchor.v, PAPER_REST_Y + 0.03)`) into `#hotspot-layer` every frame.

```ts
export interface HotspotCallbacks {
  onSelect: (section: NewspaperSection) => void;
  onExit: () => void;
}

export class HotspotOverlay {
  constructor(
    container: HTMLElement,
    sections: NewspaperSection[],
    callbacks: HotspotCallbacks,
  );
  update(
    camera: THREE.PerspectiveCamera,
    timeline: TimelineState,
    activeSectionId: string | null,
  ): void;
  dispose(): void;
}
```

- **Attract state**: Crimson dot (`#d62828`) with warm parchment ring, pulsing radar halo, and hover vintage editorial tooltip (`"01 · HEADLINE"`), auto-flipping near top/right viewport edges.
- **Active state**: Clicking a dot morphs that exact dot into a high-contrast Exit (`×`) icon button (`aria-label="Exit section view"`, inline SVG `aria-hidden="true"`). Other dots recede to `opacity: 0.25`.
- **Reveal**: Pop-in stagger driven by `timeline.dotsProgress` (`14.8s – 15.5s`).

### `PresentationHUD` (`src/ui/PresentationHUD.ts`)
Renders the dark-glass editorial presentation bar, live phase/clock readout, playback & section controls, pace selector, and first-interaction hint pill into `#hud-layer`.

```ts
export interface PresentationHUDCallbacks {
  onReplay: () => void;
  onSkipIntro: () => void;
  onResetView: () => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onSpeedChange: (speed: number) => void;
  onExitFocus?: () => void; // optional; falls back to onResetView on Esc
}

export class PresentationHUD {
  constructor(
    container: HTMLElement,
    callbacks: PresentationHUDCallbacks,
    initialSpeed?: number, // default 1
  );
  update(
    timeline: TimelineState,
    activeSectionOrder: number | null,
    totalSections: number,
  ): void;
  setSpeed(speed: number): void;
  toggleHudVisibility(): void;
  dispose(): void;
}
```

## 2. Camera Framing Presets & Spatial Bounds

| State / Phase | Position (`x, y, z`) | LookAt (`x, y, z`) | Notes |
| --- | --- | --- | --- |
| `drop` & `hold` (`0.0s – 2.2s`) | `(0.35, 8.6, 5.4)` + gentle breathing & landing dip at `1.2s` | `(0.0, -0.1, 0.25)` | Frames closed front cover & cardboard edges/under-table depth |
| `sweep` (`2.2s – 10.2s`) | Sweeps wider & lower mid-sweep (`Δy ≈ -0.85`, `Δz ≈ +0.85`) to `(0.12, 9.35, 4.65)` | `(0.0, -0.14 → 0.0, 0.25 → 0.12)` | Showcases flying curved pages and under-table floating texts |
| `settle` (`10.2s – 12.6s`) | Eased slight zoom-out (`zoomOutProgress: 0 → 1`) into Overview | `(0.0, 0.0, 0.12)` | Graceful transition into wide spread presentation |
| Default Overview | `(0.0, 10.8, 3.8)` (aspect-scaled if `aspect < 1.55`) | `(0.0, 0.0, 0.12)` | Full 2-page spread + center crease + surrounding cardboard |
| Section Focus | Directly over `sectionToFocusTarget(section).worldCenter` with `zOffset = 0.55`, `y ∈ [2.35, 7.4]` | `worldCenter` (`y = PAPER_REST_Y`) | Fits section width (`×1.14`) and height (`×1.18`) cleanly |

### Free-Roam Controls & Clamps (active when `timeline.isInteractive === true`)
- **Left-drag**: Inertia-damped pan across table (`target.x ∈ [-6.5, 6.5]`, `target.z ∈ [-4.8, 4.8]`).
- **Wheel / Trackpad scroll**: Smooth damped zoom (`camera.position.y ∈ [2.2, 14.5]`).
- **Right-drag or Shift+Left-drag**: Subtle tilt/orbit (`polarAngle ∈ [6°, 44°]`, `azimuthAngle ∈ [-42°, 42°]`).
- **Double-click canvas**: Resets smoothly to default overview.
- **Manual release from focus**: Zooming out past `y >= 7.8` or panning `>= 2.75` units away from the focused section center automatically clears `activeSectionId` so free-roam remains seamless.

## 3. Readability Threshold Mapping (`getReadabilityFactor()`)
- Returns `0.0` at default overview (`camera.position.y >= 8.8` and no active section focus).
- Smoothly ramps (`smoothstep`) to `1.0` as `camera.position.y` descends from `8.8` to `5.6` (manual zoom-in).
- Also smoothly blends toward `1.0` whenever a section is actively focused (`activeSectionId !== null`), ensuring crisp readability on all desktop aspect ratios.

## 4. Keyboard Shortcuts (`PresentationHUD`)
| Key | Action |
| --- | --- |
| `Escape` | Exit section focus (`onExitFocus` or `onResetView`) |
| `ArrowRight` | Next section (`onNextSection`, when interactive) |
| `ArrowLeft` | Previous section (`onPrevSection`, when interactive) |
| `R` | Replay full intro animation (`onReplay`) |
| `0` | Reset camera to default overview (`onResetView`, when interactive) |
| `H` | Hide / Show presentation HUD controls |

## 5. CSS Tokens (`src/ui/styles.css`)
- `--ink-dark: #1a1815`
- `--paper-cream: #f2ead8`
- `--paper-aged: #e4d6b8`
- `--gold-accent: #d9a74a`
- `--gold-soft: #ffd28a`
- `--crimson: #d62828`
- `--crimson-deep: #9e1b1b`
- `--glass-bg: rgba(15, 23, 34, 0.8)`
- `--glass-border: rgba(242, 234, 216, 0.16)`
- Cursor classes toggled on `#webgl-canvas`: `.cursor-grab`, `.cursor-grabbing`.
- Includes high-contrast `:focus-visible` outlines and `@media (prefers-reduced-motion: reduce)` handling.
