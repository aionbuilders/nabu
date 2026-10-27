/**
 * WCAG 2.x contrast, computed from hex colours. The brand page never hardcodes a ratio: it calls `contrastRatio`.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/**
 * @param {string} hex `#RGB` or `#RRGGBB`
 * @returns {[number, number, number]} channels 0-255
 */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance of an sRGB colour (0 = black, 1 = white). @param {string} hex */
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 to 21, whichever is the lighter. @param {string} a @param {string} b */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `5.4:1`: one decimal, rounded to nearest. @param {number} ratio */
export function formatRatio(ratio) {
  return `${ratio.toFixed(1)}:1`;
}

/** @param {number} ratio @param {{ large?: boolean }} [opts] "AAA" | "AA" | "fail" for text (large = 18px bold / 24px). */
export function wcagLevel(ratio, { large = false } = {}) {
  if (ratio >= (large ? 4.5 : 7)) return 'AAA';
  if (ratio >= (large ? 3 : 4.5)) return 'AA';
  return 'fail';
}
