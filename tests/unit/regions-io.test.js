// @ts-nocheck
/**
 * Unit tests for the text forms and the clipboard of regions (ADR 016 lot 3, container model of ADR 018): markdown export
 * (data comment + title as a heading + body), HTML export (`<section data-nabu-region>`), `text/plain` of a copy, the internal
 * clipboard round trip (spanning regions, into a list / toggle: placement rule), JSON with every field type; and the markdown /
 * HTML IMPORT (ADR 018 lot C): title + body, the end of a region inferred from the levels, the closing comment written only when
 * needed, nested round trips.
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension, Paragraph } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { CalloutExtension } from '$lib/blocks/callout/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { RegionsExtension } from '$lib/blocks/region/index.js';
import { MarkdownPasteExtension, HtmlPasteExtension, NabuPasteExtension, PlainTextPasteExtension } from '$lib/paste/index.js';
import { safeJson, encodeTypeId } from '$lib/blocks/region/format.js';
import { regionBlockToMarkdown } from '$lib/blocks/region/serialize.js';

const BOOK = {
  part: { level: 1, label: 'Part {index}' },
  chapter: { level: 2, label: 'Chapitre {index} — {title}', numbering: 'document', fields: { synopsis: 'richtext', status: { type: 'enum', values: ['draft', 'final'] }, due: 'date', words: 'number', done: 'boolean', pov: 'text' } },
  scene: { level: 3, label: '{path} {title}', fields: { pov: 'text' } },
};

const EXTENSIONS = (types = BOOK) => [
  ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, ToggleExtension, CalloutExtension, CodeExtension, RichTextExtension,
  RegionsExtension(types ? { types } : undefined), MarkdownPasteExtension, HtmlPasteExtension, NabuPasteExtension, PlainTextPasteExtension, BlockExtension,
];

async function makeEditor(types = BOOK) {
  const engine = new Nabu({ extensions: EXTENSIONS(types) });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return engine;
}

const D = (text, attributes) => (attributes ? { insert: text, attributes } : { insert: text });
const p = (text) => ({ type: 'paragraph', partial: false, delta: [{ insert: text }] });
/** A region PasteBlock: the `title` of `fields` is the header (delta), `children` the body. */
const R = (regionType, fields = {}, children) => {
  const { title, ...rest } = fields;
  return { type: 'region', partial: false, props: { regionType, fields: rest }, ...(title ? { delta: [{ insert: title }] } : {}), ...(children ? { children } : {}) };
};

/** Replaces the document with PasteBlocks (importFragment: the same path as importJSON / importMarkdown). */
async function load(engine, blocks) { await engine.importFragment({ blocks }); return engine; }

/** `p(text)` / `R:type(title){children}` outline of the document. */
const outline = (engine) => {
  const walk = (b) => {
    const kids = b.children?.length ? `{${b.children.map(walk).join(' ')}}` : '';
    if (b.type === 'region') return `R:${b.regionType}(${b.title})${kids}`;
    const t = b.behaviors?.get('text')?.text ?? '';
    return `${b.type === 'paragraph' ? 'p' : b.type === 'heading' ? 'h' + b.level : b.type}(${t})${kids}`;
  };
  return engine.children.map(walk).join(' ; ');
};

/** The model of the root regions: type + title + every stored field (richtext as delta). */
const markers = (engine) => engine.children.filter((b) => b.type === 'region').map((b) => ({ regionType: b.regionType, title: b.title, fields: b.exportFields }));

const FULL = {
  title: 'La forêt',
  synopsis: [D('Elle', { italic: true }), D(' entre dans '), D('le bois', { bold: true, link: 'https://example.com/a_(b)' }), D('.\nSuite *étoile* \\ [x]')],
  status: 'final', due: '2026-10-22', words: 1234.5, done: true, pov: 'Anna',
};

