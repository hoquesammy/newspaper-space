import type { AnimationPhase, TimelineState } from '../types';

export interface PresentationHUDCallbacks {
  onReplay: () => void;
  onSkipIntro: () => void;
  onResetView: () => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onSpeedChange: (speed: number) => void;
  onExitFocus?: () => void;
}

const PHASE_LABELS: Record<AnimationPhase, string> = {
  drop: 'Fly-In',
  hold: 'Hold',
  sweep: 'Page Sweep',
  settle: 'Settle',
  reveal: 'Ink Reveal',
  interactive: 'Explore · Drag & Zoom',
};

const PACE_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

const ICONS = {
  replay: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.4-3.48L3 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 2.75V6h3.25" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  skip: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 3.75L9.25 8L3.5 12.25V3.75Z" fill="currentColor"/><path d="M11.5 3.75V12.25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  overview: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.25" y="3.5" width="11.5" height="9" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M8 3.5V12.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
  prev: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  next: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hideHud: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.2 8s2.2-3.8 5.8-3.8S13.8 8 13.8 8s-2.2 3.8-5.8 3.8S2.2 8 2.2 8Z" stroke="currentColor" stroke-width="1.45"/><path d="M2.5 13.5L13.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  showHud: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.2 8s2.2-3.8 5.8-3.8S13.8 8 13.8 8s-2.2 3.8-5.8 3.8S2.2 8 2.2 8Z" stroke="currentColor" stroke-width="1.45"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
} as const;

export class PresentationHUD {
  private readonly container: HTMLElement;
  private readonly callbacks: PresentationHUDCallbacks;

  private readonly root: HTMLDivElement;
  private readonly bar: HTMLElement;
  private readonly phaseDot: HTMLSpanElement;
  private readonly phaseLabelEl: HTMLSpanElement;
  private readonly clockEl: HTMLSpanElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly overviewBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly sectionBadgeEl: HTMLSpanElement;
  private readonly paceButtons = new Map<number, HTMLButtonElement>();
  private readonly showHudBtn: HTMLButtonElement;
  private readonly hintPill: HTMLDivElement;

  private hudHidden = false;
  private currentSpeed: number;
  private hintDismissed = false;
  private isInteractiveNow = false;

  // Cached render values to avoid redundant DOM writes at 60fps
  private lastPhase: AnimationPhase | null = null;
  private lastClockText = '';
  private lastInteractive: boolean | null = null;
  private lastSectionBadge = '';

