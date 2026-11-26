# Handoff 01: Scaffold, Theme, Timing & Historical Content

## 1. Installed Dependencies & Scripts
- **Runtime**: `three` (`^0.170.0`)
- **Dev**: `@types/three` (`^0.170.0`), `vite` (`^5.4.11`), `typescript` (`^5.6.3`)
- **Scripts** (`package.json`):
  - `npm run dev` — Vite dev server on port `5173`
  - `npm run build` — `tsc --noEmit && vite build`
  - `npm run typecheck` — `tsc --noEmit`
- **HTML & Fonts** (`index.html`):
  - Loads Google Fonts: `UnifrakturMaguntia`, `Playfair Display`, `Oswald`, `Newsreader`, `IBM Plex Mono`.
  - Mounts `#app` containing `#webgl-canvas`, `#hotspot-layer`, `#hud-layer`, and loads `/src/main.ts`.

## 2. Shared Types (`src/types.ts`)
- `PageSide = 'left' | 'right'`
- `NormalizedRect = { u: number; v: number; w: number; h: number }`
- `IllustrationType = 'wall-silhouettes' | 'checkpoint-map' | 'crowd-celebration' | 'timeline-strip' | 'press-camera' | 'europe-map'`
- `NewspaperSection`: `{ id, order, page, kicker, headline, byline, lead, paragraphs, pullQuote?, caption?, illustrationType?, rect, dotAnchor }`
- `NewspaperEdition`: `{ masthead, subMasthead, editionLine, dateLine, priceBox, bannerHeadline, bannerSubhead, frontCoverHeadline, frontCoverSubhead, frontCoverDeck, sections, floatingPhrases }`
- `AnimationPhase = 'drop' | 'hold' | 'sweep' | 'settle' | 'reveal' | 'interactive'`
- `TimelineState`: `{ time, phase, dropProgress, openCoverProgress, sweepProgress, sweepVelocity, settleProgress, zoomOutProgress, mastheadReveal, sectionReveals, dotsProgress, isInteractive }`
- `CameraFocusTarget`: `{ sectionId, worldCenter: { x, y, z }, worldWidth, worldHeight }`

## 3. World Dimensions, Palette & Coordinate Helpers (`src/config/theme.ts`)
- **Table**: `TABLE_TOP_Y = 0`, `TABLE_WIDTH = 16.0`, `TABLE_DEPTH = 11.0`, `TABLE_THICKNESS = 0.24`
- **Newspaper**: `PAGE_WIDTH = 4.6`, `PAGE_HEIGHT = 6.2`, `SPREAD_WIDTH = 9.2`, `PAPER_REST_Y = 0.018`
- **Palettes**: `LIGHTING_CONFIG` (golden key + natural blue fill/ambient), `PAPER_COLORS`, `CARDBOARD_COLORS`
- **Coordinate Convention (`pageUVToWorld`)**:
  - Left page: `u ∈ [0, 1]` -> `x ∈ [-4.6, 0]` (`x = -PAGE_WIDTH + u * PAGE_WIDTH`)
  - Right page: `u ∈ [0, 1]` -> `x ∈ [0, +4.6]` (`x = u * PAGE_WIDTH`)
  - Both pages: `v ∈ [0, 1]` -> `z ∈ [-3.1, +3.1]` (`z = -PAGE_HEIGHT / 2 + v * PAGE_HEIGHT`), where `v = 0` is the top edge (`-z`) and `v = 1` is the bottom edge (`+z`).
  - Default `y = PAPER_REST_Y (0.018)`.
- **`sectionToFocusTarget(section)`**: Computes world-space center and `(worldWidth, worldHeight)` for camera framing.

## 4. Timeline & Easing (`src/config/timing.ts`)
- **`TIMING`**:
  - `drop`: `0.0s – 1.2s`
  - `hold`: `1.2s – 2.2s`
  - `sweep`: `2.2s – 10.2s` (`openCoverProgress` completes in the first `1.1s` of sweep)
  - `settle`: `10.2s – 12.6s` (`zoomOutProgress` eases `0 -> 1`)
  - `reveal`: `12.2s – 14.8s` (`mastheadReveal` + staggered `sectionReveals[]`)
  - `dots`: `14.8s – 15.5s` (`dotsProgress` eases `0 -> 1`)
  - `totalIntroDuration`: `15.5s` (`isInteractive = time >= 15.5`)
- **`evaluateTimeline(t, sectionCount = 6)`**: Pure function returning `TimelineState`.

## 5. Content & Block UV Bounds (`src/data/newspaperContent.ts`)
Edition: **"THE CHRONICLE ARCHIVE"** — *"THE WALL FALLS: HOW NOVEMBER 1989 REWROTE THE MODERN WORLD"*, with 28 `floatingPhrases` and 6 non-overlapping sections:

| Order | ID | Page | Illustration | Rect (`u, v, w, h`) | `dotAnchor` (`u, v`) |
| --- | --- | --- | --- | --- | --- |
| 1 | `night-at-bornholmer` | `left` | `wall-silhouettes` | `0.04, 0.23, 0.56, 0.44` | `0.57, 0.26` |
| 2 | `schabowski-slip` | `left` | `press-camera` | `0.63, 0.23, 0.33, 0.44` | `0.93, 0.26` |
| 3 | `twenty-eight-years` | `left` | `timeline-strip` | `0.04, 0.70, 0.92, 0.25` | `0.93, 0.73` |
| 4 | `voices-on-the-wall` | `right` | `crowd-celebration` | `0.04, 0.15, 0.92, 0.32` | `0.93, 0.18` |
| 5 | `europe-redrawn` | `right` | `europe-map` | `0.04, 0.50, 0.44, 0.45` | `0.45, 0.53` |
| 6 | `legacy-in-ink` | `right` | `checkpoint-map` | `0.51, 0.50, 0.45, 0.45` | `0.93, 0.53` |

*Note: Left page reserves `v < 0.22` for masthead/banner; right page reserves `v < 0.14` for running header/banner continuation.*