// ═══ 1 · Markdown ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('markdown export of a region', () => {
  it('the data comment (sorted keys, minimal JSON, no title), then the title as a heading of the region level, then the body', async () => {
    const engine = await load(await makeEditor(), [R('part', { title: 'I' }, [p('x'), R('chapter', { title: 'La forêt', status: 'draft', pov: 'Anna' }, [R('scene', { title: 'Seuil' })])])]);
    expect(engine.serialize('markdown')).toBe([
      '<!-- region:part {} -->\n# I',
      'x',
      '<!-- region:chapter {"pov":"Anna","status":"draft"} -->\n## La forêt',
      '<!-- region:scene {} -->\n### Seuil',
    ].join('\n\n'));
  });

  it('the title is inline markdown (marks kept); an empty title leaves the comment alone', async () => {
    const engine = await load(await makeEditor({ scene: { level: 3 } }), [{ ...R('scene'), delta: [D('Le '), D('seuil', { italic: true })] }, R('scene')]);
    expect(engine.serialize('markdown')).toBe('<!-- region:scene {} -->\n### Le *seuil*\n\n<!-- region:scene {} -->');
  });

  it('every field type is carried in the comment (richtext as an inline markdown string), but not the title', async () => {
    const engine = await load(await makeEditor(), [R('chapter', FULL)]);
    const [line, heading] = engine.serialize('markdown').split('\n');
    const json = JSON.parse(line.replace(/^<!-- region:chapter /, '').replace(/ -->$/, ''));
    expect(json).toEqual({
      status: 'final', due: '2026-10-22', words: 1234.5, done: true, pov: 'Anna',
      synopsis: '*Elle* entre dans [**le bois**](https://example.com/a_(b)).\\\nSuite \\*étoile\\* \\\\ \\[x\\]',
    });
    expect(Object.keys(json)).toEqual([...Object.keys(json)].sort());
    expect(heading).toBe('## La forêt');
  });

  it('`-->`, markup and line separators in a field can never end the comment', async () => {
    const pov = 'a --> b <script>alert(1)</script> & \u2028 c';
    const engine = await load(await makeEditor(), [R('part', { title: 'T', pov })]);
    const md = engine.serialize('markdown');
    const [comment, heading] = md.split('\n');
    expect(comment.indexOf('-->')).toBe(comment.length - 3); // the only `-->` is the closing one
    expect(comment.slice('<!-- '.length, -' -->'.length)).not.toMatch(/[<>&\u2028\u2029]/);
    expect(comment).toContain('\\u003e');
    expect(heading).toBe('# T');
  });

  it('a heading level is clamped to 1..6 (a type declared at level 9, or 0)', () => {
    const def = (id, level) => [id, { id, level, label: '{title}', numbering: 'none', fields: new Map() }];
    const config = { types: new Map([def('deep', 9), def('zero', 0)]), defaultType: 'deep', maxLevel: 9 };
    expect(regionBlockToMarkdown(config, { regionType: 'deep', fields: {} }, 'x', [])).toBe('<!-- region:deep {} -->\n###### x');
    expect(regionBlockToMarkdown(config, { regionType: 'zero', fields: {} }, 'x', [])).toBe('<!-- region:zero {} -->\n# x');
  });

  it('a title is never a field: a `title` among the props is dropped from the comment', () => {
    const config = { types: new Map(), defaultType: 'x', maxLevel: 1 };
    expect(regionBlockToMarkdown(config, { regionType: 'x', fields: { title: 'nope', pov: 'a' } }, 'T', ['body'])).toBe('<!-- region:x {"pov":"a"} -->\n# T\n\nbody');
  });

  it('a type id with unusual characters is percent-encoded', async () => {
    expect(encodeTypeId('a.b c')).toBe('a%2Eb%20c');
    const engine = await load(await makeEditor({ 'a.b c': { level: 1 } }), [R('a.b c', { title: 'T' })]);
    expect(engine.serialize('markdown')).toBe('<!-- region:a%2Eb%20c {} -->\n# T');
  });

  it('nested levels give heading levels 1, 2, 3; the default sections too', async () => {
    const a = await load(await makeEditor(), [R('part', { title: 'A' }, [R('chapter', { title: 'B' }, [R('scene', { title: 'C' })])])]);
    expect(a.serialize('markdown').split('\n\n').map((s) => s.split('\n')[1])).toEqual(['# A', '## B', '### C']);
    const d = await load(await makeEditor(null), [R('section-1', { title: 'One' }, [R('section-2', { title: 'Two' }, [R('section-3', { title: 'Three' })])])]);
    expect(d.serialize('markdown')).toBe([
      '<!-- region:section-1 {} -->\n# One',
      '<!-- region:section-2 {} -->\n## Two',
      '<!-- region:section-3 {} -->\n### Three',
    ].join('\n\n'));
  });
});

// The closing comment: written only when what follows the region would be swallowed by it.
describe('markdown export: empty title and the closing comment', () => {
  const md = async (blocks, types = BOOK) => (await load(await makeEditor(types), blocks)).serialize('markdown');

  it('an empty title is the comment alone; a body that opens with a heading gets a bare heading (it would be read as the title)', async () => {
    expect(await md([R('scene', {}, [p('x')])])).toBe('<!-- region:scene {} -->\n\nx');
    const heading = { type: 'heading', partial: false, props: { level: 2 }, delta: [D('Sub')] };
    expect(await md([R('scene', {}, [heading]), R('scene', {})])).toBe('<!-- region:scene {} -->\n###\n\n## Sub\n\n<!-- region:scene {} -->');
  });

  it('no closing comment at the end of the document, nor when a region of the same or a higher level follows', async () => {
    expect(await md([R('chapter', { title: 'A' }, [p('x')])])).toBe('<!-- region:chapter {} -->\n## A\n\nx');
    expect(await md([R('chapter', { title: 'A' }, [p('x')]), R('chapter', { title: 'B' })])).not.toContain('/region');
    expect(await md([R('chapter', { title: 'A' }, [p('x')]), R('part', { title: 'B' })])).not.toContain('/region');
    // an empty paragraph exports nothing: it does not count as content after the region
    expect(await md([R('chapter', { title: 'A' }, [p('x')]), { type: 'paragraph', partial: false, delta: [] }])).not.toContain('/region');
  });

  it('a closing comment when content follows the region at its parent level', async () => {
    expect(await md([R('chapter', { title: 'A' }, [p('x')]), p('y')])).toBe('<!-- region:chapter {} -->\n## A\n\nx\n\n<!-- /region -->\n\ny');
    // a DEEPER region after it would nest in it: closed too
    expect(await md([R('chapter', { title: 'A' }), R('scene', { title: 'B' })])).toBe('<!-- region:chapter {} -->\n## A\n\n<!-- /region -->\n\n<!-- region:scene {} -->\n### B');
  });

  it('text after a sub-region closes the sub-region only; text after the region closes both (a region whose parent closes closes too)', async () => {
    const doc = (tail) => [R('part', { title: 'P' }, [R('chapter', { title: 'C' }, [p('c')]), p('in part')]), ...tail];
    expect(await md(doc([]))).toBe('<!-- region:part {} -->\n# P\n\n<!-- region:chapter {} -->\n## C\n\nc\n\n<!-- /region -->\n\nin part');
    expect(await md(doc([p('after')]))).toBe('<!-- region:part {} -->\n# P\n\n<!-- region:chapter {} -->\n## C\n\nc\n\n<!-- /region -->\n\nin part\n\n<!-- /region -->\n\nafter');
    const deep = [R('part', { title: 'P' }, [R('chapter', { title: 'C' }, [R('scene', { title: 'S' }, [p('s')])])]), p('after')];
    expect((await md(deep)).match(/<!-- \/region -->/g)).toHaveLength(3);
    // ... but when the parent does not close (end of document), the last child does not either
    expect((await md(deep.slice(0, 1))).match(/<!-- \/region -->/g)).toBeNull();
  });

  it('the static serializer (clipboard text/plain) applies the same rules from the following siblings', async () => {
    const engine = await makeEditor();
    const Region = engine.registry.get('region');
    const md = (b, ctx = {}) => {
      const Class = engine.registry.get(b.type);
      return Class.toMarkdown(b, { ...ctx, recurse: (c, o) => md(c, o), recurseAll: (cs, o) => cs.map((c, k) => md(c, { ...o, after: cs.slice(k + 1) })) });
    };
    const part = R('part', { title: 'P' }, [R('chapter', { title: 'C' }, [p('c')]), p('in part')]);
    expect(md(part, { after: [] })).not.toContain('/region -->\n\nafter');
    expect(md(part, { after: [p('after')] }).match(/<!-- \/region -->/g)).toHaveLength(2);
    expect(md(part, { after: [R('part', { title: 'Q' })] }).match(/<!-- \/region -->/g)).toHaveLength(1); // only the chapter's
    expect(Region.toMarkdown(R('part', { title: 'P' }), { after: [p('x')], recurse: () => 'x' })).toBe('<!-- region:part {} -->\n# P\n\n<!-- /region -->');
  });
});

