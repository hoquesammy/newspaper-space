import * as THREE from 'three';
import { PAPER_COLORS } from '../config/theme';

export interface PaperTextureSet {
  leftBaseMap: THREE.CanvasTexture;
  rightBaseMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose(): void;
}

export type SpineEdge = 'left' | 'right' | 'none';

const PAPER_WIDTH = 1024;
const PAPER_HEIGHT = 1380;

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
    throw new Error('Failed to acquire 2D canvas context for paper textures');
  }
  return { canvas, ctx };
}

/**
 * Paints an authentic 1990s aged brown-yellowish newsprint background onto any 2D canvas.
 * Shared by both `createPaperTextures()` and `newspaperCanvas.ts`.
 *
 * @param spineEdge - Which edge of this page meets the center fold spine:
 *   - `'right'` for the left spread page (`u -> 1.0`)
 *   - `'left'` for the right spread page or front cover (`u -> 0.0`)
 *   - `'none'` for neutral sheets
 */
export function paintAgedNewsprintBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spineEdge: SpineEdge,
  seed: number = 198901,
): void {
  const rng = createSeededRng(seed);
  const scale = width / PAPER_WIDTH;

  // 1. Warm aged 1990s brown-yellowish newsprint base gradient
  const baseGrad = ctx.createLinearGradient(0, 0, width, height);
  baseGrad.addColorStop(0, PAPER_COLORS.warmTint);
  baseGrad.addColorStop(0.45, PAPER_COLORS.base);
  baseGrad.addColorStop(1, '#e5d5b5');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle overall vintage amber-brown cast for genuine 1990s newsprint tone
  ctx.fillStyle = 'rgba(182, 146, 92, 0.11)';
  ctx.fillRect(0, 0, width, height);

  // 2. Soft mottled age blotches
  for (let i = 0; i < 38; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const r = (90 + rng() * 240) * scale;
    const warm = rng() > 0.42;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (warm) {
      grad.addColorStop(0, `rgba(176, 138, 82, ${(0.035 + rng() * 0.045).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(176, 138, 82, 0)');
    } else {
      grad.addColorStop(0, `rgba(246, 238, 218, ${(0.04 + rng() * 0.05).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(246, 238, 218, 0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 3. Faint horizontal newsprint roll striations (rotary press web grain)
  const stepY = Math.max(2, Math.round(3 * scale));
  for (let y = 0; y < height; y += stepY) {
    const alpha = 0.012 + (Math.sin(y * 0.17) * 0.5 + 0.5) * 0.018;
    ctx.fillStyle =
      y % (stepY * 2) === 0
        ? `rgba(118, 92, 56, ${alpha.toFixed(4)})`
        : `rgba(255, 248, 232, ${(alpha * 0.7).toFixed(4)})`;
    ctx.fillRect(0, y, width, Math.max(1, Math.round(1.2 * scale)));
  }

  // 4. Organic wood-pulp fibers & tiny newsprint flecks
  const fiberCount = Math.round(3600 * Math.min(scale, 1.5));
  for (let i = 0; i < fiberCount; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const len = (2.5 + rng() * 9.5) * scale;
    const angle = (rng() - 0.5) * Math.PI;
    const dark = rng() > 0.35;
    ctx.strokeStyle = dark
      ? `rgba(116, 92, 62, ${(0.06 + rng() * 0.11).toFixed(3)})`
      : `rgba(252, 246, 232, ${(0.08 + rng() * 0.12).toFixed(3)})`;
    ctx.lineWidth = (0.5 + rng() * 0.85) * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  const speckCount = Math.round(2400 * Math.min(scale, 1.5));
  for (let i = 0; i < speckCount; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const sz = (0.6 + rng() * 1.6) * scale;
    ctx.fillStyle = `rgba(92, 70, 44, ${(0.08 + rng() * 0.17).toFixed(3)})`;
    ctx.fillRect(x, y, sz, sz);
  }

  // 5. Delicate foxing spots (warm sepia age freckles, biased toward margins)
  for (let i = 0; i < 42; i++) {
    const edgeBias = rng() > 0.35;
    let x = rng() * width;
    let y = rng() * height;
    if (edgeBias) {
      if (rng() > 0.5) {
        x = rng() > 0.5 ? rng() * width * 0.14 : width - rng() * width * 0.14;
      } else {
        y = rng() > 0.5 ? rng() * height * 0.12 : height - rng() * height * 0.12;
      }
    }
    const r = (2.5 + rng() * 11) * scale;
    const foxGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
    foxGrad.addColorStop(0, `rgba(148, 102, 48, ${(0.09 + rng() * 0.11).toFixed(3)})`);
    foxGrad.addColorStop(0.6, `rgba(156, 112, 58, ${(0.04 + rng() * 0.05).toFixed(3)})`);
    foxGrad.addColorStop(1, 'rgba(156, 112, 58, 0)');
    ctx.fillStyle = foxGrad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Subtle warm yellowing vignette toward outer margins
  const marginDepthX = width * 0.14;
  const marginDepthY = height * 0.11;

  // Top aged margin
  const topGrad = ctx.createLinearGradient(0, 0, 0, marginDepthY);
  topGrad.addColorStop(0, 'rgba(164, 126, 70, 0.34)');
  topGrad.addColorStop(0.5, 'rgba(182, 146, 90, 0.11)');
  topGrad.addColorStop(1, 'rgba(182, 146, 90, 0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, width, marginDepthY);

  // Bottom aged margin
  const botGrad = ctx.createLinearGradient(0, height, 0, height - marginDepthY);
  botGrad.addColorStop(0, 'rgba(156, 118, 64, 0.36)');
  botGrad.addColorStop(0.5, 'rgba(178, 142, 86, 0.12)');
  botGrad.addColorStop(1, 'rgba(178, 142, 86, 0)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, height - marginDepthY, width, marginDepthY);

  // Outer side aged margin (away from spine)
  if (spineEdge !== 'left') {
    const leftGrad = ctx.createLinearGradient(0, 0, marginDepthX, 0);
    leftGrad.addColorStop(0, 'rgba(154, 116, 62, 0.38)');
    leftGrad.addColorStop(0.55, 'rgba(178, 142, 86, 0.12)');
    leftGrad.addColorStop(1, 'rgba(178, 142, 86, 0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, marginDepthX, height);
  }
  if (spineEdge !== 'right') {
    const rightGrad = ctx.createLinearGradient(width, 0, width - marginDepthX, 0);
    rightGrad.addColorStop(0, 'rgba(154, 116, 62, 0.38)');
    rightGrad.addColorStop(0.55, 'rgba(178, 142, 86, 0.12)');
    rightGrad.addColorStop(1, 'rgba(178, 142, 86, 0)');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(width - marginDepthX, 0, marginDepthX, height);
  }

  // 7. Subtle horizontal mid-fold crease (classic folded broadsheet newsprint crease)
  const midY = height * 0.5;
  const foldH = Math.max(4, Math.round(10 * scale));
  const foldGrad = ctx.createLinearGradient(0, midY - foldH, 0, midY + foldH);
  foldGrad.addColorStop(0, 'rgba(120, 94, 58, 0)');
  foldGrad.addColorStop(0.42, 'rgba(102, 78, 46, 0.085)');
  foldGrad.addColorStop(0.52, 'rgba(255, 248, 232, 0.10)');
  foldGrad.addColorStop(1, 'rgba(120, 94, 58, 0)');
  ctx.fillStyle = foldGrad;
  ctx.fillRect(0, midY - foldH, width, foldH * 2);

  // 8. Realistic center spine crease shading
  if (spineEdge === 'right') {
    // Left page: right edge (u -> 1.0) meets the center spine
    const spineW = width * 0.11;
    const grad = ctx.createLinearGradient(width - spineW, 0, width, 0);
    grad.addColorStop(0, 'rgba(96, 76, 48, 0)');
    grad.addColorStop(0.55, 'rgba(84, 64, 38, 0.12)');
    grad.addColorStop(0.84, 'rgba(248, 238, 214, 0.08)'); // subtle paper bend catchlight
    grad.addColorStop(0.93, 'rgba(58, 42, 24, 0.34)');
    grad.addColorStop(1, 'rgba(38, 26, 14, 0.58)');
    ctx.fillStyle = grad;
    ctx.fillRect(width - spineW, 0, spineW, height);
  } else if (spineEdge === 'left') {
    // Right page: left edge (u -> 0.0) meets the center spine
    const spineW = width * 0.11;
    const grad = ctx.createLinearGradient(0, 0, spineW, 0);
    grad.addColorStop(0, 'rgba(38, 26, 14, 0.58)');
    grad.addColorStop(0.07, 'rgba(58, 42, 24, 0.34)');
    grad.addColorStop(0.16, 'rgba(248, 238, 214, 0.08)'); // subtle paper bend catchlight
    grad.addColorStop(0.45, 'rgba(84, 64, 38, 0.12)');
    grad.addColorStop(1, 'rgba(96, 76, 48, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, spineW, height);
  }
}

function drawPaperBump(ctx: CanvasRenderingContext2D): void {
  const rng = createSeededRng(198902);

  // Neutral mid-gray base
  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT);

  // Subtle organic paper crinkle waves
  for (let i = 0; i < 32; i++) {
    const x = rng() * PAPER_WIDTH;
    const y = rng() * PAPER_HEIGHT;
    const r = 80 + rng() * 190;
    const v = rng() > 0.5 ? 148 : 108;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v}, ${v}, ${v}, 0.24)`);
    grad.addColorStop(1, `rgba(${v}, ${v}, ${v}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine horizontal web striations
  for (let y = 0; y < PAPER_HEIGHT; y += 3) {
    const v = Math.round(128 + Math.sin(y * 0.45) * 7);
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.25)`;
    ctx.fillRect(0, y, PAPER_WIDTH, 1.5);
  }

  // Fine newsprint fiber bump
  for (let i = 0; i < 6000; i++) {
    const x = rng() * PAPER_WIDTH;
    const y = rng() * PAPER_HEIGHT;
    const len = 2 + rng() * 8;
    const angle = (rng() - 0.5) * Math.PI;
    const v = rng() > 0.5 ? 162 : 94;
    ctx.strokeStyle = `rgba(${v}, ${v}, ${v}, 0.22)`;
    ctx.lineWidth = 0.7 + rng() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  // Horizontal fold crease trough
  const midY = PAPER_HEIGHT * 0.5;
  const foldGrad = ctx.createLinearGradient(0, midY - 10, 0, midY + 10);
  foldGrad.addColorStop(0, 'rgba(128, 128, 128, 0)');
  foldGrad.addColorStop(0.45, 'rgba(84, 84, 84, 0.45)');
  foldGrad.addColorStop(0.55, 'rgba(170, 170, 170, 0.35)');
  foldGrad.addColorStop(1, 'rgba(128, 128, 128, 0)');
  ctx.fillStyle = foldGrad;
  ctx.fillRect(0, midY - 10, PAPER_WIDTH, 20);
}

function drawPaperRoughness(ctx: CanvasRenderingContext2D): void {
  const rng = createSeededRng(198903);

  // Dry matte newsprint base: 0.90 -> 230 (range 0.86..0.94 -> 219..240)
  ctx.fillStyle = 'rgb(230, 230, 230)';
  ctx.fillRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT);

  for (let i = 0; i < 45; i++) {
    const x = rng() * PAPER_WIDTH;
    const y = rng() * PAPER_HEIGHT;
    const r = 70 + rng() * 180;
    const v = Math.round(219 + rng() * 21);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v}, ${v}, ${v}, 0.32)`);
    grad.addColorStop(1, `rgba(${v}, ${v}, ${v}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (let i = 0; i < 2800; i++) {
    const x = rng() * PAPER_WIDTH;
    const y = rng() * PAPER_HEIGHT;
    const v = Math.round(220 + rng() * 20);
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.25)`;
    ctx.fillRect(x, y, 2 + rng() * 5, 1.5);
  }
}

export function createPaperTextures(): PaperTextureSet {
  const left = makeCanvas(PAPER_WIDTH, PAPER_HEIGHT);
  paintAgedNewsprintBackground(left.ctx, PAPER_WIDTH, PAPER_HEIGHT, 'right', 198901);

  const right = makeCanvas(PAPER_WIDTH, PAPER_HEIGHT);
  paintAgedNewsprintBackground(right.ctx, PAPER_WIDTH, PAPER_HEIGHT, 'left', 198907);

  const bump = makeCanvas(PAPER_WIDTH, PAPER_HEIGHT);
  drawPaperBump(bump.ctx);

  const roughness = makeCanvas(PAPER_WIDTH, PAPER_HEIGHT);
  drawPaperRoughness(roughness.ctx);

  const leftBaseMap = new THREE.CanvasTexture(left.canvas);
  leftBaseMap.colorSpace = THREE.SRGBColorSpace;
  leftBaseMap.anisotropy = 8;
  leftBaseMap.needsUpdate = true;

  const rightBaseMap = new THREE.CanvasTexture(right.canvas);
  rightBaseMap.colorSpace = THREE.SRGBColorSpace;
  rightBaseMap.anisotropy = 8;
  rightBaseMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bump.canvas);
  bumpMap.anisotropy = 4;
  bumpMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughness.canvas);
  roughnessMap.anisotropy = 4;
  roughnessMap.needsUpdate = true;

  return {
    leftBaseMap,
    rightBaseMap,
    bumpMap,
    roughnessMap,
    dispose() {
      leftBaseMap.dispose();
      rightBaseMap.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}
