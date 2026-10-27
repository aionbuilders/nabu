/**
 * Construction of the lockup. Every value here is read from brand/source/build-logo.mjs, which generates the SVGs:
 *
 *   const A = 100;       // ascender height in output units ("b")           -> ASCENDER
 *   const SCALE = 1.2;   // mark height / ascender                           -> MARK_SCALE
 *   const GAP = 0.3;     // gap / mark height                                -> GAP
 *   const H = A * SCALE;                                                     -> MARK_HEIGHT
 *   const markW = H * 100 / 74;      // the mark's viewBox is 100 x 74      -> MARK_WIDTH
 *   const markTop = -(xhPx / 2 + H / 2);   // centred on the middle of the x-height
 *   const textX = markW + GAP * H - nLsb;  // nLsb = 0 for Syne's "n"        -> WORD_X
 *
 * `xhPx` is Syne 700's x-height at that scale (xH * size / upm). The script does not print it, but `markTop` (-95.653, in
 * nabu-logo-*.svg: `translate(0 -95.653)`) fixes it: xhPx = -2 * markTop - H = 71.306. The unit test
 * (tests/unit/brand-construction.test.js) checks these numbers against the shipped SVG, so a change to the generator that
 * is not reflected here fails.
 */
export const ASCENDER = 100;
export const MARK_SCALE = 1.2;
export const GAP = 0.3;
export const MARK_HEIGHT = ASCENDER * MARK_SCALE; // 120
export const MARK_WIDTH = (MARK_HEIGHT * 100) / 74; // 162.16
export const GAP_PX = GAP * MARK_HEIGHT; // 36
export const WORD_X = MARK_WIDTH + GAP_PX; // 198.16
export const X_HEIGHT = 71.306;
export const MARK_TOP = -(X_HEIGHT / 2 + MARK_HEIGHT / 2); // -95.653
export const X_CENTRE = -X_HEIGHT / 2; // the line the mark is centred on, -35.65
export const BASELINE = 0;
export const ASCENDER_Y = -ASCENDER;

/** The overlay, in the lockup's own coordinates (origin on the baseline, left edge of the mark). */
export const GUIDES = [
  { id: 'ascender', y: ASCENDER_Y, label: 'ascender' },
  { id: 'x-height', y: -X_HEIGHT, label: 'x-height' },
  { id: 'centre', y: X_CENTRE, label: 'x-height ÷ 2', accent: true },
  { id: 'baseline', y: BASELINE, label: 'baseline' }
];
