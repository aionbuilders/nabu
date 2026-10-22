// @ts-nocheck
/**
 * STRUCTURAL round trip of import / export (lot 5e): the TREE (types, props, deltas, children) must survive
 * `serialize('json')` -> `importJSON` exactly, and `serialize('markdown')` -> `importMarkdown` for everything markdown can
 * express. The comparison reads the MODEL (every key stored on the Loro node), not a serialization, so a field the
 * serializer forgets cannot hide. See docs/design/import-export.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { Files } from '$lib/files/files.svelte.js';
import { List } from '$lib/blocks/list/list.svelte.js';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { BlockquoteExtension } from '$lib/blocks/blockquote/index.js';
import { DividerExtension } from '$lib/blocks/divider/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { CalloutExtension } from '$lib/blocks/callout/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { VideoExtension } from '$lib/blocks/video/index.js';
import { FileExtension } from '$lib/blocks/file/index.js';
import { DialogueExtension } from '$lib/blocks/dialogue/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';
import { RegionsExtension } from '$lib/blocks/region/index.js';

// Region markers (ADR 016, lot 3): every field type, so that the JSON AND the markdown form of a marker are checked on the model.
const REGION_TYPES = {
    part: { level: 1, label: 'Part {index}' },
    chapter: { level: 2, label: 'Chapter {index} - {title}', numbering: 'document', fields: { synopsis: 'richtext', status: { type: 'enum', values: ['draft', 'final'] }, due: 'date', words: 'number', done: 'boolean', pov: 'text' } },
};

const extensions = [ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ToggleExtension, ImageExtension, VideoExtension, FileExtension, DialogueExtension, ListExtension, ListItemExtension, RichTextExtension, MarkdownPasteExtension, RegionsExtension({ types: REGION_TYPES })];

const t = (s, attributes) => (attributes ? { insert: s, attributes } : { insert: s });
const item = (delta, extra = {}) => ({ type: 'list-item', delta: typeof delta === 'string' ? [t(delta)] : delta, partial: false, ...extra });
const list = (listType, items, start) => ({ type: 'list', props: start ? { listType, start } : { listType }, children: items, partial: false });
const todo = (text, checked, children) => item(text, { props: { checked }, ...(children ? { children } : {}) });
const p = (...delta) => ({ type: 'paragraph', delta: delta.map((d) => (typeof d === 'string' ? t(d) : d)) });

/** A Loro map as plain data (a text container inside is its delta: marks included). */
const dumpMap = (map) => Object.fromEntries(map.keys().sort().map((k) => { const v = map.get(k); return [k, v && typeof v.toDelta === 'function' ? v.toDelta() : v]; }));

/** Every key stored on a node, recursively (text containers as deltas). Ids are not part of the comparison. */
export function dump(node) {
    const props = {};
    for (const key of node.data.keys()) {
        if (key === 'type') continue;
        const v = node.data.get(key);
        props[key] = v && typeof v.toDelta === 'function' ? v.toDelta() : v && typeof v.kind === 'function' && v.kind() === 'Map' ? dumpMap(v) : v;
    }
    return { type: node.data.get('type'), props, children: (node.children() ?? []).map(dump) };
}
const tree = (engine) => engine.tree.roots().map(dump);
const typesOf = (engine) => engine.tree.roots().map((r) => r.data.get('type'));