describe('markdown import of a region', () => {
  it('the comment gives the type and the fields; the heading right after it is the TITLE (no heading block), the rest is the body', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('Preface\n\n<!-- region:chapter {"status":"draft"} -->\n## La *forêt*\n\nBody\n\nMore');
    expect(outline(engine)).toBe('p(Preface) ; R:chapter(La forêt){p(Body) p(More)}');
    expect(engine.children[1].behavior.toMarkdown()).toBe('La *forêt*');
    expect(markers(engine)[0].fields).toEqual({ status: 'draft' });
    expect(engine.regions.list[0].label).toBe('Chapitre 1 — La forêt');
  });

  it('the heading level is ignored (the type decides); an empty heading is an empty title', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<!-- region:chapter {} -->\n###### Whatever\n\nx\n\n<!-- region:chapter {} -->\n##\n\n## Real heading');
    expect(outline(engine)).toBe('R:chapter(Whatever){p(x)} ; R:chapter(){h2(Real heading)}');
  });

  it('the title line is optional: after a blank line, a heading is a real heading of the body', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<!-- region:part {} -->\n\n# Real heading\n\nText');
    expect(outline(engine)).toBe('R:part(){h1(Real heading) p(Text)}');
  });

  it('a heading WITHOUT the comment stays a heading (regions are never inferred from headings)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('## Chapitre 2 — La forêt\n\nText');
    expect(outline(engine)).toBe('h2(Chapitre 2 — La forêt) ; p(Text)');
    expect(engine.regions.count).toBe(0);
  });

  it('invalid JSON, wrong shape, other comments: the line stays literal text', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown([
      '<!-- region:part {"title": -->', '<!-- region:part {"title":"x"} --> trailing', '<!-- region:part [1,2] -->', '<!-- region:part "x" -->',
      '<!-- region:part {"a":1} -->x', '<!--region:part {"a":1} -->', '<!-- region: {"a":1} -->', '<!-- a normal comment -->', '<!-- region:part {} -->'.replace('part', 'pa rt'),
    ].join('\n\n'));
    const roots = engine.tree.roots();
    expect(roots.every((r) => r.data.get('type') === 'paragraph')).toBe(true);
    expect(roots.map((r) => r.data.get('text').toString())[0]).toBe('<!-- region:part {"title": -->');
    expect(engine.regions.count).toBe(0);
    const e2 = await makeEditor();
    await e2.importMarkdown('<!-- region:part {nope} -->\n## Title');
    expect(outline(e2)).toBe('p(<!-- region:part {nope} -->) ; h2(Title)');
  });

  it('an unknown region type falls back to the default (top-level) type, fields kept', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<!-- region:saga {"mood":"dark","n":3} -->\n# Saga');
    expect(markers(engine)).toEqual([{ regionType: 'part', title: 'Saga', fields: { mood: 'dark', n: 3 } }]);
  });

  it('a field of the wrong type for a declared field is dropped with a warning; unknown fields are kept', async () => {
    const engine = await makeEditor();
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    await engine.importMarkdown('<!-- region:chapter {"status":"nope","words":"12","extra":[1,{"a":true}]} -->\n## T');
    expect(markers(engine)).toEqual([{ regionType: 'chapter', title: 'T', fields: { extra: [1, { a: true }] } }]);
    expect(warn).toHaveBeenCalled();
  });

  it('a paste (one line = one block) reads the same construct, body included', async () => {
    const engine = await makeEditor();
    const fragment = MarkdownPasteExtension.pasteInterpreters[0].interpret('before\n<!-- region:part {"pov":"x"} -->\n# Part 1\nafter', engine);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'region']);
    expect(fragment.blocks[1]).toMatchObject({ props: { regionType: 'part', fields: { pov: 'x' } }, delta: [{ insert: 'Part 1' }], children: [{ type: 'paragraph', delta: [{ insert: 'after' }] }] });
  });

  it('a region inside a toggle body is hoisted after the toggle (root-only), its body with it', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<details open>\n<summary>T</summary>\n\nin body\n\n<!-- region:part {} -->\n# Part 1\n\nmore\n\n</details>\n\nafter');
    expect(outline(engine)).toBe('toggle(T){p(in body)} ; R:part(Part 1){p(more)} ; p(after)');
  });
});

