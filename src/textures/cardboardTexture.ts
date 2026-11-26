import * as THREE from 'three';
import { CARDBOARD_COLORS } from '../config/theme';

export interface CardboardTextureSet {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  edgeColorMap: THREE.CanvasTexture;
  dispose(): void;
}

const TOP_WIDTH = 2048;
const TOP_HEIGHT = 1408;
const EDGE_WIDTH = 1024;
const EDGE_HEIGHT = 128;

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context for cardboard textures');
  }
  return { canvas, ctx };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawCardboardTopColor(ctx: CanvasRenderingContext2D): void {
  const rng = createSeededRng(19891109);
  const [br, bg, bb] = hexToRgb(CARDBOARD_COLORS.base);

  // 1. Warm weathered kraft base fill
  ctx.fillStyle = CARDBOARD_COLORS.base;
  ctx.fillRect(0, 0, TOP_WIDTH, TOP_HEIGHT);

  // 2. Broad organic tonal patches (weathered kraft unevenness)
  for (let i = 0; i < 48; i++) {
    const x = rng() * TOP_WIDTH;
    const y = rng() * TOP_HEIGHT;
    const r = 140 + rng() * 340;
    const lighter = rng() > 0.48;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (lighter) {
      grad.addColorStop(0, `rgba(196, 165, 120, ${(0.04 + rng() * 0.06).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(196, 165, 120, 0)');
    } else {
      grad.addColorStop(0, `rgba(74, 53, 30, ${(0.05 + rng() * 0.07).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(74, 53, 30, 0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 3. Subtle parallel corrugated flute shading (horizontal ribs)
  const flutePitch = 18;
  for (let y = 0; y < TOP_HEIGHT; y += 2) {
    const phase = (y / flutePitch) * Math.PI * 2;
    const wave = Math.sin(phase);
    if (wave > 0) {
      ctx.fillStyle = `rgba(210, 178, 134, ${(wave * 0.045).toFixed(4)})`;
    } else {
      ctx.fillStyle = `rgba(54, 38, 22, ${(-wave * 0.058).toFixed(4)})`;
    }
    ctx.fillRect(0, y, TOP_WIDTH, 2);
  }

  // 4. Fine horizontal pulp streaks
  ctx.lineWidth = 1;
  for (let i = 0; i < 1600; i++) {
    const x = rng() * TOP_WIDTH;
    const y = rng() * TOP_HEIGHT;
    const len = 18 + rng() * 90;
    const alpha = 0.03 + rng() * 0.06;
    ctx.strokeStyle =
      rng() > 0.5
        ? `rgba(205, 175, 132, ${alpha.toFixed(3)})`
        : `rgba(78, 56, 34, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rng() - 0.5) * 2.5);
    ctx.stroke();
  }

  // 5. Organic wood-pulp fibers & recycled dark speckles
  for (let i = 0; i < 6500; i++) {
    const x = rng() * TOP_WIDTH;
    const y = rng() * TOP_HEIGHT;
    const len = 3 + rng() * 14;
    const angle = (rng() - 0.5) * Math.PI;
    const isLight = rng() > 0.62;
    ctx.strokeStyle = isLight
      ? `rgba(218, 190, 146, ${(0.08 + rng() * 0.14).toFixed(3)})`
      : `rgba(62, 44, 24, ${(0.08 + rng() * 0.16).toFixed(3)})`;
    ctx.lineWidth = 0.6 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  for (let i = 0; i < 3200; i++) {
    const x = rng() * TOP_WIDTH;
    const y = rng() * TOP_HEIGHT;
    const size = 0.8 + rng() * 2.2;
    ctx.fillStyle =
      rng() > 0.25
        ? `rgba(56, 40, 22, ${(0.12 + rng() * 0.24).toFixed(3)})`
        : `rgba(222, 198, 158, ${(0.1 + rng() * 0.16).toFixed(3)})`;
    ctx.fillRect(x, y, size, size);
  }

  // 6. Faint worn fold creases
  const drawCrease = (x1: number, y1: number, x2: number, y2: number, strength: number) => {
    ctx.save();
    ctx.lineCap = 'round';
    // Dark trough
    ctx.strokeStyle = `rgba(52, 36, 18, ${(0.22 * strength).toFixed(3)})`;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Soft bright wear edge
    ctx.strokeStyle = `rgba(212, 184, 140, ${(0.18 * strength).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1 + 3, y1 + 3);
    ctx.lineTo(x2 + 3, y2 + 3);
    ctx.stroke();
    ctx.restore();
  };

  // Horizontal fold crease across upper-mid and lower-mid
  drawCrease(0, TOP_HEIGHT * 0.18, TOP_WIDTH, TOP_HEIGHT * 0.185, 0.75);
  drawCrease(0, TOP_HEIGHT * 0.84, TOP_WIDTH, TOP_HEIGHT * 0.835, 0.7);
  // Subtle diagonal corner bend (top-left)
  drawCrease(0, TOP_HEIGHT * 0.22, TOP_WIDTH * 0.16, 0, 0.65);

  // 7. Subtle vintage packing-tape residue strip (upper-right area)
  ctx.save();
  ctx.translate(TOP_WIDTH * 0.82, TOP_HEIGHT * 0.11);
  ctx.rotate(-0.045);
  const tapeW = 360;
  const tapeH = 68;
  const tapeGrad = ctx.createLinearGradient(-tapeW / 2, 0, tapeW / 2, 0);
  tapeGrad.addColorStop(0, 'rgba(198, 166, 112, 0.06)');
  tapeGrad.addColorStop(0.08, 'rgba(208, 178, 124, 0.26)');
  tapeGrad.addColorStop(0.5, 'rgba(190, 158, 102, 0.22)');
  tapeGrad.addColorStop(0.92, 'rgba(204, 172, 118, 0.25)');
  tapeGrad.addColorStop(1, 'rgba(198, 166, 112, 0.04)');
  ctx.fillStyle = tapeGrad;
  ctx.fillRect(-tapeW / 2, -tapeH / 2, tapeW, tapeH);

  // Adhesive edge dirt line
  ctx.strokeStyle = 'rgba(72, 50, 26, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-tapeW / 2 + 4, -tapeH / 2 + 1, tapeW - 8, tapeH - 2);
  ctx.restore();

  // 8. Light aged coffee / water ring near bottom-right corner (outside newspaper footprint)
  ctx.save();
  const ringX = TOP_WIDTH * 0.885;
  const ringY = TOP_HEIGHT * 0.845;
  const ringR = 88;

  // Faint inner stain
  const innerStain = ctx.createRadialGradient(ringX, ringY, ringR * 0.2, ringX, ringY, ringR);
  innerStain.addColorStop(0, 'rgba(92, 60, 32, 0.03)');
  innerStain.addColorStop(0.84, 'rgba(84, 54, 26, 0.07)');
  innerStain.addColorStop(0.95, 'rgba(68, 42, 18, 0.22)');
  innerStain.addColorStop(1, 'rgba(68, 42, 18, 0)');
  ctx.fillStyle = innerStain;
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
  ctx.fill();

  // Broken uneven ring rim
  ctx.strokeStyle = 'rgba(64, 38, 16, 0.24)';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR * 0.93, 0.2, Math.PI * 1.72);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(68, 42, 20, 0.14)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(ringX + 4, ringY - 3, ringR * 0.88, Math.PI * 0.6, Math.PI * 2.1);
  ctx.stroke();
  ctx.restore();

  // 9. Faint vintage archival box stencil near bottom-left corner
  ctx.save();
  ctx.translate(TOP_WIDTH * 0.065, TOP_HEIGHT * 0.91);
  ctx.rotate(-0.02);
  ctx.strokeStyle = 'rgba(54, 38, 22, 0.16)';
  ctx.fillStyle = 'rgba(54, 38, 22, 0.15)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 210, 56);
  ctx.font = '700 20px monospace';
  ctx.fillText('ARCHIV · KISTE 14', 12, 26);
  ctx.font = '600 13px monospace';
  ctx.fillText('BERLIN — NOV 1989', 12, 45);
  ctx.restore();

  // 10. Worn slightly darker perimeter vignette & edge scuffing
  const vig = ctx.createRadialGradient(
    TOP_WIDTH * 0.5,
    TOP_HEIGHT * 0.5,
    TOP_HEIGHT * 0.36,
    TOP_WIDTH * 0.5,
    TOP_HEIGHT * 0.5,
    TOP_WIDTH * 0.64,
  );
  vig.addColorStop(0, `rgba(${br}, ${bg}, ${bb}, 0)`);
  vig.addColorStop(0.75, 'rgba(66, 48, 28, 0.12)');
  vig.addColorStop(1, 'rgba(42, 28, 15, 0.36)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, TOP_WIDTH, TOP_HEIGHT);
}

function drawCardboardBump(ctx: CanvasRenderingContext2D): void {
  const rng = createSeededRng(19891110);

  // Neutral mid-gray base
  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, TOP_WIDTH, TOP_HEIGHT);

  // Corrugated flute ribs (smooth horizontal sine wave)
  const flutePitch = 18;
  for (let y = 0; y < TOP_HEIGHT; y += 2) {
    const wave = Math.sin((y / flutePitch) * Math.PI * 2);
    const val = Math.round(128 + wave * 28);
    ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
    ctx.fillRect(0, y, TOP_WIDTH, 2);
  }

  // Fine fibrous grain & bump speckles
  for (let i = 0; i < 8500; i++) {
    const x = rng() * TOP_WIDTH;
    const y = rng() * TOP_HEIGHT;
    const len = 3 + rng() * 12;
    const angle = (rng() - 0.5) * Math.PI;
    const v = rng() > 0.5 ? 168 + Math.floor(rng() * 48) : 72 + Math.floor(rng() * 40);
    ctx.strokeStyle = `rgba(${v}, ${v}, ${v}, 0.26)`;
    ctx.lineWidth = 0.8 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  // Pressed fold creases (darker troughs)
  ctx.strokeStyle = 'rgba(42, 42, 42, 0.55)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, TOP_HEIGHT * 0.18);
  ctx.lineTo(TOP_WIDTH, TOP_HEIGHT * 0.185);
  ctx.moveTo(0, TOP_HEIGHT * 0.84);
  ctx.lineTo(TOP_WIDTH, TOP_HEIGHT * 0.835);
  ctx.moveTo(0, TOP_HEIGHT * 0.22);
  ctx.lineTo(TOP_WIDTH * 0.16, 0);
  ctx.stroke();
}

function drawCardboardRoughness(ctx: CanvasRenderingContext2D): void {
  const rng = createSeededRng(19891111);

  // Matte cardboard base: ~0.91 -> 232
  ctx.fillStyle = 'rgb(232, 232, 232)';
  ctx.fillRect(0, 0, TOP_WIDTH, TOP_HEIGHT);

  // Subtle roughness patches between 0.85 (217) and 0.96 (245)
  for (let i = 0; i < 64; i++) {
    const x = rng() * TOP_WIDTH;
    const y = rng() * TOP_HEIGHT;
    const r = 100 + rng() * 260;
    const v = Math.round(217 + rng() * 28);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v}, ${v}, ${v}, 0.35)`);
    grad.addColorStop(1, `rgba(${v}, ${v}, ${v}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Subtle flute rib variation
  const flutePitch = 18;
  for (let y = 0; y < TOP_HEIGHT; y += 3) {
    const wave = Math.sin((y / flutePitch) * Math.PI * 2);
    const v = Math.round(230 + wave * 8);
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.25)`;
    ctx.fillRect(0, y, TOP_WIDTH, 3);
  }

  // Slightly smoother packing-tape residue strip (~0.62 -> 158)
  ctx.save();
  ctx.translate(TOP_WIDTH * 0.82, TOP_HEIGHT * 0.11);
  ctx.rotate(-0.045);
  ctx.fillStyle = 'rgba(156, 156, 156, 0.88)';
  ctx.fillRect(-180, -34, 360, 68);
  ctx.restore();
}

function drawCardboardEdge(ctx: CanvasRenderingContext2D): void {
  const rng = createSeededRng(19891112);

  // Dark corrugated interior cavity
  ctx.fillStyle = '#2d1f12';
  ctx.fillRect(0, 0, EDGE_WIDTH, EDGE_HEIGHT);

  const topLinerH = 22;
  const botLinerY = EDGE_HEIGHT - 22;
  const fluteMidY = EDGE_HEIGHT * 0.5;
  const fluteAmp = (botLinerY - topLinerH) * 0.44;
  const cycles = 28;

  // Inner cavity depth shadow gradient
  const cavGrad = ctx.createLinearGradient(0, topLinerH, 0, botLinerY);
  cavGrad.addColorStop(0, '#22160c');
  cavGrad.addColorStop(0.5, '#3b2919');
  cavGrad.addColorStop(1, '#20150b');
  ctx.fillStyle = cavGrad;
  ctx.fillRect(0, topLinerH, EDGE_WIDTH, botLinerY - topLinerH);

  // Shadow pass behind wavy fluting
  ctx.strokeStyle = 'rgba(26, 17, 9, 0.85)';
  ctx.lineWidth = 11;
  ctx.beginPath();
  for (let x = 0; x <= EDGE_WIDTH; x += 2) {
    const t = (x / EDGE_WIDTH) * cycles * Math.PI * 2;
    const y = fluteMidY + Math.sin(t) * fluteAmp + 3;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Main kraft wavy corrugated fluting medium
  ctx.strokeStyle = CARDBOARD_COLORS.edgeCut;
  ctx.lineWidth = 8.5;
  ctx.beginPath();
  for (let x = 0; x <= EDGE_WIDTH; x += 2) {
    const t = (x / EDGE_WIDTH) * cycles * Math.PI * 2;
    const y = fluteMidY + Math.sin(t) * fluteAmp;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Bright highlight along front edge of corrugated flute
  ctx.strokeStyle = CARDBOARD_COLORS.highlight;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  for (let x = 0; x <= EDGE_WIDTH; x += 2) {
    const t = (x / EDGE_WIDTH) * cycles * Math.PI * 2;
    const y = fluteMidY + Math.sin(t) * fluteAmp - 1.5;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Top & bottom kraft liner sheets
  const drawLiner = (yStart: number, height: number) => {
    ctx.fillStyle = CARDBOARD_COLORS.base;
    ctx.fillRect(0, yStart, EDGE_WIDTH, height);

    ctx.fillStyle = 'rgba(220, 192, 148, 0.22)';
    ctx.fillRect(0, yStart, EDGE_WIDTH, 3);
    ctx.fillStyle = 'rgba(46, 32, 18, 0.35)';
    ctx.fillRect(0, yStart + height - 3, EDGE_WIDTH, 3);

    for (let i = 0; i < 420; i++) {
      const fx = rng() * EDGE_WIDTH;
      const fy = yStart + rng() * height;
      ctx.fillStyle =
        rng() > 0.5 ? 'rgba(66, 46, 26, 0.25)' : 'rgba(210, 180, 136, 0.2)';
      ctx.fillRect(fx, fy, 2 + rng() * 8, 1.2);
    }
  };

  drawLiner(0, topLinerH);
  drawLiner(botLinerY, EDGE_HEIGHT - botLinerY);
}

export function createCardboardTextures(): CardboardTextureSet {
  const color = makeCanvas(TOP_WIDTH, TOP_HEIGHT);
  drawCardboardTopColor(color.ctx);

  const bump = makeCanvas(TOP_WIDTH, TOP_HEIGHT);
  drawCardboardBump(bump.ctx);

  const roughness = makeCanvas(TOP_WIDTH, TOP_HEIGHT);
  drawCardboardRoughness(roughness.ctx);

  const edge = makeCanvas(EDGE_WIDTH, EDGE_HEIGHT);
  drawCardboardEdge(edge.ctx);

  const colorMap = new THREE.CanvasTexture(color.canvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = 8;
  colorMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bump.canvas);
  bumpMap.anisotropy = 4;
  bumpMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughness.canvas);
  roughnessMap.anisotropy = 4;
  roughnessMap.needsUpdate = true;

  const edgeColorMap = new THREE.CanvasTexture(edge.canvas);
  edgeColorMap.colorSpace = THREE.SRGBColorSpace;
  edgeColorMap.wrapS = THREE.RepeatWrapping;
  edgeColorMap.wrapT = THREE.ClampToEdgeWrapping;
  edgeColorMap.anisotropy = 4;
  edgeColorMap.needsUpdate = true;

  return {
    colorMap,
    bumpMap,
    roughnessMap,
    edgeColorMap,
    dispose() {
      colorMap.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
      edgeColorMap.dispose();
    },
  };
}
