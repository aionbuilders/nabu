// Builds the Nabu lockup SVGs with the wordmark outlined (Syne 700), following the construction rule:
// mark height = 1.2 × ascender ("b"), centred on the middle of the x-height; gap = 0.3 × mark height to the ink of the "n";
// tracking −0.02 em.
import opentype from 'opentype.js';
import fs from 'fs';

const OUT = process.argv[2];
const font = opentype.loadSync('syne-700.ttf');
const upm = font.unitsPerEm;
const A = 100;                 // ascender height in output units
const SCALE = 1.2;             // mark height / ascender
const GAP = 0.3;               // gap / mark height
const TRACK = -0.02;           // em

const glyph = (c) => font.charToGlyph(c);
const bAsc = glyph('b').getBoundingBox().y2;
const xH = glyph('x').getBoundingBox().y2;
const size = A / (bAsc / upm);
const k = size / upm;
const xhPx = xH * k;
const H = A * SCALE;
const markW = H * 100 / 74;
const markTop = -(xhPx / 2 + H / 2);
const nLsb = glyph('n').getBoundingBox().x1 * k;
const textX = markW + GAP * H - nLsb;

// wordmark path with kerning + tracking
let x = textX;
const glyphs = font.stringToGlyphs('nabu');
const parts = [];
glyphs.forEach((g, i) => {
  parts.push(g.getPath(x, 0, size).toPathData(2));
  x += g.advanceWidth * k + TRACK * size;
  if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * k;
});
const textD = parts.join('');
const textBox = font.getPath('nabu', 0, 0, size).getBoundingBox(); // only for vertical extents

const MARK = 'M20.31 28.86L27.75 13.25L47.79 13.19L60.16 28.71L52.71 44.31L40.34 28.8ZM60.16 28.71L67.6 13.1L87.63 13.04L100 28.56L92.56 44.16L80.19 28.65ZM79.69 71.14L72.25 86.75L52.21 86.81L39.84 71.29L47.29 55.69L59.66 71.2ZM39.84 71.29L32.4 86.9L12.37 86.96L0 71.44L7.44 55.84L19.81 71.35Z';
const s = H / 74;
const markTransform = `translate(0 ${markTop.toFixed(3)}) scale(${s.toFixed(5)}) translate(0 -13)`;

const top = Math.min(markTop, textBox.y1);
const bottom = Math.max(markTop + H, textBox.y2);
const right = x - TRACK * size; // drop the trailing tracking
const vb = `0 ${top.toFixed(2)} ${right.toFixed(2)} ${(bottom - top).toFixed(2)}`;

const lockup = (markFill, textFill, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${label}"><path fill="${markFill}" transform="${markTransform}" d="${MARK}"/><path fill="${textFill}" d="${textD}"/></svg>\n`;

fs.writeFileSync(`${OUT}/nabu-logo-light.svg`, lockup('#F04E31', '#1A1A1A', 'Nabu'));
fs.writeFileSync(`${OUT}/nabu-logo-dark.svg`, lockup('#FF6F61', '#F2F2F2', 'Nabu'));
fs.writeFileSync(`${OUT}/nabu-logo-mono.svg`, lockup('currentColor', 'currentColor', 'Nabu'));

// App icon / favicon: coral rounded square, white mark (62% of the side), optically centred.
const icon = (radius) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Nabu"><rect width="512" height="512" rx="${radius}" fill="#F04E31"/><path fill="#FFFFFF" transform="translate(97 140.5) scale(3.18) translate(0 -13)" d="${MARK}"/></svg>\n`;
fs.writeFileSync(`${OUT}/nabu-icon.svg`, icon(116));
fs.writeFileSync(`${OUT}/nabu-icon-square.svg`, icon(0));

console.log(JSON.stringify({ upm, bAsc, xH, size: +size.toFixed(2), H, markW: +markW.toFixed(2), gap: +(GAP * H).toFixed(2), nLsb: +nLsb.toFixed(2), vb }));