describe('markdown import: where a region ends', () => {
  const read = async (md, types = BOOK) => { const e = await makeEditor(types); await e.importMarkdown(md); return e; };
  const O = (type, level, title) => `<!-- region:${type} {} -->\n${'#'.repeat(level)} ${title}`;

  it('the next opening of the same level closes it; a deeper one nests; a higher one closes every level below', async () => {
    const e = await read(['pre', O('part', 1, 'A'), 'a', O('chapter', 2, 'B'), 'b', O('scene', 3, 'C'), 'c', O('chapter', 2, 'D'), 'd', O('part', 1, 'E'), 'e'].join('\n\n'));
    expect(outline(e)).toBe('p(pre) ; R:part(A){p(a) R:chapter(B){p(b) R:scene(C){p(c)}} R:chapter(D){p(d)}} ; R:part(E){p(e)}');
  });

  it('a region ends at the end of the document / of the enclosing region (no closing comment)', async () => {
    const e = await read([O('part', 1, 'A'), O('chapter', 2, 'B'), 'tail of B'].join('\n\n'));
    expect(outline(e)).toBe('R:part(A){R:chapter(B){p(tail of B)}}');
  });

  it('a deeper region at the root nests in the region before it; the explicit closing comment prevents it', async () => {
    expect(outline(await read([O('chapter', 2, 'A'), O('scene', 3, 'B')].join('\n\n')))).toBe('R:chapter(A){R:scene(B)}');
    expect(outline(await read([O('chapter', 2, 'A'), '<!-- /region -->', O('scene', 3, 'B')].join('\n\n')))).toBe('R:chapter(A) ; R:scene(B)');
  });

  it('the explicit closing comment ends the region (and is consumed); text after it is back at the parent level', async () => {
    const e = await read([O('part', 1, 'P'), O('chapter', 2, 'C'), 'c', '<!-- /region -->', 'in part', '<!-- /region -->', 'after'].join('\n\n'));
    expect(outline(e)).toBe('R:part(P){R:chapter(C){p(c)} p(in part)} ; p(after)');
  });

  it('a closing comment closes the INNERMOST open region only', async () => {
    const e = await read([O('part', 1, 'P'), O('chapter', 2, 'C'), O('scene', 3, 'S'), 's', '<!-- /region -->', 'in chapter', '<!-- /region -->', 'in part'].join('\n\n'));
    expect(outline(e)).toBe('R:part(P){R:chapter(C){R:scene(S){p(s)} p(in chapter)} p(in part)}');
  });

  it('a stray closing comment (nothing to close) stays literal text', async () => {
    const e = await read(['before', '<!-- /region -->', 'after'].join('\n\n'));
    expect(outline(e)).toBe('p(before) ; p(<!-- /region -->) ; p(after)');
    expect(e.regions.count).toBe(0);
  });

  it('comments inside a fenced code block are code, not constructs', async () => {
    const fence = ['```', '<!-- /region -->', O('part', 1, 'NOT A REGION'), '```'].join('\n');
    const e = await read([O('chapter', 2, 'A'), fence, 'still in A', O('chapter', 2, 'B')].join('\n\n'));
    expect(outline(e)).toBe('R:chapter(A){code(<!-- /region -->\n<!-- region:part {} -->\n# NOT A REGION) p(still in A)} ; R:chapter(B)');
    // an unclosed fence runs to the end: what is in it is code too
    const open = await read([O('chapter', 2, 'A'), '```', O('part', 1, 'X')].join('\n\n'));
    expect(open.regions.count).toBe(1);
  });

  it('an opening comment right after a paragraph line (no blank line) interrupts it', async () => {
    const e = await read('text\n<!-- region:part {} -->\n# P\nbody');
    expect(outline(e)).toBe('p(text) ; R:part(P){p(body)}');
  });
});

describe('markdown round trip of documents with regions', () => {
  const roundTrip = async (blocks, types = BOOK) => {
    const a = await load(await makeEditor(types), blocks);
    const md = a.serialize('markdown');
    const b = await makeEditor(types);
    await b.importMarkdown(md);
    return { a, b, md };
  };
  const model = (engine) => allBlocks(engine).filter((b) => b.type === 'region').map((b) => ({ regionType: b.regionType, title: b.title, titleMd: b.behavior.toMarkdown(), fields: b.exportFields, parent: b.parent?.title ?? null }));
  const same = async (blocks, types) => {
    const { a, b, md } = await roundTrip(blocks, types);
    expect(outline(b)).toBe(outline(a));
    expect(model(b)).toEqual(model(a));
    expect(b.serialize('markdown')).toBe(md);
    return { a, b, md };
  };

  it('nested regions with every field type, text after sub-regions, preamble and postamble: tree, fields and markdown are fixed points', async () => {
    const { md } = await same([
      p('Preface'),
      R('part', { title: 'I' }, [
        p('x'),
        R('chapter', { title: 'La forêt', status: 'final', due: '2026-10-22', words: 3, done: false, pov: 'Anna' }, [
          p('c1'),
          R('scene', { title: 'Seuil', extra: { deep: [1, 2] } }, [p('s1'), p('s2')]),
          p('after the scene'),
          R('scene', { title: 'Second' }, [p('s3')]),
        ]),
        p('after the chapter'),
        R('chapter', { title: 'Fin' }, [p('end')]),
      ]),
      p('Postamble'),
      R('part', { title: 'II' }, [R('chapter', { title: 'Alone' })]),
    ]);
    expect(md).toContain('<!-- /region -->');
  });

  it('empty titles, a body that opens with a heading, empty regions and regions in a row', async () => {
    const heading = { type: 'heading', partial: false, props: { level: 2 }, delta: [D('Sub')] };
    await same([R('chapter', {}, [heading, p('x')]), R('chapter', {}), R('chapter', { title: '' }, [p('y')]), p('z'), R('part', {}), R('chapter', {})]);
  });

  it('titles with marks and awkward characters', async () => {
    const withMarks = { ...R('chapter'), delta: [D('Le '), D('seuil', { italic: true }), D(' & '), D('lien', { link: 'https://example.com/' }), D(' # *x* <b> \\')] };
    const { b } = await same([withMarks, p('x')]);
    expect(b.children[0].title).toBe('Le seuil & lien # *x* <b> \\');
  });

  it('richtext fields survive (marks, links, line break, escapes)', async () => {
    const { a, b } = await same([R('chapter', { title: 'T', synopsis: FULL.synopsis })]);
    expect(markers(b)[0].fields.synopsis).toEqual(markers(a)[0].fields.synopsis);
  });

  it('a document that STARTS or ENDS with a region; regions at the root among text', async () => {
    const { b } = await same([R('part', { title: 'A' }), p('x'), R('part', { title: 'B' }, [p('in B')]), p('y'), R('chapter', { title: 'C' })]);
    expect(b.regions.count).toBe(3);
  });

  it('the default sections: levels 1..3, labels "1.", "1.1"', async () => {
    const a = await load(await makeEditor(null), [R('section-1', { title: 'One' }, [R('section-2', { title: 'Two' }, [R('section-3', { title: 'Three' })])])]);
    expect(a.serialize('markdown')).toBe([
      '<!-- region:section-1 {} -->\n# One',
      '<!-- region:section-2 {} -->\n## Two',
      '<!-- region:section-3 {} -->\n### Three',
    ].join('\n\n'));
    const b = await makeEditor(null);
    await b.importMarkdown(a.serialize('markdown'));
    expect(outline(b)).toBe('R:section-1(One){R:section-2(Two){R:section-3(Three)}}');
    expect(b.regions.list.map((r) => r.label)).toEqual(['1. One', '1.1 Two', '1.1.1 Three']);
  });

  it('a region among other containers (toggle, list, callout) keeps the whole document', async () => {
    await same([
      R('part', { title: 'A' }, [
        { type: 'toggle', partial: false, props: { collapsed: false }, delta: [D('T')], children: [p('in toggle')] },
        { type: 'list', partial: false, props: { listType: 'bullet' }, children: [{ type: 'list-item', partial: false, delta: [D('one')] }, { type: 'list-item', partial: false, delta: [D('two')] }] },
      ]),
      p('after'),
    ]);
  });
});