  constructor(
    container: HTMLElement,
    callbacks: PresentationHUDCallbacks,
    initialSpeed = 1,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.currentSpeed = initialSpeed;

    this.root = document.createElement('div');
    this.root.className = 'hud-root';

    // 1. Subtle bottom-left interaction hint pill
    this.hintPill = document.createElement('div');
    this.hintPill.className = 'hud-hint';
    this.hintPill.setAttribute('role', 'status');
    this.hintPill.innerHTML = `<span class="hud-hint-dot" aria-hidden="true"></span><span>Click any red dot to zoom &amp; read · Drag to pan · Scroll to zoom</span>`;

    // 2. Main floating glass presentation bar
    this.bar = document.createElement('nav');
    this.bar.className = 'hud-bar';
    this.bar.setAttribute('aria-label', 'Presentation controls');

    // Phase + live clock group
    const statusGroup = document.createElement('div');
    statusGroup.className = 'hud-group hud-status';

    this.phaseDot = document.createElement('span');
    this.phaseDot.className = 'hud-phase-dot';
    this.phaseDot.setAttribute('aria-hidden', 'true');

    this.phaseLabelEl = document.createElement('span');
    this.phaseLabelEl.className = 'hud-phase-label';
    this.phaseLabelEl.textContent = PHASE_LABELS.drop;

    this.clockEl = document.createElement('span');
    this.clockEl.className = 'hud-clock';
    this.clockEl.textContent = '00.0s';

    statusGroup.append(this.phaseDot, this.phaseLabelEl, this.clockEl);

    // Playback & camera actions group
    const playbackGroup = document.createElement('div');
    playbackGroup.className = 'hud-group';

    this.skipBtn = this.createIconButton(
      ICONS.skip,
      'Skip Intro',
      'Skip intro animation to interactive view',
      () => {
        this.callbacks.onSkipIntro();
      },
      'hud-btn hud-btn-accent',
    );

    const replayBtn = this.createIconButton(
      ICONS.replay,
      'Replay',
      'Replay full intro animation (R)',
      () => {
        this.hintDismissed = false;
        this.hintPill.classList.remove('is-dismissed');
        this.callbacks.onReplay();
      },
      'hud-btn',
    );

    this.overviewBtn = this.createIconButton(
      ICONS.overview,
      'Overview',
      'Reset camera to full newspaper overview (0)',
      () => {
        this.dismissHint();
        this.callbacks.onResetView();
      },
      'hud-btn',
    );

    playbackGroup.append(this.skipBtn, replayBtn, this.overviewBtn);

    // Section navigation group
    const navGroup = document.createElement('div');
    navGroup.className = 'hud-group hud-stepper';

    this.prevBtn = this.createIconButton(
      ICONS.prev,
      '',
      'Previous newspaper section (Left Arrow)',
      () => {
        this.dismissHint();
        this.callbacks.onPrevSection();
      },
      'hud-btn hud-btn-icon',
    );

    this.sectionBadgeEl = document.createElement('span');
    this.sectionBadgeEl.className = 'hud-section-badge';
    this.sectionBadgeEl.textContent = '–/6';
    this.sectionBadgeEl.setAttribute('aria-live', 'polite');

    this.nextBtn = this.createIconButton(
      ICONS.next,
      '',
      'Next newspaper section (Right Arrow)',
      () => {
        this.dismissHint();
        this.callbacks.onNextSection();
      },
      'hud-btn hud-btn-icon',
    );

    navGroup.append(this.prevBtn, this.sectionBadgeEl, this.nextBtn);

    // Pace selector group
    const paceGroup = document.createElement('div');
    paceGroup.className = 'hud-group hud-pace';
    paceGroup.setAttribute('role', 'group');
    paceGroup.setAttribute('aria-label', 'Animation playback speed');

    for (const speed of PACE_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-pace-btn';
      btn.textContent = `${speed}×`;
      btn.setAttribute('aria-label', `Set playback speed to ${speed}x`);
      btn.setAttribute('aria-pressed', speed === this.currentSpeed ? 'true' : 'false');
      if (speed === this.currentSpeed) {
        btn.classList.add('is-active');
      }
      btn.addEventListener('click', () => {
        this.setSpeed(speed);
        this.callbacks.onSpeedChange(speed);
      });
      this.paceButtons.set(speed, btn);
      paceGroup.appendChild(btn);
    }

    // Hide HUD button
    const hideBtn = this.createIconButton(
      ICONS.hideHud,
      '',
      'Hide controls for presentation (H)',
      () => this.toggleHudVisibility(),
      'hud-btn hud-btn-icon hud-btn-ghost',
    );

    this.bar.append(
      statusGroup,
      this.createDivider(),
      playbackGroup,
      this.createDivider(),
      navGroup,
      this.createDivider(),
      paceGroup,
      this.createDivider(),
      hideBtn,
    );

    // 3. Discreet floating restore pill when HUD is hidden
    this.showHudBtn = this.createIconButton(
      ICONS.showHud,
      'Controls',
      'Show presentation controls (H)',
      () => this.toggleHudVisibility(),
      'hud-restore-btn',
    );
    this.showHudBtn.hidden = true;

    this.root.append(this.hintPill, this.bar, this.showHudBtn);
    this.container.appendChild(this.root);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('pointerdown', this.handleFirstInteraction, { passive: true });
    window.addEventListener('wheel', this.handleFirstInteraction, { passive: true });
  }

