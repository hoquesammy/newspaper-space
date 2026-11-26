import type { AnimationPhase, TimelineState } from '../types';

export const TIMING = {
  dropStart: 0.0,
  dropDuration: 2.8, // 0.0s – 2.8s dramatic sweeping fly-in
  holdDuration: 1.0, // 2.8s – 3.8s closed front cover hold
  sweepDuration: 3.6, // 3.8s – 7.4s crisp reduced page turns (5 leaves)
  settleDuration: 1.8, // 7.4s – 9.2s smooth settle & slight zoom-out
  revealStart: 8.2,
  revealDuration: 2.6, // 8.2s – 10.8s fast sequential ink reveal
  dotsStart: 10.8,
  dotsDuration: 0.7, // 10.8s – 11.5s red attract dots appear
  totalIntroDuration: 11.5,
} as const;

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeInOutQuart(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
}

export function easeOutQuart(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 4);
}

export function evaluateTimeline(t: number, sectionCount = 6): TimelineState {
  const time = Math.max(0, t);

  const dropEnd = TIMING.dropStart + TIMING.dropDuration;
  const holdEnd = dropEnd + TIMING.holdDuration;
  const sweepEnd = holdEnd + TIMING.sweepDuration;
  const settleEnd = sweepEnd + TIMING.settleDuration;
  const revealEnd = TIMING.revealStart + TIMING.revealDuration;
  const dotsEnd = TIMING.dotsStart + TIMING.dotsDuration;

  let phase: AnimationPhase;
  if (time < dropEnd) {
    phase = 'drop';
  } else if (time < holdEnd) {
    phase = 'hold';
  } else if (time < sweepEnd) {
    phase = 'sweep';
  } else if (time < TIMING.revealStart) {
    phase = 'settle';
  } else if (time < TIMING.totalIntroDuration) {
    phase = 'reveal';
  } else {
    phase = 'interactive';
  }

  const dropProgress = easeOutCubic((time - TIMING.dropStart) / TIMING.dropDuration);

  // Front cover opens swiftly at the start of the sweep (first 0.95s)
  const coverOpenDuration = 0.95;
  const openCoverProgress = easeInOutQuart((time - holdEnd) / coverOpenDuration);

  // Sweep progress across the crisp 3.6s sweep window
  const rawSweep = clamp01((time - holdEnd) / TIMING.sweepDuration);
  const sweepProgress = easeInOutCubic(rawSweep);

  // Sweep velocity: ramps briskly after cover open, peaks mid-sweep, decelerates cleanly during settle
  let sweepVelocity = 0;
  if (time > holdEnd && time < settleEnd) {
    if (time <= sweepEnd) {
      const rampUp = easeOutCubic((time - holdEnd) / 0.85);
      const cruiseWave = 0.82 + 0.18 * Math.sin(rawSweep * Math.PI);
      sweepVelocity = clamp01(rampUp * cruiseWave);
    } else {
      const decelT = clamp01((time - sweepEnd) / TIMING.settleDuration);
      sweepVelocity = 0.82 * (1 - easeOutQuart(decelT));
    }
  }

  const settleProgress = easeInOutQuart((time - sweepEnd) / TIMING.settleDuration);
  const zoomOutProgress = settleProgress;

  // Masthead reveals first at the start of the reveal window
  const mastheadReveal = easeOutCubic((time - TIMING.revealStart) / 0.65);

  // Staggered sequential reveal for each newspaper section
  const sectionReveals: number[] = [];
  const count = Math.max(1, sectionCount);
  const sectionWindow = Math.max(0.55, TIMING.revealDuration / (count * 0.62));
  const staggerSpan = Math.max(0, TIMING.revealDuration - sectionWindow);
  const staggerStep = count > 1 ? staggerSpan / (count - 1) : 0;

  for (let i = 0; i < count; i++) {
    const start = TIMING.revealStart + i * staggerStep;
    const localProgress = (time - start) / sectionWindow;
    sectionReveals.push(easeOutCubic(localProgress));
  }

  const dotsProgress = easeOutCubic((time - TIMING.dotsStart) / (dotsEnd - TIMING.dotsStart));
  const isInteractive = time >= TIMING.totalIntroDuration;

  return {
    time,
    phase,
    dropProgress,
    openCoverProgress,
    sweepProgress,
    sweepVelocity,
    settleProgress,
    zoomOutProgress,
    mastheadReveal,
    sectionReveals,
    dotsProgress,
    isInteractive,
  };
}