// ═══ 2 · HTML ═════════════════════════════════════════════════════════════════════════════════════════════════════

const htmlInterpret = (engine, html) => HtmlPasteExtension.pasteInterpreters[0].interpret(html, engine);

describe('HTML form of a region', () => {
  const config = (engine) => engine.regions.config;

  it('export: a <section> with the type and the fields (no title) as escaped JSON, the title as a heading, then the body', async () => {
    const engine = await load(await makeEditor(), [R('chapter', { title: 'A "q" <b> & \'s\' -->', status: 'draft' }, [p('body <i>')])]);
    const pb = engine.children[0].serialize('application/x-nabu+json');
    const html = engine.registry.get('region').toHtml(pb, { recurse: (child) => `<p>${child.delta[0].insert.replace('<', '&lt;')}</p>` });
    expect(html).toBe('<section data-nabu-region="chapter" data-nabu-fields=\'{&quot;status&quot;:&quot;draft&quot;}\'><h2>A &quot;q&quot; &lt;b&gt; &amp; &#39;s&#39; --&gt;</h2><p>body &lt;i></p></section>');
    expect(html).not.toMatch(/<b>|<script/);
  });

});

describe('HTML import of a region', () => {
  const NESTED = '<p>before</p><section data-nabu-region="chapter" data-nabu-fields=\'{"status":"draft","pov":"Anna"}\'><h2>Le <em>seuil</em></h2><p>a</p>'
    + '<section data-nabu-region="scene" data-nabu-fields=\'{}\'><h3>Inner</h3><p>b</p></section><p>c</p></section><p>after</p>';

  it('a <section data-nabu-region> is a region: the first heading is the title (inline), the other children the body, nested', async () => {
    const engine = await makeEditor();
    const fragment = htmlInterpret(engine, NESTED);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'region', 'paragraph']);
    expect(fragment.blocks[1]).toMatchObject({ props: { regionType: 'chapter', fields: { status: 'draft', pov: 'Anna' } }, delta: [{ insert: 'Le ' }, { insert: 'seuil', attributes: { italic: true } }] });
    expect(fragment.blocks[1].children.map((c) => c.type)).toEqual(['paragraph', 'region', 'paragraph']);
    await load(engine, fragment.blocks);
    expect(outline(engine)).toBe('p(before) ; R:chapter(Le seuil){p(a) R:scene(Inner){p(b)} p(c)} ; p(after)');
  });

  it('round trip: Nabu\'s own HTML (every field, richtext, nested, empty title) comes back identical', async () => {
    const src = await load(await makeEditor(), [R('part', { title: 'I' }, [p('one'), R('chapter', FULL, [p('two'), R('scene', { title: '', pov: 'Bo' }, [p('in')]), p('three')])]), p('tail')]);
    const wholeHtml = (i) => wholeRegion(src, i).html;
    const html = wholeHtml(0);
    const engine = await makeEditor();
    await load(engine, htmlInterpret(engine, html).blocks);
    const model = (e) => allBlocks(e).filter((b) => b.type === 'region').map((b) => ({ regionType: b.regionType, title: b.title, titleMd: b.behavior.toMarkdown(), fields: b.exportFields }));
    expect(outline(engine)).toBe('R:part(I){p(one) R:chapter(La forêt){p(two) R:scene(){p(in)} p(three)}}');
    expect(model(engine)).toEqual(model(await load(await makeEditor(), [src.children[0].serializeForClipboard()])));
    expect(engine.serialize('markdown')).toBe(wholeRegion(src, 0).text);
  });

  it('a plain <section> and a plain <h2> keep their current meaning', async () => {
    const engine = await makeEditor();
    expect(htmlInterpret(engine, '<section><h2>T</h2><p>x</p></section>').blocks.map((b) => b.type)).toEqual(['heading', 'paragraph']);
    expect(htmlInterpret(engine, '<h2>Chapitre 2</h2><h1 data-other="x">T</h1>').blocks.map((b) => b.type)).toEqual(['heading', 'heading']);
    expect(htmlInterpret(engine, '<section data-nabu-region=""><h2>T</h2><p>x</p></section>').blocks.map((b) => b.type)).toEqual(['heading', 'paragraph']);
    expect(htmlInterpret(engine, '<section data-nabu-region="' + 'x'.repeat(300) + '"><p>x</p></section>').blocks.map((b) => b.type)).toEqual(['paragraph']);
    // the attribute on anything but a <section> is nothing (the old heading marker is gone)
    expect(htmlInterpret(engine, '<h2 data-nabu-region="chapter">T</h2>').blocks.map((b) => b.type)).toEqual(['heading']);
  });

  it('a section whose first child is not a heading has an empty title; only the FIRST child can be the title', async () => {
    const engine = await makeEditor();
    const [region] = htmlInterpret(engine, '<section data-nabu-region="part"><p>intro</p><h2>Later</h2></section>').blocks;
    expect(region.delta ?? []).toEqual([]);
    expect(region.children.map((c) => c.type)).toEqual(['paragraph', 'heading']);
  });

  it('invalid / hostile data: bad JSON = a region without fields; unknown type = default type; unsafe link dropped; no HTML ever passes through', async () => {
    const engine = await makeEditor();
    const one = (attrs, inner = '<h2>x</h2>') => htmlInterpret(engine, `<section ${attrs}>${inner}</section>`).blocks;
    expect(one(`data-nabu-region="chapter" data-nabu-fields="{nope"`)[0].props).toEqual({ regionType: 'chapter', fields: {} });
    expect(one(`data-nabu-region="chapter" data-nabu-fields="[1]"`)[0].props.fields).toEqual({});
    expect(one(`data-nabu-region="saga" data-nabu-fields='{"mood":"dark","__proto__":{"x":1}}'`)[0].props).toEqual({ regionType: 'part', fields: { mood: 'dark' } });
    const evil = one(`data-nabu-region="chapter" data-nabu-fields='{"synopsis":"[click](javascript:alert(1)) <img src=x onerror=alert(1)>"}' onclick="alert(1)"`, '<h2><script>alert(1)</script>T</h2><p onclick="x()">b</p>')[0];
    expect(JSON.stringify(evil.props.fields.synopsis)).not.toContain('javascript');
    await load(engine, [evil]);
    expect(engine.children[0].title).not.toContain('<');
    expect(engine.children[0].richtext('synopsis').toString()).toContain('click');
    expect(JSON.stringify(engine.children[0].exportFields.synopsis)).not.toContain('javascript');
    expect(JSON.stringify(engine.serialize('json'))).not.toMatch(/onclick|<script/);
  });
});

