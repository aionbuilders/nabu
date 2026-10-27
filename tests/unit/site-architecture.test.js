import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStatus, parseAdr, resolveAdrLink, prepareAdrBody, describeAdr, recordsModel, adrHref, githubBlob } from '../../src/site/architecture/adr.js';
import { parseAdrList, parseChapter, splitLead, resolveChapterLink, prepareChapterBody, storyList, nextAfter, prevBefore, adrLine, chapterHref } from '../../src/site/architecture/chapters.js';
import { inlineParts } from '../../src/site/architecture/inline.js';
import { CHAPTERS_FALLBACK, ADR_SHORT, SWITCH, ENTRY_CARDS, STORY_LINKS, ADR_NOTES } from '../../src/site/architecture/data.js';
import { LIMITS, STATUSES, LIMITS_UPDATED, sourceUrl } from '../../src/site/architecture/limits.js';
import { CELLS, EDITORS, ROWS, OPTIONS, DIFFERENT, AHEAD, WHICH, SVEDIT_DEPTH, COMPARISON_NOTES } from '../../src/site/architecture/comparison.js';

// The pure parts of the Architecture section (src/site/architecture/*.js) and its data files. The pages and their server rendering are
// tested in tests/e2e/site-architecture.spec.ts.

const ROOT = process.cwd();
const read = (/** @type {string} */ p) => readFileSync(resolve(ROOT, p), 'utf8');
const ADR_FILES = readdirSync(resolve(ROOT, 'docs/adr')).filter((n) => /^\d{3}-.+\.md$/.test(n)).sort();
const ADRS = ADR_FILES.map((n) => parseAdr(read(`docs/adr/${n}`), `docs/adr/${n}`));

describe('the status of a decision record', () => {
  it('reads accepted, proposed and superseded from the Status text', () => {
    expect(parseStatus('Accepted')).toEqual({ status: 'accepted', supersededBy: null });
    expect(parseStatus('Accepted (2026-10-20, validated by the owner)').status).toBe('accepted');
    expect(parseStatus('Proposed — **deferred** (after the beta critical path).')).toEqual({ status: 'proposed', supersededBy: null });
    expect(parseStatus('Superseded by ADR 018')).toEqual({ status: 'superseded', supersededBy: 18 });
    expect(parseStatus('superseded by ADR 5')).toEqual({ status: 'superseded', supersededBy: 5 });
    expect(parseStatus('Rejected').status).toBe('unknown');
  });

  it('finds the successor inside a longer status, as ADR 016 writes it, and never mistakes "Supersedes" for it', () => {
    const t = 'Accepted (2026-10-22, validated by the owner) — **data model superseded by ADR 018** (2026-10-23: regions are containers in Loro).';
    expect(parseStatus(t)).toEqual({ status: 'superseded', supersededBy: 18 });
    expect(parseStatus('Accepted. Supersedes ADR 016.').status).toBe('accepted');
  });
});

describe('parseAdr', () => {
  const RAW = [
    '# ADR 016 — Regions: structuring a continuous text with markers', '',
    '**Status:** Accepted (2026-10-22) — **data model superseded by ADR 018**',
    '**Date:** 2026-10-22',
    '**Original:** [French](fr/016-regions.md)',
    '**Supersedes:** the **data model** of ADR 014 (§2)',
    '**Related:** `docs/design/variables.md`', '', '---', '',
    '## 1. Context', '', '**Note:** a bold label that starts a paragraph is body, not header.', '',
  ].join('\n');

  it('takes the header off the body', () => {
    const a = parseAdr(RAW, 'docs/adr/016-regions.md');
    expect(a).toMatchObject({ number: 16, id: '016', slug: 'regions', title: 'Regions: structuring a continuous text with markers', status: 'superseded', supersededBy: 18, date: '2026-10-22', original: 'fr/016-regions.md', supersedes: [14] });
    expect(a.body.startsWith('## 1. Context')).toBe(true);
    expect(a.body).toContain('**Note:** a bold label');
    expect(a.body).not.toContain('**Status:**');
  });

  it('refuses a file that is not an ADR', () => {
    expect(() => parseAdr(RAW, 'docs/adr/regions.md')).toThrow(/NNN-slug/);
    expect(() => parseAdr('no title', 'docs/adr/001-x.md')).toThrow(/H1/);
  });

  it('parses every real record: a known status, a date, a French original that exists', () => {
    expect(ADRS.length).toBeGreaterThanOrEqual(17);
    for (const a of ADRS) {
      expect(['accepted', 'superseded', 'proposed'], a.file).toContain(a.status);
      expect(a.date, a.file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.title, a.file).toBeTruthy();
      expect(a.title, a.file).not.toMatch(/^ADR/);
      expect(a.body.trim().length, a.file).toBeGreaterThan(50);
      expect(describeAdr(a.body).length, `${a.file}: a description`).toBeGreaterThan(20);
      expect(a.original, a.file).toMatch(/^fr\/\d{3}-.+\.md$/);
      expect(existsSync(resolve(ROOT, 'docs/adr', /** @type {string} */ (a.original))), a.file).toBe(true);
      expect(a.body, a.file).not.toMatch(/^\*\*(Status|Date|Original):\*\*/m);
    }
  });

  it('knows ADR 016 is superseded by 018, 018 supersedes it, 013 is only proposed', () => {
    const by = (/** @type {number} */ n) => /** @type {any} */ (ADRS.find((a) => a.number === n));
    expect(by(16)).toMatchObject({ status: 'superseded', supersededBy: 18 });
    expect(by(18)).toMatchObject({ status: 'accepted', supersededBy: null, supersedes: [16] });
    expect(by(13).status).toBe('proposed');
    expect(ADRS.filter((a) => a.status === 'superseded').map((a) => a.number)).toEqual([16]);
    expect(ADRS.find((a) => a.number === 12)).toBeUndefined(); // ADR 012 was never written
  });
});