const SINK = [
    { type: 'heading', props: { level: 1 }, delta: [t('Title')] },
    { type: 'heading', props: { level: 2 }, delta: [t('Two')] },
    { type: 'heading', props: { level: 3 }, delta: [t('Three')] },
    { type: 'heading', props: { level: 4 }, delta: [t('Four')] },
    { type: 'heading', props: { level: 5 }, delta: [t('Five')] },
    { type: 'heading', props: { level: 6 }, delta: [t('Six '), t('bold', { bold: true })] },
    p('Plain ', t('bold', { bold: true }), ' ', t('italic', { italic: true }), ' ', t('strike', { strikethrough: true }), ' ', t('under', { underline: true }), ' ', t('code', { code: true }), ' and ', t('a link', { link: 'https://example.com/a_(b)' }), '.'),
    p(t('bold link', { bold: true, link: 'https://example.com/' }), ' and *stars* \\ backslash _under_ `tick` [brackets](x) <b>tags</b> # hash'),
    p('line one\nline two'),
    { type: 'blockquote', delta: [t('A '), t('quote', { italic: true })] },
    { type: 'divider' },
    // markers: a part, a chapter with every field type (richtext with marks and a link), directly followed by a real heading, an empty one
    { type: 'region', props: { regionType: 'part', fields: { title: 'Part --> <b>one</b> & "q"' } } },
    { type: 'region', props: { regionType: 'chapter', fields: { title: 'La forêt', synopsis: [t('Elle', { italic: true }), t(' entre dans '), t('le bois', { bold: true, link: 'https://example.com/a_(b)' }), t('.\nSuite *étoile* \\ [x]')], status: 'final', due: '2026-10-22', words: 1234.5, done: false, pov: 'Anna', extra: { k: [1, null, 'z'] } } } },
    { type: 'heading', props: { level: 2 }, delta: [t('A real heading right after a marker')] },
    { type: 'region', props: { regionType: 'chapter', fields: {} } },
    { type: 'code', props: { language: 'js' }, delta: [t('let a = 1;\n\nconsole.log(`a`);')] },
    { type: 'code', props: { language: null }, delta: [t('no language')] },
    { type: 'code', props: { language: 'md' }, delta: [t('```\nfence inside\n```')] },
    { type: 'callout', props: { variant: 'note' }, delta: [t('A note')] },
    { type: 'callout', props: { variant: 'tip' }, delta: [t('A '), t('tip', { bold: true })] },
    { type: 'callout', props: { variant: 'warning' }, delta: [t('first\nsecond')] },
    { type: 'callout', props: { variant: 'important' }, delta: [t('Important')] },
    { type: 'callout', props: { variant: 'caution' }, delta: [t('Careful')] },
    { type: 'dialogue', delta: [t('Hello '), t('there', { italic: true })] },
    { type: 'image', props: { ref: 'https://example.com/i.png', alt: 'an image', name: 'i.png' } },
    { type: 'image', props: { ref: 'https://example.com/b.png', alt: '' } },
    { type: 'video', props: { ref: 'https://example.com/v.mp4', alt: 'a video', name: 'v.mp4' } },
    { type: 'file', props: { ref: 'https://example.com/f.pdf', name: 'f.pdf' } },
    list('bullet', [
        item('one', { children: [
            list('ordered', [
                item('three'),
                item('four', { children: [list('todo', [todo('todo a', false), todo('todo b', true)])] }),
            ], 3),
        ] }),
        // P-28: one item, several sublists of different types
        item('multi', { children: [list('bullet', [item('m1')]), list('ordered', [item('m2')]), list('todo', [todo('m3', true)])] }),
        item([t('two '), t('bold', { bold: true })]),
    ]),
    list('ordered', [item('first'), item('second')]),
    list('todo', [todo('open', false), todo('done', true)]),
    {
        type: 'toggle', props: { collapsed: false }, delta: [t('Open toggle '), t('bold', { bold: true })], children: [
            p('inside the toggle'),
            list('bullet', [item('in a list')]),
            { type: 'toggle', props: { collapsed: true }, delta: [t('Nested collapsed')], children: [p('deep'), { type: 'code', props: { language: 'py' }, delta: [t('x = 1')] }] },
            { type: 'heading', props: { level: 2 }, delta: [t('Heading in toggle')] },
        ],
    },
    { type: 'toggle', props: { collapsed: true }, delta: [t('Collapsed toggle')], children: [p('hidden body'), p('second')] },
    { type: 'toggle', props: { collapsed: true }, delta: [t('Empty toggle')] },
    p('# not a heading'),
    p('- not a list'),
    p('<details> literal'),
];

async function make(blocks = SINK) {
    const engine = new Nabu({ extensions });
    await engine.importFragment({ blocks });
    return engine;
}
const clone = (v) => JSON.parse(JSON.stringify(v));