// ═══ 3 · Clipboard (copy → text/plain, text/html, internal fragment → paste) ═════════════════════════════════════

const allBlocks = (engine) => {
  const all = [];
  const walk = (b) => { all.push(b); (b.children ?? []).forEach(walk); };
  engine.children.forEach(walk);
  return all;
};
const textOf = (b) => b.behaviors?.get('text')?.text;

/** Select from `from`@`fromOffset` to `to`@`toOffset` (blocks found by text or by index), run handleCopy. */
function copy(engine, from, fromOffset, to, toOffset) {
  const pick = (spec) => (typeof spec === 'number' ? engine.children[spec] : allBlocks(engine).find((b) => textOf(b) === spec));
  const first = pick(from);
  const last = pick(to);
  engine.selection = {
    sync: vi.fn(), isCollapsed: false, startBlock: first, endBlock: last,
    start: { from: fromOffset }, end: { to: toOffset }, setCursor: vi.fn(), anchorBlock: first, focusBlock: last,
  };
  const data = {};
  engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
  return { data, fragment: data['application/x-nabu+json'] ? JSON.parse(data['application/x-nabu+json']) : null, html: data['text/html'], text: data['text/plain'] };
}

/** Paste a clipboard (the formats of a copy) at the end of the text block `target`. */
async function pasteAt(engine, data, target, offset) {
  const block = allBlocks(engine).find((b) => textOf(b) === target);
  Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  const event = { preventDefault: vi.fn(), clipboardData: { getData: (k) => data[k] ?? '', types: Object.keys(data), files: [], items: [] } };
  engine.handlePaste(event);
  await tick();
  await engine.commit();
  await tick();
}

const CHAPTER_FIELDS = { synopsis: [D('un '), D('résumé', { bold: true })], status: 'draft', words: 7, done: true, due: '2026-01-02' };

/** A document with a part holding two chapters; the selections below start in 'intro' and end in 'tail', around the whole part. */
const SOURCE = () => [
  p('intro'),
  R('part', { title: 'I' }, [p('one'), R('chapter', { title: 'La forêt', ...CHAPTER_FIELDS }, [p('two')]), R('chapter', { title: 'Le lac' }, [p('three')])]),
  p('tail'),
];

/**
 * The clipboard of a WHOLE region, structure included (what a structure gesture — seam, future block selection — will copy):
 * `serializeForClipboard()` without a text selection, and the text forms the engine writes for such a fragment.
 */
function wholeRegion(engine, index) {
  const pb = engine.children[index].serializeForClipboard();
  const md = (b, ctx = {}) => {
    const Class = engine.registry.get(b.type);
    return Class?.toMarkdown ? Class.toMarkdown(b, { ...ctx, recurse: (c, o) => md(c, o), recurseAll: (cs, o) => cs.map((c, k) => md(c, { ...o, before: cs.slice(0, k), after: cs.slice(k + 1) })) }) : (b.delta ?? []).map((op) => op.insert).join('');
  };
  const html = (b) => {
    const Class = engine.registry.get(b.type);
    return Class?.toHtml ? Class.toHtml(b, { recurse: html }) : `<p>${(b.delta ?? []).map((op) => op.insert).join('')}</p>`;
  };
  const data = { 'application/x-nabu+json': JSON.stringify({ version: 1, blocks: [pb] }), 'text/plain': md(pb), 'text/html': html(pb) };
  return { pb, data, text: data['text/plain'], html: data['text/html'] };
}

