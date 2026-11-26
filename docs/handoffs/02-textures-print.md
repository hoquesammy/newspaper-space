# Handoff 02: Procedural PBR Textures & 1990s Newspaper Print Assets

## 1. Cardboard Table PBR Textures (`src/textures/cardboardTexture.ts`)
- **Exports**:
  - `CardboardTextureSet`: `{ colorMap, bumpMap, roughnessMap, edgeColorMap, dispose() }`
  - `createCardboardTextures(): CardboardTextureSet`
- **Dimensions & Color Spaces**:
  - `colorMap`: `2048 × 1408` (`THREE.SRGBColorSpace`, `anisotropy: 8`) — exact `16.0 : 11.0` aspect ratio matching `TABLE_WIDTH : TABLE_DEPTH`.
  - `bumpMap`: `2048 × 1408` (linear, `anisotropy: 4`) — horizontal corrugated flute ribs, fibrous grain, and pressed fold creases.
  - `roughnessMap`: `2048 × 1408` (linear, `anisotropy: 4`) — matte kraft cardboard (`0.85–0.96`), with a smoother specular strip (`~0.62`) over the vintage packing-tape residue.
  - `edgeColorMap`: `1024 × 128` (`THREE.SRGBColorSpace`, `RepeatWrapping` on S, `ClampToEdgeWrapping` on T) — cross-section of top/bottom kraft liners sandwiching shadowed wavy corrugated fluting.
- **Visual Details**:
  - Weathered kraft brown base (`CARDBOARD_COLORS`), parallel flute shading, organic wood-pulp fibers & dark speckles, faint worn fold creases, vintage packing-tape residue strip (upper-right), aged coffee/water ring (bottom-right outside newspaper footprint), subtle archival box stencil (bottom-left), and darkened perimeter wear.

## 2. Aged 1990s Newsprint PBR Textures (`src/textures/paperTexture.ts`)
- **Exports**:
  - `PaperTextureSet`: `{ leftBaseMap, rightBaseMap, bumpMap, roughnessMap, dispose() }`
  - `createPaperTextures(): PaperTextureSet`
  - `SpineEdge = 'left' | 'right' | 'none'`
  - `paintAgedNewsprintBackground(ctx, width, height, spineEdge, seed?)` — shared deterministic aged newsprint background painter used by `newspaperCanvas.ts`.
- **Dimensions & Color Spaces**:
  - `leftBaseMap` & `rightBaseMap`: `1024 × 1380` (`THREE.SRGBColorSpace`, `anisotropy: 8`).
  - `bumpMap` & `roughnessMap`: `1024 × 1380` (linear, `anisotropy: 4`), dry matte newsprint roughness `0.86–0.94`.
- **Spine Crease Convention**:
  - `leftBaseMap` (`spineEdge = 'right'`) darkens softly along its right edge (`u -> 1.0`) with a subtle folded-paper bend highlight and spine shadow.
  - `rightBaseMap` (`spineEdge = 'left'`) darkens softly along its left edge (`u -> 0.0`) with a matching spine shadow.
  - Both include organic wood-pulp flecks, horizontal rotary web striations, delicate foxing spots, outer-margin yellowing vignette, and a subtle horizontal mid-fold crease.

## 3. High-Resolution 1990s Print Layouts & Body Masks (`src/textures/newspaperCanvas.ts`)
- **Exports**:
  - `NewspaperPrintAssets`: `{ frontCoverMap, backCoverMap, sweepPageMaps, leftPrintMap, rightPrintMap, leftBodyMaskMap, rightBodyMaskMap, dispose() }`
  - `createNewspaperPrintAssets(edition: NewspaperEdition, maxAnisotropy?: number): Promise<NewspaperPrintAssets>`
- **Font Loading**:
  - Explicitly loads and awaits `document.fonts.ready` (with a `2600ms` safe timeout fallback) for `UnifrakturMaguntia`, `Playfair Display`, `Oswald`, `Newsreader`, and `IBM Plex Mono`.
- **Texture Dimensions & Color Spaces**:
  - `frontCoverMap`, `backCoverMap`, `leftPrintMap`, `rightPrintMap`: `2048 × 2760` (`THREE.SRGBColorSpace`, `anisotropy = maxAnisotropy ?? 8`, matching `4.6 : 6.2` aspect ratio).
  - `sweepPageMaps`: `4` varied historical broadsheet pages at `1024 × 1380` (`THREE.SRGBColorSpace`) covering Aug 1961, Oct 1989 Leipzig, 18:53 CET Press Center, and Europe 1989.
  - `leftBodyMaskMap`, `rightBodyMaskMap`: `1024 × 1380` grayscale (`THREE.LinearSRGBColorSpace`, `anisotropy = maxAnisotropy ?? 8`).
- **Typography & Layout Specs**:
  - **Masthead**: `UnifrakturMaguntia` with ear boxes (`priceBox`, edition badge), double thick/thin rules, and `IBM Plex Mono` / `Oswald` dateline strip.
  - **Left Spread Header** (`v < 0.22`): Full masthead, dateline strip, and `Oswald` spread banner + `Playfair Display` italic subhead.
  - **Right Spread Header** (`v < 0.14`): Running folio (`THE CHRONICLE ARCHIVE · SPECIAL HISTORICAL REPORT · PAGE 2`) + double rule + continuation deck.
  - **6 Section Blocks**: Drawn strictly clipped inside each `section.rect` (`u, v, w, h`), with `104px` (`52px` at 1024px) top-right clearance around `section.dotAnchor` so red attract dots never cover kickers or headlines. Features inverted `Oswald` kicker bar, heavy `Playfair Display` headline, italic `Newsreader` byline, multi-column `Newsreader` body copy with classic `Playfair Display` drop cap, vertical hairline column dividers, and styled pull-quote boxes.
- **Halftone Archival Illustrations**:
  - Procedural 45°-staggered halftone dot-screen plate renderer (`renderHalftonePlate`) with warm aged plate ground (`#dfd2b6`), charcoal-sepia ink dots (`#24201b`), double hairline archival frames, and crisp engraved ink overlays for all 6 `IllustrationType`s:
    - `wall-silhouettes` (Brandenburg Gate + searchlights + silhouettes on wall parapet)
    - `press-camera` (Mohrenstraße press table, microphones, SLR camera, flash burst)
    - `timeline-strip` (1961–1989 engraved chronology bar with 5 milestones)
    - `crowd-celebration` (celebrants linked arm-in-arm atop wall crest with floodlights)
    - `europe-map` (Central/Eastern Europe landmass, breaking Iron Curtain dashed line, key cities)
    - `checkpoint-map` (West/East Berlin sectors, River Spree, Wall line, 4 historic crossings)
- **Body Mask Convention (`leftBodyMaskMap` & `rightBodyMaskMap`)**:
  - `#000000` (black) everywhere by default: background newsprint, masthead, folio header, spread banner, section frames/rules, `Oswald` kickers, `Playfair Display` section headlines, and halftone illustrations remain unmasked (sharp in overview mode).
  - `#ffffff` (white) strictly over readable body-copy regions: bylines, lead paragraphs (including drop cap), body paragraphs, pull-quote text, and illustration captions.
  - UV mapping matches `pageUVToWorld`: `u ∈ [0, 1]` maps `x: 0 -> width` and `v ∈ [0, 1]` maps `y: 0 -> height` (top-to-bottom on canvas, standard Three.js `flipY = true`).