describe('JSON round trip (structure)', () => {
    it('the kitchen sink survives serialize(json) -> importJSON with every prop', async () => {
        const a = await make();
        const before = tree(a);
        expect(before.length).toBe(SINK.length);
        const b = new Nabu({ extensions });
        await b.importJSON(clone(a.serialize('json')));
        expect(tree(b)).toEqual(before);
        // and again from a string, a second generation
        const c = new Nabu({ extensions });
        await c.importJSON(JSON.stringify(b.serialize('json')));
        expect(tree(c)).toEqual(before);
    });

    it('the markers of the sink keep every field (the model is compared, richtext with its marks)', async () => {
        const a = await make();
        const regions = tree(a).filter((n) => n.type === 'region');
        expect(regions.length).toBe(3);
        expect(regions[1].props.regionType).toBe('chapter');
        expect(regions[1].props.fields.synopsis[0]).toEqual({ insert: 'Elle', attributes: { italic: true } });
        expect(regions[1].props.fields).toMatchObject({ status: 'final', due: '2026-10-22', words: 1234.5, done: false, pov: 'Anna', title: 'La forêt' });
    });

    it('every block type of the sink is covered (guard: a new block type must join the kitchen sink)', async () => {
        const a = await make();
        const types = new Set();
        const walk = (n) => { types.add(n.type); n.children.forEach(walk); };
        tree(a).forEach(walk);
        const registered = [...a.registry.keys()];
        for (const type of registered) expect(types.has(type), `block type "${type}" is missing from the kitchen sink`).toBe(true);
    });

    it('the document carries a version; the media status survives, a pending block is not exported as final', async () => {
        const a = await make([
            { type: 'image', props: { ref: 'https://example.com/ok.png', alt: 'ok', status: 'ready' } },
            { type: 'image', props: { ref: '', alt: 'broken', name: 'broken.png', status: 'error' } },
            { type: 'video', props: { ref: 'nabu-asset:ghost', name: 'v.mp4', status: 'missing' } },
            { type: 'file', props: { ref: 'nabu-pending:1234', name: 'doc.pdf', status: 'pending' } },
            { type: 'image', props: { ref: '', alt: 'still uploading', status: 'pending' } },
        ]);
        const json = a.serialize('json');
        expect(json.version).toBe('1');
        expect(json.blocks.map((b) => b.props.status)).toEqual([undefined, 'error', 'missing', 'missing', 'missing']);
        // a transient ref never leaves the document; the label stays
        expect(json.blocks[3].props).toEqual({ ref: '', alt: '', name: 'doc.pdf', status: 'missing' });
        expect(JSON.stringify(json)).not.toContain('nabu-pending');
        const b = new Nabu({ extensions });
        await b.importJSON(clone(json));
        expect(tree(b).map((n) => n.props.status)).toEqual(['ready', 'error', 'missing', 'missing', 'missing']);
        expect(tree(b)[1].props).toMatchObject({ alt: 'broken', name: 'broken.png', ref: '' });
        // the markdown of a block with no source is its label
        expect(a.serialize('markdown')).not.toContain('nabu-pending');
    });

    it('the bytes of a nabu-asset: media travel in the export (assets map, keyed by hash) and are re-created on import; without them the block is missing', async () => {
        const a = new Nabu({ extensions });
        const ref = await Files.get(a).persist(new File([new Uint8Array([1, 2, 3, 250])], 'p.png', { type: 'image/png' }));
        const id = ref.slice('nabu-asset:'.length);
        expect(id).toMatch(/^sha256-[0-9a-f]{64}$/);
        await a.importFragment({ blocks: [{ type: 'image', props: { ref, alt: 'embedded', name: 'p.png' } }] });
        const json = clone(a.serialize('json'));
        expect(json.assets[id]).toMatchObject({ mime: 'image/png', name: 'p.png', size: 4 });
        expect(json.blocks[0].props.ref).toBe(ref);

        const b = new Nabu({ extensions });
        await b.importJSON(json);
        const asset = Files.get(b).getAsset(ref);
        expect([...asset.data]).toEqual([1, 2, 3, 250]);
        expect(await Files.get(b).store.has(id)).toBe(true);
        expect(tree(b)[0].props).toMatchObject({ ref, status: 'ready', alt: 'embedded' });

        const c = new Nabu({ extensions });
        const { assets: _dropped, ...withoutBytes } = json;
        await c.importJSON(withoutBytes);
        await Files.get(c).whenIdle();
        expect(tree(c)[0].props.status).toBe('missing');
    });

    it('a beta export (nabu-asset:<uuid> keys) still imports: the file gets its hash ref', async () => {
        const json = { version: '1', blocks: [{ id: 'x', type: 'image', props: { ref: 'nabu-asset:abc', alt: 'old', name: 'p.png' } }], assets: { abc: { mime: 'image/png', name: 'p.png', size: 4, data: btoa(String.fromCharCode(1, 2, 3, 250)) } } };
        const b = new Nabu({ extensions });
        await b.importJSON(clone(json));
        expect(tree(b)[0].props).toMatchObject({ status: 'ready', alt: 'old' });
        expect(tree(b)[0].props.ref).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);
        expect([...Files.get(b).getAsset(tree(b)[0].props.ref).data]).toEqual([1, 2, 3, 250]);
    });

    it('an unknown export version is refused with a warning and leaves the document untouched', async () => {
        const a = await make([p('keep me')]);
        const warn = vi.spyOn(a, 'warn').mockImplementation(() => {});
        await a.importJSON({ version: '2', blocks: [{ type: 'paragraph', content: [{ text: 'from the future' }] }] });
        expect(warn).toHaveBeenCalledOnce();
        expect(tree(a)[0].props.text).toEqual([{ insert: 'keep me' }]);
        // the number 1 and a missing version are the current one
        await a.importJSON({ version: 1, blocks: [{ type: 'paragraph', content: [{ text: 'one' }] }] });
        expect(tree(a)[0].props.text).toEqual([{ insert: 'one' }]);
        await a.importJSON({ blocks: [{ type: 'paragraph', content: [{ text: 'none' }] }] });
        expect(tree(a)[0].props.text).toEqual([{ insert: 'none' }]);
    });

    it('an unknown block type degrades like the clipboard: text kept as a paragraph, children kept after it', async () => {
        const a = new Nabu({ extensions: [ParagraphExtension, HeadingExtension, RichTextExtension] });
        await a.importJSON({ version: '1', blocks: [
            { type: 'kanban', props: { cols: 3 }, content: [{ text: 'Board', bold: true }], children: [{ type: 'heading', props: { level: 2 }, content: [{ text: 'Card' }] }, { type: 'mystery', content: 'raw text' }] },
        ] });
        const t = tree(a);
        expect(t.map((n) => n.type)).toEqual(['paragraph', 'heading', 'paragraph']);
        expect(t[0].props).toEqual({ text: [{ insert: 'Board', attributes: { bold: true } }] });
        expect(t[2].props.text).toEqual([{ insert: 'raw text' }]);
    });

    it('reads the first exports: `checked` next to `type`, code `content` as a string or as runs', async () => {
        const a = new Nabu({ extensions });
        await a.importJSON({ version: '1', blocks: [
            { type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', content: [{ text: 'old' }], checked: true }] },
            { type: 'code', props: { language: 'js' }, content: 'let a;' },
            { type: 'code', props: { language: null }, content: [{ text: 'runs' }] },
        ] });
        const t = tree(a);
        expect(t[0].children[0].props.checked).toBe(true);
        expect(t[1].props.text).toEqual([{ insert: 'let a;' }]);
        expect(t[2].props.text).toEqual([{ insert: 'runs' }]);
    });

    it('a to-do item is exported with props.checked; an unsafe link is dropped on import (text kept)', async () => {
        const a = await make([list('todo', [todo('x', true)]), p(t('click', { link: 'https://ok.example/' }))]);
        const json = a.serialize('json');
        expect(json.blocks[0].children[0].props).toEqual({ checked: true });
        json.blocks[1].content = [{ text: 'evil', link: 'javascript:alert(1)' }];
        const b = new Nabu({ extensions });
        await b.importJSON(json);
        expect(tree(b)[1].props.text).toEqual([{ insert: 'evil' }]);
    });
});