describe('clipboard: a text selection spanning regions copies the TEXT only (ADR 018 §3.9)', () => {
  it('the internal fragment holds the text blocks only: no region container, no title', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { fragment } = copy(engine, 'intro', 2, 'tail', 2);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(fragment.blocks.map((b) => b.delta.map((op) => op.insert).join(''))).toEqual(['tro', 'one', 'two', 'three', 'ta']);
    expect(fragment.blocks.map((b) => b.partial)).toEqual(['start', false, false, false, 'end']);
    expect(JSON.stringify(fragment)).not.toContain('forêt');
  });

  it('text/plain and text/html carry the text, without the region markers', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { text, html } = copy(engine, 'intro', 2, 'tail', 2);
    expect(text).toBe('tro\n\none\n\ntwo\n\nthree\n\nta');
    expect(html).not.toContain('data-nabu-region');
    expect(html).not.toContain('<section');
  });

  it('a selection inside ONE region body is the text blocks too (the container is not created)', async () => {
    const engine = await load(await makeEditor(), [R('part', { title: 'I' }, [p('alpha'), p('beta'), p('gamma')])]);
    const { fragment, text } = copy(engine, 'alpha', 1, 'gamma', 2);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(text).toBe('lpha\n\nbeta\n\nga');
  });

  it('a selection ending in a title leaves the title out (nothing of it is copied)', async () => {
    const engine = await load(await makeEditor(), [p('intro'), R('part', { title: 'Title' }, [p('one')])]);
    const { fragment } = copy(engine, 'intro', 2, 'Title', 3);
    expect(fragment.blocks.map((b) => b.delta.map((op) => op.insert).join(''))).toEqual(['tro']);
  });

  it('a selection entirely INSIDE a title copies that title text', async () => {
    const engine = await load(await makeEditor(), [R('part', { title: 'Title' }, [p('one')])]);
    const { text } = copy(engine, 'Title', 1, 'Title', 4);
    expect(text).toBe('itl');
  });
});

describe('clipboard: a whole region (structure) round trip', () => {
  it('the internal fragment carries each region as a container: props (richtext as delta, no title), title delta, children', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { pb: part } = wholeRegion(engine, 1);
    expect(part).toMatchObject({ type: 'region', props: { regionType: 'part', fields: {} }, delta: [{ insert: 'I' }] });
    expect(part.children.map((b) => b.type)).toEqual(['paragraph', 'region', 'region']);
    expect(part.children[1]).toMatchObject({
      type: 'region',
      props: { regionType: 'chapter', fields: { synopsis: [{ insert: 'un ' }, { insert: 'résumé', attributes: { bold: true } }], status: 'draft', words: 7, done: true, due: '2026-01-02' } },
      delta: [{ insert: 'La forêt' }],
    });
    expect(part.children[1].props.fields.title).toBeUndefined();
    expect(part.children[1].children).toMatchObject([{ type: 'paragraph', delta: [{ insert: 'two' }] }]);
  });

  it('text/plain (several blocks) is the markdown form: comment + title heading + body', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { text } = wholeRegion(engine, 1);
    expect(text).toBe([
      '<!-- region:part {} -->\n# I',
      'one',
      '<!-- region:chapter {"done":true,"due":"2026-01-02","status":"draft","synopsis":"un **résumé**","words":7} -->\n## La forêt',
      'two',
      '<!-- region:chapter {} -->\n## Le lac',
      'three',
    ].join('\n\n')); // the whole region is last: nothing follows, no closing comment
  });

  it('text/plain: the closing comments appear when text follows the region, then it reads back identically', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { pb } = wholeRegion(engine, 1);
    const Region = engine.registry.get('region');
    const text = Region.toMarkdown(pb, { after: [p('tail')], recurse: (c) => (c.type === 'region' ? '' : c.delta[0].insert), recurseAll: (cs, o) => cs.map((c, k) => (c.type === 'region' ? Region.toMarkdown(c, { ...o, recurse: (x) => x.delta[0].insert, recurseAll: (xs) => xs.map((x) => x.delta[0].insert), after: cs.slice(k + 1) }) : c.delta[0].insert)) });
    expect(text.endsWith('three\n\n<!-- /region -->\n\n<!-- /region -->')).toBe(true); // the last chapter and the part
  });

  it('text/html: <section> elements nested like the regions', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { html } = wholeRegion(engine, 1);
    expect(html).toContain('<section data-nabu-region="part" data-nabu-fields=\'{}\'><h1>I</h1><p>one</p><section data-nabu-region="chapter"');
    expect(html).toContain('<h2>Le lac</h2><p>three</p></section></section>');
    expect(html.match(/data-nabu-region/g)).toHaveLength(3);
  });

  it('pasting it at the END of the document reproduces the regions with every field and their body', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { data } = wholeRegion(engine, 1);
    await pasteAt(engine, data, 'tail', 4);
    const source = 'p(intro) ; R:part(I){p(one) R:chapter(La forêt){p(two)} R:chapter(Le lac){p(three)}} ; p(tail';
    expect(outline(engine)).toBe(`${source}) ; R:part(I){p(one) R:chapter(La forêt){p(two)} R:chapter(Le lac){p(three)}}`);
    const [first, second] = engine.regions.tree;
    expect(first.children.map((r) => r.exportFields ?? r.block.exportFields)).toEqual(second.children.map((r) => r.block.exportFields));
    expect(engine.regions.list.map((r) => r.label)).toEqual(['Part 1', 'Chapitre 1 — La forêt', 'Chapitre 2 — Le lac', 'Part 2', 'Chapitre 3 — La forêt', 'Chapitre 4 — Le lac']);
  });

  it('into ANOTHER editor with the same types, then one that declares other types (the type is kept, the registry treats it as an unnumbered leaf)', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { data } = wholeRegion(engine, 1);
    const other = await load(await makeEditor(), [p('target')]);
    await pasteAt(other, data, 'target', 6);
    expect(outline(other)).toBe('p(target) ; R:part(I){p(one) R:chapter(La forêt){p(two)} R:chapter(Le lac){p(three)}}');
    expect(other.regions.list.map((r) => r.label)).toEqual(['Part 1', 'Chapitre 1 — La forêt', 'Chapitre 2 — Le lac']);
    const poor = await load(await makeEditor({ section: { level: 1 } }), [p('target')]);
    await pasteAt(poor, data, 'target', 6);
    expect(poor.children.filter((b) => b.type === 'region').map((b) => b.regionType)).toEqual(['part']);
  });

  const EXPECTED = 'p(intro) ; R:part(I){p(one) R:chapter(La forêt){p(two)} R:chapter(Le lac){p(three)}} ; p(tail';

  it('only the markdown text/plain (another application’s clipboard) restores the regions too', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { text } = wholeRegion(engine, 1);
    await pasteAt(engine, { 'text/plain': text }, 'tail', 4);
    expect(outline(engine)).toBe(`${EXPECTED}) ; R:part(I){p(one) R:chapter(La forêt){p(two)} R:chapter(Le lac){p(three)}}`);
    expect(engine.regions.list.map((r) => r.label)).toEqual(['Part 1', 'Chapitre 1 — La forêt', 'Chapitre 2 — Le lac', 'Part 2', 'Chapitre 3 — La forêt', 'Chapitre 4 — Le lac']);
  });

  it('only the text/html (Nabu’s own HTML, no internal fragment) restores the regions too', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { html } = wholeRegion(engine, 1);
    await pasteAt(engine, { 'text/html': html }, 'tail', 4);
    expect(outline(engine)).toBe(`${EXPECTED}) ; R:part(I){p(one) R:chapter(La forêt){p(two)} R:chapter(Le lac){p(three)}}`);
    const [first, second] = engine.regions.tree;
    expect(first.children.map((r) => r.block.exportFields)).toEqual(second.children.map((r) => r.block.exportFields));
  });
});

