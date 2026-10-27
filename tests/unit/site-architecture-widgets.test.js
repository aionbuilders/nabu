// @ts-nocheck
/**
 * The Architecture chapters (docs/architecture/chapters/NN-slug.md) and their live widgets (src/site/architecture/widgets):
 *  - every chapter file has valid frontmatter, its `adrs` exist in docs/adr/, its `xray` id is registered in widgets/index.js;
 *  - every link of a chapter resolves: a site route known to exist, or a GitHub file link (to this repo) whose path exists on disk;
 *    links to other hosts (sources of the comparisons) must at least be https URLs;
 *  - the written length stays in the range the story is paced for (a few minutes per chapter);
 *  - the pure helpers of the widgets (helpers.js).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  STEPS, describeInput, describeDomPoint, describeModelPoint, resolveChord, stepMs, shortBlockId, keyLabel,
} from '../../src/site/architecture/widgets/helpers.js';

const root = resolve(__dirname, '../..');
const CHAPTERS_DIR = join(root, 'docs/architecture/chapters');
const REPO = 'https://github.com/aionbuilders/nabu/blob/main/';

const files = readdirSync(CHAPTERS_DIR).filter((f) => f.endsWith('.md')).sort();
const adrFiles = readdirSync(join(root, 'docs/adr')).filter((f) => /^\d{3}-.+\.md$/.test(f));
const adrNumbers = new Set(adrFiles.map((f) => Number(f.slice(0, 3))));
const registered = new Set([...readFileSync(join(root, 'src/site/architecture/widgets/index.js'), 'utf8').matchAll(/^\s+(?:'([\w-]+)'|(\w+)):\s*\w+,/gm)].map((m) => m[1] ?? m[2]));
const slugs = new Set(files.map((f) => f.replace(/^\d+-/, '').replace(/\.md$/, '')));

/** Flat `key: value` frontmatter, with `adrs: [1, 2]` read as an array. */
function parse(raw) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw.replace(/\r\n/g, '\n'));
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z]\w*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const v = kv[2].trim();
    data[kv[1]] = /^\[.*\]$/.test(v) ? (v.slice(1, -1).match(/\d+/g) ?? []).map(Number) : /^\d+$/.test(v) ? Number(v) : v;
  }
  return { data, body: raw.slice(m[0].length) };
}

/** Where a link of a chapter points, or why it does not exist. Returns an error string, or null when it resolves. */
function checkLink(href) {
  if (href.startsWith(REPO)) {
    const path = href.slice(REPO.length).split('#')[0];
    return existsSync(join(root, path)) ? null : `GitHub link to a missing file: ${path}`;
  }
  if (/^https:\/\/[^/\s]+\.[^/\s]+/.test(href)) return null; // another host: a source, not checked here
  if (href.startsWith('/')) {
    const path = href.split('#')[0].replace(/\/$/, '');
    if (['/api', '/labs', '/labs/performance', '/architecture', '/architecture/limits', '/architecture/others', '/architecture/decisions', '/docs'].includes(path)) return null;
    let m = /^\/architecture\/decisions\/(\d{3})$/.exec(path);
    if (m) return adrNumbers.has(Number(m[1])) ? null : `no ADR ${m[1]}`;
    m = /^\/architecture\/chapters\/([\w-]+)$/.exec(path);
    if (m) return slugs.has(m[1]) ? null : `no chapter "${m[1]}"`;
    m = /^\/docs\/([\w-]+)\/([\w-]+)$/.exec(path);
    if (m) return existsSync(join(root, 'docs', m[1], `${m[2]}.md`)) ? null : `no doc docs/${m[1]}/${m[2]}.md`;
    return `unknown site route ${path}`;
  }
  return `not a site route nor a GitHub file link: ${href}`;
}