// ── Markdown ─────────────────────────────────────────────────────────────────────────────────────────────

/** The part of the sink markdown can express exactly: no video / file (they are links), no image name. */
const MD_SINK = SINK.filter((b) => b.type !== 'video' && b.type !== 'file').map((b) => (b.type === 'image' ? { ...b, props: { ...b.props, name: undefined } } : b));

const roundTrip = async (engine) => {
    const out = new Nabu({ extensions });
    await out.importMarkdown(engine.serialize('markdown'));
    return out;
};

describe('markdown round trip (structure)', () => {
    it('the expressible subset of the kitchen sink keeps its exact tree (toggles, nested lists, P-28, callouts, code…)', async () => {
        const a = await make(MD_SINK);
        const b = await roundTrip(a);
        expect(tree(b)).toEqual(tree(a));
        // and the markdown is a fixed point
        expect(b.serialize('markdown')).toBe(a.serialize('markdown'));
    });

    it('documented loss: an image keeps ref + alt but not its name; a video / file comes back as a paragraph with a link', async () => {
        const a = await make(SINK);
        const b = await roundTrip(a);
        const A = tree(a);
        const B = tree(b);
        expect(B.length).toBe(A.length);
        const at = (t, type, k = 0) => t.filter((n) => n.type === type)[k];
        expect(at(B, 'image').props).toEqual({ ...at(A, 'image').props, name: '' });
        // the video and the file are the two paragraphs that replaced them
        const iVideo = A.findIndex((n) => n.type === 'video');
        expect(B[iVideo].type).toBe('paragraph');
        expect(B[iVideo].props.text).toEqual([{ insert: 'a video', attributes: { link: 'https://example.com/v.mp4' } }]);
        expect(B[iVideo + 1].props.text).toEqual([{ insert: 'f.pdf', attributes: { link: 'https://example.com/f.pdf' } }]);
        // everything else is identical
        const fixed = (t) => t.map((n, i) => (i === iVideo || i === iVideo + 1 || n.type === 'image' ? null : n));
        expect(fixed(B)).toEqual(fixed(A));
    });

    it('other documented loss: empty paragraphs vanish, a pending/missing media loses its status', async () => {
        const a = await make([p('a'), { type: 'paragraph', delta: [] }, p('b'), { type: 'image', props: { ref: 'https://e.com/x.png', alt: 'x', status: 'error' } }]);
        const b = await roundTrip(a);
        expect(tree(b).map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'image']);
        expect(tree(b)[2].props.status).toBe('ready');
    });

    it('other documented loss: empty heading / quote / dialogue vanish (no markdown for them), code takes no other mark, a language has no whitespace; an empty list item survives', async () => {
        const a = await make([
            { type: 'heading', props: { level: 2 }, delta: [] }, { type: 'blockquote', delta: [] }, { type: 'dialogue', delta: [] },
            p(t('bc', { bold: true, code: true }), t(' x ', { bold: true })),
            { type: 'code', props: { language: 'c plus' }, delta: [t('x')] },
            list('bullet', [item([]), item('z')]),
        ]);
        const b = await roundTrip(a);
        expect(tree(b).map((n) => n.type)).toEqual(['paragraph', 'code', 'list']);
        expect(tree(b)[0].props.text[0]).toEqual({ insert: 'bc', attributes: { code: true } });
        expect(tree(b)[1].props.language).toBe('cplus');
        expect(tree(b)[2].children.map((c) => c.props.text)).toEqual([[], [{ insert: 'z' }]]);
    });

    it('an image alt and ref with markdown specials, spaces and parentheses survive', async () => {
        const blocks = [
            { type: 'image', props: { ref: 'https://x.example/a b(1).png', alt: 'a [b] *c* \\d ] x' } },
            { type: 'image', props: { ref: 'https://x.example/a_(b).png', alt: 'ok' } },
            { type: 'image', props: { ref: 'nabu-asset:3f2a', alt: '' } },
        ];
        const a = await make(blocks);
        expect(tree(await roundTrip(a))).toEqual(tree(a));
    });

    it('a code block holding a fence (or backticks) is written with a longer fence and comes back whole', async () => {
        const blocks = [
            { type: 'code', props: { language: 'md' }, delta: [t('```\ninner\n```')] },
            { type: 'code', props: { language: 'md' }, delta: [t('````\nfour\n````\n```\nthree\n```')] },
            { type: 'code', props: { language: null }, delta: [t('a ``` b')] },
            { type: 'code', props: { language: null }, delta: [t('')] },
            { type: 'code', props: { language: null }, delta: [t('~~~\ntilde\n~~~')] },
        ];
        const a = await make(blocks);
        const md = a.serialize('markdown');
        expect(md).toContain('````md\n```\ninner\n```\n````');
        expect(md).toContain('`````md\n````\nfour');
        expect(tree(await roundTrip(a))).toEqual(tree(a));
    });

    it('marks, links and escapes survive, including text that looks like markdown or like a toggle', async () => {
        const a = await make([
            p('</details>'), p('<details>'), p('<details open>'), p('<summary>x</summary>'), p('a <details> b'),
            p('# h'), p('1. x'), p('> q'), p('-- d'), p('---'), p('* [ ] box'),
            p(t('bold', { bold: true }), ' ', t('italic', { italic: true }), ' ', t('both', { bold: true, italic: true }), ' ', t('u', { underline: true }), t('s', { strikethrough: true }), ' ', t('c', { code: true }), ' ', t('l', { link: 'https://e.com/a b' })),
        ]);
        expect(tree(await roundTrip(a))).toEqual(tree(a));
    });

    it('a toggle round-trips with its state, header marks and nested content (also inside a toggle body)', async () => {
        const a = await make([
            { type: 'toggle', props: { collapsed: false }, delta: [t('Header '), t('bold', { bold: true }), t(' </summary> and </details>\nsecond line')], children: [
                p('</details>'), p('<details>'),
                list('todo', [todo('t1', false)]), list('bullet', [item('b1')]),
                { type: 'toggle', props: { collapsed: true }, delta: [t('inner')], children: [{ type: 'toggle', props: { collapsed: false }, delta: [t('inner inner')] }] },
                { type: 'code', props: { language: null }, delta: [t('</details>\n<details>')] },
            ] },
            { type: 'toggle', props: { collapsed: true }, delta: [] },
        ]);
        const b = await roundTrip(a);
        expect(tree(b)).toEqual(tree(a));
        expect(b.serialize('markdown')).toBe(a.serialize('markdown'));
        expect(a.serialize('markdown')).toContain('<details open>\n<summary>Header **bold**');
    });
});

