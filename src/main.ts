import './ui/styles.css';

import { NEWSPAPER_EDITION } from './data/newspaperContent';
import { TIMING, evaluateTimeline } from './config/timing';
import { createPaperTextures } from './textures/paperTexture';
import { createNewspaperPrintAssets } from './textures/newspaperCanvas';
import { SceneManager } from './scene/SceneManager';
import { NewspaperRig } from './scene/NewspaperRig';
import { FloatingHistoryText } from './scene/FloatingHistoryText';
import { Atmosphere } from './scene/Atmosphere';
import { SpaceCamera } from './interaction/SpaceCamera';
import { HotspotOverlay } from './interaction/HotspotOverlay';
import { PresentationHUD } from './ui/PresentationHUD';
import type { NewspaperSection, TimelineState } from './types';

interface NewspaperSpaceDebugAPI {
  seek: (seconds: number) => void;
  pause: () => void;
  play: () => void;
  setSpeed: (speed: number) => void;
  focusSection: (id: string) => void;
  exitFocus: () => void;
  resetOverview: () => void;
  replay: () => void;
  getState: () => {
    time: number;
    paused: boolean;
    speed: number;
    phase: TimelineState['phase'];
    activeSectionId: string | null;
    readability: number;
    cameraPosition: [number, number, number];
  };
}

