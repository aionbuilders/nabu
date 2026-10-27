// The brand files, read as text at build time (Vite `?raw`) so the page draws the REAL artwork: no path data is copied by hand.
import lockupLight from '../../../brand/nabu-logo-light.svg?raw';
import lockupDark from '../../../brand/nabu-logo-dark.svg?raw';
import lockupMono from '../../../brand/nabu-logo-mono.svg?raw';
import mark from '../../../brand/nabu-mark.svg?raw';

export { lockupLight, lockupDark, lockupMono, mark };

const LABEL = / role="img" aria-label="[^"]*"/;

/** Marks the SVG as decorative (the surrounding text says what it is). @param {string} svg */
export function decorative(svg) {
  return svg.replace(LABEL, ' aria-hidden="true"');
}

/**
 * A lockup whose two fills are classes (`.mark`, `.word`) instead of colours, so CSS can colour them (theme tokens, or the
 * deliberate mistakes of the "Please don't" section). `label` replaces the accessible name; without it the SVG is decorative.
 * @param {string} svg a brand/nabu-logo-*.svg
 * @param {string} [label]
 */
export function classed(svg, label) {
  let i = 0;
  const out = svg.replace(/<path fill="[^"]*"/g, () => `<path class="${i++ === 0 ? 'mark' : 'word'}"`);
  return label ? out.replace(LABEL, ` role="img" aria-label="${label}"`) : decorative(out);
}

/** The content of the SVG (without the outer tags), to draw it inside a bigger drawing in the same coordinates. @param {string} svg */
export function inner(svg) {
  return svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

/** @param {string} svg @returns {string} the viewBox attribute value */
export function viewBoxOf(svg) {
  const m = /viewBox="([^"]+)"/.exec(svg);
  if (!m) throw new Error('No viewBox');
  return m[1];
}
