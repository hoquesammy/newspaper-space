import * as THREE from 'three';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PAPER_COLORS,
  PAPER_REST_Y,
  TABLE_TOP_Y,
} from '../config/theme';
import { TIMING, clamp01, easeInOutCubic, easeOutCubic, easeOutQuart } from '../config/timing';
import { createMotionTrailMaterial } from '../shaders/motionTrail.glsl';
import {
  createSpreadPageMaterial,
  createTurningPageDepthMaterial,
  createTurningPageMaterial,
} from '../shaders/pageCurl.glsl';
import type { NewspaperPrintAssets } from '../textures/newspaperCanvas';
import type { PaperTextureSet } from '../textures/paperTexture';
import type {
  NewspaperEdition,
  NormalizedRect,
  PageSide,
  TimelineState,
} from '../types';

export interface NewspaperRigOptions {
  edition: NewspaperEdition;
  paperTextures: PaperTextureSet;
  printAssets: NewspaperPrintAssets;
}

export interface ActiveSectionHighlight {
  page: PageSide;
  rect: NormalizedRect;
}

interface ScheduledLeafTurn {
  index: number;
  startTime: number;
  endTime: number;
  curlStrength: number;
  cornerLead: number;
  frontTexIndex: number;
  backTexIndex: number;
  isFinalLeaf: boolean;
}

interface TurningPoolSlot {
  leafMesh: THREE.Mesh;
  leafMat: THREE.ShaderMaterial;
  depthMat: THREE.ShaderMaterial;
  trailMesh: THREE.Mesh;
  trailMat: THREE.ShaderMaterial;
}

const POOL_SIZE = 5;
const TOTAL_SWEEP_LEAVES = 5;
const STACK_MAX_THICKNESS = 0.015;

/**
 * Builds the 64x48 subdivided page mesh hinged at local x = 0 (spine)
 * extending along local x in [0, PAGE_WIDTH] and z in [-PAGE_HEIGHT/2, +PAGE_HEIGHT/2].
 */
function createHingedLeafGeometry(segX = 64, segZ = 48): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(PAGE_WIDTH, PAGE_HEIGHT, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(PAGE_WIDTH * 0.5, 0, 0);
  return geo;
}

/**
 * Builds a subtly sculpted resting broadsheet half-page mesh whose surface dips
 * gracefully into the center fold valley at X = 0, rises gently to a soft crown
 * across the inner third, and settles smoothly toward the outer margin.
 */