describe('links inside a record', () => {
  it('sends another record to its page and any other repo file to GitHub', () => {
    expect(resolveAdrLink('017-commands-keymap-confirmations.md#x')).toBe('/architecture/decisions/017#x');
    expect(resolveAdrLink('./007-event-ascension.md')).toBe('/architecture/decisions/007');
    expect(resolveAdrLink('fr/016-regions.md')).toBe(githubBlob('docs/adr/fr/016-regions.md'));
    expect(resolveAdrLink('../design/copy-paste.md')).toBe(githubBlob('docs/design/copy-paste.md'));
    expect(resolveAdrLink('../../src/lib/x.js')).toBe(githubBlob('src/lib/x.js'));
  });
  it('leaves absolute urls, routes and anchors alone', () => {
    for (const h of ['https://loro.dev', '/docs/guides/regions', '#context', 'mailto:a@b.c']) expect(resolveAdrLink(h)).toBeNull();
  });
  it('rewrites links in the text, not in code', () => {
    const md = ['See [ADR 7](007-event-ascension.md) and `[x](008-y.md)`.', '```', '[z](009-z.md)', '```'].join('\n');
    expect(prepareAdrBody(md)).toBe(['See [ADR 7](/architecture/decisions/007) and `[x](008-y.md)`.', '```', '[z](009-z.md)', '```'].join('\n'));
  });
  it('describes a record by the first paragraph of its first section, cut', () => {
    const d = describeAdr('## Context\n\nFirst **bold** paragraph with `code` and a [link](x.md).\n\nSecond.');
    expect(d).toBe('First bold paragraph with code and a link.');
    expect(describeAdr('## Context\nGlued paragraph.\n\n- x')).toBe('Glued paragraph.');
    expect(describeAdr('## C\n\n' + 'word '.repeat(80)).length).toBeLessThanOrEqual(175);
  });
});

describe('recordsModel', () => {
  const model = recordsModel(ADRS);
  it('counts, neighbours and the date a record was replaced', () => {
    expect(model.counts.all).toBe(ADRS.length);
    expect(model.counts.superseded).toBe(1);
    expect(model.counts.proposed).toBe(1);
    expect(model.counts.accepted + model.counts.superseded + model.counts.proposed).toBe(model.counts.all);
    expect(model.neighbours(1).prev).toBeNull();
    expect(model.neighbours(11).next?.number).toBe(13); // there is no 012
    expect(model.neighbours(13).prev?.number).toBe(11);
    expect(model.neighbours(18).next).toBeNull();
    expect(model.replacedOn(/** @type {any} */ (model.get(16)))).toBe(model.get(18)?.date);
    expect(model.replacedOn(/** @type {any} */ (model.get(1)))).toBeNull();
    expect(adrHref(16)).toBe('/architecture/decisions/016');
  });
});

