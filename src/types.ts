export type PageSide = 'left' | 'right';

export interface NormalizedRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

export type IllustrationType =
  | 'wall-silhouettes'
  | 'checkpoint-map'
  | 'crowd-celebration'
  | 'timeline-strip'
  | 'press-camera'
  | 'europe-map';

export interface NewspaperSection {
  id: string;
  order: number;
  page: PageSide;
  kicker: string;
  headline: string;
  byline: string;
  lead: string;
  paragraphs: string[];
  pullQuote?: string;
  caption?: string;
  illustrationType?: IllustrationType;
  rect: NormalizedRect;
  dotAnchor: { u: number; v: number };
}

export interface NewspaperEdition {
  masthead: string;
  subMasthead: string;
  editionLine: string;
  dateLine: string;
  priceBox: string;
  bannerHeadline: string;
  bannerSubhead: string;
  frontCoverHeadline: string;
  frontCoverSubhead: string;
  frontCoverDeck: string;
  sections: NewspaperSection[];
  floatingPhrases: string[];
}

export type AnimationPhase =
  | 'drop'
  | 'hold'
  | 'sweep'
  | 'settle'
  | 'reveal'
  | 'interactive';

export interface TimelineState {
  time: number;
  phase: AnimationPhase;
  dropProgress: number;
  openCoverProgress: number;
  sweepProgress: number;
  sweepVelocity: number;
  settleProgress: number;
  zoomOutProgress: number;
  mastheadReveal: number;
  sectionReveals: number[];
  dotsProgress: number;
  isInteractive: boolean;
}

export interface CameraFocusTarget {
  sectionId: string;
  worldCenter: { x: number; y: number; z: number };
  worldWidth: number;
  worldHeight: number;
}
