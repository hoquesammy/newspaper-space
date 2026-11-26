# Handoff 03: Scene, Golden-Blue Lighting, GLSL Page Physics & Atmosphere

## 1. Delivered Modules

| File | Primary Exports | Role |
| --- | --- | --- |
| `src/shaders/pageCurl.glsl.ts` | `CINEMATIC_LIGHTING`, `createTurningPageMaterial`, `createTurningPageDepthMaterial`, `createSpreadPageMaterial` | Custom GLSL turning-page curl + curved cast-shadow depth material + final spread sequential ink-reveal & overview readability veil shader |
| `src/shaders/motionTrail.glsl.ts` | `createMotionTrailMaterial` | Velocity-coupled golden/sepia motion-blur ribbon streaks trailing behind fast-turning pages |
| `src/scene/SceneManager.ts` | `SceneManager` (`renderer`, `scene`, `lights`, `add`, `resize`, `render`, `dispose`) | WebGLRenderer (`ACESFilmicToneMapping`, `PCFSoftShadowMap`), slate-blue fog, golden key + cool natural-blue lighting rig |
| `src/scene/CardboardTable.ts` | `CardboardTable` (`group`, `dispose`) | Physical `16 × 11 × 0.24` corrugated cardboard slab at `Y = 0` with tiled fluted side edges & slim recessed trestle frame leaving an open void underneath |
| `src/scene/NewspaperRig.ts` | `NewspaperRig` (`group`, `update`, `dispose`), `NewspaperRigOptions`, `ActiveSectionHighlight` | Full drop -> hold -> open cover -> 8s 5-leaf sweep -> settle -> magic ink reveal & overview veil lifecycle |
| `src/scene/FloatingHistoryText.ts` | `FloatingHistoryText` (`group`, `update`, `dispose`) | 40 crisp 3D floating vintage typography planes streaming around (24) and visibly underneath (16) the cardboard table |
| `src/scene/Atmosphere.ts` | `Atmosphere` (`group`, `update`, `resize`, `dispose`) | 220 luminous golden & cool-blue floating dust motes + deep golden-blue atmospheric studio backdrop dome |

---

## 2. Exact Constructors & `update()` Signatures

### `SceneManager` (`src/scene/SceneManager.ts`)
```ts
const sceneManager = new SceneManager({
  canvas: document.getElementById('webgl-canvas') as HTMLCanvasElement,
  width: window.innerWidth,   // optional, defaults to window.innerWidth
  height: window.innerHeight, // optional, defaults to window.innerHeight
});
sceneManager.add(table.group, newspaperRig.group, floatingText.group, atmosphere.group);
sceneManager.resize(width, height);
sceneManager.render(spaceCamera.camera);
sceneManager.dispose();
```

### `CardboardTable` (`src/scene/CardboardTable.ts`)
```ts
const table = new CardboardTable(cardboardTextures); // CardboardTextureSet
sceneManager.add(table.group);
table.dispose();
```
- Top surface sits cleanly at `Y = TABLE_TOP_Y (0)`.
- Slab spans `Y ∈ [-0.24, 0]`, `X ∈ [-8, +8]`, `Z ∈ [-5.5, +5.5]`.
- Clones `edgeColorMap` internally with `repeat.set(6.5, 1)` (front/back) and `repeat.set(4.5, 1)` (left/right) and disposes cloned textures in `dispose()`.

### `NewspaperRig` (`src/scene/NewspaperRig.ts`)
```ts
const newspaperRig = new NewspaperRig({
  edition: NEWSPAPER_EDITION,
  paperTextures, // PaperTextureSet
  printAssets,   // NewspaperPrintAssets
});
sceneManager.add(newspaperRig.group);

// Called every frame:
newspaperRig.update(
  timeline,
  spaceCamera.getReadabilityFactor(), // 0.0 (overview) -> 1.0 (zoomed/focused)
  activeSection ? { page: activeSection.page, rect: activeSection.rect } : null,
);
newspaperRig.dispose();
```
- **Lifecycle Synchronization**:
  - `drop` (`0.0s – 1.2s`): Drops dead-center (`rigPivot.x = -PAGE_WIDTH / 2`) from `Y = 7.2` with graceful tilt, mid-air parabolic flex (`uDropFlex`), damped air-cushion rebound, and tightening ground contact shadow.
  - `hold` (`1.2s – 2.2s`): Closed full-size broadsheet with layered paper-edge stack (`STACK_MAX_THICKNESS = 0.044`) rests on the cardboard table.
  - `sweep` (`2.2s – 10.2s`): Front cover turns `0 -> 1` while `rigPivot.x` glides smoothly from `-PAGE_WIDTH / 2` to `0.0` (centering the open two-page spread). A 5-leaf pool executes 15 overlapping curved page flips with paired motion-blur trails and real curved cast shadows.
  - `settle` (`10.2s – 12.18s`): Final 3 leaves decelerate smoothly; leaf #15 (`backMap = paperTextures.leftBaseMap`) lands flat onto the sculpted spread at `12.18s`, seamlessly exposing the blank aged broadsheet right before `TIMING.revealStart (12.2s)`.
  - `reveal` & `interactive` (`12.2s+`): Sculpted broadsheet (`48 × 32` curved contour rising softly from center spine valley) runs organic ink-soak reveal (`uMastheadReveal`, `uSectionReveals[0..2]`), intentional body-text overview veil (`uReadability`), and subtle `~13%` focus spotlight dimming outside `activeSectionRect`.

