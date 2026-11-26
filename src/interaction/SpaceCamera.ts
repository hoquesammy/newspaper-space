import * as THREE from 'three';
import { PAPER_REST_Y, sectionToFocusTarget } from '../config/theme';
import { TIMING, clamp01, easeInOutCubic, easeInOutQuart, easeOutCubic } from '../config/timing';
import type { NewspaperSection, TimelineState } from '../types';

export interface SpaceCameraOptions {
  fov?: number;
  near?: number;
  far?: number;
}

type FocusChangeCallback = (sectionId: string | null) => void;

// Cinematic fly-in, hold & overview framing constants (sized for longer 8.8 × 7.2 broadsheet)
const INTRO_FLY_START_POS = new THREE.Vector3(-3.8, 3.8, 10.4);
const INTRO_FLY_START_LOOK = new THREE.Vector3(-2.1, 2.0, -1.6);

const INTRO_DROP_POS = new THREE.Vector3(0.45, 10.9, 6.7);
const INTRO_DROP_LOOK = new THREE.Vector3(0.0, 0.0, 0.25);

const OVERVIEW_POS = new THREE.Vector3(0.0, 12.8, 4.3);
const OVERVIEW_LOOK = new THREE.Vector3(0.0, 0.0, 0.14);

// Spatial free-roam safety bounds
const PAN_X_MIN = -6.5;
const PAN_X_MAX = 6.5;
const PAN_Z_MIN = -5.6;
const PAN_Z_MAX = 5.6;

const MIN_CAMERA_HEIGHT = 2.2;
const MAX_CAMERA_HEIGHT = 17.5;

const MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(6);
const MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(46);
const MAX_AZIMUTH_ANGLE = THREE.MathUtils.degToRad(45);

// Readability veil thresholds (0.0 at overview -> 1.0 when zoomed/focused)
const READABILITY_OVERVIEW_Y = 9.8;
const READABILITY_CRISP_Y = 6.2;