// ── The <details> exception ─────────────────────────────────────────────────────────────────────────────

describe('markdown import: <details> is read ONLY as the construct Nabu emits', () => {
    const imp = async (md) => { const e = new Nabu({ extensions }); await e.importMarkdown(md); return e; };
    const texts = (e) => tree(e).map((n) => (n.props.text ?? []).map((o) => o.insert).join(''));
    const toggles = (e) => { let n = 0; const walk = (x) => { if (x.type === 'toggle') n++; x.children.forEach(walk); }; tree(e).forEach(walk); return n; };

    it('<details> is a collapsed toggle, <details open> an expanded one; the body is markdown', async () => {
        const e = await imp('<details>\n<summary>Why?</summary>\n\nBecause **bold**.\n\n- a\n- b\n\n</details>\n\nafter');
        const [toggle, after] = tree(e);
        expect(toggle.type).toBe('toggle');
        expect(toggle.props.collapsed).toBe(true);
        expect(toggle.props.text).toEqual([{ insert: 'Why?' }]);
        expect(toggle.children.map((c) => c.type)).toEqual(['paragraph', 'list']);
        expect(toggle.children[0].props.text).toEqual([{ insert: 'Because ' }, { insert: 'bold', attributes: { bold: true } }, { insert: '.' }]);
        expect(after.type).toBe('paragraph');
        const open = tree(await imp('<details open>\n<summary>Open</summary>\n\nbody\n\n</details>'))[0];
        expect(open.props.collapsed).toBe(false);
    });

    it('the summary is inline markdown; the older one-line form and an empty body are read too', async () => {
        const e = await imp('<details><summary>**b** and [l](https://example.com/) and `c`</summary>\n\n</details>');
        const [toggle] = tree(e);
        expect(toggle.props.text).toEqual([{ insert: 'b', attributes: { bold: true } }, { insert: ' and ' }, { insert: 'l', attributes: { link: 'https://example.com/' } }, { insert: ' and ' }, { insert: 'c', attributes: { code: true } }]);
        expect(toggle.children).toEqual([]);
        expect(tree(await imp('<details>\n<summary></summary>\n</details>'))[0].type).toBe('toggle');
    });

    it('nesting: an inner <details> is matched with its own closing line; fenced code is skipped', async () => {
        const e = await imp([
            '<details open>', '<summary>outer</summary>', '', 'one', '',
            '<details>', '<summary>inner</summary>', '', 'deep', '', '</details>', '',
            '```html', '</details>', '```', '', 'two', '', '</details>', '', 'tail',
        ].join('\n'));
        const t = tree(e);
        expect(t.map((n) => n.type)).toEqual(['toggle', 'paragraph']);
        expect(t[0].children.map((c) => c.type)).toEqual(['paragraph', 'toggle', 'code', 'paragraph']);
        expect(t[0].children[1].children.map((c) => c.type)).toEqual(['paragraph']);
        expect(t[0].children[2].props.text).toEqual([{ insert: '</details>' }]);
    });

    it('a <details> can interrupt a paragraph (CommonMark)', async () => {
        const e = await imp('intro\n<details>\n<summary>S</summary>\n\nb\n\n</details>');
        expect(tree(e).map((n) => n.type)).toEqual(['paragraph', 'toggle']);
    });

    it('safety: any attribute, other tag, case or spacing is refused and stays literal text', async () => {
        const closed = (open, summary = '<summary>S</summary>') => `${open}\n${summary}\n\nbody\n\n</details>`;
        const refused = [
            closed('<details class="x">'), closed('<details open class="x">'), closed('<details open="">'), closed('<details onclick="alert(1)">'),
            closed('<details style="display:none">'), closed('<details open >'), closed('<DETAILS>'), closed('<Details>'),
            closed(' <details>'), closed('<details>', '<summary class="x">S</summary>'), closed('<details>', '<summary onclick=x>S</summary>'),
            closed('<details>', '<SUMMARY>S</SUMMARY>'), closed('<details>', 'S without a summary tag'),
            closed('<details>', '<summary>S</summary> trailing'), closed('<details>', '<summary>unterminated'),
            '<details>\n<summary>S</summary>\n\nno closing line', '<details>\n<summary>S</summary>\n\nbody\n\n</details >',
            '<details>\n\n<summary>blank line before the summary</summary>\n\nbody\n\n</details>',
            '<details>\nbody only\n\n</details>',
        ];
        for (const md of refused) {
            const e = await imp(md);
            expect(toggles(e), JSON.stringify(md)).toBe(0);
            // the HTML is kept as text, never interpreted: the first tag is still there
            expect(texts(e).join('\n'), JSON.stringify(md)).toContain('<');
            // and nothing but text was created
            expect(new Set(tree(e).map((n) => n.type)), JSON.stringify(md)).toEqual(new Set(['paragraph']));
        }
    });

    it('safety: nothing of the markup reaches the model (no props other than collapsed), scripts in the body stay text', async () => {
        const e = await imp('<details open>\n<summary><img src=x onerror=alert(1)> [x](javascript:alert(1))</summary>\n\n<script>alert(1)</script>\n\n<b onclick="x">y</b>\n\n</details>');
        const [toggle] = tree(e);
        expect(toggle.type).toBe('toggle');
        expect(Object.keys(toggle.props).sort()).toEqual(['collapsed', 'text']);
        const all = JSON.stringify(toggle);
        expect(all).not.toContain('javascript:');
        expect(toggle.children.map((c) => c.type)).toEqual(['paragraph', 'paragraph']);
        expect(toggle.children[0].props.text).toEqual([{ insert: '<script>alert(1)</script>' }]);
    });

    it('an unclosed outer <details> around a closed inner one: the inner is a toggle, the outer lines stay text', async () => {
        const e = await imp('<details>\n<summary>outer</summary>\n\n<details>\n<summary>inner</summary>\n\nx\n\n</details>');
        expect(toggles(e)).toBe(1);
        expect(texts(e)[0]).toBe('<details> <summary>outer</summary>'); // the outer opening lines, as text
    });
});

