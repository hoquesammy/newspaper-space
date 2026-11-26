import * as THREE from 'three';
import { TABLE_DEPTH, TABLE_WIDTH } from '../config/theme';
import { TIMING, clamp01, easeOutCubic } from '../config/timing';
import type { TimelineState } from '../types';

export interface FloatingHistoryTextOptions {
  phrases: string[];
  aroundCount?: number;
  underCount?: number;
}

type StreamZone = 'around' | 'under';
type StreamAxis = 'x' | 'z';

interface FloatingStreamItem {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  zone: StreamZone;
  axis: StreamAxis;
  direction: 1 | -1;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseScaleX: number;
  baseScaleY: number;
  speed: number;
  bobAmp: number;
  bobFreq: number;
  bobPhase: number;
  baseRotX: number;
  baseRotY: number;
  baseRotZ: number;
  baseOpacity: number;
  wrapSpan: number;
}

const AROUND_INK_PALETTE = ['#ffe7b8', '#ffd285', '#fae8c8', '#b8d6f8'];
const UNDER_INK_PALETTE = ['#ffda96', '#f2cf94', '#a8cdf8', '#ffe4ad'];

const FONT_STYLES = [
  { family: '"Playfair Display", Georgia, serif', weight: '700', size: 46 },
  { family: '"Oswald", "Arial Narrow", sans-serif', weight: '600', size: 48 },
  { family: '"IBM Plex Mono", monospace', weight: '500', size: 36 },
  { family: '"UnifrakturMaguntia", Georgia, serif', weight: '400', size: 50 },
] as const;

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createTypographyPlaneTexture(
  phrase: string,
  color: string,
  styleIndex: number,
  withRule: boolean,
  isUnder: boolean,
): { texture: THREE.CanvasTexture; aspect: number } {
  const style = FONT_STYLES[styleIndex % FONT_STYLES.length];
  const width = 1024;
  const height = 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, width, height);

    ctx.font = `${style.weight} ${style.size}px ${style.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Crisp luminous glow so under-table & perimeter typography pops over slate-blue space
    ctx.shadowColor = isUnder ? '#5ba3ff' : color;
    ctx.shadowBlur = isUnder ? 16 : 10;
    ctx.fillStyle = color;

    const measured = ctx.measureText(phrase).width;
    const maxDrawWidth = width - 76;
    if (measured > maxDrawWidth) {
      const scaledSize = Math.max(24, Math.floor(style.size * (maxDrawWidth / measured)));
      ctx.font = `${style.weight} ${scaledSize}px ${style.family}`;
    }

    ctx.fillText(phrase, width * 0.5, height * 0.5);

    if (withRule) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = color;
      ctx.globalAlpha = isUnder ? 0.62 : 0.48;
      ctx.lineWidth = isUnder ? 2.5 : 2;
      const ruleHalf = Math.min(maxDrawWidth * 0.46, Math.max(150, measured * 0.44));
      ctx.beginPath();
      ctx.moveTo(width * 0.5 - ruleHalf, height * 0.5 + 34);
      ctx.lineTo(width * 0.5 + ruleHalf, height * 0.5 + 34);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return { texture, aspect: width / height };
}

/**
 * Renders ~40 crisp 3D floating historical typography planes across two cleanly
 * separated spatial zones:
 * - Around-the-Table Streams (~24 items): strictly outside the newspaper footprint
 *   (|x| > 5.7 on left/right flanks, or |z| > 4.05 on front/back perimeters) so no
 *   phrase ever overlaps or obscures the masthead or open broadsheet.
 * - Under-the-Table Streams (~16 items): prominent ~25% larger luminous cool-blue
 *   and warm-gold phrases streaming visibly beneath the cardboard slab (Y in [-0.55, -2.2])
 *   and emerging past the front, left, and right cardboard edges.
 */
export class FloatingHistoryText {
  public readonly group: THREE.Group;

  private readonly items: FloatingStreamItem[] = [];
  private readonly sharedPlaneGeo: THREE.PlaneGeometry;
  private readonly ownedTextures: THREE.Texture[] = [];

  private streamDistance = 0;
  private lastTimelineTime = -1;

  constructor(options: FloatingHistoryTextOptions) {
    this.group = new THREE.Group();
    this.group.name = 'FloatingHistoryText';
    this.group.visible = false;

    const phrases =
      options.phrases.length > 0 ? options.phrases : ['THE CHRONICLE ARCHIVE'];
    const aroundCount = options.aroundCount ?? 24;
    const underCount = options.underCount ?? 16;

    this.sharedPlaneGeo = new THREE.PlaneGeometry(1, 1);

    const rng = createSeededRng(19891110);
    const total = aroundCount + underCount;
    const halfTableW = TABLE_WIDTH * 0.5; // 8.0
    const halfTableD = TABLE_DEPTH * 0.5; // 5.5

    for (let i = 0; i < total; i++) {
      const zone: StreamZone = i < aroundCount ? 'around' : 'under';
      const isUnder = zone === 'under';
      const phrase = phrases[i % phrases.length];
      const palette = isUnder ? UNDER_INK_PALETTE : AROUND_INK_PALETTE;
      const color = palette[Math.floor(rng() * palette.length)];
      const styleIdx = (i + (isUnder ? 2 : 0)) % FONT_STYLES.length;
      const withRule = rng() > 0.45;

      const { texture, aspect } = createTypographyPlaneTexture(
        phrase,
        color,
        styleIdx,
        withRule,
        isUnder,
      );
      this.ownedTextures.push(texture);

      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(this.sharedPlaneGeo, mat);
      mesh.renderOrder = isUnder ? 3 : 12;

      let axis: StreamAxis = 'x';
      let direction: 1 | -1 = -1;
      let baseX = 0;
      let baseY = 0;
      let baseZ = 0;
      let planeHeight = 0.52;
      let baseRotX = -0.45;
      let baseRotY = 0;
      let baseRotZ = 0;
      let baseOpacity = 0.84;
      let speed = 3.2;
      let wrapSpan = 30.0;

      if (!isUnder) {
        // Strictly outside the open longer newspaper footprint (x in [-4.4, +4.4], z in [-3.6, +3.6])
        const lane = i % 4;
        if (lane === 0) {
          // Back perimeter stream behind the top of the newspaper
          axis = 'x';
          direction = -1;
          wrapSpan = 28.0;
          baseX = (rng() - 0.5) * wrapSpan;
          baseZ = -(4.55 + rng() * 2.8);
          baseY = 0.25 + rng() * 1.45;
          baseRotX = -0.42 + (rng() - 0.5) * 0.2;
          baseRotY = (rng() - 0.5) * 0.16;
        } else if (lane === 1) {
          // Front perimeter stream in foreground space
          axis = 'x';
          direction = -1;
          wrapSpan = 26.0;
          baseX = (rng() - 0.5) * wrapSpan;
          baseZ = 4.55 + rng() * 2.4;
          baseY = 0.1 + rng() * 0.72;
          baseRotX = -0.56 + (rng() - 0.5) * 0.18;
          baseRotY = (rng() - 0.5) * 0.14;
        } else if (lane === 2) {
          // Left flank corridor outside left page edge
          axis = 'z';
          direction = 1;
          wrapSpan = 16.0;
          baseX = -(5.55 + rng() * 3.8);
          baseZ = (rng() - 0.5) * wrapSpan;
          baseY = 0.18 + rng() * 1.35;
          baseRotX = -0.44;
          baseRotY = 0.26 + (rng() - 0.5) * 0.16;
        } else {
          // Right flank corridor outside right page edge
          axis = 'z';
          direction = -1;
          wrapSpan = 16.0;
          baseX = 5.55 + rng() * 3.8;
          baseZ = (rng() - 0.5) * wrapSpan;
          baseY = 0.18 + rng() * 1.35;
          baseRotX = -0.44;
          baseRotY = -0.26 + (rng() - 0.5) * 0.16;
        }

        // Smaller, crisper editorial floating scale
        planeHeight = 0.27 + rng() * 0.15;
        baseRotZ = (rng() - 0.5) * 0.06;
        baseOpacity = 0.58 + rng() * 0.26;
        speed = 2.6 + rng() * 2.0;
      } else {
        // Under-Newspaper Streams: drifting gracefully through open void below the floating spread
        axis = 'x';
        direction = -1;
        wrapSpan = 28.0;
        baseX = (rng() - 0.5) * wrapSpan;
        baseY = -(0.65 + rng() * 2.2); // Y in [-0.65, -2.85]

        const underLane = i % 4;
        if (underLane === 0 || underLane === 1) {
          baseZ = 3.2 + rng() * 3.4;
        } else if (underLane === 2) {
          baseZ = (rng() - 0.5) * (TABLE_DEPTH * 0.9);
          baseX = (rng() > 0.5 ? 1 : -1) * (halfTableW * 0.65 + rng() * 5.2);
        } else {
          baseZ = -(1.5 + rng() * 4.0);
        }

        // Refined smaller floating text below the newspaper
        planeHeight = 0.34 + rng() * 0.18;
        baseRotX = -0.34 + (rng() - 0.5) * 0.22;
        baseRotY = (rng() - 0.5) * 0.16;
        baseRotZ = (rng() - 0.5) * 0.05;
        baseOpacity = 0.68 + rng() * 0.22;
        speed = 2.9 + rng() * 2.2;
      }

      const scaleX = planeHeight * aspect;
      const scaleY = planeHeight;
      mesh.scale.set(scaleX, scaleY, 1);
      mesh.position.set(baseX, baseY, baseZ);
      mesh.rotation.set(baseRotX, baseRotY, baseRotZ);

      this.group.add(mesh);
      this.items.push({
        mesh,
        material: mat,
        zone,
        axis,
        direction,
        baseX,
        baseY,
        baseZ,
        baseScaleX: scaleX,
        baseScaleY: scaleY,
        speed,
        bobAmp: 0.07 + rng() * 0.13,
        bobFreq: 0.9 + rng() * 1.1,
        bobPhase: rng() * Math.PI * 2,
        baseRotX,
        baseRotY,
        baseRotZ,
        baseOpacity,
        wrapSpan,
      });
    }
  }

  public update(timeline: TimelineState): void {
    const t = timeline.time;
    const sweepStart = TIMING.dropStart + TIMING.dropDuration + TIMING.holdDuration;
    const dissolveStart = TIMING.revealStart - 0.35;
    const dissolveEnd = TIMING.revealStart + 0.95;

    if (this.lastTimelineTime < 0 || t < this.lastTimelineTime) {
      this.streamDistance = 0;
      this.lastTimelineTime = t;
    }

    const dt = Math.min(0.1, Math.max(0, t - this.lastTimelineTime));
    this.lastTimelineTime = t;

    const fadeIn = easeOutCubic((t - sweepStart) / 0.85);
    const fadeOut = 1 - easeOutCubic((t - dissolveStart) / (dissolveEnd - dissolveStart));
    const envelope = clamp01(fadeIn * fadeOut);

    if (envelope <= 0.002 || timeline.isInteractive) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    const flowRate = 0.28 + timeline.sweepVelocity * 3.1;
    this.streamDistance += dt * flowRate;

    const stretchX = 1.0 + timeline.sweepVelocity * 0.22;
    const bankZ = -timeline.sweepVelocity * 0.075;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const halfSpan = item.wrapSpan * 0.5;

      let x = item.baseX;
      let z = item.baseZ;
      let edgeFade = 1.0;

      if (item.axis === 'x') {
        x = item.baseX + item.direction * this.streamDistance * item.speed;
        x = ((((x + halfSpan) % item.wrapSpan) + item.wrapSpan) % item.wrapSpan) - halfSpan;
        edgeFade = 1.0 - clamp01((Math.abs(x) - (halfSpan - 3.6)) / 3.6);
      } else {
        z = item.baseZ + item.direction * this.streamDistance * item.speed * 0.72;
        z = ((((z + halfSpan) % item.wrapSpan) + item.wrapSpan) % item.wrapSpan) - halfSpan;
        edgeFade = 1.0 - clamp01((Math.abs(z) - (halfSpan - 2.6)) / 2.6);
      }

      const y =
        item.baseY +
        Math.sin(t * item.bobFreq + item.bobPhase) * item.bobAmp;

      item.mesh.position.set(x, y, z);
      item.mesh.scale.set(
        item.axis === 'x' ? item.baseScaleX * stretchX : item.baseScaleX,
        item.baseScaleY,
        1,
      );
      item.mesh.rotation.set(
        item.baseRotX,
        item.baseRotY,
        item.baseRotZ + (item.axis === 'x' ? bankZ : 0),
      );

      const velBright =
        item.zone === 'under'
          ? 0.62 + 0.38 * Math.max(0.3, timeline.sweepVelocity)
          : 0.48 + 0.52 * Math.max(0.25, timeline.sweepVelocity);
      item.material.opacity = item.baseOpacity * envelope * edgeFade * velBright;
    }
  }

  public dispose(): void {
    this.sharedPlaneGeo.dispose();
    for (const item of this.items) {
      item.material.dispose();
    }
    for (const tex of this.ownedTextures) {
      tex.dispose();
    }
  }
}
