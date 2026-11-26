import * as THREE from 'three';
import { PAPER_REST_Y, pageUVToWorld } from '../config/theme';
import { clamp01 } from '../config/timing';
import type { NewspaperSection, TimelineState } from '../types';

export interface HotspotCallbacks {
  onSelect: (section: NewspaperSection) => void;
  onExit: () => void;
}

interface HotspotItem {
  section: NewspaperSection;
  worldAnchor: THREE.Vector3;
  button: HTMLButtonElement;
  tooltip: HTMLSpanElement;
  staggerDelay: number;
}

const EXIT_ICON_SVG = `<svg class="hotspot-exit-svg" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
</svg>`;

function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function formatOrder(order: number): string {
  return order < 10 ? `0${order}` : `${order}`;
}

export class HotspotOverlay {
  private readonly container: HTMLElement;
  private readonly callbacks: HotspotCallbacks;
  private readonly items: HotspotItem[] = [];
  private readonly projected = new THREE.Vector3();
  private lastActiveSectionId: string | null = null;

  constructor(
    container: HTMLElement,
    sections: NewspaperSection[],
    callbacks: HotspotCallbacks,
  ) {
    this.container = container;
    this.callbacks = callbacks;

    const count = Math.max(1, sections.length);

    sections.forEach((section, index) => {
      const worldPos = pageUVToWorld(
        section.page,
        section.dotAnchor.u,
        section.dotAnchor.v,
        PAPER_REST_Y + 0.03,
      );

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hotspot-dot';
      button.dataset.sectionId = section.id;
      button.setAttribute(
        'aria-label',
        `Focus section ${formatOrder(section.order)}: ${section.headline}`,
      );
      button.style.visibility = 'hidden';
      button.style.opacity = '0';

      const pulse = document.createElement('span');
      pulse.className = 'hotspot-pulse';
      pulse.setAttribute('aria-hidden', 'true');

      const core = document.createElement('span');
      core.className = 'hotspot-core';
      core.setAttribute('aria-hidden', 'true');
      core.innerHTML = EXIT_ICON_SVG;

      const tooltip = document.createElement('span');
      tooltip.className = 'hotspot-tooltip';
      tooltip.setAttribute('aria-hidden', 'true');

      const numSpan = document.createElement('span');
      numSpan.className = 'hotspot-tooltip-num';
      numSpan.textContent = formatOrder(section.order);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'hotspot-tooltip-title';
      titleSpan.textContent = section.headline;

      tooltip.append(numSpan, titleSpan);
      button.append(pulse, core, tooltip);

      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.lastActiveSectionId === section.id) {
          this.callbacks.onExit();
        } else {
          this.callbacks.onSelect(section);
        }
      });

      // Prevent canvas drag/dblclick from firing when interacting with dots
      button.addEventListener('pointerdown', (e) => e.stopPropagation());
      button.addEventListener('dblclick', (e) => e.stopPropagation());

      this.container.appendChild(button);

      const staggerDelay = count > 1 ? (index / (count - 1)) * 0.34 : 0;
      this.items.push({
        section,
        worldAnchor: new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z),
        button,
        tooltip,
        staggerDelay,
      });
    });
  }

  public update(
    camera: THREE.PerspectiveCamera,
    timeline: TimelineState,
    activeSectionId: string | null,
  ): void {
    this.lastActiveSectionId = activeSectionId;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const dotsProgress = timeline.dotsProgress;

    for (const item of this.items) {
      const { button, section, worldAnchor, staggerDelay } = item;

      if (dotsProgress <= 0.001) {
        if (button.style.visibility !== 'hidden') {
          button.style.visibility = 'hidden';
          button.style.opacity = '0';
          button.style.pointerEvents = 'none';
        }
        continue;
      }

      // Project 3D anchor to screen space
      this.projected.copy(worldAnchor).project(camera);

      // Hide if behind camera or far outside viewport
      const isOffscreen =
        this.projected.z > 1 ||
        this.projected.z < -1 ||
        this.projected.x < -1.15 ||
        this.projected.x > 1.15 ||
        this.projected.y < -1.15 ||
        this.projected.y > 1.15;

      if (isOffscreen) {
        if (button.style.visibility !== 'hidden') {
          button.style.visibility = 'hidden';
          button.style.pointerEvents = 'none';
        }
        continue;
      }

      const screenX = (this.projected.x * 0.5 + 0.5) * width;
      const screenY = (-this.projected.y * 0.5 + 0.5) * height;

      // Per-dot staggered pop-in
      const localRaw = clamp01((dotsProgress - staggerDelay) / Math.max(0.01, 1 - staggerDelay));
      const popScale = easeOutBack(localRaw);

      const isActive = activeSectionId === section.id;
      const isDimmed = activeSectionId !== null && !isActive;

      button.classList.toggle('is-active', isActive);
      button.classList.toggle('is-dimmed', isDimmed);

      // Keep ARIA label synchronized with active/exit state
      const expectedLabel = isActive
        ? 'Exit section view'
        : `Focus section ${formatOrder(section.order)}: ${section.headline}`;
      if (button.getAttribute('aria-label') !== expectedLabel) {
        button.setAttribute('aria-label', expectedLabel);
      }

      // Flip tooltip alignment near edges so it never clips off-screen
      button.dataset.tooltipAlign = screenX > width - 270 ? 'left' : 'right';
      button.dataset.tooltipPos = screenY < 96 ? 'bottom' : 'top';

      const targetOpacity = localRaw * (isDimmed ? 0.25 : 1.0);
      button.style.visibility = localRaw > 0.01 ? 'visible' : 'hidden';
      button.style.opacity = targetOpacity.toFixed(3);
      button.style.pointerEvents = timeline.isInteractive && localRaw > 0.5 ? 'auto' : 'none';
      button.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0) translate(-50%, -50%) scale(${popScale.toFixed(3)})`;
    }
  }

  public dispose(): void {
    for (const item of this.items) {
      item.button.remove();
    }
    this.items.length = 0;
  }
}
