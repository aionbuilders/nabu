import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// House rule for the English copy: an em dash is fine punctuation, but its overuse reads as machine-written, so a document keeps at most
// about one, never for a dramatic reveal ("Not X — Y"). The allowance is 2 rather than 1 (a little slack for a quoted example, like the
// typography demo `Nobody — not even the fog — had crossed.`). The e2e twin is the "em dashes" test of tests/e2e/site-pages.spec.ts (pages).
// Out of scope on purpose: the French sources (docs/adr/fr, *.fr.md), the audit (internal), the dated source notes, and the
// "How Nabu is made" page, which is still being written.
const MAX = 2;
const ROOT = process.cwd();

/** @param {string} dir @returns {string[]} the .md files of one folder (repo-relative) */
const mdIn = (dir) => readdirSync(resolve(ROOT, dir)).filter((/** @type {string} */ n) => n.endsWith('.md')).sort().map((/** @type {string} */ n) => join(dir, n));

const FILES = [
  ...mdIn('docs/guides'),
  ...mdIn('docs/getting-started'),
  ...mdIn('docs/recipes'),
  ...mdIn('docs/architecture/chapters'),
  ...mdIn('docs/adr'),
  'README.md',
  'CHANGELOG.md',
];

/** Em dashes of a Markdown source, outside fenced code blocks and inline code. @param {string} md */
function countEmDashes(md) {
  let fence = false;
  let n = 0;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    n += (line.replace(/(`+)[^`]*?\1/g, '').match(/—/g) ?? []).length;
  }
  return n;
}

describe('em dashes in the English Markdown sources', () => {
  it('counts outside code only', () => {
    expect(countEmDashes('a — b')).toBe(1);
    expect(countEmDashes('`a — b` and ``x — y``')).toBe(0);
    expect(countEmDashes(['```js', 'a — b', '```', 'c — d'].join('\n'))).toBe(1);
  });

  it('covers the published docs, the chapters, the decision records, the README and the changelog', () => {
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES).toContain('CHANGELOG.md');
    expect(FILES.some((f) => f.includes('docs/adr/018'))).toBe(true);
    expect(FILES.some((f) => f.includes('/fr/'))).toBe(false);
  });

  for (const file of FILES) {
    it(`${file} has at most ${MAX}`, () => {
      expect(countEmDashes(readFileSync(resolve(ROOT, file), 'utf8'))).toBeLessThanOrEqual(MAX);
    });
  }
});
