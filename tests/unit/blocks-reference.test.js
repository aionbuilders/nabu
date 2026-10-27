// @ts-nocheck — mocks intentionally implement only the surface the hooks use
/**
 * Guard of docs/guides/blocks-reference.md (the "Blocks reference"): the page documents EVERY extension of `FullPreset`, and it states facts.
 * The visual "Tour of the blocks" (src/site/tour) is guarded by tour-page.test.js, which reads this page for the facts it repeats.
 *
 *  1. Exhaustive: each extension of `FullPreset` (by `.name`) has its section (a heading that carries `` `name` ``), and a section
 *     names an extension that exists. The slash entries, the action topics and the keys of every extension are all in its section.
 *  2. True: every slash entry the page mentions exists (and the query it gives finds it), every typed shortcut the page claims
 *     makes the block it says (a paragraph is typed into, the `onBeforeInput` hooks run as the engine runs them), every live markdown
 *     example imports to the block type its section claims, the HTML tags, the presets and the API links are the real ones.
 *  3. Rendered: the page goes through the site pipeline (doc.server.js) and no live region swallows the rest of the page.
 *
 * The page marks its markdown examples with the info string of the fence that shows them:
 *     ````md live=toggle        the same text stands right above the fence, as a live example; it imports to these top-level types
 *     ````md import=paragraph   not live; it imports to these top-level types (the gap is documented: video and file have no markdown form)
 * Snippets fenced as ```js test run in docs-examples.test.js.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import * as lib from '#lib/index.js';
import { FullPreset, MinimalPreset, TextPreset, DocumentPreset, createFullEditor } from '#lib/index.js';
import { filterSlashCommands } from '#lib/ui/slash-menu.svelte.js';
import { buildModel } from '../../scripts/api-model.js';
import { buildDoc } from '../../src/site/docs/doc.server.js';
import { loadDocEngine, createDocEngine } from '../../src/site/docs/doc-preset.js';
import { slugify, createSlugger, parseFrontmatter } from '../../src/site/docs/content.js';
import { flush, setCaret, outline, typeBlockShortcut, typeInline, marksOf } from './helpers/typing.js';

const ROOT = process.cwd();
const PAGE = 'docs/guides/blocks-reference.md';
const raw = readFileSync(join(ROOT, PAGE), 'utf8');
const { body } = parseFrontmatter(raw);
const lines = body.split('\n');

// ─── reading the page ─────────────────────────────────────────────────────────

/** Which lines are inside a fenced block (fence lines included), and the fenced blocks. */
function scanFences(ls) {
  const inFence = ls.map(() => false);
  const fences = [];
  for (let i = 0; i < ls.length; i++) {
    const open = /^( {0,3})(`{3,}|~{3,})\s*(.*)$/.exec(ls[i]);
    if (!open) continue;
    let j = i + 1;
    for (; j < ls.length; j++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(ls[j]);
      if (close && close[1][0] === open[2][0] && close[1].length >= open[2].length) break;
    }
    const [lang = '', ...flags] = open[3].trim().split(/\s+/).filter(Boolean);
    fences.push({ open: i, close: j, lang, flags, info: open[3].trim(), code: ls.slice(i + 1, j).join('\n') });
    for (let k = i; k <= Math.min(j, ls.length - 1); k++) inFence[k] = true;
    i = j;
  }
  return { inFence, fences };
}

/** The ATX headings of some lines, outside fences. The title line of a region example (it follows a region comment) is not a heading of the page. */
function headingsOf(ls) {
  const { inFence } = scanFences(ls);
  const out = [];
  ls.forEach((line, i) => {
    if (inFence[i]) return;
    const m = /^(#{1,6}) (.+?)\s*$/.exec(line);
    if (!m || (ls[i - 1] ?? '').startsWith('<!-- region:')) return;
    out.push({ level: m[1].length, raw: m[2], line: i });
  });
  return out;
}

/** The inline code spans of a text (single or multiple backticks, CommonMark). */
function codeSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`') continue;
    let n = 0;
    while (text[i + n] === '`') n++;
    let j = i + n;
    let end = -1;
    while (j < text.length) {
      if (text[j] !== '`') { j++; continue; }
      let m = 0;
      while (text[j + m] === '`') m++;
      if (m === n) { end = j; break; }
      j += m;
    }
    if (end < 0) { i += n - 1; continue; }
    spans.push(text.slice(i + n, end).replace(/^ (.*) $/, '$1'));
    i = end + n - 1;
  }
  return spans;
}

const { fences } = scanFences(lines);
const headings = headingsOf(lines);
const SECTION_HEADING = /^(.+) · `([a-z][a-z-]*)`$/;

/** One section per `### Title · `name`` heading (h2 too, should a group heading ever carry a name). Its lines run to the next h2/h3. */
const sections = headings
  .map((h, idx) => ({ h, idx, m: SECTION_HEADING.exec(h.raw) }))
  .filter((x) => x.m && x.h.level <= 3)
  .map(({ h, idx, m }) => {
    const next = headings.slice(idx + 1).find((n) => n.level <= 3);
    const sectionLines = lines.slice(h.line + 1, next ? next.line : lines.length);
    const text = sectionLines.join('\n');
    const bullets = {};
    for (const line of sectionLines) {
      const b = /^- \*\*([^*]+?)\.\*\* (.*)$/.exec(line);
      if (b) bullets[b[1]] = b[2];
    }
    return { name: m[2], title: m[1], level: h.level, line: h.line, lines: sectionLines, text, bullets, spans: codeSpans(sectionLines.join('\n')) };
  });
const sectionOf = (name) => sections.find((s) => s.name === name);

const byName = new Map(FullPreset.map((extension) => [extension.name, extension]));

// ─── the engine side: typing without a browser (helpers/typing.js) ────────────


// ─── 1. exhaustive ────────────────────────────────────────────────────────────

describe('the page covers every extension of FullPreset', () => {
  it('has the frontmatter the site needs', () => {
    const { data } = parseFrontmatter(raw);
    expect(data).toMatchObject({ title: 'Blocks reference', section: 'guides', order: 90 });
    expect(String(data.description).length).toBeGreaterThan(20);
  });

  it.each(FullPreset.map((extension) => [extension.name]))('%s has a section whose heading carries its name', (name) => {
    expect(sectionOf(name), `no "### Title · \`${name}\`" heading for the extension "${name}"`).toBeTruthy();
  });

  it('every section names an extension of FullPreset, once', () => {
    const names = sections.map((s) => s.name);
    expect(names.filter((n) => !byName.has(n)), 'a section for an extension that FullPreset does not have').toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the sections come in the order of the groups of the page (blocks, text, paste, block)', () => {
    const order = ['paragraph', 'heading', 'blockquote', 'divider', 'code', 'callout', 'toggle', 'image', 'video', 'file', 'list', 'list-item', 'dialogue', 'region',
      'rich-text', 'typography', 'markdown-shortcuts', 'nabu-paste', 'html-paste', 'markdown-paste', 'plain-text-paste', 'block'];
    expect(sections.map((s) => s.name)).toEqual(order);
  });

  it('the groups of the page are there', () => {
    const groups = headings.filter((h) => h.level === 2).map((h) => h.raw);
    for (const group of ['How to read this page', 'At a glance', 'Blocks', 'Text behaviours', 'Paste', 'Make your own']) expect(groups).toContain(group);
    expect(groups.some((g) => /block/i.test(g) && g !== 'Blocks')).toBe(true); // the group of the `block` extension
  });

  it('closes on "make your own", with a link to the extensions guide', () => {
    const tail = lines.slice(headings.find((h) => h.raw === 'Make your own').line).join('\n');
    expect(tail).toContain('(./extensions.md)');
  });

  it('the mini table of contents links every section, and only anchors that exist', async () => {
    const glance = lines.slice(headings.find((h) => h.raw === 'At a glance').line, headings.find((h) => h.raw === 'Blocks').line).join('\n');
    const doc = await buildDoc(body, { dir: 'docs/guides' });
    const anchors = new Set(Object.values(doc.ids));
    for (const s of sections) {
      const slug = createSlugger()(`${s.title} · ${s.name}`);
      expect(glance, `the table of contents lacks "${s.title}"`).toContain(`(#${slug})`);
      expect(anchors.has(slug), `the heading of "${s.name}" has another anchor than ${slug}`).toBe(true);
    }
    for (const [, anchor] of body.matchAll(/\]\(#([^)]+)\)/g)) expect(anchors.has(anchor), `dead anchor #${anchor}`).toBe(true);
  });
});

describe('the extensions give everything to their section', () => {
  const allSlash = FullPreset.flatMap((extension) => extension.slashCommands.map((entry) => ({ extension: extension.name, title: entry.title })));

  it('every slash entry of FullPreset is in the section of the extension that declares it', () => {
    expect(allSlash.length).toBeGreaterThan(10);
    for (const { extension, title } of allSlash) {
      const pairs = [...(sectionOf(extension)?.bullets['Slash menu'] ?? '').matchAll(/([A-Z][\w-]*(?: [\w-]+)*?) \(`(\/[\w-]+)`\)/g)].map((m) => m[1]);
      expect(pairs, `the "Slash menu" bullet of "${extension}" does not name "${title}"`).toContain(title);
    }
  });

  it('every action and command of an extension is a topic of its "From code" bullet (the click on a gap between blocks is internal)', () => {
    for (const extension of FullPreset) {
      const topics = [...Object.keys(extension.actions), ...Object.keys(extension.commands)].filter((t) => t !== 'gap:click');
      if (!topics.length) continue;
      const spans = sectionOf(extension.name)?.bullets['From code'] ? codeSpans(sectionOf(extension.name).bullets['From code']) : [];
      for (const topic of topics) expect(spans, `"${extension.name}": the "From code" bullet lacks ${topic}`).toContain(topic);
    }
  });

  it('every key of a command of an extension is in its section', () => {
    for (const extension of FullPreset) {
      const section = sectionOf(extension.name);
      for (const [id, command] of Object.entries(extension.commands)) {
        for (const chord of command.keys ?? []) expect(section.spans, `"${extension.name}": ${id} has the key ${chord}`).toContain(chord);
      }
    }
  });
});

// ─── 2. true ──────────────────────────────────────────────────────────────────

describe('the slash menu entries the page mentions exist, and the query finds them', () => {
  const engine = createFullEditor();
  const entries = engine.slashCommands;

  it.each(sections.filter((s) => byName.get(s.name).slashCommands.length).map((s) => [s.name, s]))('%s', (name, section) => {
    const pairs = [...section.bullets['Slash menu'].matchAll(/([A-Z][\w-]*(?: [\w-]+)*?) \(`(\/[\w-]+)`\)/g)].map((m) => ({ title: m[1], query: m[2].slice(1) }));
    expect(pairs.length).toBeGreaterThan(0);
    for (const { title, query } of pairs) {
      const entry = byName.get(name).slashCommands.find((e) => e.title === title);
      expect(entry, `"${title}" is not a slash entry of "${name}"`).toBeTruthy();
      expect(entries).toContain(entry);
      expect(filterSlashCommands(entries, query), `"/${query}" does not find "${title}"`).toContain(entry);
    }
  });

  it('the region entries are offered under the "structure" group, and only where they fit', async () => {
    const [section1] = byName.get('region').slashCommands;
    expect(section1.group).toBe('structure');
    expect(typeof section1.when).toBe('function');
  });
});

describe('the typed shortcuts the page claims make the block it says', () => {
  const blockShortcuts = [
    { typed: '#', spans: ['#', '######'], then: 'space', blocks: [{ type: 'heading', props: { level: 1 } }] },
    { typed: '###', then: 'space', blocks: [{ type: 'heading', props: { level: 3 } }] },
    { typed: '######', then: 'space', blocks: [{ type: 'heading', props: { level: 6 } }] },
    { typed: '>', spans: ['>'], then: 'space', blocks: [{ type: 'blockquote' }] },
    { typed: '---', spans: ['---'], then: 'space', blocks: [{ type: 'divider' }, { type: 'paragraph' }] },
    { typed: '```', spans: ['```'], then: 'enter', blocks: [{ type: 'code', props: { language: null } }] },
    { typed: '```js', spans: ['```js'], then: 'enter', blocks: [{ type: 'code', props: { language: 'js' } }] },
    { typed: '!', spans: ['!'], then: 'space', blocks: [{ type: 'callout', props: { variant: 'note' } }] },
    { typed: '-', spans: ['-'], then: 'space', blocks: [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item' }] }] },
    { typed: '1.', spans: ['1.'], then: 'space', blocks: [{ type: 'list', props: { listType: 'ordered' }, children: [{ type: 'list-item' }] }] },
    { typed: '7.', spans: ['7.'], then: 'space', blocks: [{ type: 'list', props: { listType: 'ordered', start: 7 }, children: [{ type: 'list-item' }] }] },
    { typed: '[ ]', spans: ['[ ]'], then: 'space', blocks: [{ type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', props: { checked: false } }] }] },
    { typed: '[]', spans: ['[]'], then: 'space', blocks: [{ type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', props: { checked: false } }] }] },
    { typed: '[x]', spans: ['[x]'], then: 'space', blocks: [{ type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', props: { checked: true } }] }] },
    { typed: '--', spans: ['--'], then: 'space', blocks: [{ type: 'dialogue' }] },
  ];

  it.each(blockShortcuts.map((c) => [`${c.typed} + ${c.then}`, c]))('%s', async (_name, c) => {
    const { took, blocks } = await typeBlockShortcut(c.typed, c.then);
    expect(took).toBe(true);
    expect(blocks).toEqual(c.blocks);
    for (const span of c.spans ?? []) expect(sectionOf('markdown-shortcuts').spans, `the cheat sheet does not show ${span}`).toContain(span);
  });

  it('`:::` + Space opens the chooser of the region types, and choosing one makes the region', async () => {
    const { engine, took } = await typeBlockShortcut(':::', 'space');
    expect(took).toBe(true);
    expect(engine.pendingCommand?.id).toBe('region:create');
    engine.commandConfirm.choose(0);
    await flush();
    expect(engine.serialize('json').blocks.map((b) => b.type)).toEqual(['region']);
    expect(engine.regions.list.map((r) => r.type)).toEqual(['section-1']);
    expect(sectionOf('markdown-shortcuts').spans).toContain(':::');
    expect(sectionOf('region').bullets.Type).toContain(':::');
  });

  it('`:::` + Enter at the end of a region body closes the region', async () => {
    const engine = createFullEditor();
    await engine.importMarkdown('<!-- region:section-1 {} -->\n# One\n\nText\n\n:::');
    expect(engine.children.map((b) => b.type)).toEqual(['region']);
    const region = engine.children[0];
    const mark = region.children.at(-1);
    setCaret(engine, mark, 3);
    const event = { inputType: 'insertParagraph', data: null, preventDefault: vi.fn() };
    let took = false;
    for (const hook of engine.hooks.get('onBeforeInput')) if (hook(engine, event, mark) === engine.BREAK) { took = true; break; }
    await flush();
    expect(took).toBe(true);
    expect(engine.serialize('json').blocks.map((b) => [b.type, b.children?.length])).toEqual([['region', 1], ['paragraph', undefined]]);
  });

  it('the blocks without a typed shortcut say so', () => {
    for (const name of ['toggle', 'image', 'video', 'file']) {
      const type = sectionOf(name).bullets.Type ?? '';
      expect(type, `"${name}"`).toMatch(/^Nothing/);
    }
  });

  it('the cheat sheet lists every shortcut a section claims in its Type bullet', () => {
    for (const name of ['heading', 'blockquote', 'divider', 'code', 'callout', 'list', 'dialogue', 'region']) {
      const type = sectionOf(name).bullets.Type;
      expect(type, `"${name}" has a Type bullet`).toBeTruthy();
      // (`*` and `+` are named in the list section as NOT being typed shortcuts)
      for (const span of codeSpans(type).filter((x) => x !== '*' && x !== '+')) {
        expect(sectionOf('markdown-shortcuts').spans, `the cheat sheet lacks ${span} of "${name}"`).toContain(span);
      }
    }
  });
});

describe('the inline shortcuts the page claims make the marks it says', () => {
  const cases = [
    { typed: ' **b*', data: '*', marks: [{ text: 'b', marks: ['bold'] }], span: '**bold**' },
    { typed: ' __b_', data: '_', marks: [{ text: 'b', marks: ['bold'] }], span: '__bold__' },
    { typed: ' *i', data: '*', marks: [{ text: 'i', marks: ['italic'] }], span: '*italic*' },
    { typed: ' _i', data: '_', marks: [{ text: 'i', marks: ['italic'] }], span: '_italic_' },
    { typed: ' ***b**', data: '*', marks: [{ text: 'b', marks: ['bold', 'italic'] }], span: '***both***' },
    { typed: ' ___b__', data: '_', marks: [{ text: 'b', marks: ['bold', 'italic'] }], span: '___both___' },
    { typed: ' `c', data: '`', marks: [{ text: 'c', marks: ['code'] }], span: '`code`' },
    { typed: ' ~~s~', data: '~', marks: [{ text: 's', marks: ['strikethrough'] }], span: '~~strike~~' },
  ];

  it.each(cases.map((c) => [c.span, c]))('%s', async (_name, c) => {
    const { delta } = await typeInline('x', c.typed, c.data);
    expect(marksOf(delta)).toEqual(c.marks);
    expect(sectionOf('markdown-shortcuts').text).toContain(c.span);
  });

  it('delimiters must hug the text, and an underscore never works inside a word', async () => {
    expect(marksOf((await typeInline('x', ' * b ', '*')).delta)).toEqual([]); // `2 * 3 * 4`
    expect(marksOf((await typeInline('x', ' snake_case_nam', '_')).delta)).toEqual([]); // `snake_case_name`
    expect(marksOf((await typeInline('x', ' a*b', '*')).delta)).toEqual([{ text: 'b', marks: ['italic'] }]); // `a*b*c`
    const section = sectionOf('markdown-shortcuts').text;
    expect(section).toContain('2 * 3 * 4');
    expect(section).toContain('snake_case_name');
    expect(section).toContain('a*b*c');
  });

  it('there are eight input rules', () => {
    expect(byName.get('markdown-shortcuts').inputRules).toHaveLength(8);
    expect(sectionOf('markdown-shortcuts').text).toContain('Eight input rules');
  });

  it('typography: two hyphens and a space are an em dash; `--help` and `---` keep theirs', async () => {
    expect((await typeInline('x', ' Nobody --', ' ')).text).toBe('x Nobody — ');
    expect((await typeInline('x', ' run --help', ' ')).text).toBe('x run --help ');
    expect((await typeInline('x', ' a ---', ' ')).text).toBe('x a --- ');
    const section = sectionOf('typography').text;
    expect(section).toContain('`--help`');
    expect(section).toContain('`---`');
    expect(section).toContain('Nobody — not even the fog — had crossed.');
  });

  it('the dialogue shortcut wins over typography at the start of an empty paragraph', async () => {
    const { blocks } = await typeBlockShortcut('--', 'space');
    expect(blocks).toEqual([{ type: 'dialogue' }]);
    expect(sectionOf('typography').text).toContain('[dialogue](#dialogue--dialogue)');
  });

  it('callouts and toggle headers skip the typed transformations (what the page says)', async () => {
    expect((await typeInline('> [!NOTE]\n> hi', ' **b*', '*')).text).toBe('hi **b**');
    expect((await typeInline('<details>\n<summary>hi</summary>\n\nx\n\n</details>', ' **b*', '*')).text).toBe('hi **b**');
    expect((await typeInline('> [!NOTE]\n> hi', ' --', ' ')).text).toBe('hi -- ');
    expect(sectionOf('callout').bullets['Good to know']).toMatch(/skip/);
    expect(sectionOf('toggle').bullets['Good to know']).toMatch(/skips the typed shortcuts/);
    // ...while the blocks around them do not.
    expect(marksOf((await typeInline('# hi', ' **b*', '*')).delta)).toEqual([{ text: 'b', marks: ['bold'] }]);
    expect(marksOf((await typeInline('- hi', ' **b*', '*')).delta)).toEqual([{ text: 'b', marks: ['bold'] }]);
  });
});

describe('the markdown examples of the page', () => {
  const examples = fences.filter((f) => f.lang === 'md' && f.flags.some((x) => /^(live|import)=/.test(x))).map((f) => {
    const flag = f.flags.find((x) => /^(live|import)=/.test(x));
    const [kind, types] = flag.split('=');
    const section = [...sections].reverse().find((s) => s.line < f.open);
    return { ...f, kind, types: types.split(','), section: section?.name, flag };
  });

  it('there are examples', () => {
    expect(examples.length).toBeGreaterThanOrEqual(15);
    expect(examples.filter((e) => e.kind === 'live').length).toBeGreaterThanOrEqual(13);
  });

  const topTypes = (engine) => engine.children.map((b) => b.type);

  it.each(examples.map((e) => [`${e.section}: ${e.flag}`, e]))('%s imports to the types it claims, in the editor and in the site engine', async (_name, e) => {
    for (const engine of [createFullEditor(), createDocEngine()]) {
      await engine.importMarkdown(e.code);
      expect(topTypes(engine)).toEqual(e.types);
    }
  });

  it.each(examples.filter((e) => e.kind === 'live').map((e) => [`${e.section}: ${e.flag}`, e]))('%s stands live right above its source', (_name, e) => {
    // The lines above the fence, up to the blank line before the source, are the example itself, word for word.
    const above = lines.slice(0, e.open).join('\n').replace(/\n+$/, '');
    expect(above.endsWith(e.code), `the live example above the fence of ${e.section} differs from its source`).toBe(true);
    const before = above.slice(0, above.length - e.code.length);
    expect(before === '' || before.endsWith('\n\n'), `the live example of ${e.section} is not a block of its own`).toBe(true);
  });

  it('each section claims the block type of its live examples', async () => {
    const claims = {
      paragraph: 'paragraph', heading: 'heading', blockquote: 'blockquote', divider: 'divider', code: 'code', callout: 'callout', toggle: 'toggle',
      image: 'image', list: 'list', 'list-item': 'list-item', dialogue: 'dialogue', region: 'region',
    };
    for (const [name, type] of Object.entries(claims)) {
      const live = examples.filter((e) => e.section === name && e.kind === 'live');
      expect(live.length, `"${name}" has a live example`).toBeGreaterThan(0);
      const found = [];
      for (const e of live) {
        const engine = createFullEditor();
        await engine.importMarkdown(e.code);
        const walk = (b) => { found.push(b.type); (b.children ?? []).forEach(walk); };
        engine.serialize('json').blocks.forEach(walk);
      }
      expect(found, `"${name}"`).toContain(type);
    }
  });

  it('the to-do example has checked and unchecked items; the toggle starts closed; the callout is a warning', async () => {
    const engine = createFullEditor();
    await engine.importMarkdown(examples.find((e) => e.section === 'list-item').code);
    const [list] = engine.serialize('json').blocks;
    expect(list.props.listType).toBe('todo');
    expect(list.children.map((item) => item.props.checked)).toEqual([true, false, false]);

    await engine.importMarkdown(examples.find((e) => e.section === 'toggle').code);
    expect(engine.serialize('json').blocks[0].props.collapsed).toBe(true);

    await engine.importMarkdown(examples.find((e) => e.section === 'callout').code);
    expect(engine.serialize('json').blocks[0].props.variant).toBe('warning');
  });

  it('the rich text example carries every mark', async () => {
    const engine = createFullEditor();
    await engine.importMarkdown(examples.find((e) => e.section === 'rich-text').code);
    const marks = new Set(marksOf(engine.children[0].delta).flatMap((run) => run.marks));
    expect([...marks].sort()).toEqual(['bold', 'code', 'italic', 'link', 'strikethrough', 'underline']);
  });

  it('video and file have no markdown form: their link imports as a paragraph with a link (the gap the page documents)', async () => {
    for (const name of ['video', 'file']) {
      const example = examples.find((e) => e.section === name);
      const engine = createFullEditor();
      await engine.importMarkdown(example.code);
      expect(engine.children.map((b) => b.type)).toEqual(['paragraph']);
      expect(engine.children[0].delta.some((run) => run.attributes?.link)).toBe(true);
      expect(sectionOf(name).bullets['Good to know']).toMatch(/no (markdown )?form|has no markdown form/);
    }
  });

  it('the images are local files that exist', () => {
    for (const m of body.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)\)/g)) expect(existsSync(join(ROOT, 'static', m[1])), `static${m[1]}`).toBe(true);
    expect(body.match(/!\[[^\]]*\]\(https?:/g) ?? []).toEqual([]);
  });

  it('no external URL stands in the prose of the page (the snippets that run may use one)', () => {
    const { inFence } = scanFences(lines);
    const prose = lines.filter((_, i) => !inFence[i]).join('\n');
    expect(prose.match(/https?:\/\//g) ?? []).toEqual([]);
  });
});

describe('the HTML each block writes, as the page says', () => {
  const d = [{ insert: 'Hi' }];
  const cases = [
    { name: 'paragraph', pb: { type: 'paragraph', delta: d }, tags: ['p'] },
    { name: 'heading', pb: { type: 'heading', props: { level: 3 }, delta: d }, tags: ['h3'], spans: ['<h1>', '<h6>'] },
    { name: 'blockquote', pb: { type: 'blockquote', delta: d }, tags: ['blockquote'] },
    { name: 'divider', pb: { type: 'divider' }, tags: ['hr'] },
    { name: 'code', pb: { type: 'code', props: { language: 'js' }, delta: d }, tags: ['pre><code'], spans: ['<pre><code>'] },
    { name: 'callout', pb: { type: 'callout', props: { variant: 'warning' }, delta: d }, tags: ['aside class="callout callout-warning" data-callout="warning"'], spans: ['<aside class="callout callout-warning" data-callout="warning">'] },
    { name: 'toggle', pb: { type: 'toggle', props: { collapsed: true }, delta: d, children: [{ type: 'paragraph', delta: d }] }, tags: ['details><summary'], spans: ['<details>', '<summary>'] },
    { name: 'image', pb: { type: 'image', props: { ref: '/a.png', alt: 'x' } }, tags: ['img src="/a.png" alt="x"'], spans: ['<img src alt>'] },
    { name: 'video', pb: { type: 'video', props: { ref: '/a.mp4' } }, tags: ['video src="/a.mp4" controls'], spans: ['<video src controls>'] },
    { name: 'file', pb: { type: 'file', props: { ref: '/a.pdf', name: 'a.pdf' } }, tags: ['a href="/a.pdf" download="a.pdf"'], spans: ['<a href download>'] },
    { name: 'list', pb: { type: 'list', props: { listType: 'ordered', start: 3 }, children: [{ type: 'list-item', delta: d }] }, tags: ['ol start="3"'], spans: ['<ol start>', '<ul>'] },
    { name: 'list', pb: { type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', delta: d, props: { checked: true } }] }, tags: ['ul class="contains-task-list"'], spans: ['<ul class="contains-task-list">'] },
    { name: 'list-item', pb: { type: 'list-item', delta: d, props: { checked: true } }, tags: ['li><input type="checkbox" disabled checked'], spans: ['<li>', '<input type="checkbox" disabled>'] },
    { name: 'dialogue', pb: { type: 'dialogue', delta: d }, tags: ['p'], text: 'plain `<p>`' },
    { name: 'region', pb: { type: 'region', props: { regionType: 'section-1', fields: {} }, delta: d, children: [{ type: 'paragraph', delta: d }] }, tags: ['section data-nabu-region="section-1" data-nabu-fields=\'{}\'><h1'], spans: ['<section data-nabu-region="section-1" data-nabu-fields>'] },
    { name: 'rich-text', html: '<strong>x</strong>', spans: ['<strong>', '<em>', '<u>', '<code>', '<s>', '<a href>'] },
  ];

  it.each(cases.map((c) => [c.name + (c.tags ? ` ${c.tags[0]}` : ''), c]))('%s', (_name, c) => {
    const section = sectionOf(c.name);
    if (c.pb) {
      const engine = createFullEditor();
      const recurse = (child) => engine.registry.get(child.type).toHtml(child, { recurse });
      const html = recurse(c.pb);
      expect(html.startsWith(`<${c.tags[0]}`), html).toBe(true);
    }
    for (const span of c.spans ?? []) expect(section.bullets['Markdown and HTML'] ?? section.text, `"${c.name}" shows ${span}`).toContain(span);
    if (c.text) expect(section.bullets['Markdown and HTML']).toContain(c.text);
  });

  it('rich text: the marks write the tags the page lists', async () => {
    const { deltaToHtml, deltaToMarkdown } = lib;
    const runs = ['bold', 'italic', 'underline', 'code', 'strikethrough'].map((mark) => ({ insert: 'x', attributes: { [mark]: true } }));
    const html = deltaToHtml(runs);
    for (const tag of ['<strong>', '<em>', '<u>', '<code>', '<s>']) expect(html).toContain(tag);
    expect(deltaToHtml([{ insert: 'x', attributes: { link: '/a' } }])).toBe('<a href="/a">x</a>');
    expect(deltaToMarkdown(runs.slice(0, 1))).toBe('**x**');
    expect(deltaToMarkdown(runs.slice(1, 2))).toBe('*x*');
    expect(deltaToMarkdown(runs.slice(2, 3))).toBe('<u>x</u>');
    expect(deltaToMarkdown(runs.slice(3, 4))).toBe('`x`');
    expect(deltaToMarkdown(runs.slice(4, 5))).toBe('~~x~~');
  });

  it('every other block writes the markdown the page says', async () => {
    const engine = createFullEditor();
    const md = async (pb) => {
      const BlockClass = engine.registry.get(pb.type);
      return BlockClass.toMarkdown(pb, { recurse: (c) => engine.registry.get(c.type).toMarkdown(c, {}), recurseAll: (cs) => cs.map((c) => engine.registry.get(c.type).toMarkdown(c, {})) });
    };
    const d = [{ insert: 'Hi' }];
    expect(await md({ type: 'heading', props: { level: 4 }, delta: d })).toBe('#### Hi');
    expect(await md({ type: 'blockquote', delta: d })).toBe('> Hi');
    expect(await md({ type: 'divider' })).toBe('---');
    expect(await md({ type: 'code', props: { language: 'js' }, delta: d })).toBe('```js\nHi\n```');
    expect(await md({ type: 'callout', props: { variant: 'tip' }, delta: d })).toBe('> [!TIP]\n> Hi');
    expect(await md({ type: 'image', props: { ref: '/a.png', alt: 'x' } })).toBe('![x](/a.png)');
    expect(await md({ type: 'video', props: { ref: '/a.mp4', alt: 'clip' } })).toBe('[clip](/a.mp4)');
    expect(await md({ type: 'file', props: { ref: '/a.pdf', name: 'a.pdf' } })).toBe('[a.pdf](/a.pdf)');
    expect(await md({ type: 'dialogue', delta: d })).toBe('-- Hi');
  });
});

describe('the presets line of each section is the truth', () => {
  const presets = { Minimal: MinimalPreset, Text: TextPreset, Document: DocumentPreset, Full: FullPreset };

  it.each(FullPreset.map((extension) => [extension.name, extension]))('%s', (name, extension) => {
    const line = sectionOf(name).bullets.Presets;
    expect(line, `"${name}" has a Presets bullet`).toBeTruthy();
    const said = [...line.matchAll(/\b(Minimal|Text|Document|Full)\b/g)].map((m) => m[1]);
    const real = Object.entries(presets).filter(([, preset]) => preset.some((x) => x.name === name)).map(([label]) => label);
    expect(said).toEqual(real);
  });
});

describe('the API links are the real reference pages', () => {
  let model;
  beforeAll(async () => { model = await buildModel(); }, 120000);

  it('every /api/root/Name link of the page is an item of the model', () => {
    const names = [...body.matchAll(/\]\(\/api\/root\/([A-Za-z0-9_]+)\)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(model.items[`root/${name}`], `no API page for ${name}`).toBeTruthy();
  });

  it.each(FullPreset.map((extension) => [extension.name, extension]))('%s links its own export', (name, extension) => {
    const exports = Object.entries(lib).filter(([, value]) => value === extension).map(([exportName]) => exportName);
    const expected = name === 'region' ? ['RegionsExtension', 'createRegionsExtension'] : exports;
    expect(expected.length).toBeGreaterThan(0);
    const api = sectionOf(name).bullets.API;
    for (const exportName of expected) {
      expect(api, `"${name}": the API bullet lacks ${exportName}`).toContain(`(/api/root/${exportName})`);
      expect(typeof lib[exportName]).not.toBe('undefined');
    }
  });
});

describe('the links to the other pages are alive', () => {
  const headingsOfFile = (file) => {
    const ls = readFileSync(file, 'utf8').split('\n');
    const slug = createSlugger();
    return new Set(headingsOf(ls).map((h) => slug(h.raw.replace(/`/g, ''))));
  };

  it('every relative .md link points to a page that exists, with an anchor that exists', () => {
    const links = [...body.matchAll(/\]\((\.{1,2}\/[^)#\s]+\.md)(#[^)\s]+)?\)/g)];
    expect(links.length).toBeGreaterThan(5);
    for (const [, path, hash] of links) {
      const file = resolve(ROOT, dirname(PAGE), path);
      expect(existsSync(file), path).toBe(true);
      if (hash) expect(headingsOfFile(file).has(hash.slice(1)), `${path}${hash}`).toBe(true);
    }
  });
});

// ─── 3. rendered ──────────────────────────────────────────────────────────────

describe('the page goes through the site pipeline', () => {
  let doc;
  let engine;
  beforeAll(async () => {
    doc = await buildDoc(body, { dir: 'docs/guides' });
    engine = loadDocEngine(doc.snapshot);
  }, 60000);

  it('every section heading is at the root of the page: no live region swallows the rest', () => {
    const rootHeadings = engine.children.filter((b) => b.type === 'heading').map((b) => b.text);
    for (const s of sections) expect(rootHeadings, `the heading of ${s.name}`).toContain(`${s.title} · ${s.name}`);
    expect(rootHeadings).toContain('Make your own');
    expect(engine.children.at(-1).type).toBe('paragraph'); // the last words of the story
  });

  it('the live examples are really those blocks', () => {
    const types = new Set();
    const walk = (blocks) => blocks.forEach((b) => { types.add(b.type); walk(b.children ?? []); });
    walk(engine.children);
    for (const type of ['toggle', 'callout', 'region', 'image', 'dialogue', 'list', 'list-item', 'divider', 'blockquote', 'code', 'heading', 'table']) {
      expect(types.has(type), `a live ${type}`).toBe(true);
    }
    const toggles = [];
    const find = (blocks) => blocks.forEach((b) => { if (b.type === 'toggle') toggles.push(b); find(b.children ?? []); });
    find(engine.children);
    expect(toggles.map((t) => t.collapsed)).toEqual([true]); // the page ships its toggle closed, a reader opens it
    expect(engine.regions.list.map((r) => r.label)).toEqual(['1. The ferryman', '1.1 The lantern']);
  });

  it('the table of contents of the site lists the sections', () => {
    const labels = doc.toc.map((t) => t.label);
    for (const s of sections) expect(labels).toContain(`${s.title} · ${s.name}`);
  });
});