  public update(
    timeline: TimelineState,
    activeSectionOrder: number | null,
    totalSections: number,
  ): void {
    this.isInteractiveNow = timeline.isInteractive;

    if (this.lastPhase !== timeline.phase) {
      this.lastPhase = timeline.phase;
      this.phaseLabelEl.textContent = PHASE_LABELS[timeline.phase];
      this.phaseDot.classList.toggle('is-interactive', timeline.phase === 'interactive');
    }

    const clampedTime = Math.min(timeline.time, 999.9);
    const clockText = `${clampedTime < 10 ? '0' : ''}${clampedTime.toFixed(1)}s`;
    if (this.lastClockText !== clockText) {
      this.lastClockText = clockText;
      this.clockEl.textContent = clockText;
    }

    if (this.lastInteractive !== timeline.isInteractive) {
      this.lastInteractive = timeline.isInteractive;
      this.skipBtn.hidden = timeline.isInteractive;
      this.overviewBtn.disabled = !timeline.isInteractive;
      this.prevBtn.disabled = !timeline.isInteractive;
      this.nextBtn.disabled = !timeline.isInteractive;

      this.hintPill.classList.toggle(
        'is-visible',
        timeline.isInteractive && !this.hintDismissed && !this.hudHidden,
      );
    }

    if (activeSectionOrder !== null) {
      this.dismissHint();
    }

    const badgeText =
      activeSectionOrder !== null ? `${activeSectionOrder}/${totalSections}` : `–/${totalSections}`;
    if (this.lastSectionBadge !== badgeText) {
      this.lastSectionBadge = badgeText;
      this.sectionBadgeEl.textContent = badgeText;
      this.sectionBadgeEl.classList.toggle('is-active', activeSectionOrder !== null);
    }
  }

  public setSpeed(speed: number): void {
    this.currentSpeed = speed;
    for (const [val, btn] of this.paceButtons) {
      const active = Math.abs(val - speed) < 0.001;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  public toggleHudVisibility(): void {
    this.hudHidden = !this.hudHidden;
    this.bar.classList.toggle('is-hidden', this.hudHidden);
    this.showHudBtn.hidden = !this.hudHidden;
    this.hintPill.classList.toggle(
      'is-visible',
      this.isInteractiveNow && !this.hintDismissed && !this.hudHidden,
    );
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('pointerdown', this.handleFirstInteraction);
    window.removeEventListener('wheel', this.handleFirstInteraction);
    this.root.remove();
  }

  private dismissHint(): void {
    if (this.hintDismissed) return;
    this.hintDismissed = true;
    this.hintPill.classList.remove('is-visible');
    this.hintPill.classList.add('is-dismissed');
  }

  private createIconButton(
    svgMarkup: string,
    label: string,
    ariaLabel: string,
    onClick: () => void,
    className: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.setAttribute('aria-label', ariaLabel);
    btn.title = ariaLabel;
    btn.innerHTML = label
      ? `<span class="hud-btn-svg">${svgMarkup}</span><span class="hud-btn-label">${label}</span>`
      : `<span class="hud-btn-svg">${svgMarkup}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private createDivider(): HTMLSpanElement {
    const div = document.createElement('span');
    div.className = 'hud-divider';
    div.setAttribute('aria-hidden', 'true');
    return div;
  }

  private readonly handleFirstInteraction = (): void => {
    if (this.isInteractiveNow && !this.hintDismissed) {
      this.dismissHint();
    }
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    switch (e.key) {
      case 'Escape':
        if (this.callbacks.onExitFocus) {
          this.callbacks.onExitFocus();
        } else {
          this.callbacks.onResetView();
        }
        break;
      case 'ArrowRight':
        if (this.isInteractiveNow) {
          e.preventDefault();
          this.dismissHint();
          this.callbacks.onNextSection();
        }
        break;
      case 'ArrowLeft':
        if (this.isInteractiveNow) {
          e.preventDefault();
          this.dismissHint();
          this.callbacks.onPrevSection();
        }
        break;
      case 'r':
      case 'R':
        this.hintDismissed = false;
        this.hintPill.classList.remove('is-dismissed');
        this.callbacks.onReplay();
        break;
      case '0':
        if (this.isInteractiveNow) {
          this.dismissHint();
          this.callbacks.onResetView();
        }
        break;
      case 'h':
      case 'H':
        this.toggleHudVisibility();
        break;
    }
  };
}