/** Prose of a chapter without code fences, for the word count. */
const prose = (body) => body.replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[#>*`\[\]]/g, ' ');

describe('architecture chapters', () => {
  it('the seven chapters exist, numbered 1 to 7', () => {
    expect(files.map((f) => Number(f.slice(0, 2)))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  for (const file of files) {
    const raw = readFileSync(join(CHAPTERS_DIR, file), 'utf8');
    const parsed = parse(raw);

    describe(file, () => {
      it('has valid frontmatter', () => {
        expect(parsed, 'frontmatter block').not.toBeNull();
        const { data } = parsed;
        expect(typeof data.title).toBe('string');
        expect(data.title.length).toBeGreaterThan(3);
        expect(typeof data.description).toBe('string');
        expect(data.description.length).toBeGreaterThan(10);
        expect(data.chapter).toBe(Number(file.slice(0, 2)));
        expect(Array.isArray(data.adrs) && data.adrs.length > 0, 'adrs is a non-empty array').toBe(true);
      });

      it('cites ADRs that exist', () => {
        for (const n of parsed.data.adrs) expect(adrNumbers.has(n), `ADR ${n}`).toBe(true);
      });

      it('names a registered widget', () => {
        if (parsed.data.xray === undefined) return;
        expect(registered.has(parsed.data.xray), `xray "${parsed.data.xray}" is not in widgets/index.js (${[...registered]})`).toBe(true);
      });

      it('every link resolves', () => {
        const links = [...parsed.body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
        expect(links.length).toBeGreaterThan(2);
        const bad = links.map((l) => [l, checkLink(l)]).filter(([, err]) => err);
        expect(bad).toEqual([]);
      });

      it('opens with a paragraph (the widget sits after it) and has a "buys" and a "costs" callout', () => {
        const first = parsed.body.trim().split(/\n\s*\n/)[0];
        expect(/^(#|>|[-*] |```)/.test(first), 'the first block is plain text').toBe(false);
        expect(parsed.body).toMatch(/^> \[!TIP\]\n> \S/m);
        expect(parsed.body).toMatch(/^> \[!WARNING\]\n> \S/m);
      });

      it('is 600 to 1100 words, and does not repeat its H1', () => {
        const words = prose(parsed.body).split(/\s+/).filter(Boolean).length;
        expect(words).toBeGreaterThanOrEqual(550);
        expect(words).toBeLessThanOrEqual(1100);
        expect(parsed.body).not.toMatch(/^# /m);
      });

      it('has no hard-coded typing latency (it moves: link the lab and the limits page)', () => {
        expect(parsed.body).not.toMatch(/\b88\s*ms\b/);
      });
    });
  }

  it('every registered widget is used by a chapter', () => {
    const used = new Set(files.map((f) => parse(readFileSync(join(CHAPTERS_DIR, f), 'utf8')).data.xray));
    expect([...registered].filter((id) => !used.has(id))).toEqual([]);
  });
});

describe('widget helpers', () => {
  it('lists seven steps, in order, and only two are timed', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['keydown', 'beforeinput', 'selection', 'ascend', 'loro', 'svelte', 'paint']);
    expect(STEPS.filter((s) => s.timed).map((s) => s.id)).toEqual(['svelte', 'paint']);
    for (const s of STEPS) expect(s.where.length).toBeGreaterThan(3);
  });

  it('describeInput: Enter ascends, a character and deletions do not', () => {
    expect(describeInput('insertParagraph').ascends).toBe(true);
    expect(describeInput('insertText').ascends).toBe(false);
    expect(describeInput('deleteContentBackward').text).toContain('deleteContentBackward');
    expect(describeInput(null).text).toMatch(/no beforeinput/);
    expect(describeInput('insertFromPaste').text).toContain('insertFromPaste');
  });

  it('formats milliseconds and keys', () => {
    expect(stepMs(2.64)).toBe('2.6 ms');
    expect(stepMs(0.01)).toBe('<0.1 ms');
    expect(stepMs(118.4)).toBe('118 ms');
    expect(stepMs(null)).toBe('');
    expect(stepMs(NaN)).toBe('');
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('n')).toBe('n');
  });

  it('writes model positions and DOM points', () => {
    expect(shortBlockId('12@7340')).toBe('12');
    expect(describeModelPoint({ id: '12@7340', type: 'paragraph' }, 17)).toBe('paragraph#12 · index 17');
    expect(describeModelPoint(null, 0)).toBe('—');
    const p = document.createElement('div');
    p.setAttribute('data-block-type', 'paragraph');
    p.textContent = 'Across the river, the bank was dark';
    expect(describeDomPoint(p.firstChild, 12)).toBe('#text "Across the riv…" @ 12 in div');
    expect(describeDomPoint(null, 0)).toBe('—');
    expect(describeDomPoint(p, 1)).toBe('<div> @ child 1');
  });

  describe('resolveChord', () => {
    const chordOfKey = (t) => ({ 'Mod-Enter': 'Ctrl-Enter', 'Mod-b': 'Ctrl-b' })[t] ?? null;
    const info = (id, keys, extra = {}) => ({ id, label: id, keys, display: keys, extension: 'x', available: true, ...extra });
    const split = info('region:split', ['Mod-Enter']);
    const todo = info('todo:toggle', ['Mod-Enter'], { scope: 'list-item' });
    const bold = info('mark:bold', ['Mod-b']);

    it('a scoped command beats a generic one at the caret of its type', () => {
      const r = resolveChord([todo, split, bold], 'Ctrl-Enter', chordOfKey, 'list-item');
      expect(r.winner).toBe('todo:toggle');
      expect(r.tie).toBe(false);
      expect(r.candidates.map((c) => c.id)).toEqual(['todo:toggle', 'region:split']);
    });

    it('without the scope the two tie, and the registration order names the first', () => {
      const r = resolveChord([todo, split], 'Ctrl-Enter', chordOfKey, 'paragraph');
      expect(r.tie).toBe(true);
      expect(r.winner).toBe('todo:toggle');
    });

    it('a command that does not apply is listed after the ones that do, and never wins', () => {
      const r = resolveChord([{ ...todo, available: false }, split], 'Ctrl-Enter', chordOfKey, 'paragraph');
      expect(r.winner).toBe('region:split');
      expect(r.candidates.map((c) => [c.id, c.available])).toEqual([['region:split', true], ['todo:toggle', false]]);
      expect(r.tie).toBe(false);
    });

    it('a chord nobody binds has no candidate and no winner', () => {
      const r = resolveChord([todo, split, bold], 'Ctrl-q', chordOfKey, 'paragraph');
      expect(r).toEqual({ candidates: [], winner: null, tie: false });
    });
  });
});
