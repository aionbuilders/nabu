import { describe, it, expect } from 'vitest';
import { parseHex, relativeLuminance, contrastRatio, formatRatio, wcagLevel } from '../../src/site/brand/contrast.js';
import { PALETTE, CONTRAST_PAIRS } from '../../src/site/brand/palette.js';

describe('contrast (WCAG 2.x)', () => {
  it('parses #RGB and #RRGGBB, with or without #', () => {
    expect(parseHex('#F04E31')).toEqual([240, 78, 49]);
    expect(parseHex('fff')).toEqual([255, 255, 255]);
    expect(parseHex('#0b0b0c')).toEqual([11, 11, 12]);
    expect(() => parseHex('#12')).toThrow();
    expect(() => parseHex('coral')).toThrow();
  });

  it('relative luminance: black 0, white 1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
  });

  it('black on white is 21:1, a colour on itself 1:1, and the order does not matter', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#C2381F', '#C2381F')).toBe(1);
  });

  it('matches the reference values from the WCAG spec / known pairs', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.478, 3);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.542, 3);
  });

  it('the three ratios the brand page quotes', () => {
    const byId = Object.fromEntries(CONTRAST_PAIRS.map((p) => [p.id, p.text]));
    expect(byId).toEqual({ 'link-on-white': '5.4:1', 'pastel-on-night': '7.2:1', 'vif-on-white': '3.6:1' });
    expect(formatRatio(contrastRatio('#C2381F', '#FFFFFF'))).toBe('5.4:1');
    expect(formatRatio(contrastRatio('#FF6F61', '#0B0B0C'))).toBe('7.2:1');
    expect(formatRatio(contrastRatio('#F04E31', '#FFFFFF'))).toBe('3.6:1');
  });

  it('levels', () => {
    expect(wcagLevel(7.2)).toBe('AAA');
    expect(wcagLevel(5.4)).toBe('AA');
    expect(wcagLevel(3.6)).toBe('fail');
    expect(wcagLevel(3.6, { large: true })).toBe('AA');
    expect(wcagLevel(2.9, { large: true })).toBe('fail');
  });

  it('every swatch prints its hex in a colour that passes AA (4.5:1) on it', () => {
    for (const c of PALETTE) expect(contrastRatio(c.on, c.hex), c.id).toBeGreaterThanOrEqual(4.5);
  });
});
