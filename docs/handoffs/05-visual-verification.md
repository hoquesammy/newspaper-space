# Handoff 05: Integration, Build & Live Visual Verification

## 1. Integration (`src/main.ts`) & Production Build
- Wired `SceneManager`, `SpaceCamera`, `CardboardTable`, `NewspaperRig`, `FloatingHistoryText`, `Atmosphere`, `HotspotOverlay`, and `PresentationHUD` with a clamped-`dt` `requestAnimationFrame` loop, window resize sync, keyboard presentation controls, and clean resource disposal on unload.
- Exposed `window.__newspaperSpace` (`seek`, `pause`, `play`, `setSpeed`, `focusSection`, `exitFocus`, `resetOverview`, `replay`, `getState`) for deterministic pacing tests and live rehearsal.
- **Build Check**: `npm run build` (`tsc --noEmit && vite build`) passed with **0 TypeScript errors** (`dist/assets/index-*.js` built in `1.61s`).

## 2. Live Browser Visual Verification (`http://localhost:5173/`, `1440 × 900`)
Verified across two visual passes with **0 console/WebGL errors**:

### Pass 1 Findings -> Resolved in Polish Sprint
1. **Left-Page Z-Fighting during Fast Sweep**: Turning leaves dipping below the sculpted spread contour caused diagonal polygon slicing on the left page.
   - *Fix*: Matched sculpted rest arch contour inside `evalTurningPagePos` (shared with `TurningPageDepthMaterial` and `MotionTrailMaterial`) plus strict monotonic `turnOrder` elevation clearance (`+0.016` per active slot).
2. **Table Edges & Under-Table Floating Texts Visibility**: Mid-sweep camera was slightly too close, hiding cardboard edges and under-table depth.
   - *Fix*: Pulled mid-sweep camera back/lower (`(0.2, 9.2, 8.2)`), restricted `around` phrases strictly outside the open spread perimeter, boosted `under`-table stream size/luminance, and deepened cool natural-blue rim & under-lip lighting.
3. **2-Column Text Balancing**: Multi-column blocks filled column 1 before spilling to column 2.
   - *Fix*: Pre-wrapped `FlowLine` distribution across columns in `src/textures/newspaperCanvas.ts` accounting for pull-quote reservations and keeping `bodyMask` aligned.
4. **Zoomed-In Bottom Hint Pill Overlap**: Hint pill overlapped the Section 01 pull-quote.
   - *Fix*: Dismissed hint pill immediately on `activeSectionOrder !== null` and biased `focusSection` vertical framing (`lookAt.z += worldHeight * 0.055`, `×1.24` height margin).

### Pass 2 Confirmed Results (All Passed)
- **Drop & 1s Hold**: Closed full-size 1990s broadsheet rests dead-center on the corrugated kraft cardboard table with crisp masthead, headline, halftone plate, golden dust motes, and soft shadows.
- **8s Fast Sweep + Floating Texts**: Smooth curved 3D turning pages with directional motion blur, realistic golden-key + natural-blue spine shading, zero Z-fighting, visible cardboard edges, and floating 3D historical phrases surging around the perimeter and visibly beneath the table.
- **Settle & Magic Sequential Ink Reveal**: Graceful slight zoom-out onto flat left + right broadsheet with realistic center crease line; blocks materialize sequentially via organic ink-soak shader.
- **Interactive Space & Red Dots -> Exit Icon**: All 6 red corner attract dots appear on schedule; overview keeps body copy intentionally softened while headlines & halftone art remain sharp; clicking any red dot glides smoothly into razor-sharp balanced 2-column reading view and morphs that dot into a high-contrast Exit (`×`) button; clicking `×` glides smoothly back to overview; manual drag-pan, scroll-zoom, and tilt all respond smoothly.

## 3. Swapping Your Final History Topic Later
- Edit only `src/data/newspaperContent.ts` (`NEWSPAPER_EDITION`): update the masthead, headlines, 6 section blocks, and `floatingPhrases`. All textures, 3D shaders, sequential reveal timing, and red-dot coordinates update automatically.
- Tune animation pacing in `src/config/timing.ts` (`TIMING`) or live via the HUD pace toggle (`0.75×`, `1×`, `1.25×`, `1.5×`).
