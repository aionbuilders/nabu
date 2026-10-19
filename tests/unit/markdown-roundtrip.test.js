// @ts-nocheck
/**
 * serialize('markdown') -> importMarkdown -> serialize('markdown') is idempotent for a document that holds every block
 * type (a preview of the markdown round trip, P-59 / lot 5e).
 */

import { describe, it, expect } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { BlockquoteExtension } from '$lib/blocks/blockquote/index.js';
import { DividerExtension } from '$lib/blocks/divider/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { CalloutExtension } from '$lib/blocks/callout/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { DialogueExtension } from '$lib/blocks/dialogue/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';

const extensions = [ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ToggleExtension, ImageExtension, DialogueExtension, ListExtension, ListItemExtension, RichTextExtension, MarkdownPasteExtension];

const t = (s, attributes) => (attributes ? { insert: s, attributes } : { insert: s });
const item = (delta, extra = {}) => ({ type: 'list-item', delta, partial: false, ...extra });

const DOC = [
    { type: 'heading', props: { level: 1 }, delta: [t('Title')] },
    { type: 'heading', props: { level: 2 }, delta: [t('Two')] },
    { type: 'heading', props: { level: 3 }, delta: [t('Three '), t('bold', { bold: true })] },
    { type: 'heading', props: { level: 6 }, delta: [t('Six')] },
    { type: 'paragraph', delta: [t('Plain '), t('bold', { bold: true }), t(' '), t('italic', { italic: true }), t(' '), t('strike', { strikethrough: true }), t(' '), t('under', { underline: true }), t(' '), t('code', { code: true }), t(' and a '), t('link', { link: 'https://example.com/a_(b)' }), t('.')] },
    { type: 'paragraph', delta: [t('line one\nline two')] },
    { type: 'blockquote', delta: [t('A '), t('quote', { italic: true })] },
    { type: 'blockquote', delta: [t('a quote\nwith a break')] },
    { type: 'divider' },
    { type: 'code', props: { language: 'js' }, delta: [t('let a = 1;\n\nconsole.log(a);')] },
    { type: 'code', props: { language: null }, delta: [t('no language')] },
    { type: 'callout', props: { variant: 'note' }, delta: [t('A note')] },
    { type: 'callout', props: { variant: 'warning' }, delta: [t('first\nsecond')] },
    { type: 'callout', props: { variant: 'tip' }, delta: [t('A '), t('tip', { bold: true })] },
    { type: 'dialogue', delta: [t('Hello there')] },
    { type: 'image', props: { ref: 'https://example.com/i.png', alt: 'an image' } },
    {
        type: 'list', props: { listType: 'bullet' }, children: [
            item([t('one')], { children: [
                { type: 'list', props: { listType: 'ordered', start: 3 }, children: [
                    item([t('three')]),
                    item([t('four')], { children: [{ type: 'list', props: { listType: 'todo' }, children: [item([t('todo a')], { props: { checked: false } }), item([t('todo b')], { props: { checked: true } })] }] }),
                ] },
            ] }),
            item([t('two '), t('bold', { bold: true })]),
        ],
    },
    { type: 'list', props: { listType: 'ordered' }, children: [item([t('first')]), item([t('second')])] },
    { type: 'list', props: { listType: 'todo' }, children: [item([t('open')], { props: { checked: false } }), item([t('done')], { props: { checked: true } })] },
    { type: 'toggle', props: { collapsed: false }, delta: [t('Toggle head')], children: [
        { type: 'paragraph', delta: [t('inside the toggle')] },
        { type: 'list', props: { listType: 'bullet' }, children: [item([t('in a list')])] },
    ] },
    { type: 'paragraph', delta: [t('# not a heading')] },
    { type: 'paragraph', delta: [t('- not a list')] },
    { type: 'paragraph', delta: [t('1. not a list')] },
    { type: 'paragraph', delta: [t('> not a quote')] },
    { type: 'paragraph', delta: [t('---')] },
    { type: 'paragraph', delta: [t('===')] },
    { type: 'paragraph', delta: [t('```not a fence')] },
    { type: 'paragraph', delta: [t('~~~ not a fence')] },
    { type: 'paragraph', delta: [t('| a | b |')] },
    { type: 'paragraph', delta: [t('<div>literal html</div> and [^1] a footnote')] },
    { type: 'paragraph', delta: [t('[^1]: the note')] },
];

async function make() {
    const engine = new Nabu({ extensions });
    await engine.importFragment({ blocks: DOC });
    return engine;
}

describe('markdown round trip', () => {
    it('serialize -> import -> serialize is idempotent for every block type', async () => {
        const engine = await make();
        const md1 = engine.serialize('markdown');
        await engine.importMarkdown(md1);
        const md2 = engine.serialize('markdown');
        expect(md2).toBe(md1);
        await engine.importMarkdown(md2);
        expect(engine.serialize('markdown')).toBe(md1);
    });

    it('the second generation has the same blocks, props and marks as the first (up to the toggle)', async () => {
        const engine = await make();
        const strip = (b) => JSON.parse(JSON.stringify(b, (k, v) => (k === 'id' ? undefined : v)));
        const json = () => engine.serialize('json').blocks.map(strip);
        const before = json();
        const toggleAt = before.findIndex((b) => b.type === 'toggle');
        expect(toggleAt).toBeGreaterThan(0);
        await engine.importMarkdown(engine.serialize('markdown'));
        const after = json();
        expect(after.slice(0, toggleAt)).toEqual(before.slice(0, toggleAt));
        // A toggle is exported as literal <details> text (no markdown rule reads it back): its summary, its body and the
        // closing tag are plain paragraphs / blocks of the second generation.
        const texts = after.slice(toggleAt).map((b) => b.type);
        expect(texts.slice(0, 2)).toEqual(['paragraph', 'paragraph']);
        expect(after[toggleAt].content).toEqual([{ text: '<details><summary>Toggle head</summary>' }]);
        expect(after.slice(toggleAt).some((b) => b.type === 'paragraph' && JSON.stringify(b.content).includes('</details>'))).toBe(true);
    });

    it('a hand-written README (setext, tilde fence, nested quote, loose and tab-indented lists, table…) is stable after one pass', async () => {
        const README = [
            '\uFEFFProject', '=======', '', 'Intro with **bold**, a footnote[^1] and <b>html</b>.', '', 'Install', '-------', '',
            '~~~bash', 'npm i project', '', 'npm test', '~~~', '',
            '> quote', '> > nested', 'lazy', '', '1. Add it', '\t- with npm', '\t- with bun', '   continued text', '',
            '2. Use it', '', '   ```js', '   run();', '   ```', '',
            '* [x] done', '* [ ] todo', '', '| name | type |', '|:-----|-----:|', '| `a`  | text |', '',
            '    indented', '', '* * *', '', '<div align="center">', '', '[^1]: The note.',
        ].join('\r\n');
        const engine = new Nabu({ extensions });
        await engine.importMarkdown(README);
        const md1 = engine.serialize('markdown');
        await engine.importMarkdown(md1);
        expect(engine.serialize('markdown')).toBe(md1);
    });
});