describe('chapter files', () => {
  const RAW = ['---', 'title: The life of a keystroke', 'description: "From your key to the paint."', 'chapter: 3', 'adrs: [7, 8]', 'xray: keystroke', '---', '', '# The life of a keystroke', '', 'Lead paragraph.', ''].join('\n');

  it('reads the contract: title, description, chapter, adrs, xray', () => {
    const c = parseChapter(RAW, 'docs/architecture/chapters/03-the-life-of-a-keystroke.md');
    expect(c).toMatchObject({ n: 3, slug: 'the-life-of-a-keystroke', title: 'The life of a keystroke', description: 'From your key to the paint.', adrs: [7, 8], xray: 'keystroke', href: '/architecture/chapters/the-life-of-a-keystroke' });
    expect(chapterHref('x')).toBe('/architecture/chapters/x');
  });
  it('reads the adrs inline or as a block list, and no xray as null', () => {
    expect(parseAdrList('---\nadrs: [16,  18]\n---\n')).toEqual([16, 18]);
    expect(parseAdrList('---\ntitle: x\nadrs:\n  - 2\n  - 4\n  - 10\nchapter: 2\n---\n')).toEqual([2, 4, 10]);
    expect(parseAdrList('---\ntitle: x\n---\n')).toEqual([]);
    expect(parseAdrList('no frontmatter')).toEqual([]);
    expect(parseChapter(RAW.replace('xray: keystroke\n', ''), 'docs/architecture/chapters/03-a.md').xray).toBeNull();
  });
  it('refuses a chapter without a title or a number', () => {
    expect(() => parseChapter('---\nchapter: 1\n---\nx', 'docs/architecture/chapters/01-a.md')).toThrow(/title/);
    expect(() => parseChapter('---\ntitle: A\n---\nx', 'docs/architecture/chapters/01-a.md')).toThrow(/chapter/);
    expect(() => parseChapter(RAW, 'docs/architecture/chapters/a.md')).toThrow(/NN-slug/);
  });
  it('every real chapter file (there may be none yet) honours the contract and points at records that exist', () => {
    const dir = resolve(ROOT, 'docs/architecture/chapters');
    const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')) : [];
    const numbers = new Set();
    for (const n of files) {
      const c = parseChapter(read(`docs/architecture/chapters/${n}`), `docs/architecture/chapters/${n}`);
      expect(c.n, n).toBeLessThanOrEqual(7);
      expect(numbers.has(c.n), `${n}: duplicate chapter number`).toBe(false);
      numbers.add(c.n);
      expect(c.description, n).toBeTruthy();
      for (const a of c.adrs) expect(ADRS.some((r) => r.number === a), `${n}: ADR ${a} does not exist`).toBe(true);
    }
  });
});

describe('splitLead', () => {
  it('cuts after the first paragraph and drops a leading H1', () => {
    const { lead, rest } = splitLead('# Title\n\nFirst line\nsecond line.\n\n## Section\n\nBody.\n');
    expect(lead).toBe('First line\nsecond line.');
    expect(rest).toBe('## Section\n\nBody.');
  });
  it('keeps what comes before the first paragraph with it, and a fenced block as one block', () => {
    expect(splitLead('> [!NOTE]\n> n\n\nLead.\n\nMore.').lead).toBe('> [!NOTE]\n> n\n\nLead.');
    const r = splitLead('Lead.\n\n```md\n\nnot a paragraph\n\n```\n\nAfter.');
    expect(r.lead).toBe('Lead.');
    expect(r.rest).toBe('```md\n\nnot a paragraph\n\n```\n\nAfter.');
  });
  it('is all lead for one paragraph, all rest for none', () => {
    expect(splitLead('Only.')).toEqual({ lead: 'Only.', rest: '' });
    expect(splitLead('## A\n\n- b')).toEqual({ lead: '', rest: '## A\n\n- b' });
  });
});

describe('links inside a chapter', () => {
  const files = new Set(['04-where-is-the-caret.md']);
  it('sends a chapter, a record, and any other file where they live', () => {
    expect(resolveChapterLink('./04-where-is-the-caret.md#x', files)).toBe('/architecture/chapters/where-is-the-caret#x');
    expect(resolveChapterLink('05-missing.md', files)).toBe(githubBlob('docs/architecture/chapters/05-missing.md'));
    expect(resolveChapterLink('../../adr/007-event-ascension.md', files)).toBe('/architecture/decisions/007');
    expect(resolveChapterLink('../../design/copy-paste.md', files)).toBe(githubBlob('docs/design/copy-paste.md'));
    expect(resolveChapterLink('/architecture/limits', files)).toBeNull();
    expect(prepareChapterBody('A [c](04-where-is-the-caret.md) and [web](https://x.dev).', files)).toBe('A [c](/architecture/chapters/where-is-the-caret) and [web](https://x.dev).');
  });
});