// Manual release thresholds while focused on a section
const FOCUS_RELEASE_HEIGHT = 8.6;
const FOCUS_RELEASE_PAN_DIST = 2.9;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function expDamp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export class SpaceCamera {
  public readonly camera: THREE.PerspectiveCamera;

  private readonly domElement: HTMLElement;
  private readonly focusListeners = new Set<FocusChangeCallback>();

  // Interactive orbital state (current damped vs target)
  private currentTarget = new THREE.Vector3().copy(OVERVIEW_LOOK);
  private desiredTarget = new THREE.Vector3().copy(OVERVIEW_LOOK);

  private currentDistance = 11.45;
  private desiredDistance = 11.45;

  private currentPolar = THREE.MathUtils.degToRad(18.8);
  private desiredPolar = THREE.MathUtils.degToRad(18.8);

  private currentAzimuth = 0;
  private desiredAzimuth = 0;

  // Intro & transition bookkeeping
  private interactiveUnlocked = false;
  private activeSectionId: string | null = null;
  private focusedCenter = new THREE.Vector3();
  private focusReadability = 0;

  // Pointer interaction state
  private isDragging = false;
  private dragMode: 'pan' | 'orbit' | null = null;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private dragDistanceAccum = 0;

  // Scratch vectors to avoid per-frame allocations
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();
  private readonly tmpSweepEndPos = new THREE.Vector3();
  private readonly tmpSweepEndLook = new THREE.Vector3();
  private readonly tmpOverviewPos = new THREE.Vector3();

  constructor(domElement: HTMLElement, options: SpaceCameraOptions = {}) {
    this.domElement = domElement;

    const width = domElement.clientWidth || window.innerWidth || 1280;
    const height = domElement.clientHeight || window.innerHeight || 720;
    const aspect = width / Math.max(1, height);

    this.camera = new THREE.PerspectiveCamera(
      options.fov ?? 38,
      aspect,
      options.near ?? 0.1,
      options.far ?? 120,
    );

    this.camera.position.copy(INTRO_FLY_START_POS);
    this.camera.lookAt(INTRO_FLY_START_LOOK);

    this.syncOrbitalToOverview(true);
    this.bindEvents();
  }

  public update(dt: number, timeline: TimelineState): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.1);

    if (!timeline.isInteractive) {
      if (this.interactiveUnlocked) {
        this.interactiveUnlocked = false;
        this.domElement.classList.remove('cursor-grab', 'cursor-grabbing');
      }
      this.focusReadability = expDamp(this.focusReadability, 0, 8, safeDt);
      this.updateIntroChoreography(timeline);
      return;
    }

    // First frame entering interactive mode
    if (!this.interactiveUnlocked) {
      this.interactiveUnlocked = true;
      this.domElement.classList.add('cursor-grab');

      // Seed current orbital state from current camera pose, targeting exact overview
      this.captureCurrentCameraIntoOrbital();
      if (!this.activeSectionId) {
        this.syncOrbitalToOverview(false);
      }
    }

    // Smoothly damp interactive camera parameters
    const posLambda = this.activeSectionId ? 6.5 : 8.5;
    const angleLambda = this.activeSectionId ? 6.5 : 9.0;

    this.currentTarget.x = expDamp(this.currentTarget.x, this.desiredTarget.x, posLambda, safeDt);
    this.currentTarget.y = expDamp(this.currentTarget.y, this.desiredTarget.y, posLambda, safeDt);
    this.currentTarget.z = expDamp(this.currentTarget.z, this.desiredTarget.z, posLambda, safeDt);

    this.currentDistance = expDamp(this.currentDistance, this.desiredDistance, posLambda, safeDt);
    this.currentPolar = expDamp(this.currentPolar, this.desiredPolar, angleLambda, safeDt);
    this.currentAzimuth = expDamp(this.currentAzimuth, this.desiredAzimuth, angleLambda, safeDt);

    this.applyOrbitalToCamera();

    // Smoothly blend focus readability factor
    const targetFocusRead = this.activeSectionId ? 1.0 : 0.0;
    this.focusReadability = expDamp(this.focusReadability, targetFocusRead, 6.0, safeDt);
  }

  public focusSection(section: NewspaperSection): void {
    const target = sectionToFocusTarget(section);

    const vFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const tanHalfV = Math.tan(vFovRad * 0.5);
    const tanHalfH = tanHalfV * Math.max(0.5, this.camera.aspect);

    // ~14% horizontal margin and ~24% vertical margin so bottom pull-quotes clear the HUD bar
    const reqHeightV = (target.worldHeight * 1.24) / (2 * tanHalfV);
    const reqHeightH = (target.worldWidth * 1.14) / (2 * tanHalfH);

    const idealY = THREE.MathUtils.clamp(
      Math.max(reqHeightV, reqHeightH),
      2.35,
      7.6,
    );

    // Slight editorial angle (nearly top-down)
    const zOffset = 0.55;
    const polar = THREE.MathUtils.clamp(
      Math.atan2(zOffset, idealY),
      MIN_POLAR_ANGLE,
      MAX_POLAR_ANGLE,
    );
    const distance = Math.hypot(idealY, zOffset);

    // Nudge lookAt.z slightly downward (+z) so the focused section sits cleanly above the bottom HUD
    const targetZ = THREE.MathUtils.clamp(
      target.worldCenter.z + target.worldHeight * 0.055,
      PAN_Z_MIN,
      PAN_Z_MAX,
    );

    this.desiredTarget.set(
      THREE.MathUtils.clamp(target.worldCenter.x, PAN_X_MIN, PAN_X_MAX),
      PAPER_REST_Y,
      targetZ,
    );
    this.desiredPolar = polar;
    this.desiredAzimuth = 0;
    this.desiredDistance = distance;

    this.focusedCenter.set(target.worldCenter.x, PAPER_REST_Y, targetZ);
    this.setActiveSectionId(section.id);
  }

  public exitFocus(): void {
    if (this.activeSectionId !== null) {
      this.setActiveSectionId(null);
    }
    this.syncOrbitalToOverview(false);
  }

  public getActiveSectionId(): string | null {
    return this.activeSectionId;
  }

  public getReadabilityFactor(): number {
    const heightReadability = smoothstep(
      READABILITY_OVERVIEW_Y,
      READABILITY_CRISP_Y,
      this.camera.position.y,
    );
    return clamp01(Math.max(heightReadability, this.focusReadability));
  }

  public resetOverview(): void {
    if (this.activeSectionId !== null) {
      this.setActiveSectionId(null);
    }
    this.syncOrbitalToOverview(false);
  }

  public resetForReplay(): void {
    this.setActiveSectionId(null);
    this.interactiveUnlocked = false;
    this.focusReadability = 0;
    this.isDragging = false;
    this.dragMode = null;
    this.activePointerId = null;
    this.domElement.classList.remove('cursor-grab', 'cursor-grabbing');

    this.camera.position.copy(INTRO_FLY_START_POS);
    this.camera.lookAt(INTRO_FLY_START_LOOK);
    this.syncOrbitalToOverview(true);
  }

  public onFocusChange(cb: FocusChangeCallback): () => void {
    this.focusListeners.add(cb);
    return () => {
      this.focusListeners.delete(cb);
    };
  }

  public resize(width: number, height: number): void {
    const safeW = Math.max(1, width);
    const safeH = Math.max(1, height);
    this.camera.aspect = safeW / safeH;
    this.camera.updateProjectionMatrix();

    // If parked in overview without active section, gently re-adapt distance for aspect ratio
    if (this.interactiveUnlocked && !this.activeSectionId && !this.isDragging) {
      const overview = this.getAspectAdjustedOverviewPos(this.tmpOverviewPos);
      const offset = overview.clone().sub(OVERVIEW_LOOK);
      const overviewDist = offset.length();
      // Only re-adapt if user hasn't manually zoomed far away from overview
      if (Math.abs(this.desiredDistance - overviewDist) < 1.5) {
        this.desiredDistance = overviewDist;
      }
    }
  }

  public dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    this.domElement.removeEventListener('wheel', this.handleWheel);
    this.domElement.removeEventListener('dblclick', this.handleDoubleClick);
    this.domElement.removeEventListener('contextmenu', this.handleContextMenu);
    this.domElement.classList.remove('cursor-grab', 'cursor-grabbing');
    this.focusListeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Intro Choreography
  // ---------------------------------------------------------------------------

  private updateIntroChoreography(timeline: TimelineState): void {
    const t = timeline.time;
    const overviewPos = this.getAspectAdjustedOverviewPos(this.tmpOverviewPos);
    const dropEnd = TIMING.dropStart + TIMING.dropDuration;
    const sweepEnd = dropEnd + TIMING.holdDuration + TIMING.sweepDuration;

    if (timeline.phase === 'drop') {
      // Dynamic cinema crane & tracking arc following the broadsheet as it flies in through space
      const u = clamp01(t / Math.max(0.001, TIMING.dropDuration));
      const posBlend = easeInOutCubic(u);
      const lookBlend = easeOutCubic(u);
      const arcSwing = Math.sin(u * Math.PI);

      // Sweeps gracefully from low-left tracking angle, swings gently right-outward, and rises cleanly
      this.tmpPos.lerpVectors(INTRO_FLY_START_POS, INTRO_DROP_POS, posBlend);
      this.tmpPos.x += arcSwing * 1.85;
      this.tmpPos.y += arcSwing * 0.75;
      this.tmpPos.z += arcSwing * 0.9;

      this.tmpLook.lerpVectors(INTRO_FLY_START_LOOK, INTRO_DROP_LOOK, lookBlend);
      this.tmpLook.y += Math.sin(u * Math.PI) * 0.35;
    } else if (timeline.phase === 'hold') {
      // Poised slow cinematic dolly & gentle breathing during the 1s title hold
      const holdU = clamp01((t - dropEnd) / Math.max(0.001, TIMING.holdDuration));
      const drift = easeInOutCubic(holdU);
      this.tmpPos.set(
        INTRO_DROP_POS.x - drift * 0.12 + Math.sin(t * 1.1) * 0.05,
        INTRO_DROP_POS.y - drift * 0.28 + Math.cos(t * 0.9) * 0.04,
        INTRO_DROP_POS.z - drift * 0.18,
      );
      this.tmpLook.copy(INTRO_DROP_LOOK);
    } else if (timeline.phase === 'sweep') {
      // Smooth sweeping arc showcasing the 5 crisp curling pages & smaller floating history texts
      const s = timeline.sweepProgress;
      const envelope = Math.sin(s * Math.PI);

      this.computeSweepPose(s, envelope, t, this.tmpPos, this.tmpLook);
    } else {
      // Settle, Reveal, Dots: start from exact end-of-sweep pose & execute graceful slight zoom-out
      this.computeSweepPose(1, 0, sweepEnd, this.tmpSweepEndPos, this.tmpSweepEndLook);
      const zOut = easeInOutQuart(timeline.zoomOutProgress);

      this.tmpPos.lerpVectors(this.tmpSweepEndPos, overviewPos, zOut);
      this.tmpLook.lerpVectors(this.tmpSweepEndLook, OVERVIEW_LOOK, zOut);
    }

    this.camera.position.copy(this.tmpPos);
    this.camera.lookAt(this.tmpLook);
  }

  private computeSweepPose(
    sweepProgress: number,
    envelope: number,
    time: number,
    outPos: THREE.Vector3,
    outLook: THREE.Vector3,
  ): void {
    // Starts cleanly from end-of-hold pose and sweeps smoothly to showcase pages & surrounding floating text
    const startX = INTRO_DROP_POS.x - 0.12;
    const startY = INTRO_DROP_POS.y - 0.28;
    const startZ = INTRO_DROP_POS.z - 0.18;

    const sweepEndPosX = 0.12;
    const sweepEndPosY = 11.2;
    const sweepEndPosZ = 7.4;

    const blend = easeInOutCubic(sweepProgress);
    const baseX = THREE.MathUtils.lerp(startX, sweepEndPosX, blend);
    const baseY = THREE.MathUtils.lerp(startY, sweepEndPosY, blend);
    const baseZ = THREE.MathUtils.lerp(startZ, sweepEndPosZ, blend);

    const driftX = -0.55 * Math.sin(sweepProgress * Math.PI * 1.25) * envelope;
    const driftY = 0.2 * envelope + Math.sin(time * 0.9) * 0.05 * envelope;
    const driftZ = 1.45 * envelope;

    outPos.set(baseX + driftX, baseY + driftY, baseZ + driftZ);

    const lookX = THREE.MathUtils.lerp(INTRO_DROP_LOOK.x, OVERVIEW_LOOK.x, blend) + driftX * 0.1;
    const lookY = THREE.MathUtils.lerp(INTRO_DROP_LOOK.y, -0.18, blend) - 0.16 * envelope;
    const lookZ = THREE.MathUtils.lerp(INTRO_DROP_LOOK.z, 0.22, blend);
    outLook.set(lookX, lookY, lookZ);
  }

  // ---------------------------------------------------------------------------
  // Orbital Math & Helpers
  // ---------------------------------------------------------------------------

  private getAspectAdjustedOverviewPos(out: THREE.Vector3): THREE.Vector3 {
    out.copy(OVERVIEW_POS);
    // On narrower desktop windows (< 16:10), step slightly further back so full spread stays framed
    if (this.camera.aspect < 1.55) {
      const scale = THREE.MathUtils.clamp(1.55 / Math.max(0.75, this.camera.aspect), 1.0, 1.32);
      const dx = OVERVIEW_POS.x - OVERVIEW_LOOK.x;
      const dy = OVERVIEW_POS.y - OVERVIEW_LOOK.y;
      const dz = OVERVIEW_POS.z - OVERVIEW_LOOK.z;
      out.set(
        OVERVIEW_LOOK.x + dx * scale,
        OVERVIEW_LOOK.y + dy * scale,
        OVERVIEW_LOOK.z + dz * scale,
      );
    }
    return out;
  }

  private syncOrbitalToOverview(snapCurrent: boolean): void {
    const overviewPos = this.getAspectAdjustedOverviewPos(this.tmpOverviewPos);
    const dx = overviewPos.x - OVERVIEW_LOOK.x;
    const dy = overviewPos.y - OVERVIEW_LOOK.y;
    const dz = overviewPos.z - OVERVIEW_LOOK.z;

    const dist = Math.hypot(dx, dy, dz);
    const polar = Math.acos(THREE.MathUtils.clamp(dy / Math.max(0.0001, dist), -1, 1));
    const azimuth = Math.atan2(dx, dz);

    this.desiredTarget.copy(OVERVIEW_LOOK);
    this.desiredDistance = dist;
    this.desiredPolar = polar;
    this.desiredAzimuth = azimuth;

    if (snapCurrent) {
      this.currentTarget.copy(OVERVIEW_LOOK);
      this.currentDistance = dist;
      this.currentPolar = polar;
      this.currentAzimuth = azimuth;
    }
  }

  private captureCurrentCameraIntoOrbital(): void {
    // Intersect camera viewing ray with y = PAPER_REST_Y plane to get current look target
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (Math.abs(dir.y) > 0.05) {
      const t = (PAPER_REST_Y - this.camera.position.y) / dir.y;
      if (t > 0.1 && t < 50) {
        this.currentTarget.copy(this.camera.position).addScaledVector(dir, t);
      } else {
        this.currentTarget.copy(OVERVIEW_LOOK);
      }
    } else {
      this.currentTarget.copy(OVERVIEW_LOOK);
    }

    const offset = this.camera.position.clone().sub(this.currentTarget);
    const dist = Math.max(0.5, offset.length());
    this.currentDistance = dist;
    this.currentPolar = THREE.MathUtils.clamp(
      Math.acos(THREE.MathUtils.clamp(offset.y / dist, -1, 1)),
      MIN_POLAR_ANGLE,
      MAX_POLAR_ANGLE,
    );
    this.currentAzimuth = THREE.MathUtils.clamp(
      Math.atan2(offset.x, offset.z),
      -MAX_AZIMUTH_ANGLE,
      MAX_AZIMUTH_ANGLE,
    );
  }

  private applyOrbitalToCamera(): void {
    const sinPolar = Math.sin(this.currentPolar);
    const cosPolar = Math.cos(this.currentPolar);
    const sinAz = Math.sin(this.currentAzimuth);
    const cosAz = Math.cos(this.currentAzimuth);

    this.camera.position.set(
      this.currentTarget.x + this.currentDistance * sinPolar * sinAz,
      this.currentTarget.y + this.currentDistance * cosPolar,
      this.currentTarget.z + this.currentDistance * sinPolar * cosAz,
    );
    this.camera.lookAt(this.currentTarget);
  }

  private clampDistanceToHeightBounds(distance: number, polar: number): number {
    const cosPolar = Math.max(0.2, Math.cos(polar));
    const minDist = (MIN_CAMERA_HEIGHT - this.desiredTarget.y) / cosPolar;
    const maxDist = (MAX_CAMERA_HEIGHT - this.desiredTarget.y) / cosPolar;
    return THREE.MathUtils.clamp(distance, Math.max(1.8, minDist), maxDist);
  }

  private setActiveSectionId(nextId: string | null): void {
    if (this.activeSectionId === nextId) return;
    this.activeSectionId = nextId;
    for (const cb of this.focusListeners) {
      cb(nextId);
    }
  }

  private checkManualFocusRelease(): void {
    if (!this.activeSectionId) return;

    const desiredHeight = this.desiredTarget.y + this.desiredDistance * Math.cos(this.desiredPolar);
    const panDist = Math.hypot(
      this.desiredTarget.x - this.focusedCenter.x,
      this.desiredTarget.z - this.focusedCenter.z,
    );

    if (desiredHeight >= FOCUS_RELEASE_HEIGHT || panDist >= FOCUS_RELEASE_PAN_DIST) {
      this.setActiveSectionId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer & Wheel Event Handlers
  // ---------------------------------------------------------------------------

  private bindEvents(): void {
    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    this.domElement.addEventListener('wheel', this.handleWheel, { passive: false });
    this.domElement.addEventListener('dblclick', this.handleDoubleClick);
    this.domElement.addEventListener('contextmenu', this.handleContextMenu);
  }

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (!this.interactiveUnlocked) return;
    if (e.button !== 0 && e.button !== 2) return;

    this.isDragging = true;
    this.activePointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.dragDistanceAccum = 0;

    if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      this.dragMode = 'orbit';
    } else {
      this.dragMode = 'pan';
    }

    this.domElement.classList.add('cursor-grabbing');
    try {
      this.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without active pointer capture
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (!this.isDragging || !this.interactiveUnlocked) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.dragDistanceAccum += Math.hypot(dx, dy);

    const viewportHeight = Math.max(1, this.domElement.clientHeight || window.innerHeight);

    if (this.dragMode === 'pan') {
      // Scale screen pixel drag to world units on the table plane
      const vFovRad = THREE.MathUtils.degToRad(this.camera.fov);
      const worldPerPixel = (2 * this.desiredDistance * Math.tan(vFovRad * 0.5)) / viewportHeight;

      const cosAz = Math.cos(this.desiredAzimuth);
      const sinAz = Math.sin(this.desiredAzimuth);

      // Forward/right vectors projected onto XZ table plane
      const panRight = -dx * worldPerPixel;
      const panForward = -dy * worldPerPixel / Math.max(0.45, Math.cos(this.desiredPolar));

      this.desiredTarget.x = THREE.MathUtils.clamp(
        this.desiredTarget.x + panRight * cosAz + panForward * sinAz,
        PAN_X_MIN,
        PAN_X_MAX,
      );
      this.desiredTarget.z = THREE.MathUtils.clamp(
        this.desiredTarget.z - panRight * sinAz + panForward * cosAz,
        PAN_Z_MIN,
        PAN_Z_MAX,
      );

      this.checkManualFocusRelease();
    } else if (this.dragMode === 'orbit') {
      const orbitSensitivity = 0.0042;
      this.desiredAzimuth = THREE.MathUtils.clamp(
        this.desiredAzimuth - dx * orbitSensitivity,
        -MAX_AZIMUTH_ANGLE,
        MAX_AZIMUTH_ANGLE,
      );
      this.desiredPolar = THREE.MathUtils.clamp(
        this.desiredPolar - dy * orbitSensitivity,
        MIN_POLAR_ANGLE,
        MAX_POLAR_ANGLE,
      );
      this.desiredDistance = this.clampDistanceToHeightBounds(
        this.desiredDistance,
        this.desiredPolar,
      );
    }
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    this.isDragging = false;
    this.dragMode = null;
    this.activePointerId = null;
    this.domElement.classList.remove('cursor-grabbing');
    try {
      if (this.domElement.hasPointerCapture(e.pointerId)) {
        this.domElement.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
  };

  private readonly handleWheel = (e: WheelEvent): void => {
    if (!this.interactiveUnlocked) return;
    e.preventDefault();

    // Normalize wheel delta across mouse wheels & trackpads
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 24;
    else if (e.deltaMode === 2) delta *= 240;

    const zoomFactor = Math.exp(delta * 0.00115);
    this.desiredDistance = this.clampDistanceToHeightBounds(
      this.desiredDistance * zoomFactor,
      this.desiredPolar,
    );

    this.checkManualFocusRelease();
  };

  private readonly handleDoubleClick = (): void => {
    if (!this.interactiveUnlocked) return;
    if (this.dragDistanceAccum > 12) return;
    this.resetOverview();
  };

  private readonly handleContextMenu = (e: MouseEvent): void => {
    if (this.interactiveUnlocked) {
      e.preventDefault();
    }
  };
}
