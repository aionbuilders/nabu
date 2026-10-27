import { contrastRatio, formatRatio } from './contrast.js';

/** The six brand colours (BrandRest, 04 · Palette). `on` is the colour of the hex label printed on the swatch. */
export const PALETTE = [
  { id: 'coral-vif', name: 'Coral vif', hex: '#F04E31', role: 'The mark on light backgrounds.', on: '#0B0B0C' },
  { id: 'coral-pastel', name: 'Coral pastel', hex: '#FF6F61', role: 'The mark and accents on dark.', on: '#0B0B0C' },
  { id: 'link-coral', name: 'Link coral', hex: '#C2381F', role: 'Links and small text on light (AA).', on: '#FFFFFF' },
  { id: 'ink', name: 'Ink', hex: '#1A1A1A', role: 'The word on light.', on: '#F2F2F2', outline: true },
  { id: 'paper', name: 'Paper', hex: '#F2F2F2', role: 'The word on dark.', on: '#0B0B0C' },
  { id: 'night', name: 'Night', hex: '#0B0B0C', role: 'The site’s background.', on: '#A9A9AE', outline: true }
];

const hexOf = (/** @type {string} */ id) => {
  const c = PALETTE.find((p) => p.id === id);
  if (!c) throw new Error(`Unknown brand colour: ${id}`);
  return c.hex;
};

export const WHITE = '#FFFFFF';

/** The three pairs the page quotes. Ratios are computed, never typed. */
export const CONTRAST_PAIRS = [
  { id: 'link-on-white', fg: hexOf('link-coral'), bg: WHITE },
  { id: 'pastel-on-night', fg: hexOf('coral-pastel'), bg: hexOf('night') },
  { id: 'vif-on-white', fg: hexOf('coral-vif'), bg: WHITE }
].map((p) => {
  const ratio = contrastRatio(p.fg, p.bg);
  return { ...p, ratio, text: formatRatio(ratio) };
});

/** @param {string} id */
export const pair = (id) => {
  const p = CONTRAST_PAIRS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown contrast pair: ${id}`);
  return p;
};