describe('the story', () => {
  it('lists seven chapters: the file when there is one, the fallback (not linked) when not', () => {
    const none = storyList([]);
    expect(none).toHaveLength(7);
    expect(none.every((c) => c.href === null)).toBe(true);
    expect(none.map((c) => c.title)).toEqual(CHAPTERS_FALLBACK.map((c) => c.title));
    const real = parseChapter('---\ntitle: Real three\ndescription: Real.\nchapter: 3\nadrs: [7]\n---\nx', 'docs/architecture/chapters/03-real.md');
    const some = storyList([real]);
    expect(some[2]).toMatchObject({ n: 3, title: 'Real three', description: 'Real.', adrs: [7], href: '/architecture/chapters/real' });
    expect(some[0].href).toBeNull();
    // a chapter outside 1..7 (the e2e fixture) is not in the story
    expect(storyList([{ ...real, n: 99 }]).every((c) => c.href === null)).toBe(true);
  });
  it('knows what comes next and before', () => {
    const real = (/** @type {number} */ n) => parseChapter(`---\ntitle: T${n}\nchapter: ${n}\n---\nx`, `docs/architecture/chapters/0${n}-t${n}.md`);
    const story = storyList([real(2), real(4)]);
    expect(nextAfter(2, story)).toEqual({ label: '04 · T4', href: '/architecture/chapters/t4' });
    expect(nextAfter(4, story)).toEqual({ label: 'The limits', href: '/architecture/limits' });
    expect(prevBefore(4, story)).toEqual({ label: '02 · T2', href: '/architecture/chapters/t2' });
    expect(prevBefore(2, story)).toBeNull();
  });
  it('writes the records of a chapter on one line, with an arrow for a replacement', () => {
    expect(adrLine([1, 3])).toBe('ADR 001 · 003');
    expect(adrLine([16, 18], new Map([[16, 18]]))).toBe('ADR 016 → 018');
    expect(adrLine([])).toBe('');
  });
});

