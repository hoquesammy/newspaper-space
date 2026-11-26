import type { CameraFocusTarget, NewspaperSection, PageSide } from '../types';

export const TABLE_TOP_Y = 0;
export const TABLE_WIDTH = 16.0;
export const TABLE_DEPTH = 11.0;
export const TABLE_THICKNESS = 0.24;

export const PAGE_WIDTH = 4.4;
export const PAGE_HEIGHT = 7.2;
export const SPREAD_WIDTH = 8.8;
export const PAPER_REST_Y = 0.018;

export const LIGHTING_CONFIG = {
  background: 0x13161f,
  fogColor: 0x181a24,
  fogNear: 14,
  fogFar: 38,
  ambientColor: 0xe6d2b5,
  ambientIntensity: 0.46,
  hemiSkyColor: 0xa9bce0,
  hemiGroundColor: 0x7c5532,
  hemiIntensity: 0.62,
  keyLightColor: 0xffb357,
  keyLightIntensity: 2.85,
  keyLightPosition: { x: -5.5, y: 8.8, z: 4.5 },
  fillLightColor: 0x86a8d6,
  fillLightIntensity: 0.85,
  fillLightPosition: { x: 6.8, y: 6.2, z: -4.2 },
  rimLightColor: 0xffa642,
  rimLightIntensity: 0.85,
  rimLightPosition: { x: 0.5, y: 4.0, z: -7.5 },
  toneMappingExposure: 1.16,
} as const;

export const PAPER_COLORS = {
  base: '#f2ead8',
  warmTint: '#e8dcc2',
  agedEdge: '#d7c6a3',
  gutterShadow: '#bfb091',
  inkPrimary: '#1a1815',
  inkSecondary: '#3b352c',
  inkMuted: '#635a4b',
  accentGold: '#b8862b',
  accentBlue: '#2c4f73',
  ruleLine: '#2b2620',
  halftoneDark: '#24201b',
  halftoneLight: '#dfd3ba',
} as const;

export const CARDBOARD_COLORS = {
  base: '#9c7c52',
  highlight: '#b49367',
  shadow: '#6e5435',
  corrugation: '#584128',
  fiberSpeck: '#7d6240',
  edgeCut: '#846642',
} as const;

/**
 * Maps normalized page UV coordinates (u ∈ [0,1], v ∈ [0,1]) to 3D world coordinates
 * on the open newspaper spread resting on the table.
 * - Left page: u ∈ [0,1] -> x ∈ [-PAGE_WIDTH, 0]
 * - Right page: u ∈ [0,1] -> x ∈ [0, PAGE_WIDTH]
 * - Both pages: v ∈ [0,1] -> z ∈ [-PAGE_HEIGHT/2, +PAGE_HEIGHT/2]
 */
export function pageUVToWorld(
  page: PageSide,
  u: number,
  v: number,
  y: number = PAPER_REST_Y,
): { x: number; y: number; z: number } {
  const x = page === 'left' ? -PAGE_WIDTH + u * PAGE_WIDTH : u * PAGE_WIDTH;
  const z = -PAGE_HEIGHT / 2 + v * PAGE_HEIGHT;
  return { x, y, z };
}

/**
 * Converts a NewspaperSection's normalized UV rectangle into a world-space
 * CameraFocusTarget centered on that section.
 */
export function sectionToFocusTarget(section: NewspaperSection): CameraFocusTarget {
  const centerU = section.rect.u + section.rect.w * 0.5;
  const centerV = section.rect.v + section.rect.h * 0.5;
  const worldCenter = pageUVToWorld(section.page, centerU, centerV, PAPER_REST_Y);

  return {
    sectionId: section.id,
    worldCenter,
    worldWidth: section.rect.w * PAGE_WIDTH,
    worldHeight: section.rect.h * PAGE_HEIGHT,
  };
}