describe('clipboard: regions pasted into containers follow the placement rule', () => {
  const marker = () => ({ type: 'region', partial: false, props: { regionType: 'chapter', fields: {} }, delta: [{ insert: 'Pasted' }] });
  const paste = async (engine, blocks) => { engine.insertFragment({ blocks }); await tick(); await engine.commit(); };
  const at = async (specs, caretText, offset) => {
    const engine = await makeEditor();
    await engine.importMarkdown(specs);
    const block = allBlocks(engine).find((b) => textOf(b) === caretText);
    Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
    engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    return engine;
  };

  it('in a toggle BODY: hoisted right AFTER the toggle', async () => {
    const engine = await at('<details open>\n<summary>T</summary>\n\nbody one\n\nbody two\n\n</details>\n\nafter', 'body one', 8);
    await paste(engine, [p('x'), marker(), p('y')]);
    expect(engine.children.map((b) => b.type)).toEqual(['toggle', 'region', 'paragraph']);
    expect(engine.children[0].children.map(textOf)).toEqual(['body onex', 'y', 'body two']);
    expect(engine.regions.list.map((r) => r.title)).toEqual(['Pasted']);
    expect(violations(engine)).toEqual([]);
  });

  it('in a list item: the list is split around the region, which is at the root', async () => {
    const engine = await at('- one\n- two\n- three', 'two', 3);
    await paste(engine, [p('x'), marker(), p('y')]);
    // the pasted paragraph joins the item, the list normalizer cuts the list around the region (its remainder follows it)
    expect(treeOf(engine)).toBe('list[list-item(one) list-item(twox)] ; region(Pasted) ; paragraph(y) ; list[list-item(three)]');
    expect(engine.regions.count).toBe(1);
    expect(violations(engine)).toEqual([]);
  });

  it('in a nested list item: the region lands at the root after the top-level list structure', async () => {
    const engine = await at('- one\n  - nested\n- three', 'nested', 6);
    await paste(engine, [p('x'), marker(), p('y')]);
    expect(treeOf(engine)).toBe('list[list-item(one)[list[list-item(nestedx)]]] ; region(Pasted) ; paragraph(y) ; list[list-item(three)]');
    expect(violations(engine)).toEqual([]);
  });

  it('in a callout: hoisted after it', async () => {
    const engine = await at('> [!NOTE]\n> note text', 'note text', 4);
    await paste(engine, [p('x'), marker(), p('y')]);
    expect(violations(engine)).toEqual([]);
    expect(engine.regions.count).toBe(1);
  });
});

const treeOf = (engine) => { const w = (b) => `${b.type}${textOf(b) !== undefined ? '(' + textOf(b) + ')' : ''}${b.children?.length ? '[' + b.children.map(w).join(' ') + ']' : ''}`; return engine.children.map(w).join(' ; '); };
/** A region must be at the root or directly in a region body. */
function violations(engine) {
  const out = [];
  for (const b of allBlocks(engine)) if (b.type === 'region' && b.parent && b.parent.type !== 'region') out.push(`misplaced region ${b.id}`);
  return out;
}

// ═══ 4 · JSON ═════════════════════════════════════════════════════════════════════════════════════════════════════

describe('JSON export / import of regions with every field type', () => {
  it('text, richtext, enum, date, number, boolean and an unknown field, the title as content, the body as children: exact, twice', async () => {
    const a = await load(await makeEditor(), [p('x'), R('chapter', FULL, [p('in the body'), R('scene', { title: 'S', pov: 'Bo', unknown: { k: [1, null, 'z'] } })])]);
    const json = JSON.parse(JSON.stringify(a.serialize('json')));
    expect(json.blocks[1]).toMatchObject({ type: 'region', props: { regionType: 'chapter', fields: { status: 'final', due: '2026-10-22', words: 1234.5, done: true, pov: 'Anna' } }, content: [{ text: 'La forêt' }] });
    expect(json.blocks[1].props.fields.title).toBeUndefined();
    expect(Array.isArray(json.blocks[1].props.fields.synopsis)).toBe(true);
    expect(json.blocks[1].children.map((c) => c.type)).toEqual(['paragraph', 'region']);
    const b = await makeEditor();
    await b.importJSON(json);
    expect(outline(b)).toBe(outline(a));
    expect(markers(b)).toEqual(markers(a));
    expect(b.children[1].richtext('synopsis').toDelta()).toEqual(a.children[1].richtext('synopsis').toDelta());
    expect(b.children[1].children[1].exportFields).toEqual(a.children[1].children[1].exportFields);
    const c = await makeEditor();
    await c.importJSON(JSON.stringify(b.serialize('json')));
    const noIds = (doc) => JSON.parse(JSON.stringify(doc, (key, value) => (key === 'id' ? undefined : value)));
    expect(noIds(c.serialize('json'))).toEqual(noIds(a.serialize('json')));
  });
});

describe('format helpers', () => {
  it('safeJson sorts keys at every level and never emits `>` `<` `&`', () => {
    expect(safeJson({ b: 1, a: { d: '>', c: '<&' } })).toBe('{"a":{"c":"\\u003c\\u0026","d":"\\u003e"},"b":1}');
  });
});