describe('the data of the landing', () => {
  it('has the six answers, the seven chapters and the two cards', () => {
    expect(SWITCH.items.filter((i) => i.verdict === 'yes')).toHaveLength(3);
    expect(SWITCH.items.filter((i) => i.verdict === 'wait')).toHaveLength(3);
    expect(CHAPTERS_FALLBACK.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(Object.values(ENTRY_CARDS).map((c) => c.href)).toEqual(['/architecture/limits', '/architecture/decisions']);
    expect(STORY_LINKS.map((l) => l.href)).toEqual(['/architecture/limits', '/architecture/decisions']);
  });
  it('points the chapters at records that exist, and names the records for the timeline', () => {
    const numbers = new Set(ADRS.map((a) => a.number));
    for (const c of CHAPTERS_FALLBACK) for (const a of c.adrs) expect(numbers.has(a), `chapter ${c.n}: ADR ${a}`).toBe(true);
    for (const n of Object.keys(ADR_SHORT)) expect(numbers.has(Number(n)), `ADR_SHORT ${n}`).toBe(true);
    for (const a of ADRS) expect(ADR_SHORT[a.number], `ADR ${a.id} has a short name`).toBeTruthy();
    for (const n of Object.keys(ADR_NOTES)) expect(ADRS.find((a) => a.number === Number(n))?.status).toBe('superseded');
  });
  it('parses the tiny inline markup', () => {
    expect(inlineParts('a *in* b `c` d')).toEqual([
      { text: 'a ', kind: 'text' }, { text: 'in', kind: 'em' }, { text: ' b ', kind: 'text' }, { text: 'c', kind: 'code' }, { text: ' d', kind: 'text' },
    ]);
  });
});

describe('the limits', () => {
  it('lists the eight limits, each with a known status, a number, an honest description and a source', () => {
    expect(LIMITS.map((l) => l.id)).toEqual(['typing', 'mobile', 'browsers', 'collaboration', 'tables', 'extensions', 'bundle', 'setup']);
    expect(new Set(LIMITS.map((l) => l.id)).size).toBe(LIMITS.length);
    for (const l of LIMITS) {
      expect(STATUSES[l.status], l.id).toBeTruthy();
      expect(l.title, l.id).toBeTruthy();
      expect(l.description.length, l.id).toBeGreaterThan(40);
      expect(l.value, l.id).toBeTruthy();
      expect(l.unit, l.id).toBeTruthy();
    }
    expect(Object.values(STATUSES).map((s) => s.label)).toEqual(expect.arrayContaining(['known · being fixed', 'known · planned', 'by design, not yet', 'planned', 'known · untested']));
    expect(LIMITS_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('every source is a file that exists in the repo, linked on GitHub', () => {
    for (const l of LIMITS) {
      expect(existsSync(resolve(ROOT, l.source.path)), `${l.id}: ${l.source.path}`).toBe(true);
      expect(sourceUrl(l.source), l.id).toBe(`https://github.com/aionbuilders/nabu/blob/main/${l.source.path}`);
    }
  });
  it('marks the number that is being worked on as of the time of writing, with its date', () => {
    const typing = /** @type {any} */ (LIMITS.find((l) => l.id === 'typing'));
    expect(typing.volatile).toBe(true);
    expect(typing.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typing.unit).toMatch(/at the time of writing/);
    expect(typing.description).toMatch(/at the time of writing/i);
    expect(typing.source.path).toBe('tests/e2e/perf/lab-numbers.perf.ts');
  });
});

describe('the comparison', () => {
  it('has a cell for every editor of every row', () => {
    for (const row of ROWS) for (const e of EDITORS) expect(CELLS[row.id]?.[e.id], `${row.id} / ${e.id}`).toBeTruthy();
    expect(EDITORS).toHaveLength(10);
    expect(EDITORS.filter((e) => !e.extra).map((e) => e.name)).toEqual(['ProseMirror', 'Tiptap', 'Lexical', 'BlockNote', 'Svedit', 'Nabu']);
    expect(EDITORS.at(-1)?.name).toBe('Nabu');
  });
  it('every cell carries its source URL, or is marked unverified and has no link', () => {
    const cells = [...Object.values(CELLS).flatMap((r) => Object.values(r)), ...OPTIONS.flatMap((o) => [o.engine, o.collab])];
    for (const c of cells) {
      expect(c.text, JSON.stringify(c)).toBeTruthy();
      if (c.url) expect(c.url, c.text).toMatch(/^https?:\/\/[^\s]+$/);
      else expect(c.unverified, `${c.text} has no URL: it must be marked unverified`).toBe(true);
      if (c.unverified) expect(c.note, `${c.text}: say why it is unverified`).toBeTruthy();
    }
    for (const o of OPTIONS) expect(o.url).toMatch(/^https?:\/\//);
    // the Nabu column's sources are files of this repo
    for (const row of ROWS) {
      const u = /** @type {string} */ (CELLS[row.id].nabu.url);
      expect(u.startsWith('https://github.com/aionbuilders/nabu/blob/main/'), row.id).toBe(true);
      expect(existsSync(resolve(ROOT, u.replace('https://github.com/aionbuilders/nabu/blob/main/', ''))), u).toBe(true);
    }
  });
  it('has no price anywhere (the notes flag them as unverified)', () => {
    const all = JSON.stringify({ CELLS, OPTIONS, DIFFERENT, AHEAD, WHICH });
    expect(all).not.toMatch(/[$€£]\s?\d|\d\s?(USD|EUR)|per month|\/month/i);
  });
  it('has the five options, the lists of the board, and the Svedit-in-depth slot hidden for now', () => {
    expect(OPTIONS.map((o) => o.name)).toEqual(['Tiptap', 'ProseKit', 'svelte-lexical', 'Svedit', 'Nabu']);
    expect(DIFFERENT).toHaveLength(5);
    expect(AHEAD).toHaveLength(6);
    expect(WHICH.map((w) => w.name)).toEqual(['Tiptap', 'ProseKit', 'Nabu']);
    expect(SVEDIT_DEPTH.href).toBeNull();
  });
  it('keeps the research notes in the repo, unchanged', () => {
    const notes = read(COMPARISON_NOTES);
    expect(notes).toMatch(/^# Nabu and the others: research notes/);
    expect(notes).toContain('Prepared 2026-10-27');
  });
});

describe('the documents of the section are built by the docs pipeline', () => {
  it('builds every record, and a second document of a page with its own peer id', async () => {
    const { buildDoc } = await import('../../src/site/docs/doc.server.js');
    for (const a of ADRS) {
      const doc = await buildDoc(prepareAdrBody(a.body), { dir: 'docs/adr', tocLevels: [] });
      expect(doc.snapshot.length, a.file).toBeGreaterThan(100);
      expect(Object.values(doc.ids).length, a.file).toBeGreaterThan(0);
    }
    const [one, two] = [await buildDoc('Lead.', { dir: 'docs/architecture/chapters', tocLevels: [] }), await buildDoc('## A\n\n> [!TIP]\n> Buys.\n\n> [!WARNING]\n> Costs.', { dir: 'docs/architecture/chapters', tocLevels: [], peer: 2 })];
    expect(Object.keys(two.ids)[0]).toMatch(/@2$/);
    expect(one.snapshot).not.toBe(two.snapshot);
  }, 60000);
});
