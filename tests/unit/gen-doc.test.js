/** The Performance lab's document generator (src/site/gen-doc.js): deterministic and shaped like a real document. */
import { describe, it, expect } from 'vitest';
import { genDoc, rng } from '../../src/site/gen-doc.js';

/** @param {any[]} bs @param {(b: any) => void} f */
const walk = (bs, f) => { for (const b of bs) { f(b); if (b.children) walk(b.children, f); } };

describe('rng', () => {
  it('same seed, same sequence; values in [0, 1)', () => {
    const a = rng(5), b = rng(5);
    for (let i = 0; i < 50; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe('genDoc', () => {
  it('is deterministic: same options, identical JSON; another seed differs', () => {
    const a = JSON.stringify(genDoc({ blocks: 500, regions: true }).doc);
    expect(JSON.stringify(genDoc({ blocks: 500, regions: true }).doc)).toBe(a);
    expect(JSON.stringify(genDoc({ blocks: 500, regions: true, seed: 2 }).doc)).not.toBe(a);
  });

  for (const n of [1000, 5000, 10000]) {
    it(`${n} blocks: at least ${n} nodes (a few more at most), counted like the tree`, () => {
      const g = genDoc({ blocks: n, regions: true });
      let count = 0;
      walk(g.doc.blocks, () => count++);
      expect(count).toBe(g.nodes);
      expect(g.nodes).toBeGreaterThanOrEqual(n);
      expect(g.nodes).toBeLessThan(n * 1.05);
    });
  }

  it('is realistic: paragraphs of 40-80 words, ~10% headings, lists, regions, a few marks', () => {
    const g = genDoc({ blocks: 5000, regions: true });
    const types = new Map();
    let paragraphs = 0, bad = 0, marks = 0;
    walk(g.doc.blocks, (b) => {
      types.set(b.type, (types.get(b.type) ?? 0) + 1);
      if (b.type === 'paragraph') {
        paragraphs++;
        const text = b.content.map((/** @type {any} */ r) => r.text).join('');
        const words = text.trim().split(/\s+/).length;
        if (words < 40 || words > 80) bad++;
        if (b.content.some((/** @type {any} */ r) => r.bold || r.italic)) marks++;
      }
    });
    expect(bad).toBe(0);
    expect(marks).toBeGreaterThan(paragraphs * 0.05);
    const headings = types.get('heading') ?? 0;
    expect(headings / g.nodes).toBeGreaterThan(0.06);
    expect(headings / g.nodes).toBeLessThan(0.14);
    expect(types.get('list')).toBeGreaterThan(10);
    expect(types.get('toggle')).toBeGreaterThan(5);
    expect(types.get('code')).toBeGreaterThan(5);
    expect(g.regions).toBe(3 * (1 + 4 * (1 + 3)));
    expect(types.get('region')).toBe(g.regions);
  });

  it('without regions, no region; never two lists in a row (the importer would merge them)', () => {
    const g = genDoc({ blocks: 2000 });
    expect(g.regions).toBe(0);
    for (let i = 1; i < g.doc.blocks.length; i++) {
      expect(g.doc.blocks[i].type === 'list' && g.doc.blocks[i - 1].type === 'list').toBe(false);
    }
  });
});