function createSculptedSpreadHalfGeometry(
  side: PageSide,
  segX = 48,
  segZ = 32,
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(PAGE_WIDTH, PAGE_HEIGHT, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(side === 'left' ? -PAGE_WIDTH * 0.5 : PAGE_WIDTH * 0.5, 0, 0);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Normalized distance from center spine (0 at spine X=0, 1 at outer page edge)
    const d = clamp01(Math.abs(x) / PAGE_WIDTH);
    const zNorm = z / (PAGE_HEIGHT * 0.5);

    // Physical broadsheet swell: snug crease valley at spine, graceful gentle arch crown
    const archCrown = 0.052 * Math.sin(Math.pow(d, 0.72) * Math.PI * 0.90);
    // Subtle organic paper relaxation along top/bottom edge
    const edgeRipple = 0.004 * Math.sin(zNorm * Math.PI * 1.5 + d * 2.2) * d;
    const y = PAPER_REST_Y + 0.002 + archCrown + edgeRipple;
    pos.setY(i, y);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a fine horizontal stratified paper-pages edge texture for the
 * slim stacked newsprint edges tucked subtly beneath the broadsheet.
 */
function createPaperStackEdgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = PAPER_COLORS.agedEdge;
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 128; y += 3) {
      const shade = y % 6 === 0 ? '#c2b08d' : '#e5d8bc';
      ctx.fillStyle = shade;
      ctx.fillRect(0, y, 64, 1.5);
      ctx.fillStyle = 'rgba(72, 56, 36, 0.28)';
      ctx.fillRect(0, y + 1.5, 64, 1.0);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a concise, snappy 5-leaf page-flip schedule spanning the 3.6s sweep
 * and 1.8s settle phases: crisp overlapping flips followed by a graceful slow
 * settle of the final hero leaf at 8.18s (right before TIMING.revealStart = 8.2s).
 */
function buildSweepSchedule(sweepTextureCount: number): ScheduledLeafTurn[] {
  const safeCount = Math.max(1, sweepTextureCount);
  const turns: ScheduledLeafTurn[] = [];

  const sweepStart = TIMING.dropStart + TIMING.dropDuration + TIMING.holdDuration; // 3.8s
  // 5 purposeful, readable page turns (dramatically reduced from 15)
  const startOffsets = [
    0.26, // leaf 0: 4.06s -> 4.98s (lifts right as cover sweeps past)
    0.84, // leaf 1: 4.64s -> 5.52s
    1.46, // leaf 2: 5.26s -> 6.20s
    2.18, // leaf 3: 5.98s -> 7.06s (beginning deceleration)
    3.00, // leaf 4: 6.80s -> 8.18s (final hero leaf settling softly before 8.2s reveal)
  ];

  const durations = [0.92, 0.88, 0.94, 1.08, 1.38];

  for (let i = 0; i < TOTAL_SWEEP_LEAVES; i++) {
    const startTime = sweepStart + startOffsets[i];
    const endTime = startTime + durations[i];
    const isFinalLeaf = i === TOTAL_SWEEP_LEAVES - 1;
    const wave = Math.sin(i * 1.9 + 0.4);
    const curlStrength = isFinalLeaf ? 1.16 : 0.96 + 0.18 * (0.5 + 0.5 * wave);
    const cornerLead = isFinalLeaf
      ? 0.088
      : (i % 2 === 0 ? 1 : -0.7) * (0.072 + 0.02 * Math.abs(wave));

    turns.push({
      index: i,
      startTime,
      endTime,
      curlStrength,
      cornerLead,
      frontTexIndex: i % safeCount,
      backTexIndex: (i + 1) % safeCount,
      isFinalLeaf,
    });
  }

  return turns;
}

/**
 * Full-size 3D Historical Newspaper Rig managing:
 * - Centered drop from Y = 7.2 with mid-air flex & air-cushion landing bounce
 * - Hold on closed front cover
 * - Front cover opening + smooth horizontal re-centering to full open spread
 * - 5-leaf overlapping fast sweep cascade with velocity-coupled motion-blur trails
 * - Smooth settle onto sculpted broadsheet with physical spine crease & paper stack rims
 * - Magic sequential ink reveal + overview readability veil + focus highlight vignette
 */
export class NewspaperRig {
  public readonly group: THREE.Group;

  private readonly rigPivot: THREE.Group;

  private readonly rightStackMesh: THREE.Mesh;
  private readonly leftStackMesh: THREE.Mesh;
  private readonly spineCordMesh: THREE.Mesh;
  private readonly flyUnderLeafA: THREE.Mesh;
  private readonly flyUnderLeafAMat: THREE.ShaderMaterial;
  private readonly flyUnderLeafB: THREE.Mesh;
  private readonly flyUnderLeafBMat: THREE.ShaderMaterial;

  private readonly sweepBaseLeftMesh: THREE.Mesh;
  private readonly sweepBaseLeftMat: THREE.ShaderMaterial;
  private readonly sweepBaseRightMesh: THREE.Mesh;
  private readonly sweepBaseRightMat: THREE.ShaderMaterial;

  private readonly leftSpreadMesh: THREE.Mesh;
  private readonly leftSpreadMat: THREE.ShaderMaterial;
  private readonly rightSpreadMesh: THREE.Mesh;
  private readonly rightSpreadMat: THREE.ShaderMaterial;

  private readonly coverLeafMesh: THREE.Mesh;
  private readonly coverLeafMat: THREE.ShaderMaterial;
  private readonly coverDepthMat: THREE.ShaderMaterial;

  private readonly turningPool: TurningPoolSlot[] = [];
  private readonly schedule: ScheduledLeafTurn[];

  private readonly paperTextures: PaperTextureSet;
  private readonly printAssets: NewspaperPrintAssets;
  private readonly leftSectionIndices: number[] = [];
  private readonly rightSectionIndices: number[] = [];

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];

  constructor(options: NewspaperRigOptions) {
    this.paperTextures = options.paperTextures;
    this.printAssets = options.printAssets;

    this.group = new THREE.Group();
    this.group.name = 'NewspaperRig';

    // 1. Inner Newspaper Rig Pivot (translates X from -PAGE_WIDTH/2 to 0 as cover opens)
    this.rigPivot = new THREE.Group();
    this.rigPivot.position.set(-PAGE_WIDTH * 0.5, 0, 0);
    this.group.add(this.rigPivot);

    // 2. Paper-Thin Inset Newsprint Stack Backing (slim, inset beneath overhanging sheets — never boxy)
    const stackEdgeTex = createPaperStackEdgeTexture();
    this.ownedTextures.push(stackEdgeTex);

    const stackEdgeMat = new THREE.MeshStandardMaterial({
      map: stackEdgeTex,
      color: new THREE.Color(0xefe5d0),
      roughness: 0.92,
      metalness: 0.0,
    });
    const stackTopMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PAPER_COLORS.agedEdge),
      roughness: 0.94,
      metalness: 0.0,
    });
    this.materials.push(stackEdgeMat, stackTopMat);

    const stackMaterials = [
      stackEdgeMat,
      stackEdgeMat,
      stackTopMat,
      stackTopMat,
      stackEdgeMat,
      stackEdgeMat,
    ];

    const stackGeo = new THREE.BoxGeometry(
      PAGE_WIDTH - 0.14,
      STACK_MAX_THICKNESS,
      PAGE_HEIGHT - 0.14,
    );
    this.geometries.push(stackGeo);

    this.rightStackMesh = new THREE.Mesh(stackGeo, stackMaterials);
    this.rightStackMesh.position.set(
      PAGE_WIDTH * 0.5 - 0.04,
      TABLE_TOP_Y + STACK_MAX_THICKNESS * 0.5,
      0,
    );
    this.rightStackMesh.castShadow = true;
    this.rightStackMesh.receiveShadow = true;
    this.rigPivot.add(this.rightStackMesh);

    this.leftStackMesh = new THREE.Mesh(stackGeo, stackMaterials);
    this.leftStackMesh.position.set(
      -PAGE_WIDTH * 0.5 + 0.04,
      TABLE_TOP_Y + STACK_MAX_THICKNESS * 0.5,
      0,
    );
    this.leftStackMesh.castShadow = true;
    this.leftStackMesh.receiveShadow = true;
    this.leftStackMesh.visible = false;
    this.rigPivot.add(this.leftStackMesh);

    // Subtle folded spine crease ridge along X = 0
    const spineGeo = new THREE.CylinderGeometry(
      0.010,
      0.010,
      PAGE_HEIGHT - 0.02,
      10,
    );
    spineGeo.rotateX(Math.PI / 2);
    this.geometries.push(spineGeo);
    const spineMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PAPER_COLORS.gutterShadow),
      roughness: 0.95,
    });
    this.materials.push(spineMat);
    this.spineCordMesh = new THREE.Mesh(spineGeo, spineMat);
    this.spineCordMesh.position.set(0, PAPER_REST_Y + 0.004, 0);
    this.rigPivot.add(this.spineCordMesh);

    // 4. Sculpted Resting Final Spread (Left + Right Pages)
    const leftRects: THREE.Vector4[] = [];
    const rightRects: THREE.Vector4[] = [];

    options.edition.sections.forEach((sec, idx) => {
      const vec = new THREE.Vector4(
        sec.rect.u,
        sec.rect.v,
        sec.rect.w,
        sec.rect.h,
      );
      if (sec.page === 'left' && leftRects.length < 3) {
        leftRects.push(vec);
        this.leftSectionIndices.push(idx);
      } else if (sec.page === 'right' && rightRects.length < 3) {
        rightRects.push(vec);
        this.rightSectionIndices.push(idx);
      }
    });

    const sculptedLeftGeo = createSculptedSpreadHalfGeometry('left');
    const sculptedRightGeo = createSculptedSpreadHalfGeometry('right');
    this.geometries.push(sculptedLeftGeo, sculptedRightGeo);

    this.leftSpreadMat = createSpreadPageMaterial({
      basePaperMap: this.paperTextures.leftBaseMap,
      printMap: this.printAssets.leftPrintMap,
      bodyMaskMap: this.printAssets.leftBodyMaskMap,
      bumpMap: this.paperTextures.bumpMap,
      pageSide: 'left',
      mastheadCutV: 0.22,
      sectionRects: leftRects,
    });
    this.rightSpreadMat = createSpreadPageMaterial({
      basePaperMap: this.paperTextures.rightBaseMap,
      printMap: this.printAssets.rightPrintMap,
      bodyMaskMap: this.printAssets.rightBodyMaskMap,
      bumpMap: this.paperTextures.bumpMap,
      pageSide: 'right',
      mastheadCutV: 0.14,
      sectionRects: rightRects,
    });
    this.materials.push(this.leftSpreadMat, this.rightSpreadMat);

    this.leftSpreadMesh = new THREE.Mesh(sculptedLeftGeo, this.leftSpreadMat);
    this.leftSpreadMesh.name = 'LeftSpreadPage';
    this.leftSpreadMesh.visible = false;
    this.rigPivot.add(this.leftSpreadMesh);

    this.rightSpreadMesh = new THREE.Mesh(sculptedRightGeo, this.rightSpreadMat);
    this.rightSpreadMesh.name = 'RightSpreadPage';
    this.rightSpreadMesh.visible = false;
    this.rigPivot.add(this.rightSpreadMesh);

    // 5. Underlying Sweep Base Pages (visible beneath the flipping cascade during 8s sweep)
    const fallbackSweepMap =
      this.printAssets.sweepPageMaps[0] ?? this.printAssets.backCoverMap;
    this.sweepBaseLeftMat = createSpreadPageMaterial({
      basePaperMap: this.paperTextures.leftBaseMap,
      printMap: fallbackSweepMap,
      bodyMaskMap: this.printAssets.leftBodyMaskMap,
      bumpMap: this.paperTextures.bumpMap,
      pageSide: 'left',
      mastheadCutV: 1.0,
      sectionRects: [],
    });
    this.sweepBaseLeftMat.uniforms.uMastheadReveal.value = 1.0;
    this.sweepBaseLeftMat.uniforms.uReadability.value = 1.0;

    this.sweepBaseRightMat = createSpreadPageMaterial({
      basePaperMap: this.paperTextures.rightBaseMap,
      printMap:
        this.printAssets.sweepPageMaps[1] ?? fallbackSweepMap,
      bodyMaskMap: this.printAssets.rightBodyMaskMap,
      bumpMap: this.paperTextures.bumpMap,
      pageSide: 'right',
      mastheadCutV: 1.0,
      sectionRects: [],
    });
    this.sweepBaseRightMat.uniforms.uMastheadReveal.value = 1.0;
    this.sweepBaseRightMat.uniforms.uReadability.value = 1.0;
    this.materials.push(this.sweepBaseLeftMat, this.sweepBaseRightMat);

    this.sweepBaseLeftMesh = new THREE.Mesh(
      sculptedLeftGeo,
      this.sweepBaseLeftMat,
    );
    this.sweepBaseLeftMesh.visible = false;
    this.rigPivot.add(this.sweepBaseLeftMesh);

    this.sweepBaseRightMesh = new THREE.Mesh(
      sculptedRightGeo,
      this.sweepBaseRightMat,
    );
    this.sweepBaseRightMesh.visible = false;
    this.rigPivot.add(this.sweepBaseRightMesh);

    // 6. Front Cover Turning Leaf (drops closed, holds, then lifts open 0 -> 1)
    const leafGeo = createHingedLeafGeometry(64, 48);
    const trailGeo = createHingedLeafGeometry(28, 16);
    this.geometries.push(leafGeo, trailGeo);

    this.coverLeafMat = createTurningPageMaterial({
      frontMap: this.printAssets.frontCoverMap,
      backMap: fallbackSweepMap,
      bumpMap: this.paperTextures.bumpMap,
      curlStrength: 1.12,
      cornerLead: 0.095,
    });
    this.coverDepthMat = createTurningPageDepthMaterial(this.coverLeafMat);
    this.materials.push(this.coverLeafMat, this.coverDepthMat);

    this.coverLeafMesh = new THREE.Mesh(leafGeo, this.coverLeafMat);
    this.coverLeafMesh.customDepthMaterial = this.coverDepthMat;
    this.coverLeafMesh.castShadow = true;
    this.coverLeafMesh.frustumCulled = false;
    this.coverLeafMesh.position.set(0, TABLE_TOP_Y + STACK_MAX_THICKNESS + 0.004, 0);
    this.rigPivot.add(this.coverLeafMesh);

    // 6b. Two subtle fanned trailing inner broadsheet sheets visible during closed Fly-In
    // so the folded paper reads as layered flexible sheets rather than a solid rectangular block
    this.flyUnderLeafAMat = createTurningPageMaterial({
      frontMap: this.printAssets.sweepPageMaps[1] ?? fallbackSweepMap,
      backMap: this.printAssets.backCoverMap,
      bumpMap: this.paperTextures.bumpMap,
      curlStrength: 0.9,
      cornerLead: 0.04,
      restArchScale: 0.0,
    });
    this.flyUnderLeafBMat = createTurningPageMaterial({
      frontMap: this.printAssets.sweepPageMaps[2] ?? fallbackSweepMap,
      backMap: this.printAssets.backCoverMap,
      bumpMap: this.paperTextures.bumpMap,
      curlStrength: 0.9,
      cornerLead: 0.04,
      restArchScale: 0.0,
    });
    this.materials.push(this.flyUnderLeafAMat, this.flyUnderLeafBMat);

    this.flyUnderLeafA = new THREE.Mesh(leafGeo, this.flyUnderLeafAMat);
    this.flyUnderLeafA.frustumCulled = false;
    this.flyUnderLeafA.position.set(0.02, TABLE_TOP_Y + STACK_MAX_THICKNESS - 0.004, 0.01);
    this.rigPivot.add(this.flyUnderLeafA);

    this.flyUnderLeafB = new THREE.Mesh(leafGeo, this.flyUnderLeafBMat);
    this.flyUnderLeafB.frustumCulled = false;
    this.flyUnderLeafB.position.set(0.04, TABLE_TOP_Y + 0.002, -0.01);
    this.rigPivot.add(this.flyUnderLeafB);

    // 7. Pool of 5 Overlapping Turning Leaves + Paired Motion-Blur Ghost Trails
    this.schedule = buildSweepSchedule(this.printAssets.sweepPageMaps.length);

    for (let i = 0; i < POOL_SIZE; i++) {
      const leafMat = createTurningPageMaterial({
        frontMap: fallbackSweepMap,
        backMap: fallbackSweepMap,
        bumpMap: this.paperTextures.bumpMap,
        curlStrength: 1.0,
        cornerLead: 0.075,
      });
      const depthMat = createTurningPageDepthMaterial(leafMat);
      const leafMesh = new THREE.Mesh(leafGeo, leafMat);
      leafMesh.customDepthMaterial = depthMat;
      leafMesh.castShadow = true;
      leafMesh.frustumCulled = false;
      leafMesh.visible = false;
      this.rigPivot.add(leafMesh);

      const trailMat = createMotionTrailMaterial({
        curlStrength: 1.0,
        trailSpan: 0.26,
      });
      const trailMesh = new THREE.Mesh(trailGeo, trailMat);
      trailMesh.frustumCulled = false;
      trailMesh.visible = false;
      trailMesh.renderOrder = 6 + i;
      this.rigPivot.add(trailMesh);

      this.materials.push(leafMat, depthMat, trailMat);
      this.turningPool.push({
        leafMesh,
        leafMat,
        depthMat,
        trailMesh,
        trailMat,
      });
    }
  }

  public update(
    timeline: TimelineState,
    readability: number,
    activeSectionRect?: ActiveSectionHighlight | null,
  ): void {
    const t = timeline.time;
    const sweepMaps = this.printAssets.sweepPageMaps;
    const fallbackMap = sweepMaps[0] ?? this.printAssets.backCoverMap;

    // --- 1. Dramatic 2.8s Sweeping Fly-In Trajectory, Aerodynamic Banking & Float ---
    let flyX = 0;
    let flyY = 0;
    let flyZ = 0;
    let tiltX = 0;
    let tiltY = 0;
    let tiltZ = 0;
    let dropFlex = 0;
    let fanSpread = 0;

    if (t < TIMING.dropDuration) {
      const u = clamp01(t / TIMING.dropDuration);
      const easePos = easeOutQuart(u);
      const easeSettle = easeInOutCubic(u);
      const airArc = Math.sin(u * Math.PI);
      const rem = 1 - easePos;

      // Sweeps gracefully in from upper-left/far space along a curved glider arc
      flyX = -6.8 * rem + Math.sin(u * Math.PI) * 1.15;
      flyY = 4.9 * Math.pow(1 - u, 2.2) + Math.sin(u * Math.PI * 1.35) * 0.42 * (1 - u);
      flyZ = -5.4 * rem - Math.sin(u * Math.PI) * 0.65;

      // Expressive aerodynamic roll/pitch/yaw as the broadsheet glides & levels out
      tiltZ = 0.42 * Math.pow(1 - easeSettle, 1.35) - 0.14 * airArc;
      tiltX = -0.34 * Math.pow(1 - easeSettle, 1.25) + 0.08 * airArc;
      tiltY = 0.46 * Math.pow(1 - easeSettle, 1.4);

      // Billowing paper flex peaks mid-flight, settling to a soft organic sheet drape at rest
      dropFlex = 0.08 + 0.88 * Math.sin(Math.pow(u, 0.82) * Math.PI);
      fanSpread = Math.sin(Math.pow(u, 0.85) * Math.PI);
    } else if (timeline.openCoverProgress < 0.02) {
      // Gentle zero-gravity poise during the 1s closed-cover hold
      const holdT = t - TIMING.dropDuration;
      flyY = Math.sin(holdT * 2.1) * 0.045;
      tiltZ = Math.sin(holdT * 1.4) * 0.012;
      tiltX = Math.cos(holdT * 1.2) * 0.01;
      dropFlex = 0.075; // keeps folded broadsheet gently curved, never flat/rigid
      fanSpread = 0.12;
    }

    // --- 2. Centered Closed -> Centered Open Spread Horizontal Glide ---
    const openP = clamp01(timeline.openCoverProgress);
    const pivotX = -PAGE_WIDTH * 0.5 * (1 - openP) + flyX;
    this.rigPivot.position.set(pivotX, flyY, flyZ);
    this.rigPivot.rotation.set(tiltX, tiltY, tiltZ);

    // --- 3. Physical Paper Stack Thickness Transfer (Right -> Left) ---
    const transferRatio = clamp01(
      openP * 0.15 + timeline.sweepProgress * 0.72 + timeline.settleProgress * 0.13,
    );
    const rightScaleY = Math.max(0.35, 1.0 - 0.58 * transferRatio);
    const leftScaleY = Math.max(0.08, 0.08 + 0.54 * transferRatio);

    // Hide solid inset stack during airborne fly-in so fanned thin leaves define the silhouette
    const showStacks = t >= TIMING.dropDuration * 0.88;
    this.rightStackMesh.visible = showStacks;
    this.rightStackMesh.scale.y = rightScaleY;
    this.rightStackMesh.position.y =
      TABLE_TOP_Y + STACK_MAX_THICKNESS * rightScaleY * 0.5;

    this.leftStackMesh.visible = showStacks && openP > 0.04;
    this.leftStackMesh.scale.y = leftScaleY;
    this.leftStackMesh.position.y =
      TABLE_TOP_Y + STACK_MAX_THICKNESS * leftScaleY * 0.5;

    this.spineCordMesh.visible = openP > 0.08;

    // Fanned inner leaves visible while closed/flying in, cleanly hidden once cover opens
    const showFannedLeaves = openP < 0.06;
    this.flyUnderLeafA.visible = showFannedLeaves;
    this.flyUnderLeafB.visible = showFannedLeaves;
    if (showFannedLeaves) {
      this.flyUnderLeafA.position.set(
        0.02 + fanSpread * 0.07,
        TABLE_TOP_Y + STACK_MAX_THICKNESS - 0.008 - fanSpread * 0.045,
        0.015 + fanSpread * 0.03,
      );
      this.flyUnderLeafA.rotation.set(0, -fanSpread * 0.025, -fanSpread * 0.045);
      this.flyUnderLeafAMat.uniforms.uTime.value = t;
      this.flyUnderLeafAMat.uniforms.uDropFlex.value = dropFlex * 0.82;

      this.flyUnderLeafB.position.set(
        0.04 + fanSpread * 0.13,
        TABLE_TOP_Y - 0.004 - fanSpread * 0.095,
        -0.015 - fanSpread * 0.035,
      );
      this.flyUnderLeafB.rotation.set(0, fanSpread * 0.03, -fanSpread * 0.085);
      this.flyUnderLeafBMat.uniforms.uTime.value = t;
      this.flyUnderLeafBMat.uniforms.uDropFlex.value = dropFlex * 0.65;
    }

    // --- 5. Front Cover Leaf ---
    const coverActive = openP < 0.995;
    this.coverLeafMesh.visible = coverActive;
    if (coverActive) {
      const rightTopY =
        TABLE_TOP_Y + STACK_MAX_THICKNESS * rightScaleY + 0.006;
      const openClearanceY = PAPER_REST_Y + 0.026;
      const archBlend = clamp01(openP / 0.08);
      this.coverLeafMesh.position.y =
        rightTopY * (1 - archBlend) + Math.max(rightTopY, openClearanceY) * archBlend;
      this.coverLeafMat.uniforms.uTurnProgress.value = openP;
      this.coverLeafMat.uniforms.uRestArchScale.value = archBlend;
      this.coverLeafMat.uniforms.uVelocity.value =
        Math.sin(openP * Math.PI) * 0.48;
      this.coverLeafMat.uniforms.uTime.value = t;
      this.coverLeafMat.uniforms.uDropFlex.value = dropFlex;
    }

    // --- 6. Active Sweep Leaves (5-Slot Pool) & Motion-Blur Trails ---
    const finalTurn = this.schedule[this.schedule.length - 1];
    const finalLeafStarted = t >= finalTurn.startTime;
    const finalLeafFinished = t >= finalTurn.endTime;

    // Collect active turns at current timestamp `t` (deterministic & scrub-safe),
    // ordered oldest -> newest so each newer leaf gets strictly higher turnOrder elevation.
    const activeTurns: Array<{ turn: ScheduledLeafTurn; p: number }> = [];
    let completedCount = 0;

    for (let i = 0; i < this.schedule.length; i++) {
      const turn = this.schedule[i];
      if (t >= turn.endTime) {
        completedCount++;
      } else if (t >= turn.startTime) {
        const rawP = clamp01(
          (t - turn.startTime) / (turn.endTime - turn.startTime),
        );
        // Final leaf uses softer landing curve; fast mid-sweep leaves feel snappy & aerodynamic
        const easedP = turn.isFinalLeaf
          ? easeInOutCubic(rawP)
          : easeOutCubic(rawP * 0.35 + easeInOutCubic(rawP) * 0.65);
        activeTurns.push({ turn, p: easedP });
      }
    }

    // Track dominant overhead shadow from airborne leaves onto the resting spread
    let shadowWeightedX = 0;
    let shadowWeightSum = 0;

    for (let slotIdx = 0; slotIdx < POOL_SIZE; slotIdx++) {
      const slot = this.turningPool[slotIdx];
      const entry = activeTurns[slotIdx];

      if (!entry) {
        slot.leafMesh.visible = false;
        slot.trailMesh.visible = false;
        continue;
      }

      const { turn, p } = entry;
      const frontTex = sweepMaps[turn.frontTexIndex] ?? fallbackMap;
      const backTex = turn.isFinalLeaf
        ? this.paperTextures.leftBaseMap
        : (sweepMaps[turn.backTexIndex] ?? fallbackMap);

      // Strict turn-order vertical stratification above the sculpted resting spread
      // (spread sits at PAPER_REST_Y + 0.002 + restContour; each turning leaf includes exact
      // restContour in vertex shader plus +0.016 base clearance and +0.016 per newer turnOrder).
      const turnOrder = slotIdx;
      const settleClearance = turn.isFinalLeaf
        ? 0.016 - 0.012 * clamp01((p - 0.84) / 0.16)
        : 0.016;
      const baseLiftY =
        PAPER_REST_Y + 0.002 + settleClearance + turnOrder * 0.016;

      slot.leafMesh.visible = true;
      slot.leafMesh.position.y = baseLiftY;

      slot.leafMat.uniforms.uFrontMap.value = frontTex;
      slot.leafMat.uniforms.uBackMap.value = backTex;
      slot.leafMat.uniforms.uTurnProgress.value = p;
      slot.leafMat.uniforms.uRestArchScale.value = 1.0;
      slot.leafMat.uniforms.uCurlStrength.value = turn.curlStrength;
      slot.leafMat.uniforms.uCornerLead.value = turn.cornerLead;
      slot.leafMat.uniforms.uVelocity.value = timeline.sweepVelocity;
      slot.leafMat.uniforms.uTime.value = t;
      slot.leafMat.uniforms.uDropFlex.value = 0.0;

      // Coupled motion-blur ghost ribbon trails behind fast leaves
      const showTrail =
        timeline.sweepVelocity > 0.06 && p > 0.06 && p < 0.94 && !turn.isFinalLeaf;
      slot.trailMesh.visible = showTrail;
      if (showTrail) {
        slot.trailMesh.position.y = baseLiftY + 0.012;
        slot.trailMat.uniforms.uTurnProgress.value = p;
        slot.trailMat.uniforms.uVelocity.value = timeline.sweepVelocity;
        slot.trailMat.uniforms.uCurlStrength.value = turn.curlStrength;
        slot.trailMat.uniforms.uTime.value = t;
      }

      // Accumulate analytical soft overhead shadow projection (key light comes from +X)
      const env = Math.sin(p * Math.PI);
      const leafCenterX = Math.cos(p * Math.PI) * PAGE_WIDTH * 0.45 - 0.55;
      shadowWeightedX += leafCenterX * env;
      shadowWeightSum += env;
    }

    // Cover leaf also casts soft moving shadow on open spread while lifting
    if (openP > 0.02 && openP < 0.98) {
      const coverEnv = Math.sin(openP * Math.PI);
      shadowWeightedX += (Math.cos(openP * Math.PI) * PAGE_WIDTH * 0.42 - 0.5) * coverEnv;
      shadowWeightSum += coverEnv;
    }

    const shadowCenterX =
      shadowWeightSum > 0.01 ? shadowWeightedX / shadowWeightSum : 0;
    const shadowStrength = clamp01(shadowWeightSum * 0.65);

    // --- 7. Underlying Sweep Base vs. Final Sculpted Spread Visibility ---
    // Right side switches to the blank final rightSpreadMesh the moment the final leaf begins lifting!
    const showRightFinal = finalLeafStarted || timeline.isInteractive;
    // Left side switches to the blank/revealing leftSpreadMesh the moment the final leaf settles!
    const showLeftFinal = finalLeafFinished || timeline.isInteractive;

    this.rightSpreadMesh.visible = showRightFinal;
    this.leftSpreadMesh.visible = showLeftFinal;

    this.sweepBaseRightMesh.visible = openP > 0.05 && !showRightFinal;
    this.sweepBaseLeftMesh.visible = openP > 0.22 && !showLeftFinal;

    if (this.sweepBaseRightMesh.visible) {
      const rightIdx = (completedCount + 1) % Math.max(1, sweepMaps.length);
      this.sweepBaseRightMat.uniforms.uPrintMap.value =
        sweepMaps[rightIdx] ?? fallbackMap;
      this.sweepBaseRightMat.uniforms.uSweepShadow.value.set(
        shadowCenterX,
        shadowStrength,
        2.6,
      );
    }

    if (this.sweepBaseLeftMesh.visible) {
      const leftIdx = completedCount % Math.max(1, sweepMaps.length);
      this.sweepBaseLeftMat.uniforms.uPrintMap.value =
        sweepMaps[leftIdx] ?? fallbackMap;
      this.sweepBaseLeftMat.uniforms.uSweepShadow.value.set(
        shadowCenterX,
        shadowStrength,
        2.6,
      );
    }

    // --- 8. Final Spread Sequential Ink Reveal, Overview Veil & Active Focus Vignette ---
    const safeReadability = clamp01(readability);
    const hasAnyActive = activeSectionRect != null ? 1.0 : 0.0;

    // Left page uniforms
    this.leftSpreadMat.uniforms.uMastheadReveal.value = timeline.mastheadReveal;
    this.leftSpreadMat.uniforms.uReadability.value = safeReadability;
    this.leftSpreadMat.uniforms.uTime.value = t;
    this.leftSpreadMat.uniforms.uHasAnyActiveSection.value = hasAnyActive;
    this.leftSpreadMat.uniforms.uSweepShadow.value.set(
      shadowCenterX,
      shadowStrength,
      2.4,
    );

    const leftReveals = this.leftSpreadMat.uniforms.uSectionReveals
      .value as number[];
    for (let i = 0; i < 3; i++) {
      const secIdx = this.leftSectionIndices[i];
      leftReveals[i] =
        secIdx !== undefined ? (timeline.sectionReveals[secIdx] ?? 0) : 0;
    }

    const leftActiveVec = this.leftSpreadMat.uniforms.uActiveRect
      .value as THREE.Vector4;
    if (activeSectionRect && activeSectionRect.page === 'left') {
      leftActiveVec.set(
        activeSectionRect.rect.u,
        activeSectionRect.rect.v,
        activeSectionRect.rect.w,
        activeSectionRect.rect.h,
      );
    } else {
      leftActiveVec.set(0, 0, 0, 0);
    }

    // Right page uniforms
    this.rightSpreadMat.uniforms.uMastheadReveal.value = timeline.mastheadReveal;
    this.rightSpreadMat.uniforms.uReadability.value = safeReadability;
    this.rightSpreadMat.uniforms.uTime.value = t;
    this.rightSpreadMat.uniforms.uHasAnyActiveSection.value = hasAnyActive;
    this.rightSpreadMat.uniforms.uSweepShadow.value.set(
      shadowCenterX,
      shadowStrength,
      2.4,
    );

    const rightReveals = this.rightSpreadMat.uniforms.uSectionReveals
      .value as number[];
    for (let i = 0; i < 3; i++) {
      const secIdx = this.rightSectionIndices[i];
      rightReveals[i] =
        secIdx !== undefined ? (timeline.sectionReveals[secIdx] ?? 0) : 0;
    }

    const rightActiveVec = this.rightSpreadMat.uniforms.uActiveRect
      .value as THREE.Vector4;
    if (activeSectionRect && activeSectionRect.page === 'right') {
      rightActiveVec.set(
        activeSectionRect.rect.u,
        activeSectionRect.rect.v,
        activeSectionRect.rect.w,
        activeSectionRect.rect.h,
      );
    } else {
      rightActiveVec.set(0, 0, 0, 0);
    }
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.ownedTextures) t.dispose();
  }
}
