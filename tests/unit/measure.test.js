/** The pure parts of the shared typing-latency measure (src/site/measure.js). The browser parts (nextPaint, createKeyMeter) are covered by the e2e specs. */
import { describe, it, expect } from 'vitest';
import { FRAME_MS, percentile, summarize, pushBounded, formatMs, isEditKey, sparklinePoints } from '../../src/site/measure.js';

describe('percentile / summarize', () => {
  it('nearest rank, order independent', () => {
    const xs = [9, 1, 5, 3, 7];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(9);
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 100)).toBe(9);
    expect(xs).toEqual([9, 1, 5, 3, 7]); // not mutated
  });
  it('p95 of 20 values is the 19th', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(19);
  });
  it('empty is NaN; summarize carries n and max', () => {
    expect(percentile([], 50)).toBeNaN();
    expect(summarize([]).p50).toBeNaN();
    expect(summarize([4, 8, 6])).toEqual({ n: 3, p50: 6, p95: 8, max: 8 });
  });
});

describe('pushBounded', () => {
  it('keeps the last `max` entries and does not mutate', () => {
    const a = [1, 2, 3];
    expect(pushBounded(a, 4, 3)).toEqual([2, 3, 4]);
    expect(pushBounded(a, 4, 5)).toEqual([1, 2, 3, 4]);
    expect(a).toEqual([1, 2, 3]);
  });
});

describe('formatMs', () => {
  it('formats', () => {
    expect(formatMs(4.234)).toBe('4.2');
    expect(formatMs(16.67)).toBe('16.7');
    expect(formatMs(118.4)).toBe('118');
    expect(formatMs(0.04)).toBe('<0.1');
    expect(formatMs(NaN)).toBe('n/a');
  });
  it('the frame is 1/60 s', () => {
    expect(FRAME_MS).toBeCloseTo(16.667, 2);
  });
});

describe('isEditKey', () => {
  it('printable characters and the editing keys', () => {
    for (const key of ['a', 'Z', ' ', '7', 'é', '/', 'Backspace', 'Delete', 'Enter']) expect(isEditKey({ key }), key).toBe(true);
  });
  it('not navigation, modifiers, shortcuts, composition', () => {
    for (const key of ['ArrowLeft', 'Shift', 'Control', 'Escape', 'Tab', 'Home', 'F5', 'Process', 'Dead']) expect(isEditKey({ key }), key).toBe(false);
    expect(isEditKey({ key: 'z', ctrlKey: true })).toBe(false);
    expect(isEditKey({ key: 'v', metaKey: true })).toBe(false);
    expect(isEditKey({ key: 'a', altKey: true })).toBe(false);
    expect(isEditKey({ key: 'a', isComposing: true })).toBe(false);
    expect(isEditKey({ key: 'Backspace', isComposing: true })).toBe(false);
  });
});

describe('sparklinePoints', () => {
  const box = { width: 100, height: 50, max: 40, pad: 2 };
  it('empty -> empty', () => expect(sparklinePoints([], box)).toBe(''));
  it('one point is a flat line across the box', () => {
    const [a, b] = sparklinePoints([20], box).split(' ');
    expect(a.startsWith('0,')).toBe(true);
    expect(b.startsWith('100,')).toBe(true);
    expect(a.split(',')[1]).toBe(b.split(',')[1]);
  });
  it('x spans the width, 0 is the bottom, max the top, higher = smaller y', () => {
    const pts = sparklinePoints([0, 40, 20], box).split(' ').map((p) => p.split(',').map(Number));
    expect(pts.map((p) => p[0])).toEqual([0, 50, 100]);
    expect(pts[0][1]).toBe(48); // height - pad
    expect(pts[1][1]).toBe(2); // pad
    expect(pts[2][1]).toBe(25);
  });
  it('clamps values above the scale', () => {
    const pts = sparklinePoints([1000], box).split(' ');
    expect(pts[0].split(',')[1]).toBe('2');
  });
});
