// @ts-nocheck
/**
 * `@aionbuilders/nabu/format` (src/lib/format.js): the pure entry for read-only pages and servers, and `serialize('text')`,
 * which is `jsonToText` over the blocks' JSON. Real engines (FullPreset), no mocks but for the one spy on `embedAssets`.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { createFullEditor, FullPreset } from '#lib';
import { Files } from '#lib/files/index.js';
import { jsonToText, deltaToHtml, deltaToMarkdown } from '#lib/format.js';

const p = (text, marks = {}) => ({ type: 'paragraph', content: text === '' ? [] : [{ text, ...marks }] });

/** A fresh full editor holding the `blocks` (a `serialize('json')` export). */
async function load(blocks) {
  const engine = createFullEditor();
  await engine.importJSON({ version: '1', blocks });
  return engine;
}

/** One block of every kind of FullPreset, containers holding a child, a list with a nested list. */
const KINDS = [
  p('Paragraph'),
  { type: 'heading', props: { level: 2 }, content: [{ text: 'Heading' }] },
  { type: 'blockquote', content: [{ text: 'Quote' }] },
  { type: 'divider' },
  { type: 'code', props: { language: 'js' }, content: 'let a = 1;\nlet b = 2;' },
  { type: 'callout', props: { variant: 'note' }, content: [{ text: 'Callout' }] },
  { type: 'toggle', props: { collapsed: false }, content: [{ text: 'Toggle' }], children: [p('Inside the toggle')] },
  {
    type: 'list',
    props: { listType: 'bullet' },
    children: [
      { type: 'list-item', content: [{ text: 'One' }], children: [
        { type: 'list', props: { listType: 'bullet' }, children: [
          { type: 'list-item', content: [{ text: 'Nested' }] },
        ] },
      ] },
      { type: 'list-item', content: [{ text: 'Two' }] },
    ],
  },
  { type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', props: { checked: true }, content: [{ text: 'Task' }] }] },
  { type: 'dialogue', content: [{ text: 'Said' }] },
  { type: 'image', props: { ref: 'https://example.test/a.png', alt: 'An image' } },
  { type: 'video', props: { ref: 'https://example.test/a.mp4' } },
  { type: 'file', props: { ref: 'https://example.test/a.pdf', name: 'a.pdf' } },
  {
    type: 'region',
    props: { regionType: 'section-1', fields: {} },
    content: [{ text: 'Region' }],
    children: [p('Inside the region')],
  },
];

const KINDS_TEXT = [
  'Paragraph', 'Heading', 'Quote', 'let a = 1;\nlet b = 2;', 'Callout', 'Toggle', 'Inside the toggle',
  'One\nNested\nTwo', 'Task', 'Said', 'Region', 'Inside the region',
].join('\n\n');

describe("serialize('text')", () => {
  it('writes the text of one block of every kind of the full preset', async () => {
    const engine = await load(KINDS);
    // The document really holds every kind (the preset's blocks are the ones the fixture names).
    const types = new Set();
    const walk = (blocks) => blocks.forEach((b) => { types.add(b.type); walk(b.children ?? []); });
    walk(engine.serialize('json').blocks);
    for (const name of ['paragraph', 'heading', 'blockquote', 'divider', 'code', 'callout', 'toggle', 'list', 'list-item', 'dialogue', 'image', 'video', 'file', 'region']) {
      expect(types.has(name), name).toBe(true);
    }
    expect(FullPreset.length).toBeGreaterThan(10);
    expect(engine.serialize('text')).toBe(KINDS_TEXT);
  });

  it('ignores marks and links, and keeps the characters literal (no escaping, no markup)', async () => {
    const engine = await load([
      { type: 'paragraph', content: [
        { text: '5 * 3 = 15, ' }, { text: '#title', bold: true }, { text: ' <b>x</b> ', italic: true },
        { text: '`code`', code: true }, { text: ' and a link', link: 'https://example.com' },
      ] },
    ]);
    const text = engine.serialize('text');
    expect(text).toBe('5 * 3 = 15, #title <b>x</b> `code` and a link');
    // The markdown export, by contrast, escapes: this is the reason for the format.
    expect(engine.serialize('markdown')).toContain('5 \\* 3');
  });

  it('keeps a line break inside a block as a newline', async () => {
    const engine = await load([p('first line\nsecond line'), p('next')]);
    expect(engine.serialize('text')).toBe('first line\nsecond line\n\nnext');
  });

  it('separates the items of a list, nested ones included, with a single newline and no bullet', async () => {
    const engine = await load([
      p('before'),
      { type: 'list', props: { listType: 'ordered', start: 3 }, children: [
        { type: 'list-item', content: [{ text: 'a' }], children: [
          { type: 'list', props: { listType: 'bullet' }, children: [
            { type: 'list-item', content: [{ text: 'a.1' }], children: [
              { type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', content: [{ text: 'a.1.1' }] }] },
            ] },
            { type: 'list-item', content: [{ text: 'a.2' }] },
          ] },
        ] },
        { type: 'list-item', content: [{ text: 'b' }] },
      ] },
      p('after'),
    ]);
    expect(engine.serialize('text')).toBe('before\n\na\na.1\na.1.1\na.2\nb\n\nafter');
  });

  it('adds no blank line for an empty paragraph, a divider or a media, at the start, the middle or the end', async () => {
    const engine = await load([
      p(''), p('one'), p(''), { type: 'divider' }, p(''), p('two'),
      { type: 'image', props: { ref: 'https://example.test/a.png' } }, p(''),
    ]);
    expect(engine.serialize('text')).toBe('one\n\ntwo');
    expect((await load([p('')])).serialize('text')).toBe('');
    expect(createFullEditor().serialize('text')).toBe('');
  });

  it('trims nothing inside a block', async () => {
    const engine = await load([p('  padded  '), p('x\n')]);
    expect(engine.serialize('text')).toBe('  padded  \n\nx\n');
  });

  it("is what jsonToText gives of the 'json' export, also after a round trip through importJSON", async () => {
    const engine = await load(KINDS);
    const json = engine.serialize('json');
    expect(jsonToText(json)).toBe(engine.serialize('text'));
    expect(jsonToText(json.blocks)).toBe(engine.serialize('text'));
    // a server that only holds the stored string computes the same
    expect(jsonToText(JSON.parse(JSON.stringify(json)))).toBe(engine.serialize('text'));

    const copy = createFullEditor();
    await copy.importJSON(JSON.parse(JSON.stringify(json)));
    expect(copy.serialize('text')).toBe(engine.serialize('text'));
    expect(jsonToText(copy.serialize('json'))).toBe(engine.serialize('text'));
  });

  it('does not embed the assets: Files.embedAssets runs for json and never for text', async () => {
    const engine = await load([p('a')]);
    const spy = vi.spyOn(Files.get(engine), 'embedAssets');
    engine.serialize('text');
    expect(spy).not.toHaveBeenCalled();
    engine.serialize('json');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('jsonToText', () => {
  it('reads the content of a block from an extension, whatever its type, and skips one without content', () => {
    const json = {
      version: '1',
      blocks: [
        { type: 'acme-note', props: { tone: 'loud' }, content: [{ text: 'custom ' }, { text: 'text', bold: true }] },
        { type: 'acme-widget', props: { text: 'in a prop, not read' } },
        { type: 'acme-card', content: [{ text: 'card' }], children: [{ type: 'acme-note', content: [{ text: 'inside' }] }] },
      ],
    };
    expect(jsonToText(json)).toBe('custom text\n\ncard\n\ninside');
  });

  it('accepts an empty export, a bare array, and nothing sensible', () => {
    expect(jsonToText({ blocks: [] })).toBe('');
    expect(jsonToText({ version: '1' })).toBe('');
    expect(jsonToText([])).toBe('');
    expect(jsonToText([p('a'), p('b')])).toBe('a\n\nb');
    expect(jsonToText(null)).toBe('');
    expect(jsonToText(undefined)).toBe('');
    expect(jsonToText({ blocks: [null, 'x', 3, p('ok')] })).toBe('ok');
  });
});

describe('the helpers, from the pure entry', () => {
  it('deltaToHtml still refuses an unsafe link, and keeps the label', () => {
    const html = deltaToHtml([
      { insert: 'click', attributes: { link: 'javascript:alert(1)' } },
      { insert: ' <b>', attributes: { bold: true } },
      { insert: 'ok', attributes: { link: 'https://example.com/a?x=1&y=2' } },
    ]);
    expect(html).toBe('click<strong> &lt;b&gt;</strong><a href="https://example.com/a?x=1&amp;y=2">ok</a>');
    expect(html).not.toContain('javascript');
  });

  it('deltaToMarkdown is the one the editor uses', () => {
    expect(deltaToMarkdown([{ insert: '5 * 3' }])).toBe('5 \\* 3');
  });
});

// ── The import graph ──────────────────────────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

/** The source without its comments (JSDoc `import('loro-crdt')` types and `@import` tags are not runtime imports). */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The runtime specifiers a module imports: static, re-exports and dynamic `import()`; never `import type`. */
function specifiersOf(source) {
  const code = stripComments(source);
  const found = [];
  for (const m of code.matchAll(/\bimport\s+(type\s+)?[^'";()]*?\bfrom\s*['"]([^'"]+)['"]/g)) if (!m[1]) found.push(m[2]);
  for (const m of code.matchAll(/\bexport\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) if (!m[1]) found.push(m[2]);
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

/** @param {string} from absolute file @param {string} specifier relative */
function resolveRelative(from, specifier) {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.js`, resolve(base, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${relative(ROOT, from)} imports ${specifier}, which does not resolve`);
}

/** Every file reachable from `entry`, and every non-relative or Svelte specifier met on the way (`file -> specifier`). */
function importGraph(entry) {
  const files = new Set();
  const offenders = [];
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.') || /\.svelte(\.js)?$/.test(specifier)) {
        offenders.push(`${relative(ROOT, file)} -> ${specifier}`);
        continue;
      }
      visit(resolveRelative(file, specifier));
    }
  };
  visit(resolve(ROOT, entry));
  return { files: [...files].map((f) => relative(ROOT, f).split(sep).join('/')).sort(), offenders };
}

describe('the import graph of @aionbuilders/nabu/format (it must not load the WebAssembly of Loro)', () => {
  it('imports no loro-crdt, no svelte and no .svelte file, directly or through any module it reaches', () => {
    const { files, offenders } = importGraph('src/lib/format.js');
    // The graph is really walked: the pure formatters and their helpers are in it.
    expect(files).toEqual(expect.arrayContaining([
      'src/lib/format.js',
      'src/lib/behaviors/text/delta-format.js',
      'src/lib/behaviors/text/markdown-syntax.js',
      'src/lib/utils/html.js',
      'src/lib/utils/extensions.js',
    ]));
    expect(offenders).toEqual([]);
  });

  it('the scan does catch the old home of deltaToHtml (text.behavior.svelte.js imports Loro and Svelte)', () => {
    const { offenders } = importGraph('src/lib/behaviors/text/text.behavior.svelte.js');
    expect(offenders.join('\n')).toContain('-> loro-crdt');
    expect(offenders.join('\n')).toContain('-> svelte');
  });

  it('the scan ignores a type-only import and a JSDoc import', () => {
    expect(specifiersOf("import type { A } from 'loro-crdt';\n/** @type {import('loro-crdt').Delta} */\n// import x from 'svelte'\nimport { b } from './b.js';")).toEqual(['./b.js']);
    expect(specifiersOf("export * from './a.js'; export { x } from 'loro-crdt'; await import('svelte');")).toEqual(['./a.js', 'loro-crdt', 'svelte']);
  });
});