declare global {
  interface Window {
    __newspaperSpace?: NewspaperSpaceDebugAPI;
  }
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement | null;
  const hotspotLayer = document.getElementById('hotspot-layer');
  const hudLayer = document.getElementById('hud-layer');

  if (!canvas || !hotspotLayer || !hudLayer) {
    throw new Error('Required mount containers (#webgl-canvas, #hotspot-layer, #hud-layer) not found.');
  }

  const orderedSections = [...NEWSPAPER_EDITION.sections].sort((a, b) => a.order - b.order);
  const sectionById = new Map<string, NewspaperSection>(
    orderedSections.map((section) => [section.id, section]),
  );

  // 1. Core renderer, lighting rig & spatial camera
  const sceneManager = new SceneManager({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const spaceCamera = new SpaceCamera(canvas);
  spaceCamera.resize(window.innerWidth, window.innerHeight);

  // 2. Procedural aged newsprint & high-DPI 1990s broadsheet canvases
  const maxAnisotropy = Math.min(sceneManager.renderer.capabilities.getMaxAnisotropy(), 16);
  const paperTextures = createPaperTextures();
  const printAssets = await createNewspaperPrintAssets(NEWSPAPER_EDITION, maxAnisotropy);

  // 3. 3D scene assemblies (pure floating space — no table underneath)
  const newspaperRig = new NewspaperRig({
    edition: NEWSPAPER_EDITION,
    paperTextures,
    printAssets,
  });
  const floatingText = new FloatingHistoryText({
    phrases: NEWSPAPER_EDITION.floatingPhrases,
    aroundCount: 24,
    underCount: 16,
  });
  const atmosphere = new Atmosphere(220);

  sceneManager.add(
    newspaperRig.group,
    floatingText.group,
    atmosphere.group,
  );

  // 4. Timeline & playback state
  let timelineTime = 0;
  let elapsedRealTime = 0;
  let playbackSpeed = 1;
  let isPaused = false;
  let latestTimeline: TimelineState = evaluateTimeline(0, orderedSections.length);

  const ensureInteractive = (): void => {
    if (timelineTime < TIMING.totalIntroDuration) {
      timelineTime = TIMING.totalIntroDuration;
    }
  };

  const stepSection = (delta: 1 | -1): void => {
    ensureInteractive();
    const activeId = spaceCamera.getActiveSectionId();
    if (!activeId) {
      const target = delta > 0 ? orderedSections[0] : orderedSections[orderedSections.length - 1];
      if (target) spaceCamera.focusSection(target);
      return;
    }
    const idx = orderedSections.findIndex((s) => s.id === activeId);
    if (idx === -1) {
      if (orderedSections[0]) spaceCamera.focusSection(orderedSections[0]);
      return;
    }
    const nextIdx = (idx + delta + orderedSections.length) % orderedSections.length;
    const nextSection = orderedSections[nextIdx];
    if (nextSection) spaceCamera.focusSection(nextSection);
  };

  const replayIntro = (): void => {
    timelineTime = 0;
    isPaused = false;
    spaceCamera.resetForReplay();
  };

  // 5. Red-dot hotspot overlay & desktop presentation HUD
  const hotspotOverlay = new HotspotOverlay(hotspotLayer, orderedSections, {
    onSelect: (section) => {
      ensureInteractive();
      spaceCamera.focusSection(section);
    },
    onExit: () => {
      spaceCamera.exitFocus();
    },
  });

  const hud = new PresentationHUD(
    hudLayer,
    {
      onReplay: replayIntro,
      onSkipIntro: () => {
        timelineTime = TIMING.totalIntroDuration;
        isPaused = false;
      },
      onResetView: () => {
        ensureInteractive();
        spaceCamera.resetOverview();
      },
      onExitFocus: () => {
        spaceCamera.exitFocus();
      },
      onPrevSection: () => stepSection(-1),
      onNextSection: () => stepSection(1),
      onSpeedChange: (speed) => {
        playbackSpeed = speed;
      },
    },
    playbackSpeed,
  );

  // 6. Resize handling
  const handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    sceneManager.resize(w, h);
    spaceCamera.resize(w, h);
    atmosphere.resize();
  };
  window.addEventListener('resize', handleResize);

  // 7. Helper to render one deterministic frame (used both by RAF and debug API)
  const renderStep = (dt: number): void => {
    if (!isPaused) {
      timelineTime += dt * playbackSpeed;
    }
    elapsedRealTime += dt;

    latestTimeline = evaluateTimeline(timelineTime, orderedSections.length);

    // Update spatial camera first so readability & projection match this exact frame
    spaceCamera.update(dt, latestTimeline);

    const activeId = spaceCamera.getActiveSectionId();
    const activeSection = activeId ? (sectionById.get(activeId) ?? null) : null;
    const readability = spaceCamera.getReadabilityFactor();

    newspaperRig.update(
      latestTimeline,
      readability,
      activeSection ? { page: activeSection.page, rect: activeSection.rect } : null,
    );
    floatingText.update(latestTimeline);
    atmosphere.update(elapsedRealTime, latestTimeline);

    sceneManager.render(spaceCamera.camera);

    hotspotOverlay.update(spaceCamera.camera, latestTimeline, activeId);
    hud.update(latestTimeline, activeSection ? activeSection.order : null, orderedSections.length);
  };

  // Expose lightweight director/verification API on window
  window.__newspaperSpace = {
    seek: (seconds: number) => {
      timelineTime = Math.max(0, seconds);
      if (timelineTime < TIMING.totalIntroDuration) {
        spaceCamera.resetForReplay();
      }
      // Step several small ticks so damped camera settles cleanly onto the sought timestamp
      const wasPaused = isPaused;
      isPaused = true;
      for (let i = 0; i < 45; i++) {
        renderStep(1 / 60);
      }
      isPaused = wasPaused;
    },
    pause: () => {
      isPaused = true;
    },
    play: () => {
      isPaused = false;
    },
    setSpeed: (speed: number) => {
      playbackSpeed = speed;
      hud.setSpeed(speed);
    },
    focusSection: (id: string) => {
      const section = sectionById.get(id);
      if (!section) return;
      ensureInteractive();
      spaceCamera.focusSection(section);
    },
    exitFocus: () => {
      spaceCamera.exitFocus();
    },
    resetOverview: () => {
      ensureInteractive();
      spaceCamera.resetOverview();
    },
    replay: replayIntro,
    getState: () => ({
      time: Number(timelineTime.toFixed(2)),
      paused: isPaused,
      speed: playbackSpeed,
      phase: latestTimeline.phase,
      activeSectionId: spaceCamera.getActiveSectionId(),
      readability: Number(spaceCamera.getReadabilityFactor().toFixed(3)),
      cameraPosition: [
        Number(spaceCamera.camera.position.x.toFixed(2)),
        Number(spaceCamera.camera.position.y.toFixed(2)),
        Number(spaceCamera.camera.position.z.toFixed(2)),
      ],
    }),
  };

  // 8. Main animation loop
  let rafId = 0;
  let lastPerf = performance.now();

  const tick = (now: number): void => {
    rafId = window.requestAnimationFrame(tick);
    const dt = Math.min((now - lastPerf) / 1000, 0.05);
    lastPerf = now;
    renderStep(dt);
  };

  // Paint initial frame immediately, then launch loop
  renderStep(1 / 60);
  rafId = window.requestAnimationFrame(tick);

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('resize', handleResize);
    hotspotOverlay.dispose();
    hud.dispose();
    spaceCamera.dispose();
    newspaperRig.dispose();
    floatingText.dispose();
    atmosphere.dispose();
    printAssets.dispose();
    paperTextures.dispose();
    sceneManager.dispose();
  });
}

bootstrap().catch((err) => {
  console.error('Failed to initialize Historical Newspaper Space:', err);
});