// ── P-30: adjacent lists ──────────────────────────────────────────────────────────────────────────────────

describe('markdown lists: a change of marker starts a new list (CommonMark, P-30)', () => {
    const imp = async (md) => { const e = new Nabu({ extensions }); await e.importMarkdown(md); return e; };
    const shape = (e) => tree(e).map((n) => (n.type === 'list' ? `${n.props.listType}${n.props.start ? '@' + n.props.start : ''}[${n.children.map((c) => (c.props.text ?? []).map((o) => o.insert).join('')).join(',')}]` : n.type)).join(' ; ');

    it('root: `- a` then `1. b` are two lists', async () => {
        expect(shape(await imp('- a\n1. b'))).toBe('bullet[a] ; ordered[b]');
        expect(shape(await imp('1. a\n- b'))).toBe('ordered[a] ; bullet[b]');
    });

    it('a to-do list next to a bullet list stays two lists when the bullet character changes', async () => {
        expect(shape(await imp('- [ ] a\n* b'))).toBe('todo[a] ; bullet[b]');
        expect(shape(await imp('- [ ] a\n\n* b'))).toBe('todo[a] ; bullet[b]');
        expect(shape(await imp('* a\n- [x] b'))).toBe('bullet[a] ; todo[b]');
    });

    it('same bullet character = ONE list (a loose list too); other marker changes of the SAME type merge in the model', async () => {
        expect(shape(await imp('- a\n- b\n\n- c'))).toBe('bullet[a,b,c]');
        // two lists for the parser, merged by the List normalizer (same type, adjacent): the model is unchanged by P-30
        expect(shape(await imp('- a\n* b\n+ c'))).toBe('bullet[a,b,c]');
        expect(shape(await imp('1. a\n2) b'))).toBe('ordered[a,b]');
    });

    it('in a sublist: several sublists of one item (P-28)', async () => {
        const e = await imp('- item\n  - [ ] a\n  * b\n  1. c');
        const sub = tree(e)[0].children[0].children.map((l) => l.props.listType);
        expect(sub).toEqual(['todo', 'bullet', 'ordered']);
    });

    it('the exporter alternates the bullet character / delimiter between adjacent lists, so they come back as written', async () => {
        const a = await make([
            list('todo', [todo('t', true)]), list('bullet', [item('b1'), item('b2')]), list('todo', [todo('t2', false)]),
            p('between'),
            list('bullet', [item('x')]), list('ordered', [item('o')]), list('bullet', [item('y')]),
            p('gap'),
            list('bullet', [item('host', { children: [list('todo', [todo('s1', false)]), list('bullet', [item('s2')]), list('ordered', [item('s3')], 4)] })]),
        ]);
        const md = a.serialize('markdown');
        expect(md).toBe([
            '- [x] t', '', '* b1', '* b2', '', '- [ ] t2', '', 'between', '', '- x', '', '1. o', '', '- y', '', 'gap', '',
            '- host', '  - [ ] s1', '  * s2', '  4. s3',
        ].join('\n'));
        expect(tree(await roundTrip(a))).toEqual(tree(a));
    });

    it('the clipboard text (static serializers) alternates too, also inside a toggle body', () => {
        const pbs = [list('todo', [todo('a', false)]), list('bullet', [item('b')])];
        expect(List.toMarkdown(pbs[1], { before: [pbs[0]] })).toBe('* b');
        expect(List.toMarkdown(list('ordered', [item('n')], 5), { before: [list('ordered', [item('m')])] })).toBe('5) n');
        expect(List.toMarkdown(list('ordered', [item('n')], 5), { before: [p('x'), list('bullet', [item('m')])] })).toBe('5. n');
    });

    it('nested content is indented under the marker, whatever its width (ordered 10+, to-do)', async () => {
        const a = await make([list('ordered', [item('ten', { children: [list('bullet', [item('child', { children: [list('todo', [todo('deep', true)])] })])] })], 10)]);
        expect(a.serialize('markdown')).toBe('10. ten\n    - child\n      - [x] deep');
        expect(tree(await roundTrip(a))).toEqual(tree(a));
    });
});