### `FloatingHistoryText` (`src/scene/FloatingHistoryText.ts`)
```ts
const floatingText = new FloatingHistoryText({
  phrases: NEWSPAPER_EDITION.floatingPhrases,
  aroundCount: 24, // optional
  underCount: 16,  // optional
});
sceneManager.add(floatingText.group);
floatingText.update(timeline);
floatingText.dispose();
```
- Automatically resets on replay (`timeline.time < lastTimelineTime`), fades in at `2.2s`, accelerates with `timeline.sweepVelocity`, slows during `settle`, dissolves gracefully between `12.0s – 13.45s`, and sets `group.visible = false` when idle/interactive.

### `Atmosphere` (`src/scene/Atmosphere.ts`)
```ts
const atmosphere = new Atmosphere(220);
sceneManager.add(atmosphere.group);
atmosphere.update(elapsedSeconds, timeline);
atmosphere.resize(); // call on window resize/DPR change
atmosphere.dispose();
```

---

## 3. Shader Uniforms Reference

### `createTurningPageMaterial` (`src/shaders/pageCurl.glsl.ts`)
- **Geometry Contract**: `64 × 48` subdivided plane hinged at local `x = 0`, `x ∈ [0, PAGE_WIDTH]`, `z ∈ [-PAGE_HEIGHT/2, +PAGE_HEIGHT/2]`, `uv.y = 1` at top (`-Z`), `uv.y = 0` at bottom (`+Z`).
- **Key Uniforms**:
  - `uFrontMap`, `uBackMap`, `uBumpMap`, `uHasBumpMap`
  - `uTurnProgress` (`0..1`), `uCurlStrength` (default `1.0`), `uVelocity` (`0..1`), `uTime`, `uDropFlex` (`0..1`), `uCornerLead` (default `0.075`), `uPageWidth`, `uPageHeight`, `uOpacity`
- **Features**: Back-face U mirroring (`1.0 - vUv.x`), finite-difference bent normals, velocity-scaled 5-tap horizontal motion blur (strongest near outer sweeping edge), golden backlit paper translucency, spine crease AO, and shared uniform objects with `createTurningPageDepthMaterial(mat)` (`RGBADepthPacking`) for exact curved cast shadows.

### `createSpreadPageMaterial` (`src/shaders/pageCurl.glsl.ts`)
- **UV Convention**: Converts WebGL `vUv` to document UV via `docUv = vec2(vUv.x, 1.0 - vUv.y)` so `uMastheadCutV` (`0.22` left, `0.14` right) and `uSectionRects[3]` (`vec4(u, v, w, h)`) align 1:1 with `NormalizedRect` and `newspaperCanvas.ts`.
- **Key Uniforms**:
  - `uBasePaperMap`, `uPrintMap`, `uBodyMaskMap`, `uBumpMap`, `uHasBumpMap`
  - `uMastheadReveal` (`0..1`), `uMastheadCutV`, `uSectionReveals` (`float[3]`), `uSectionRects` (`vec4[3]`)
  - `uReadability` (`0.0` overview veil -> `1.0` razor-sharp ink)
  - `uActiveRect` (`vec4`), `uHasAnyActiveSection` (`0.0 | 1.0`), `uPageSide` (`-1.0 | +1.0`), `uSweepShadow` (`vec3(worldX, strength, width)`), `uTime`
- **Overview Veil Behavior**: At `uReadability = 0.0`, pixels with `uBodyMaskMap.r > 0.35` receive a 5-tap micro-softening kernel and blend `68%` toward `uBasePaperMap`, keeping bold headlines, masthead, rules & halftones crisp while inviting users to zoom in or click a red dot to read body paragraphs.

### `createMotionTrailMaterial` (`src/shaders/motionTrail.glsl.ts`)
- Uniforms: `uTurnProgress`, `uVelocity`, `uCurlStrength`, `uTime`, `uTrailSpan`, `uPageWidth`, `uPageHeight`, `uGoldColor`, `uSepiaColor`.
- Discards cleanly when `uVelocity < 0.05`.

---

## 4. Lighting Tuning Knobs (`CINEMATIC_LIGHTING` in `src/shaders/pageCurl.glsl.ts`)
- **Backdrop & Fog**: `#0d1522`, `FogExp2` density `0.022`
- **Golden Key DirectionalLight**: `#ffbe6b`, intensity `2.9`, position `(6.8, 10.6, 5.4)`, `2048×2048` shadow map, `bias = -0.0004`, `normalBias = 0.015`, frustum `[-10.5, 10.5] × [-9, 9]`
- **Natural Blue HemisphereLight**: sky `#6d99d4` / warm kraft ground `#3a2c1e`, intensity `1.15`
- **Cool Natural-Blue Rim/Fill DirectionalLight**: `#78a9e6`, intensity `1.05`, position `(-7.4, 6.2, -5.6)`
- **Golden Overhead SpotLight Pool**: `#ffcf87`, intensity `24`, position `(0.4, 9.2, 1.2)`, penumbra `0.88`
- **Under-Table Cool Blue PointLight**: `#6ba6ef`, intensity `12`, position `(0.0, -1.6, 0.8)`
- **Renderer**: `ACESFilmicToneMapping`, `toneMappingExposure = 1.15`, `SRGBColorSpace` (all custom GLSL shaders end with `#include <tonemapping_fragment>` + `#include <colorspace_fragment>`).

---

## 5. Performance Notes
- Turning leaves share a single `64 × 48` `PlaneGeometry` and a fixed 5-slot pool (`POOL_SIZE = 5`); inactive slots and motion trails are hidden (`visible = false`), costing zero draw calls during reading/interactive mode.
- `FloatingHistoryText` sets `group.visible = false` during `drop`, `hold`, and `interactive` phases, eliminating 40 transparent draw calls once the presentation spread settles.
- All geometries, materials, shadow maps, and internally generated/cloned textures are tracked and released via `.dispose()`.
