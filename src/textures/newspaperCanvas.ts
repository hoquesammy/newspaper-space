import * as THREE from 'three';
import { PAPER_COLORS } from '../config/theme';
import type {
  IllustrationType,
  NewspaperEdition,
  NewspaperSection,
} from '../types';
import { paintAgedNewsprintBackground, type SpineEdge } from './paperTexture';

export interface NewspaperPrintAssets {
  frontCoverMap: THREE.CanvasTexture;
  backCoverMap: THREE.CanvasTexture;
  sweepPageMaps: THREE.CanvasTexture[];
  leftPrintMap: THREE.CanvasTexture;
  rightPrintMap: THREE.CanvasTexture;
  leftBodyMaskMap: THREE.CanvasTexture;
  rightBodyMaskMap: THREE.CanvasTexture;
  dispose(): void;
}

const PRINT_W = 2048;
const PRINT_H = 3344;
const MASK_W = 1024;
const MASK_H = 1672;
const SWEEP_W = 1024;
const SWEEP_H = 1672;

const INK_DARK = '#191613';
const INK_BODY = '#24201b';
const INK_MUTED = '#4c4439';
const INK_RULE = '#29241e';
const PLATE_BG = '#dfd2b6';

const FONT_MASTHEAD = '"UnifrakturMaguntia", Georgia, serif';
const FONT_HEADLINE = '"Playfair Display", Georgia, serif';
const FONT_CONDENSED = '"Oswald", "Arial Narrow", sans-serif';
const FONT_BODY = '"Newsreader", Georgia, "Times New Roman", serif';
const FONT_MONO = '"IBM Plex Mono", "Courier New", monospace';

interface MaskRecorder {
  mark(x: number, y: number, w: number, h: number): void;
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
    throw new Error('Failed to acquire 2D canvas context for newspaper print assets');
  }
  return { canvas, ctx };
}

async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return;
  }
  const fontSpecs = [
    '400 72px "UnifrakturMaguntia"',
    '900 72px "Playfair Display"',
    '700 48px "Playfair Display"',
    'italic 700 32px "Playfair Display"',
    '700 56px "Oswald"',
    '500 28px "Oswald"',
    '400 28px "Newsreader"',
    '600 28px "Newsreader"',
    'italic 400 24px "Newsreader"',
    '600 20px "IBM Plex Mono"',
  ];
  const loads = fontSpecs.map((spec) => document.fonts.load(spec).catch(() => []));
  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, 2600);
  });
  await Promise.race([
    Promise.allSettled([...loads, document.fonts.ready]).then(() => undefined),
    timeout,
  ]);
}

function createMaskRecorder(
  maskCtx: CanvasRenderingContext2D,
  scale: number,
): MaskRecorder {
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, maskCtx.canvas.width, maskCtx.canvas.height);

  return {
    mark(x: number, y: number, w: number, h: number) {
      if (w <= 0 || h <= 0) return;
      const pad = 2;
      const mx = Math.max(0, Math.floor(x * scale) - pad);
      const my = Math.max(0, Math.floor(y * scale) - pad);
      const mw = Math.min(maskCtx.canvas.width - mx, Math.ceil(w * scale) + pad * 2);
      const mh = Math.min(maskCtx.canvas.height - my, Math.ceil(h * scale) + pad * 2);
      maskCtx.fillStyle = '#ffffff';
      maskCtx.fillRect(mx, my, mw, mh);
    },
  };
}

function drawDoubleRule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  thick = 4,
  thin = 1.5,
  gap = 5,
): void {
  ctx.fillStyle = INK_RULE;
  ctx.fillRect(x, y, w, thick);
  ctx.fillRect(x, y + thick + gap, w, thin);
}

function drawHairline(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 1.5,
  color = 'rgba(41, 36, 30, 0.55)',
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  firstLineMaxWidth?: number,
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const limit = lines.length === 0 && firstLineMaxWidth !== undefined ? firstLineMaxWidth : maxWidth;
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= limit || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines?: number,
  align: CanvasTextAlign = 'left',
): { endY: number; lineCount: number } {
  const lines = wrapText(ctx, text, maxWidth);
  const count = maxLines !== undefined ? Math.min(lines.length, maxLines) : lines.length;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const drawX = align === 'center' ? x + maxWidth * 0.5 : align === 'right' ? x + maxWidth : x;

  for (let i = 0; i < count; i++) {
    let line = lines[i];
    if (maxLines !== undefined && i === count - 1 && lines.length > count) {
      line = line.replace(/[.,;:\s]*$/, '') + '…';
    }
    ctx.fillText(line, drawX, y + i * lineHeight);
  }
  return { endY: y + count * lineHeight, lineCount: count };
}

function drawFittedSingleLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontTemplate: (size: number) => string,
  maxFontSize: number,
  minFontSize: number,
  align: CanvasTextAlign = 'center',
): number {
  let size = maxFontSize;
  while (size > minFontSize) {
    ctx.font = fontTemplate(size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  ctx.font = fontTemplate(size);
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const drawX = align === 'center' ? x + maxWidth * 0.5 : align === 'right' ? x + maxWidth : x;
  ctx.fillText(text, drawX, y);
  return size;
}

// ============================================================================
// HALFTONE ARCHIVAL ILLUSTRATION ENGINE
// ============================================================================

function renderHalftonePlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dotPitch: number,
  paintGrayscale: (gCtx: CanvasRenderingContext2D, gw: number, gh: number) => void,
  paintInkOverlay?: (oCtx: CanvasRenderingContext2D, ox: number, oy: number, ow: number, oh: number) => void,
): void {
  if (w < 20 || h < 20) return;

  ctx.save();
  // Warm aged photographic paper plate background
  ctx.fillStyle = PLATE_BG;
  ctx.fillRect(x, y, w, h);

  // Clip inside inner frame
  const inset = 4;
  const ix = x + inset;
  const iy = y + inset;
  const iw = w - inset * 2;
  const ih = h - inset * 2;

  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();

  // Sample grayscale source onto compact offscreen canvas
  const sampleW = Math.max(48, Math.round(iw / Math.max(dotPitch * 0.8, 2)));
  const sampleH = Math.max(32, Math.round(ih / Math.max(dotPitch * 0.8, 2)));
  const off = makeCanvas(sampleW, sampleH);
  off.ctx.fillStyle = '#ffffff';
  off.ctx.fillRect(0, 0, sampleW, sampleH);
  paintGrayscale(off.ctx, sampleW, sampleH);

  const imgData = off.ctx.getImageData(0, 0, sampleW, sampleH).data;

  // Classic 1990s newspaper halftone dot screen (staggered 45-degree screen)
  ctx.fillStyle = PAPER_COLORS.halftoneDark;
  const rowStep = dotPitch * 0.88;
  const maxR = dotPitch * 0.54;
  let rowIndex = 0;

  for (let py = 0; py <= ih; py += rowStep) {
    const xOffset = (rowIndex % 2) * (dotPitch * 0.5);
    const sy = Math.min(sampleH - 1, Math.max(0, Math.floor((py / ih) * sampleH)));
    for (let px = -xOffset; px <= iw; px += dotPitch) {
      const sx = Math.min(sampleW - 1, Math.max(0, Math.floor((px / iw) * sampleW)));
      const idx = (sy * sampleW + sx) * 4;
      const lum = (imgData[idx] * 0.299 + imgData[idx + 1] * 0.587 + imgData[idx + 2] * 0.114) / 255;
      const darkness = 1 - lum;
      if (darkness > 0.06) {
        const r = Math.pow(darkness, 0.82) * maxR;
        ctx.beginPath();
        ctx.arc(ix + px, iy + py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    rowIndex++;
  }

  // Crisp engraved ink linework / annotations on top of halftone
  if (paintInkOverlay) {
    paintInkOverlay(ctx, ix, iy, iw, ih);
  }

  // Subtle vintage edge vignette inside the photo plate
  const vig = ctx.createRadialGradient(
    ix + iw * 0.5,
    iy + ih * 0.5,
    Math.min(iw, ih) * 0.28,
    ix + iw * 0.5,
    iy + ih * 0.5,
    Math.max(iw, ih) * 0.72,
  );
  vig.addColorStop(0, 'rgba(30, 24, 18, 0)');
  vig.addColorStop(1, 'rgba(30, 24, 18, 0.24)');
  ctx.fillStyle = vig;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.restore();

  // Double hairline archival plate frame
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = 2.2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(26, 23, 20, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
}

function drawWallSilhouettesScene(g: CanvasRenderingContext2D, w: number, h: number): void {
  // Night sky gradient
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#141414');
  sky.addColorStop(0.58, '#4a4a4a');
  sky.addColorStop(0.82, '#888888');
  sky.addColorStop(1, '#1c1c1c');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // Dramatic searchlight beams cutting across the night sky
  const drawBeam = (bx: number, topX: number, spread: number, alpha: number) => {
    const grad = g.createLinearGradient(bx, h * 0.85, topX, 0);
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(bx - spread * 0.15, h * 0.82);
    g.lineTo(topX - spread, 0);
    g.lineTo(topX + spread, 0);
    g.lineTo(bx + spread * 0.15, h * 0.82);
    g.closePath();
    g.fill();
  };
  drawBeam(w * 0.18, w * 0.42, w * 0.16, 0.65);
  drawBeam(w * 0.82, w * 0.56, w * 0.18, 0.6);
  drawBeam(w * 0.5, w * 0.52, w * 0.12, 0.5);

  // Brandenburg Gate silhouette in background center
  const gx = w * 0.34;
  const gw = w * 0.32;
  const gTop = h * 0.25;
  const gBase = h * 0.68;
  g.fillStyle = '#252525';
  // Attic + entablature
  g.fillRect(gx - gw * 0.04, gTop, gw * 1.08, h * 0.09);
  g.fillRect(gx + gw * 0.18, gTop - h * 0.06, gw * 0.64, h * 0.06);
  // Quadriga crest silhouette
  g.beginPath();
  g.arc(gx + gw * 0.5, gTop - h * 0.09, gw * 0.12, Math.PI, 0);
  g.fill();
  // 6 Doric columns
  const cols = 6;
  for (let i = 0; i < cols; i++) {
    const cx = gx + (i / (cols - 1)) * (gw - gw * 0.09);
    g.fillRect(cx, gTop + h * 0.08, gw * 0.085, gBase - (gTop + h * 0.08));
  }

  // Concrete Berlin Wall parapet across foreground
  const wallY = h * 0.66;
  g.fillStyle = '#333333';
  g.fillRect(0, wallY, w, h - wallY);
  // Rounded concrete pipe cap along top of wall
  g.fillStyle = '#5c5c5c';
  g.fillRect(0, wallY - h * 0.025, w, h * 0.035);
  // Wall panel vertical seams
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = Math.max(1, w * 0.004);
  for (let px = w * 0.08; px < w; px += w * 0.12) {
    g.beginPath();
    g.moveTo(px, wallY);
    g.lineTo(px, h);
    g.stroke();
  }

  // Silhouettes of jubilant Berliners standing & waving atop the wall
  g.fillStyle = '#0c0c0c';
  const figures = [0.09, 0.15, 0.21, 0.28, 0.36, 0.43, 0.51, 0.58, 0.66, 0.74, 0.81, 0.89];
  figures.forEach((fx, i) => {
    const x = fx * w;
    const figH = h * (0.14 + (i % 3) * 0.028);
    const torsoW = w * 0.026;
    const baseY = wallY - h * 0.015;
    // Torso
    g.fillRect(x - torsoW * 0.5, baseY - figH * 0.72, torsoW, figH * 0.74);
    // Head
    g.beginPath();
    g.arc(x, baseY - figH * 0.82, torsoW * 0.42, 0, Math.PI * 2);
    g.fill();
    // Raised arms
    g.lineWidth = Math.max(1.2, torsoW * 0.34);
    g.strokeStyle = '#0c0c0c';
    g.beginPath();
    g.moveTo(x - torsoW * 0.4, baseY - figH * 0.62);
    g.lineTo(x - torsoW * 1.15, baseY - figH * (i % 2 === 0 ? 1.05 : 0.9));
    g.moveTo(x + torsoW * 0.4, baseY - figH * 0.62);
    g.lineTo(x + torsoW * 1.15, baseY - figH * (i % 2 === 1 ? 1.08 : 0.88));
    g.stroke();
  });

  // Glowing sparklers / camera flashes
  g.fillStyle = '#ffffff';
  for (const [sx, sy] of [
    [0.22, 0.46],
    [0.44, 0.43],
    [0.67, 0.47],
    [0.83, 0.49],
  ]) {
    const r = Math.max(2, w * 0.014);
    const fl = g.createRadialGradient(sx * w, sy * h, 0, sx * w, sy * h, r * 3);
    fl.addColorStop(0, 'rgba(255,255,255,0.95)');
    fl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fl;
    g.beginPath();
    g.arc(sx * w, sy * h, r * 3, 0, Math.PI * 2);
    g.fill();
  }
}

function drawPressCameraScene(g: CanvasRenderingContext2D, w: number, h: number): void {
  // Dim press hall backdrop
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2c2c2c');
  bg.addColorStop(0.6, '#6e6e6e');
  bg.addColorStop(1, '#262626');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // Bright camera flash burst upper right
  const flash = g.createRadialGradient(w * 0.72, h * 0.28, 0, w * 0.72, h * 0.28, w * 0.42);
  flash.addColorStop(0, 'rgba(255,255,255,0.98)');
  flash.addColorStop(0.35, 'rgba(240,240,240,0.55)');
  flash.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = flash;
  g.fillRect(0, 0, w, h);

  // Press conference table & dossier papers
  g.fillStyle = '#383838';
  g.fillRect(0, h * 0.68, w, h * 0.32);
  g.fillStyle = '#dcdcdc';
  g.beginPath();
  g.moveTo(w * 0.24, h * 0.76);
  g.lineTo(w * 0.56, h * 0.72);
  g.lineTo(w * 0.62, h * 0.88);
  g.lineTo(w * 0.28, h * 0.92);
  g.closePath();
  g.fill();

  // Cluster of 1989 broadcast microphones on desk
  g.strokeStyle = '#111111';
  g.fillStyle = '#111111';
  for (const [mx, angle] of [
    [0.34, -0.35],
    [0.44, -0.1],
    [0.54, 0.18],
    [0.64, 0.36],
  ]) {
    const bx = mx * w;
    const by = h * 0.84;
    const tx = bx + Math.sin(angle) * h * 0.28;
    const ty = by - Math.cos(angle) * h * 0.28;
    g.lineWidth = Math.max(1.5, w * 0.012);
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(tx, ty);
    g.stroke();
    g.beginPath();
    g.ellipse(tx, ty, w * 0.022, h * 0.045, angle, 0, Math.PI * 2);
    g.fill();
  }

  // Vintage SLR camera body & lens silhouette on left foreground
  g.fillStyle = '#161616';
  g.fillRect(w * 0.08, h * 0.34, w * 0.26, h * 0.24);
  g.fillRect(w * 0.15, h * 0.28, w * 0.11, h * 0.07);
  g.fillStyle = '#8d8d8d';
  g.beginPath();
  g.arc(w * 0.21, h * 0.46, h * 0.095, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#181818';
  g.beginPath();
  g.arc(w * 0.21, h * 0.46, h * 0.06, 0, Math.PI * 2);
  g.fill();
}

function drawCrowdCelebrationScene(g: CanvasRenderingContext2D, w: number, h: number): void {
  // Dramatic night sky with celebratory light cones
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#181818');
  sky.addColorStop(0.55, '#585858');
  sky.addColorStop(1, '#202020');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // Spotlights
  for (const [sx, tx] of [
    [0.12, 0.32],
    [0.5, 0.48],
    [0.88, 0.66],
  ]) {
    const grad = g.createLinearGradient(sx * w, h, tx * w, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(sx * w - w * 0.03, h);
    g.lineTo(tx * w - w * 0.14, 0);
    g.lineTo(tx * w + w * 0.14, 0);
    g.lineTo(sx * w + w * 0.03, h);
    g.closePath();
    g.fill();
  }

  // Wall crest curving slightly across the frame
  g.fillStyle = '#383838';
  g.fillRect(0, h * 0.64, w, h * 0.36);
  g.fillStyle = '#757575';
  g.fillRect(0, h * 0.62, w, h * 0.04);

  // Dense celebrating crowd linked arm-in-arm along the crest
  g.fillStyle = '#0e0e0e';
  const count = 18;
  for (let i = 0; i < count; i++) {
    const fx = (0.04 + (i / (count - 1)) * 0.92) * w;
    const fh = h * (0.19 + ((i * 7) % 4) * 0.025);
    const fw = w * 0.026;
    const baseY = h * 0.63;
    g.fillRect(fx - fw * 0.5, baseY - fh * 0.72, fw, fh * 0.75);
    g.beginPath();
    g.arc(fx, baseY - fh * 0.84, fw * 0.46, 0, Math.PI * 2);
    g.fill();
    // Raised hammer / champagne bottle / waving arms
    g.strokeStyle = '#0e0e0e';
    g.lineWidth = Math.max(1.2, fw * 0.32);
    g.beginPath();
    g.moveTo(fx, baseY - fh * 0.58);
    g.lineTo(fx + (i % 2 === 0 ? -fw : fw), baseY - fh * 1.12);
    g.stroke();
  }

  // Headlight glow & sparklers
  for (const [lx, ly, lr] of [
    [0.18, 0.82, 0.09],
    [0.25, 0.82, 0.08],
    [0.76, 0.83, 0.09],
    [0.34, 0.36, 0.06],
    [0.62, 0.33, 0.07],
  ]) {
    const rad = lr * w;
    const gl = g.createRadialGradient(lx * w, ly * h, 0, lx * w, ly * h, rad);
    gl.addColorStop(0, 'rgba(255,255,255,0.92)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.beginPath();
    g.arc(lx * w, ly * h, rad, 0, Math.PI * 2);
    g.fill();
  }
}

function drawTimelineStripPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  renderHalftonePlate(
    ctx,
    x,
    y,
    w,
    h,
    5,
    (g, gw, gh) => {
      const bg = g.createLinearGradient(0, 0, gw, 0);
      bg.addColorStop(0, '#c8c8c8');
      bg.addColorStop(0.5, '#ededed');
      bg.addColorStop(1, '#c4c4c4');
      g.fillStyle = bg;
      g.fillRect(0, 0, gw, gh);
      // Subtle top/bottom archival tone bands
      g.fillStyle = '#999999';
      g.fillRect(0, 0, gw, gh * 0.14);
      g.fillRect(0, gh * 0.86, gw, gh * 0.14);
    },
    (o, ox, oy, ow, oh) => {
      const lineY = oy + oh * 0.5;
      // Double timeline axis
      o.strokeStyle = INK_DARK;
      o.lineWidth = 3;
      o.beginPath();
      o.moveTo(ox + ow * 0.05, lineY);
      o.lineTo(ox + ow * 0.95, lineY);
      o.stroke();

      const milestones = [
        { t: 0.09, year: 'AUG 1961', label: 'WALL ERECTED' },
        { t: 0.3, year: 'JUN 1963', label: 'BERLIN SPEECH' },
        { t: 0.51, year: 'MAY 1989', label: 'HUNGARY WIRE CUT' },
        { t: 0.72, year: 'OCT 1989', label: 'LEIPZIG VIGILS' },
        { t: 0.91, year: 'NOV 9, 1989', label: 'GATES OPEN' },
      ];

      const fontScale = Math.max(0.75, ow / 1400);
      milestones.forEach((m, idx) => {
        const mx = ox + ow * m.t;
        const r = Math.max(7, 11 * fontScale);
        // Outer ring
        o.fillStyle = PLATE_BG;
        o.strokeStyle = INK_DARK;
        o.lineWidth = 3;
        o.beginPath();
        o.arc(mx, lineY, r, 0, Math.PI * 2);
        o.fill();
        o.stroke();
        // Solid center dot (larger on 1989 climax)
        o.fillStyle = INK_DARK;
        o.beginPath();
        o.arc(mx, lineY, idx === milestones.length - 1 ? r * 0.65 : r * 0.45, 0, Math.PI * 2);
        o.fill();

        // Year above
        o.fillStyle = INK_DARK;
        o.font = `700 ${Math.round(22 * fontScale)}px ${FONT_CONDENSED}`;
        o.textAlign = 'center';
        o.textBaseline = 'bottom';
        o.fillText(m.year, mx, lineY - r - 8);

        // Label below
        o.font = `600 ${Math.round(16 * fontScale)}px ${FONT_MONO}`;
        o.textBaseline = 'top';
        o.fillText(m.label, mx, lineY + r + 8);
      });
    },
  );
}

function drawEuropeMapPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  renderHalftonePlate(
    ctx,
    x,
    y,
    w,
    h,
    5,
    (g, gw, gh) => {
      // Sea tones (darker halftone)
      g.fillStyle = '#929292';
      g.fillRect(0, 0, gw, gh);
      // Stylized Central & Eastern Europe landmass (lighter)
      g.fillStyle = '#e8e8e8';
      g.beginPath();
      g.moveTo(gw * 0.04, gh * 0.28);
      g.lineTo(gw * 0.24, gh * 0.22);
      g.lineTo(gw * 0.34, gh * 0.14);
      g.lineTo(gw * 0.58, gh * 0.18);
      g.lineTo(gw * 0.86, gh * 0.08);
      g.lineTo(gw * 0.98, gh * 0.15);
      g.lineTo(gw * 0.98, gh * 0.92);
      g.lineTo(gw * 0.66, gh * 0.94);
      g.lineTo(gw * 0.44, gh * 0.82);
      g.lineTo(gw * 0.32, gh * 0.92);
      g.lineTo(gw * 0.12, gh * 0.84);
      g.lineTo(gw * 0.04, gh * 0.62);
      g.closePath();
      g.fill();

      // Subtle darker shade for former Eastern Bloc side
      g.fillStyle = '#c8c8c8';
      g.beginPath();
      g.moveTo(gw * 0.46, gh * 0.16);
      g.lineTo(gw * 0.98, gh * 0.14);
      g.lineTo(gw * 0.98, gh * 0.92);
      g.lineTo(gw * 0.56, gh * 0.92);
      g.lineTo(gw * 0.5, gh * 0.62);
      g.lineTo(gw * 0.42, gh * 0.42);
      g.closePath();
      g.fill();
    },
    (o, ox, oy, ow, oh) => {
      const sc = Math.max(0.65, ow / 760);

      // Subtle latitude/longitude graticule
      o.strokeStyle = 'rgba(26, 23, 20, 0.22)';
      o.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        o.beginPath();
        o.moveTo(ox + (ow * i) / 5, oy);
        o.lineTo(ox + (ow * i) / 5, oy + oh);
        o.stroke();
      }
      for (let j = 1; j <= 3; j++) {
        o.beginPath();
        o.moveTo(ox, oy + (oh * j) / 4);
        o.lineTo(ox + ow, oy + (oh * j) / 4);
        o.stroke();
      }

      // Breaking Iron Curtain dashed line (Baltic to Adriatic)
      o.save();
      o.strokeStyle = INK_DARK;
      o.lineWidth = Math.max(2.5, 4 * sc);
      o.setLineDash([12 * sc, 8 * sc]);
      o.beginPath();
      o.moveTo(ox + ow * 0.44, oy + oh * 0.18);
      o.bezierCurveTo(
        ox + ow * 0.41,
        oy + oh * 0.42,
        ox + ow * 0.52,
        oy + oh * 0.62,
        ox + ow * 0.48,
        oy + oh * 0.86,
      );
      o.stroke();
      o.restore();

      // Key European cities
      const cities = [
        { name: 'BERLIN', cx: 0.46, cy: 0.34, primary: true },
        { name: 'WARSAW', cx: 0.72, cy: 0.36, primary: false },
        { name: 'PRAGUE', cx: 0.53, cy: 0.54, primary: false },
        { name: 'VIENNA', cx: 0.58, cy: 0.68, primary: false },
        { name: 'BUDAPEST', cx: 0.72, cy: 0.74, primary: false },
        { name: 'BONN', cx: 0.25, cy: 0.44, primary: false },
      ];

      cities.forEach((c) => {
        const px = ox + ow * c.cx;
        const py = oy + oh * c.cy;
        o.fillStyle = INK_DARK;
        o.beginPath();
        o.arc(px, py, (c.primary ? 6.5 : 4.2) * sc, 0, Math.PI * 2);
        o.fill();
        if (c.primary) {
          o.strokeStyle = INK_DARK;
          o.lineWidth = 2;
          o.beginPath();
          o.arc(px, py, 11 * sc, 0, Math.PI * 2);
          o.stroke();
        }
        o.font = `${c.primary ? 700 : 600} ${Math.round((c.primary ? 20 : 15) * sc)}px ${FONT_CONDENSED}`;
        o.textAlign = 'left';
        o.textBaseline = 'middle';
        o.fillText(c.name, px + 10 * sc, py);
      });

      // Sea labels & compass
      o.font = `italic 600 ${Math.round(14 * sc)}px ${FONT_BODY}`;
      o.fillStyle = INK_MUTED;
      o.fillText('BALTIC SEA', ox + ow * 0.52, oy + oh * 0.11);
      o.fillText('ADRIATIC', ox + ow * 0.34, oy + oh * 0.9);

      // Legend box bottom-left
      const lx = ox + 12;
      const ly = oy + oh - Math.round(44 * sc);
      const lw = Math.round(190 * sc);
      const lh = Math.round(32 * sc);
      o.fillStyle = 'rgba(235, 224, 198, 0.9)';
      o.fillRect(lx, ly, lw, lh);
      o.strokeStyle = INK_DARK;
      o.lineWidth = 1.5;
      o.strokeRect(lx, ly, lw, lh);
      o.fillStyle = INK_DARK;
      o.font = `600 ${Math.round(12 * sc)}px ${FONT_MONO}`;
      o.textAlign = 'left';
      o.textBaseline = 'middle';
      o.fillText('--- IRON CURTAIN', lx + 8 * sc, ly + lh * 0.5);
    },
  );
}

function drawCheckpointMapPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  renderHalftonePlate(
    ctx,
    x,
    y,
    w,
    h,
    5,
    (g, gw, gh) => {
      // West Berlin lighter tone, East Berlin slightly darker tone
      g.fillStyle = '#e6e6e6';
      g.fillRect(0, 0, gw, gh);
      g.fillStyle = '#c4c4c4';
      g.beginPath();
      g.moveTo(gw * 0.54, 0);
      g.lineTo(gw, 0);
      g.lineTo(gw, gh);
      g.lineTo(gw * 0.48, gh);
      g.bezierCurveTo(gw * 0.42, gh * 0.65, gw * 0.62, gh * 0.4, gw * 0.54, 0);
      g.closePath();
      g.fill();
    },
    (o, ox, oy, ow, oh) => {
      const sc = Math.max(0.65, ow / 760);

      // River Spree winding horizontally across Berlin
      o.strokeStyle = 'rgba(42, 38, 32, 0.35)';
      o.lineWidth = Math.max(4, 9 * sc);
      o.beginPath();
      o.moveTo(ox, oy + oh * 0.58);
      o.bezierCurveTo(
        ox + ow * 0.28,
        oy + oh * 0.46,
        ox + ow * 0.62,
        oy + oh * 0.64,
        ox + ow,
        oy + oh * 0.5,
      );
      o.stroke();

      // The Berlin Wall boundary line (bold double-track line)
      o.strokeStyle = INK_DARK;
      o.lineWidth = Math.max(3, 5 * sc);
      o.beginPath();
      o.moveTo(ox + ow * 0.54, oy);
      o.bezierCurveTo(
        ox + ow * 0.62,
        oy + oh * 0.38,
        ox + ow * 0.42,
        oy + oh * 0.66,
        ox + ow * 0.48,
        oy + oh,
      );
      o.stroke();

      // Sector labels
      o.fillStyle = 'rgba(26, 23, 20, 0.55)';
      o.font = `700 ${Math.round(18 * sc)}px ${FONT_CONDENSED}`;
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillText('WEST BERLIN', ox + ow * 0.22, oy + oh * 0.2);
      o.fillText('EAST BERLIN', ox + ow * 0.78, oy + oh * 0.2);

      // Historic crossing points
      const crossings = [
        { name: 'BORNHOLMER STR.', cx: 0.56, cy: 0.18, align: 'right' as const },
        { name: 'INVALIDENSTR.', cx: 0.55, cy: 0.4, align: 'left' as const },
        { name: 'BRANDENBURG GATE', cx: 0.51, cy: 0.56, align: 'right' as const },
        { name: 'CHECKPOINT CHARLIE', cx: 0.48, cy: 0.78, align: 'left' as const },
      ];

      crossings.forEach((pt) => {
        const px = ox + ow * pt.cx;
        const py = oy + oh * pt.cy;
        o.fillStyle = PLATE_BG;
        o.strokeStyle = INK_DARK;
        o.lineWidth = 2.4;
        o.fillRect(px - 6 * sc, py - 6 * sc, 12 * sc, 12 * sc);
        o.strokeRect(px - 6 * sc, py - 6 * sc, 12 * sc, 12 * sc);

        o.fillStyle = INK_DARK;
        o.font = `700 ${Math.round(14 * sc)}px ${FONT_MONO}`;
        o.textAlign = pt.align;
        o.textBaseline = 'middle';
        const dx = pt.align === 'left' ? 12 * sc : -12 * sc;
        o.fillText(pt.name, px + dx, py);
      });
    },
  );
}

function drawIllustration(
  ctx: CanvasRenderingContext2D,
  type: IllustrationType,
  x: number,
  y: number,
  w: number,
  h: number,
  dotPitch = 6,
): void {
  switch (type) {
    case 'wall-silhouettes':
      renderHalftonePlate(ctx, x, y, w, h, dotPitch, drawWallSilhouettesScene);
      break;
    case 'press-camera':
      renderHalftonePlate(
        ctx,
        x,
        y,
        w,
        h,
        dotPitch,
        drawPressCameraScene,
        (o, ox, oy, ow, oh) => {
          const sc = Math.max(0.65, ow / 560);
          o.fillStyle = 'rgba(235, 224, 198, 0.92)';
          o.fillRect(ox + ow * 0.54, oy + oh * 0.78, ow * 0.4, oh * 0.16);
          o.strokeStyle = INK_DARK;
          o.lineWidth = 1.5;
          o.strokeRect(ox + ow * 0.54, oy + oh * 0.78, ow * 0.4, oh * 0.16);
          o.fillStyle = INK_DARK;
          o.font = `700 ${Math.round(14 * sc)}px ${FONT_MONO}`;
          o.textAlign = 'center';
          o.textBaseline = 'middle';
          o.fillText('LIVE · MOHRENSTR.', ox + ow * 0.74, oy + oh * 0.86);
        },
      );
      break;
    case 'timeline-strip':
      drawTimelineStripPlate(ctx, x, y, w, h);
      break;
    case 'crowd-celebration':
      renderHalftonePlate(ctx, x, y, w, h, dotPitch, drawCrowdCelebrationScene);
      break;
    case 'europe-map':
      drawEuropeMapPlate(ctx, x, y, w, h);
      break;
    case 'checkpoint-map':
      drawCheckpointMapPlate(ctx, x, y, w, h);
      break;
  }
}

// ============================================================================
// MULTI-COLUMN NEWSPAPER COPY ENGINE (WITH DROP CAP & BODY MASKING)
// ============================================================================

interface FlowLine {
  text: string;
  font: string;
  indent: number;
  gapAfter: number;
}

function drawBodyColumns(
  ctx: CanvasRenderingContext2D,
  mask: MaskRecorder | null,
  lead: string,
  paragraphs: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  colCount: number,
  fontSize: number,
  pullQuote?: string,
): void {
  if (h < 30 || w < 40) return;

  const colGap = 24;
  const colW = (w - colGap * (colCount - 1)) / colCount;
  const lineH = Math.round(fontSize * 1.34);
  const paraGap = Math.round(lineH * 0.42);

  // Draw vertical hairline column dividers
  for (let c = 1; c < colCount; c++) {
    const divX = x + c * colW + (c - 0.5) * colGap;
    drawHairline(ctx, divX, y + 4, divX, y + h - 4, 1.2, 'rgba(41, 36, 30, 0.35)');
  }

  // Reserve pull-quote box at bottom of last column if provided and space allows
  let quoteBoxH = 0;
  let quoteLines: string[] = [];
  const quoteFontSize = Math.round(fontSize * 1.06);
  const quoteLineH = Math.round(quoteFontSize * 1.32);

  if (pullQuote && h > 160) {
    ctx.font = `italic 700 ${quoteFontSize}px ${FONT_HEADLINE}`;
    quoteLines = wrapText(ctx, pullQuote, colW - 24);
    quoteBoxH = Math.min(h * 0.42, quoteLines.length * quoteLineH + 28);
  }

  // Available height per column (rightmost column accounts for pull-quote box)
  const colAvailH: number[] = [];
  let totalAvailH = 0;
  for (let c = 0; c < colCount; c++) {
    const avail = c === colCount - 1 && quoteBoxH > 0 ? Math.max(0, h - quoteBoxH - 12) : h;
    colAvailH.push(avail);
    totalAvailH += avail;
  }

  // Pre-wrap all paragraphs into FlowLines so we can balance evenly across columns
  const allParas = [lead, ...paragraphs].map((p) => p.trim()).filter(Boolean);
  const flowLines: FlowLine[] = [];

  let dropCapChar: string | null = null;
  let dropCapSize = 0;
  let dropCapW = 0;
  let dropCapIndent = 0;
  let dropCapLines = 0;

  if (allParas.length > 0 && colAvailH[0] >= lineH * 2.5) {
    dropCapChar = allParas[0].charAt(0);
    dropCapSize = Math.round(lineH * 2.15);
    ctx.save();
    ctx.font = `900 ${dropCapSize}px ${FONT_HEADLINE}`;
    dropCapW = ctx.measureText(dropCapChar).width;
    ctx.restore();
    dropCapIndent = dropCapW + 10;
    dropCapLines = 2;
  }

  for (let pIdx = 0; pIdx < allParas.length; pIdx++) {
    const isLead = pIdx === 0;
    const paraFont = isLead
      ? `600 ${fontSize}px ${FONT_BODY}`
      : `400 ${fontSize}px ${FONT_BODY}`;
    ctx.font = paraFont;

    const textToFlow = isLead && dropCapChar ? allParas[pIdx].slice(1) : allParas[pIdx];
    const words = textToFlow.split(/\s+/);
    let lineText = '';
    let paraLineIdx = 0;
    const paraStartIdx = flowLines.length;

    for (const word of words) {
      const indent = isLead && paraLineIdx < dropCapLines ? dropCapIndent : 0;
      const limit = colW - indent;
      const candidate = lineText ? `${lineText} ${word}` : word;
      if (ctx.measureText(candidate).width <= limit || !lineText) {
        lineText = candidate;
      } else {
        flowLines.push({ text: lineText, font: paraFont, indent, gapAfter: 0 });
        paraLineIdx++;
        lineText = word;
      }
    }
    if (lineText) {
      const indent = isLead && paraLineIdx < dropCapLines ? dropCapIndent : 0;
      flowLines.push({ text: lineText, font: paraFont, indent, gapAfter: 0 });
    }
    if (flowLines.length > paraStartIdx && pIdx < allParas.length - 1) {
      flowLines[flowLines.length - 1].gapAfter = paraGap;
    }
  }

  // Compute total natural height of wrapped copy
  const totalTextH = flowLines.reduce((acc, ln) => acc + lineH + ln.gapAfter, 0);

  // Split FlowLines proportionally across columns (respecting pull-quote height in last col)
  const columns: FlowLine[][] = Array.from({ length: colCount }, () => []);
  let lineCursor = 0;
  let remainingTextH = totalTextH;
  let remainingAvailH = totalAvailH;

  for (let c = 0; c < colCount; c++) {
    const avail = colAvailH[c];
    if (avail < lineH || lineCursor >= flowLines.length) {
      remainingAvailH -= avail;
      continue;
    }

    const isLastCol = c === colCount - 1;
    // Proportional share of remaining text based on this column's share of remaining space
    const proportionalH =
      remainingAvailH > 0 ? (remainingTextH * avail) / remainingAvailH : avail;
    // Allow up to half a line grace so balancing feels natural without leaving orphan lines
    const targetH = isLastCol ? avail : Math.min(avail, proportionalH + lineH * 0.55);

    let usedH = 0;
    while (lineCursor < flowLines.length) {
      const ln = flowLines[lineCursor];
      const stepH = lineH + ln.gapAfter;
      // Never exceed column's hard available height
      if (usedH + lineH > avail) break;
      // For non-final columns, stop once we reach the balanced target (keeping drop-cap lines together in col 0)
      const keepDropCapTogether = c === 0 && dropCapChar !== null && columns[0].length < dropCapLines;
      if (!isLastCol && !keepDropCapTogether && columns[c].length > 0 && usedH + lineH > targetH) {
        break;
      }
      columns[c].push(ln);
      usedH += stepH;
      remainingTextH -= stepH;
      lineCursor++;
    }
    remainingAvailH -= avail;
  }

  // Render balanced columns + aligned body mask
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (dropCapChar && columns[0].length > 0) {
    ctx.save();
    ctx.font = `900 ${dropCapSize}px ${FONT_HEADLINE}`;
    ctx.fillStyle = INK_DARK;
    ctx.fillText(dropCapChar, x, y - 4);
    mask?.mark(x, y, dropCapW + 4, lineH * 2);
    ctx.restore();
  }

  for (let c = 0; c < colCount; c++) {
    const colLines = columns[c];
    const colBaseX = x + c * (colW + colGap);
    let curY = y;

    for (let i = 0; i < colLines.length; i++) {
      const ln = colLines[i];
      const drawX = colBaseX + ln.indent;
      ctx.fillStyle = INK_BODY;
      ctx.font = ln.font;
      ctx.fillText(ln.text, drawX, curY);
      mask?.mark(drawX, curY, colW - ln.indent, lineH);
      curY += lineH + (i < colLines.length - 1 ? ln.gapAfter : 0);
    }
  }

  // Draw styled pull-quote box at bottom of final column
  if (pullQuote && quoteBoxH > 0) {
    const qx = x + (colCount - 1) * (colW + colGap);
    const qy = y + h - quoteBoxH;

    // Subtle warm ink-wash box + double horizontal bars
    ctx.fillStyle = 'rgba(41, 36, 30, 0.055)';
    ctx.fillRect(qx, qy, colW, quoteBoxH);
    ctx.fillStyle = INK_DARK;
    ctx.fillRect(qx, qy, colW, 3);
    ctx.fillRect(qx, qy + quoteBoxH - 2, colW, 2);

    ctx.fillStyle = INK_DARK;
    ctx.font = `italic 700 ${quoteFontSize}px ${FONT_HEADLINE}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let qCurY = qy + 12;
    for (const qLine of quoteLines) {
      if (qCurY + quoteLineH > qy + quoteBoxH - 4) break;
      ctx.fillText(qLine, qx + 12, qCurY);
      mask?.mark(qx + 12, qCurY, colW - 24, quoteLineH);
      qCurY += quoteLineH;
    }
  }
}

// ============================================================================
// SECTION BLOCK RENDERER (STRICTLY INSIDE section.rect)
// ============================================================================

function drawNewspaperSection(
  ctx: CanvasRenderingContext2D,
  mask: MaskRecorder,
  section: NewspaperSection,
  pageW: number,
  pageH: number,
): void {
  const rx = Math.round(section.rect.u * pageW);
  const ry = Math.round(section.rect.v * pageH);
  const rw = Math.round(section.rect.w * pageW);
  const rh = Math.round(section.rect.h * pageH);

  ctx.save();
  // Strict clipping inside section.rect so text NEVER overflows
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();

  // Subtle 1990s broadsheet block border frame
  ctx.strokeStyle = 'rgba(41, 36, 30, 0.42)';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
  // Crisp top accent bar
  ctx.fillStyle = INK_DARK;
  ctx.fillRect(rx, ry, rw, 4);

  const pad = 22;
  const innerX = rx + pad;
  const innerY = ry + pad + 4;
  const innerW = rw - pad * 2;
  const innerH = rh - pad * 2 - 4;

  // Reserve ~96px corner clearance at 2048px (= 48px at 1024px) around section.dotAnchor
  const dotX = section.dotAnchor.u * pageW;
  const dotY = section.dotAnchor.v * pageH;
  const dotClearRight = dotX > rx + rw * 0.65 && dotY < ry + 180 ? 104 : 0;
  const headerMaxW = innerW - dotClearRight;

  // 1. Kicker pill / rule (UNMASKED so it stays sharp in overview)
  ctx.font = `700 20px ${FONT_CONDENSED}`;
  ctx.fillStyle = INK_DARK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const kickerText = section.kicker.toUpperCase();
  const kickerW = Math.min(headerMaxW, ctx.measureText(kickerText).width + 18);
  ctx.fillStyle = INK_DARK;
  ctx.fillRect(innerX, innerY, kickerW, 28);
  ctx.fillStyle = PAPER_COLORS.base;
  ctx.fillText(kickerText, innerX + 9, innerY + 3);

  let curY = innerY + 36;

  // 2. Bold heavy Playfair Display headline (UNMASKED!)
  const isWide = rw > 1300;
  const isNarrow = rw < 780;
  let headSize = isWide ? 48 : isNarrow ? 34 : 42;
  ctx.font = `900 ${headSize}px ${FONT_HEADLINE}`;
  let headLines = wrapText(ctx, section.headline, headerMaxW);
  while (headLines.length > 3 && headSize > 26) {
    headSize -= 3;
    ctx.font = `900 ${headSize}px ${FONT_HEADLINE}`;
    headLines = wrapText(ctx, section.headline, headerMaxW);
  }
  const headLineH = Math.round(headSize * 1.08);
  ctx.fillStyle = INK_DARK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const line of headLines) {
    ctx.fillText(line, innerX, curY);
    curY += headLineH;
  }

  curY += 6;
  drawHairline(ctx, innerX, curY, innerX + innerW, curY, 1.4, 'rgba(26, 23, 20, 0.55)');
  curY += 8;

  // 3. Italic Byline (MASKED)
  ctx.font = `italic 400 21px ${FONT_BODY}`;
  ctx.fillStyle = INK_MUTED;
  ctx.fillText(section.byline, innerX, curY);
  mask.mark(innerX, curY, Math.min(innerW, ctx.measureText(section.byline).width + 8), 26);
  curY += 32;

  const remainingH = innerY + innerH - curY;

  // 4. Tailored layout by aspect ratio of the section block
  if (section.illustrationType === 'timeline-strip') {
    // Wide chronology strip (Section 3): timeline plate across top + 3 columns below
    const plateH = Math.round(Math.min(186, remainingH * 0.42));
    drawIllustration(ctx, 'timeline-strip', innerX, curY, innerW, plateH, 5);
    curY += plateH + 8;

    if (section.caption) {
      ctx.font = `italic 400 18px ${FONT_BODY}`;
      ctx.fillStyle = INK_MUTED;
      ctx.fillText(section.caption, innerX, curY);
      mask.mark(innerX, curY, innerW, 22);
      curY += 26;
    }

    const bodyH = innerY + innerH - curY;
    drawBodyColumns(
      ctx,
      mask,
      section.lead,
      section.paragraphs,
      innerX,
      curY,
      innerW,
      bodyH,
      3,
      20,
      section.pullQuote,
    );
  } else if (isWide) {
    // Wide hero feature (Section 4): left 54% illustration + caption + pull quote; right 46% 2-col body
    const splitGap = 28;
    const leftW = Math.round(innerW * 0.53);
    const rightX = innerX + leftW + splitGap;
    const rightW = innerW - leftW - splitGap;

    const plateH = Math.round(remainingH * 0.66);
    if (section.illustrationType) {
      drawIllustration(ctx, section.illustrationType, innerX, curY, leftW, plateH, 6);
    }

    let leftY = curY + plateH + 10;
    if (section.caption) {
      ctx.font = `italic 400 19px ${FONT_BODY}`;
      ctx.fillStyle = INK_MUTED;
      const cap = drawWrappedText(ctx, section.caption, innerX, leftY, leftW, 23, 2);
      mask.mark(innerX, leftY, leftW, cap.endY - leftY);
      leftY = cap.endY + 10;
    }

    if (section.pullQuote && innerY + innerH - leftY > 56) {
      const qh = innerY + innerH - leftY;
      ctx.fillStyle = 'rgba(41, 36, 30, 0.055)';
      ctx.fillRect(innerX, leftY, leftW, qh);
      ctx.fillStyle = INK_DARK;
      ctx.fillRect(innerX, leftY, 4, qh);
      ctx.font = `italic 700 24px ${FONT_HEADLINE}`;
      const qRes = drawWrappedText(ctx, section.pullQuote, innerX + 16, leftY + 12, leftW - 26, 30, 3);
      mask.mark(innerX + 16, leftY + 12, leftW - 26, qRes.endY - (leftY + 12));
    }

    drawHairline(ctx, rightX - splitGap * 0.5, curY, rightX - splitGap * 0.5, innerY + innerH, 1.4);

    drawBodyColumns(
      ctx,
      mask,
      section.lead,
      section.paragraphs,
      rightX,
      curY,
      rightW,
      remainingH,
      2,
      21,
    );
  } else {
    // Tall / medium-square block (Sections 1, 2, 5, 6): illustration on top + 1 or 2 columns below
    const plateH = Math.round(remainingH * (isNarrow ? 0.27 : 0.34));
    if (section.illustrationType) {
      drawIllustration(ctx, section.illustrationType, innerX, curY, innerW, plateH, 6);
      curY += plateH + 8;
    }

    if (section.caption) {
      ctx.font = `italic 400 18px ${FONT_BODY}`;
      ctx.fillStyle = INK_MUTED;
      const cap = drawWrappedText(ctx, section.caption, innerX, curY, innerW, 22, 2);
      mask.mark(innerX, curY, innerW, cap.endY - curY);
      curY = cap.endY + 12;
    }

    const bodyH = innerY + innerH - curY;
    const cols = isNarrow ? 1 : 2;
    const bodyFontSize = isNarrow ? 21 : rw > 1050 ? 22 : 20;

    drawBodyColumns(
      ctx,
      mask,
      section.lead,
      section.paragraphs,
      innerX,
      curY,
      innerW,
      bodyH,
      cols,
      bodyFontSize,
      section.pullQuote,
    );
  }

  ctx.restore();
}

// ============================================================================
// HEADERS & MASTHEADS
// ============================================================================

function drawLeftSpreadMasthead(
  ctx: CanvasRenderingContext2D,
  edition: NewspaperEdition,
): void {
  const mx = Math.round(PRINT_W * 0.04);
  const mw = Math.round(PRINT_W * 0.92);
  let y = 52;

  // Ear boxes (left: priceBox, right: edition badge)
  const earW = 240;
  const earH = 66;
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = 2;
  ctx.strokeRect(mx, y + 10, earW, earH);
  ctx.strokeRect(mx + mw - earW, y + 10, earW, earH);

  ctx.fillStyle = INK_DARK;
  ctx.font = `600 18px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ARCHIVAL EDITION', mx + earW * 0.5, y + 30);
  ctx.font = `700 22px ${FONT_CONDENSED}`;
  ctx.fillText(edition.priceBox, mx + earW * 0.5, y + 56);

  ctx.font = `600 17px ${FONT_MONO}`;
  ctx.fillText('BERLIN · LONDON', mx + mw - earW * 0.5, y + 30);
  ctx.font = `700 20px ${FONT_CONDENSED}`;
  ctx.fillText('EXTRA SUPPLEMENT', mx + mw - earW * 0.5, y + 56);

  // Classic 1990s Blackletter Masthead
  ctx.fillStyle = INK_DARK;
  drawFittedSingleLine(
    ctx,
    edition.masthead,
    mx + earW + 20,
    y - 4,
    mw - (earW + 20) * 2,
    (sz) => `400 ${sz}px ${FONT_MASTHEAD}`,
    108,
    64,
    'center',
  );

  y += 108;
  ctx.font = `600 18px ${FONT_MONO}`;
  ctx.fillStyle = INK_MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(edition.subMasthead, mx + mw * 0.5, y);

  y += 32;
  drawDoubleRule(ctx, mx, y, mw, 4, 1.5, 4);
  y += 16;

  // Dateline & Edition strip
  ctx.fillStyle = INK_DARK;
  ctx.font = `600 20px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(edition.editionLine, mx, y);
  ctx.textAlign = 'center';
  ctx.font = `700 22px ${FONT_CONDENSED}`;
  ctx.fillText(edition.dateLine, mx + mw * 0.5, y - 2);
  ctx.textAlign = 'right';
  ctx.font = `600 20px ${FONT_MONO}`;
  ctx.fillText('PAGE 1 · SPECIAL REPORT', mx + mw, y);

  y += 32;
  drawDoubleRule(ctx, mx, y, mw, 1.5, 4, 4);
  y += 22;

  // Bold spread banner headline + subhead (kept safely above v = 0.22 -> y = 607)
  ctx.fillStyle = INK_DARK;
  const bannerSize = drawFittedSingleLine(
    ctx,
    edition.bannerHeadline,
    mx,
    y,
    mw,
    (sz) => `700 ${sz}px ${FONT_CONDENSED}`,
    74,
    46,
    'center',
  );
  y += bannerSize + 14;

  ctx.font = `italic 700 26px ${FONT_HEADLINE}`;
  ctx.fillStyle = INK_BODY;
  const sub = drawWrappedText(ctx, edition.bannerSubhead, mx + 40, y, mw - 80, 32, 2, 'center');
  y = Math.min(586, sub.endY + 12);

  drawDoubleRule(ctx, mx, y, mw, 5, 2, 5);
}

function drawRightSpreadFolio(
  ctx: CanvasRenderingContext2D,
  edition: NewspaperEdition,
): void {
  const mx = Math.round(PRINT_W * 0.04);
  const mw = Math.round(PRINT_W * 0.92);
  let y = 56;

  // Running 1990s broadsheet folio header
  ctx.fillStyle = INK_DARK;
  ctx.font = `400 44px ${FONT_MASTHEAD}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(edition.masthead, mx, y);

  ctx.font = `700 24px ${FONT_CONDENSED}`;
  ctx.textAlign = 'center';
  ctx.fillText('SPECIAL HISTORICAL REPORT · NOVEMBER 1989', mx + mw * 0.5, y + 14);

  ctx.font = `700 24px ${FONT_MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText('PAGE 2', mx + mw, y + 14);

  y += 58;
  drawDoubleRule(ctx, mx, y, mw, 4, 1.5, 4);
  y += 18;

  // Continuation deck
  ctx.fillStyle = INK_DARK;
  drawFittedSingleLine(
    ctx,
    'VOICES FROM THE BREACH · A CONTINENT REDRAWN IN INK AND STONE',
    mx,
    y,
    mw,
    (sz) => `700 ${sz}px ${FONT_CONDENSED}`,
    54,
    34,
    'center',
  );
  y += 66;

  ctx.font = `italic 700 25px ${FONT_HEADLINE}`;
  ctx.fillStyle = INK_BODY;
  drawWrappedText(
    ctx,
    'Eyewitness Dispatches from Kurfürstendamm, Diplomatic Cables Across Europe, and the Archival Sector Map of Berlin',
    mx + 40,
    y,
    mw - 80,
    30,
    2,
    'center',
  );

  drawDoubleRule(ctx, mx, 358, mw, 4, 1.5, 4);
}

// ============================================================================
// FRONT COVER, BACK COVER & SWEEP PAGES
// ============================================================================

function drawFrontCover(
  ctx: CanvasRenderingContext2D,
  edition: NewspaperEdition,
): void {
  paintAgedNewsprintBackground(ctx, PRINT_W, PRINT_H, 'left', 198911);

  const mx = 110;
  const mw = PRINT_W - mx * 2;
  let y = 84;

  // Outer broadsheet decorative border
  ctx.strokeStyle = 'rgba(41, 36, 30, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(54, 48, PRINT_W - 108, PRINT_H - 96);

  // Ear boxes
  const earW = 270;
  const earH = 82;
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(mx, y + 12, earW, earH);
  ctx.strokeRect(mx + mw - earW, y + 12, earW, earH);

  ctx.fillStyle = INK_DARK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 18px ${FONT_MONO}`;
  ctx.fillText('PRICE · ARCHIVE', mx + earW * 0.5, y + 36);
  ctx.font = `700 28px ${FONT_CONDENSED}`;
  ctx.fillText(edition.priceBox, mx + earW * 0.5, y + 68);

  ctx.font = `600 18px ${FONT_MONO}`;
  ctx.fillText('EXTRA EDITION', mx + mw - earW * 0.5, y + 36);
  ctx.font = `700 22px ${FONT_CONDENSED}`;
  ctx.fillText('VOL. CXIV · NO. 314', mx + mw - earW * 0.5, y + 68);

  // Iconic large blackletter masthead
  drawFittedSingleLine(
    ctx,
    edition.masthead,
    mx + earW + 24,
    y - 2,
    mw - (earW + 24) * 2,
    (sz) => `400 ${sz}px ${FONT_MASTHEAD}`,
    126,
    72,
    'center',
  );

  y += 126;
  ctx.font = `600 20px ${FONT_MONO}`;
  ctx.fillStyle = INK_MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(edition.subMasthead, mx + mw * 0.5, y);

  y += 38;
  drawDoubleRule(ctx, mx, y, mw, 5, 2, 5);
  y += 20;

  // Dateline bar
  ctx.fillStyle = INK_DARK;
  ctx.font = `600 22px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(edition.editionLine, mx, y);
  ctx.textAlign = 'center';
  ctx.font = `700 26px ${FONT_CONDENSED}`;
  ctx.fillText(edition.dateLine, mx + mw * 0.5, y - 2);
  ctx.textAlign = 'right';
  ctx.font = `600 22px ${FONT_MONO}`;
  ctx.fillText('BERLIN SPECIAL', mx + mw, y);

  y += 40;
  drawDoubleRule(ctx, mx, y, mw, 2, 5, 5);
  y += 32;

  // Huge bold condensed 90s front-page headline
  ctx.fillStyle = INK_DARK;
  const hSize = drawFittedSingleLine(
    ctx,
    edition.frontCoverHeadline,
    mx,
    y,
    mw,
    (sz) => `700 ${sz}px ${FONT_CONDENSED}`,
    220,
    120,
    'center',
  );
  y += hSize + 10;

  // Subhead banner bar
  ctx.fillStyle = INK_DARK;
  ctx.fillRect(mx, y, mw, 64);
  ctx.fillStyle = PAPER_COLORS.base;
  drawFittedSingleLine(
    ctx,
    edition.frontCoverSubhead,
    mx + 24,
    y + 10,
    mw - 48,
    (sz) => `900 ${sz}px ${FONT_HEADLINE}`,
    42,
    26,
    'center',
  );
  y += 80;

  // Deck line
  ctx.fillStyle = INK_BODY;
  ctx.font = `italic 700 28px ${FONT_HEADLINE}`;
  const deck = drawWrappedText(ctx, edition.frontCoverDeck, mx + 36, y, mw - 72, 36, 2, 'center');
  y = deck.endY + 24;

  // Dramatic procedural halftone centerpiece illustration of the Berlin Wall at night
  const heroH = 820;
  drawIllustration(ctx, 'wall-silhouettes', mx, y, mw, heroH, 7);
  y += heroH + 14;

  ctx.fillStyle = INK_MUTED;
  ctx.font = `italic 400 22px ${FONT_BODY}`;
  ctx.textAlign = 'left';
  ctx.fillText(
    'BERLIN, NOV. 9, 1989 — Citizens climb the concrete parapet before Brandenburg Gate under searchlights as crossing barriers swing open.',
    mx,
    y,
  );
  y += 38;
  drawDoubleRule(ctx, mx, y, mw, 3, 1.5, 4);
  y += 26;

  // 3 authentic newsprint teaser columns below
  const teaserSections = edition.sections.slice(0, 3);
  const colGap = 36;
  const colW = (mw - colGap * 2) / 3;
  const colBottom = PRINT_H - 135;

  teaserSections.forEach((sec, idx) => {
    const cx = mx + idx * (colW + colGap);
    if (idx > 0) {
      drawHairline(ctx, cx - colGap * 0.5, y, cx - colGap * 0.5, colBottom, 1.6);
    }

    let cy = y;
    ctx.fillStyle = INK_DARK;
    ctx.font = `700 20px ${FONT_CONDENSED}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(sec.kicker, cx, cy);
    cy += 30;

    ctx.font = `900 32px ${FONT_HEADLINE}`;
    const hRes = drawWrappedText(ctx, sec.headline, cx, cy, colW, 36, 3);
    cy = hRes.endY + 10;

    drawHairline(ctx, cx, cy, cx + colW * 0.45, cy, 2, INK_DARK);
    cy += 12;

    ctx.font = `italic 400 20px ${FONT_BODY}`;
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(sec.byline, cx, cy);
    cy += 28;

    drawBodyColumns(
      ctx,
      null,
      sec.lead,
      sec.paragraphs.slice(0, 1),
      cx,
      cy,
      colW,
      colBottom - cy,
      1,
      22,
    );
  });

  // Bottom index bar
  drawDoubleRule(ctx, mx, PRINT_H - 116, mw, 2, 4, 4);
  ctx.fillStyle = INK_DARK;
  ctx.font = `600 20px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(
    'INSIDE THIS ARCHIVAL SUPPLEMENT · BORNHOELMER STRASSE · PRESS CENTER · CHRONOLOGY 1961–1989 · SECTOR MAPS',
    mx + mw * 0.5,
    PRINT_H - 96,
  );
}

function drawBackCover(
  ctx: CanvasRenderingContext2D,
  edition: NewspaperEdition,
): void {
  paintAgedNewsprintBackground(ctx, PRINT_W, PRINT_H, 'right', 198922);

  const mx = 110;
  const mw = PRINT_W - mx * 2;
  let y = 76;

  // Folio header
  ctx.fillStyle = INK_DARK;
  ctx.font = `400 52px ${FONT_MASTHEAD}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(edition.masthead, mx, y);
  ctx.font = `600 22px ${FONT_MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText('ARCHIVAL INDEX · BACK PAGE', mx + mw, y + 18);

  y += 72;
  drawDoubleRule(ctx, mx, y, mw, 4, 1.5, 4);
  y += 28;

  // Top editorial banner
  ctx.font = `700 68px ${FONT_CONDENSED}`;
  ctx.textAlign = 'center';
  ctx.fillText('ARCHIVAL CHRONICLE · PRESS DISPATCHES & SECTOR INDEX', mx + mw * 0.5, y);
  y += 92;
  drawHairline(ctx, mx, y, mx + mw, y, 2, INK_DARK);
  y += 28;

  // Upper half: Left archive index boxes + Right Europe map plate
  const leftW = Math.round(mw * 0.44);
  const rightX = mx + leftW + 40;
  const rightW = mw - leftW - 40;
  const topBlockH = 740;

  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = 2;
  ctx.strokeRect(mx, y, leftW, topBlockH);
  ctx.fillStyle = INK_DARK;
  ctx.fillRect(mx, y, leftW, 48);
  ctx.fillStyle = PAPER_COLORS.base;
  ctx.font = `700 24px ${FONT_CONDENSED}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EDITION DIRECTORY · NOV. 10, 1989', mx + leftW * 0.5, y + 24);

  let iy = y + 72;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const sec of edition.sections) {
    ctx.fillStyle = INK_DARK;
    ctx.font = `700 20px ${FONT_CONDENSED}`;
    ctx.fillText(`0${sec.order} · ${sec.kicker}`, mx + 24, iy);
    iy += 28;
    ctx.font = `700 24px ${FONT_HEADLINE}`;
    const res = drawWrappedText(ctx, sec.headline, mx + 24, iy, leftW - 48, 28, 2);
    iy = res.endY + 18;
    drawHairline(ctx, mx + 24, iy - 8, mx + leftW - 24, iy - 8, 1);
  }

  drawIllustration(ctx, 'europe-map', rightX, y, rightW, topBlockH - 50, 6);
  ctx.fillStyle = INK_MUTED;
  ctx.font = `italic 400 21px ${FONT_BODY}`;
  ctx.textAlign = 'left';
  ctx.fillText(
    'Archival reference map: Central European border crossings opened across autumn 1989.',
    rightX,
    y + topBlockH - 36,
  );

  y += topBlockH + 40;
  drawDoubleRule(ctx, mx, y, mw, 3, 1.5, 4);
  y += 32;

  // Lower half: 4 vintage classifieds / wire bulletin columns
  const cols = 4;
  const cGap = 28;
  const cw = (mw - cGap * (cols - 1)) / cols;
  const colH = PRINT_H - y - 190;

  const bulletins = [
    {
      title: 'WIRE BULLETIN · 18:53',
      body: 'International Press Center, Mohrenstraße: Spokesman announces immediate exit travel permissions for all citizens of the German Democratic Republic.',
    },
    {
      title: 'TRANSIT NOTICE · BERLIN',
      body: 'U-Bahn and S-Bahn interchanges across divided stations preparing emergency restoration schedules. Extra night buses operating on Kurfürstendamm.',
    },
    {
      title: 'ARCHIVE PRESERVATION',
      body: 'This commemorative broadsheet is printed on rotary newsprint stock. Readers are advised to store unfolded in dry archival sleeves for historical reference.',
    },
    {
      title: 'PRESS COLOPHON',
      body: 'Set in metal & phototype composition. Published simultaneously by The Chronicle Archive in Berlin and London. All dispatches filed November 9–10, 1989.',
    },
  ];

  bulletins.forEach((b, idx) => {
    const bx = mx + idx * (cw + cGap);
    if (idx > 0) {
      drawHairline(ctx, bx - cGap * 0.5, y, bx - cGap * 0.5, y + colH, 1.4);
    }
    ctx.fillStyle = INK_DARK;
    ctx.fillRect(bx, y, cw, 34);
    ctx.fillStyle = PAPER_COLORS.base;
    ctx.font = `700 18px ${FONT_CONDENSED}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.title, bx + cw * 0.5, y + 17);

    ctx.fillStyle = INK_BODY;
    ctx.font = `400 21px ${FONT_BODY}`;
    drawWrappedText(ctx, b.body, bx, y + 48, cw, 29);

    // Decorative vintage boxed notice below
    const boxY = y + colH - 220;
    ctx.strokeStyle = INK_DARK;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 6, boxY, cw - 12, 190);
    ctx.font = `700 22px ${FONT_CONDENSED}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = INK_DARK;
    ctx.fillText('EXTRA EDITION', bx + cw * 0.5, boxY + 34);
    ctx.font = `italic 400 19px ${FONT_BODY}`;
    drawWrappedText(
      ctx,
      'Keep this historic issue for future generations.',
      bx + 20,
      boxY + 76,
      cw - 40,
      26,
      3,
      'center',
    );
  });

  // Footer colophon
  drawDoubleRule(ctx, mx, PRINT_H - 134, mw, 4, 1.5, 4);
  ctx.fillStyle = INK_MUTED;
  ctx.font = `600 19px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(
    'THE CHRONICLE ARCHIVE · PRINTED BY ROTARY OFFSET · VOL. CXIV NO. 314 · NOVEMBER 10, 1989',
    mx + mw * 0.5,
    PRINT_H - 110,
  );
}

function drawSweepPage(
  ctx: CanvasRenderingContext2D,
  edition: NewspaperEdition,
  variantIndex: number,
): void {
  const spine: SpineEdge = variantIndex % 2 === 0 ? 'left' : 'right';
  paintAgedNewsprintBackground(ctx, SWEEP_W, SWEEP_H, spine, 198930 + variantIndex * 17);

  const configs: Array<{
    folio: string;
    kicker: string;
    headline: string;
    subhead: string;
    illus: IllustrationType;
    bodyA: string;
    bodyB: string;
    quote: string;
  }> = [
    {
      folio: 'ARCHIVAL CHRONICLE · AUGUST 1961',
      kicker: 'HISTORICAL BACKGROUND · SECTOR DIVIDE',
      headline: 'BARBED WIRE SPLITS BERLIN OVERNIGHT',
      subhead: 'Streets, Rail Lines, and Families Sealed Behind Concrete and Watchtowers',
      illus: 'checkpoint-map',
      bodyA: edition.sections[2].lead,
      bodyB: edition.sections[2].paragraphs[0],
      quote: '"A city halved in concrete waits twenty-eight winters for dawn."',
    },
    {
      folio: 'ARCHIVAL CHRONICLE · OCTOBER 1989',
      kicker: 'AUTUMN OF DEFIANCE · LEIPZIG',
      headline: 'SEVENTY THOUSAND VOICES IN CANDLELIGHT',
      subhead: 'Peaceful Monday Marches Echo "Wir Sind Das Volk" Across Saxony',
      illus: 'crowd-celebration',
      bodyA: edition.sections[2].paragraphs[1],
      bodyB: edition.sections[3].lead,
      quote: '"We are the people — no tanks can silence a city of candles."',
    },
    {
      folio: 'ARCHIVAL CHRONICLE · 18:53 CET',
      kicker: 'PRESS CENTER FLASH · MOHRENSTRASSE',
      headline: 'EFFECTIVE IMMEDIATELY, WITHOUT DELAY',
      subhead: 'Seven Improvised Words on Live Television Ignite a Historic Night',
      illus: 'press-camera',
      bodyA: edition.sections[1].lead,
      bodyB: edition.sections[1].paragraphs[0],
      quote: '"Sofort, unverzüglich — immediately, without delay."',
    },
    {
      folio: 'ARCHIVAL CHRONICLE · EUROPE 1989',
      kicker: 'CONTINENTAL SHIFT · BALTIC TO ADRIATIC',
      headline: 'THE IRON CURTAIN DISSOLVES IN INK',
      subhead: 'From Warsaw to Prague and Budapest, Postwar Borders Give Way',
      illus: 'europe-map',
      bodyA: edition.sections[4].lead,
      bodyB: edition.sections[4].paragraphs[0],
      quote: '"History rewritten not by force of arms, but by civic courage."',
    },
  ];

  const cfg = configs[variantIndex % configs.length];
  const mx = 52;
  const mw = SWEEP_W - mx * 2;
  let y = 44;

  // Folio header
  ctx.fillStyle = INK_DARK;
  ctx.font = `400 28px ${FONT_MASTHEAD}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(edition.masthead, mx, y);
  ctx.font = `600 13px ${FONT_MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(cfg.folio, mx + mw, y + 10);

  y += 38;
  drawDoubleRule(ctx, mx, y, mw, 3, 1, 3);
  y += 16;

  // Kicker
  ctx.fillStyle = INK_DARK;
  ctx.fillRect(mx, y, 310, 22);
  ctx.fillStyle = PAPER_COLORS.base;
  ctx.font = `700 13px ${FONT_CONDENSED}`;
  ctx.textAlign = 'left';
  ctx.fillText(cfg.kicker, mx + 8, y + 3);
  y += 30;

  // Big bold 90s headline
  ctx.fillStyle = INK_DARK;
  const hSize = drawFittedSingleLine(
    ctx,
    cfg.headline,
    mx,
    y,
    mw,
    (sz) => `700 ${sz}px ${FONT_CONDENSED}`,
    66,
    36,
    'left',
  );
  y += hSize + 8;

  ctx.font = `italic 700 20px ${FONT_HEADLINE}`;
  ctx.fillStyle = INK_BODY;
  const sub = drawWrappedText(ctx, cfg.subhead, mx, y, mw, 25, 2);
  y = sub.endY + 14;
  drawHairline(ctx, mx, y, mx + mw, y, 2, INK_DARK);
  y += 16;

  // Halftone plate
  const plateH = 440;
  drawIllustration(ctx, cfg.illus, mx, y, mw, plateH, 5);
  y += plateH + 20;

  // 3-column newsprint copy
  drawBodyColumns(
    ctx,
    null,
    cfg.bodyA,
    [cfg.bodyB, edition.sections[0].paragraphs[0], edition.sections[5].paragraphs[0]],
    mx,
    y,
    mw,
    SWEEP_H - y - 64,
    3,
    14,
    cfg.quote,
  );

  // Bottom rule
  drawDoubleRule(ctx, mx, SWEEP_H - 48, mw, 1.5, 3, 3);
}

// ============================================================================
// PUBLIC ASSET FACTORY
// ============================================================================

export async function createNewspaperPrintAssets(
  edition: NewspaperEdition,
  maxAnisotropy: number = 8,
): Promise<NewspaperPrintAssets> {
  await waitForFonts();

  const anisotropy = Math.max(1, maxAnisotropy);

  // 1. Front Cover (2048 x 2760)
  const front = makeCanvas(PRINT_W, PRINT_H);
  drawFrontCover(front.ctx, edition);

  // 2. Back Cover (2048 x 2760)
  const back = makeCanvas(PRINT_W, PRINT_H);
  drawBackCover(back.ctx, edition);

  // 3. Sweep Pages (4 x 1024 x 1380)
  const sweepCanvases = [0, 1, 2, 3].map((i) => {
    const sw = makeCanvas(SWEEP_W, SWEEP_H);
    drawSweepPage(sw.ctx, edition, i);
    return sw.canvas;
  });

  // 4. Left Spread Page (2048 x 2760) + Body Mask (1024 x 1380)
  const leftPrint = makeCanvas(PRINT_W, PRINT_H);
  const leftMask = makeCanvas(MASK_W, MASK_H);
  const leftMaskRec = createMaskRecorder(leftMask.ctx, MASK_W / PRINT_W);
  paintAgedNewsprintBackground(leftPrint.ctx, PRINT_W, PRINT_H, 'right', 198901);
  drawLeftSpreadMasthead(leftPrint.ctx, edition);

  for (const sec of edition.sections.filter((s) => s.page === 'left')) {
    drawNewspaperSection(leftPrint.ctx, leftMaskRec, sec, PRINT_W, PRINT_H);
  }

  // 5. Right Spread Page (2048 x 2760) + Body Mask (1024 x 1380)
  const rightPrint = makeCanvas(PRINT_W, PRINT_H);
  const rightMask = makeCanvas(MASK_W, MASK_H);
  const rightMaskRec = createMaskRecorder(rightMask.ctx, MASK_W / PRINT_W);
  paintAgedNewsprintBackground(rightPrint.ctx, PRINT_W, PRINT_H, 'left', 198907);
  drawRightSpreadFolio(rightPrint.ctx, edition);

  for (const sec of edition.sections.filter((s) => s.page === 'right')) {
    drawNewspaperSection(rightPrint.ctx, rightMaskRec, sec, PRINT_W, PRINT_H);
  }

  // Convert canvases to Three.js CanvasTextures with proper colorSpace & anisotropy
  const makeColorTex = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  const makeMaskTex = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  const frontCoverMap = makeColorTex(front.canvas);
  const backCoverMap = makeColorTex(back.canvas);
  const sweepPageMaps = sweepCanvases.map(makeColorTex);
  const leftPrintMap = makeColorTex(leftPrint.canvas);
  const rightPrintMap = makeColorTex(rightPrint.canvas);
  const leftBodyMaskMap = makeMaskTex(leftMask.canvas);
  const rightBodyMaskMap = makeMaskTex(rightMask.canvas);

  return {
    frontCoverMap,
    backCoverMap,
    sweepPageMaps,
    leftPrintMap,
    rightPrintMap,
    leftBodyMaskMap,
    rightBodyMaskMap,
    dispose() {
      frontCoverMap.dispose();
      backCoverMap.dispose();
      for (const tex of sweepPageMaps) {
        tex.dispose();
      }
      leftPrintMap.dispose();
      rightPrintMap.dispose();
      leftBodyMaskMap.dispose();
      rightBodyMaskMap.dispose();
    },
  };
}