// ── Code fence in a list item ───────────────────────────────────────────────────────────────────────────

describe('a fenced code in a list item', () => {
    const fenced = 'intro\n```js\nlet a = 1;\n\n\tif (a) {}\n---\n- not an item\n```\nafter';
    const doc = (text, extra = {}) => [list('bullet', [item(text, extra), item('next')]), p('tail')];

    it('an item holds text, not blocks: the fence is TEXT of the item, written as an indented fence and read back identically', async () => {
        const a = await make(doc(fenced));
        const md = a.serialize('markdown');
        expect(md).toBe('- intro\n  ```js\n  let a = 1;\n\n  \tif (a) {}\n  ---\n  - not an item\n  ```\n  after\n- next\n\ntail');
        const b = await roundTrip(a);
        expect(tree(b)).toEqual(tree(a));
        expect(tree(b)[0].children[0].props.text).toEqual([{ insert: fenced }]);
        expect(tree(b)).toHaveLength(2);
    });

    it('under an ordered item, with sublists after it', async () => {
        const a = await make([list('ordered', [item('step\n~~~\ncode\n~~~', { children: [list('bullet', [item('sub')])] })])]);
        expect(a.serialize('markdown')).toBe('1. step\n   ~~~\n   code\n   ~~~\n   - sub');
        expect(tree(await roundTrip(a))).toEqual(tree(a));
    });

    it('text a fence cannot carry exactly stays escaped text (unclosed fence, fence first, blank line next to it) and still round-trips', async () => {
        for (const text of ['a\n```js\nnever closed', '```js\ncode\n```', 'a\n\n```\ncode\n```', 'a\n```\ncode\n```\n\nb']) {
            const a = await make(doc(text));
            const md = a.serialize('markdown');
            expect(md, JSON.stringify(text)).toContain('\\`\\`\\`');
            expect(tree(await roundTrip(a)), JSON.stringify(text)).toEqual(tree(a));
        }
    });

    it('markdown written by hand (a fence under an item) is read as item text, then exported as the same fence', async () => {
        const e = new Nabu({ extensions });
        const md = '- item\n  ```sh\n  npm i\n  ```\n- other';
        await e.importMarkdown(md);
        expect(tree(e)[0].children[0].props.text).toEqual([{ insert: 'item\n```sh\nnpm i\n```' }]);
        expect(e.serialize('markdown')).toBe(md);
    });
});
