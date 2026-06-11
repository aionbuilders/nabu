// @ts-nocheck
/**
 * Unit tests for CalloutBlock — static serializers/parsers and integration flags.
 */

import { describe, it, expect } from 'vitest';

describe('CalloutBlock statics', () => {
    it('toMarkdown wraps in callout block with NOTE header', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const pb = { type: 'callout', props: { variant: 'note' }, delta: [{ insert: 'hi' }] };
        expect(CalloutBlock.toMarkdown(pb)).toBe('> [!NOTE]\n> hi');
    });

    it('toMarkdown uppercases the variant', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const pb = { type: 'callout', props: { variant: 'warning' }, delta: [{ insert: 'x' }] };
        expect(CalloutBlock.toMarkdown(pb)).toMatch(/^> \[!WARNING\]/);
    });

    it('toMarkdown prefixes each body line with "> "', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const pb = { type: 'callout', props: { variant: 'note' }, delta: [{ insert: 'a\nb' }] };
        expect(CalloutBlock.toMarkdown(pb)).toBe('> [!NOTE]\n> a\n> b');
    });

    it('toMarkdown returns only header when body is empty', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const pb = { type: 'callout', props: { variant: 'tip' }, delta: [] };
        expect(CalloutBlock.toMarkdown(pb)).toBe('> [!TIP]');
    });

    it('toHtml wraps in <aside> with data-callout attribute', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const pb = { type: 'callout', props: { variant: 'note' }, delta: [{ insert: 'hello' }] };
        const html = CalloutBlock.toHtml(pb);
        expect(html).toContain('data-callout="note"');
        expect(html).toMatch(/^<aside/);
        expect(html).toContain('hello');
    });

    it('toHtml uses "note" as default variant', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const pb = { type: 'callout', props: {}, delta: [{ insert: 'x' }] };
        expect(CalloutBlock.toHtml(pb)).toContain('data-callout="note"');
    });

    it('fromMarkdown parses variant and body', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const result = CalloutBlock.fromMarkdown(
            ['> [!TIP]', '> hello'],
            { parseInline: t => [{ insert: t }] }
        );
        expect(result).toEqual({
            type: 'callout',
            props: { variant: 'tip' },
            delta: [{ insert: 'hello' }],
            partial: false,
        });
    });

    it('fromMarkdown is case-insensitive for variant', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const result = CalloutBlock.fromMarkdown(
            ['> [!WARNING]', '> careful'],
            { parseInline: t => [{ insert: t }] }
        );
        expect(result.props.variant).toBe('warning');
    });

    it('fromMarkdown falls back to "note" for unknown variant', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const result = CalloutBlock.fromMarkdown(
            ['> [!frobnicate]', '> body'],
            { parseInline: t => [{ insert: t }] }
        );
        expect(result.props.variant).toBe('note');
    });

    it('fromMarkdown returns null when line does not match callout pattern', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const result = CalloutBlock.fromMarkdown(
            ['> just a quote'],
            { parseInline: t => [{ insert: t }] }
        );
        expect(result).toBeNull();
    });

    it('markdownRules detect matches "[!NOTE]" case-insensitively', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const rule = CalloutBlock.markdownRules[0];
        expect(rule.detect.test('> [!NOTE]')).toBe(true);
        rule.detect.lastIndex = 0;
        expect(rule.detect.test('> [!note]')).toBe(true);
        rule.detect.lastIndex = 0;
        expect(rule.detect.test('> [!TIP]')).toBe(true);
        rule.detect.lastIndex = 0;
    });

    it('markdownRules detect does NOT match a plain blockquote line', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        const rule = CalloutBlock.markdownRules[0];
        rule.detect.lastIndex = 0;
        expect(rule.detect.test('> just a quote')).toBe(false);
    });

    it('markdownRules priority is 20 (higher than blockquote priority 10)', async () => {
        const { CalloutBlock } = await import('$lib/blocks/callout/callout.svelte.js');
        expect(CalloutBlock.markdownRules[0].priority).toBe(20);
    });
});

describe('CalloutBlock integration', () => {
    it('engine.insert("callout") creates a callout block with correct flags', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { CalloutExtension } = await import('$lib/blocks/callout/index.js');
        const { RichTextExtension } = await import('$lib/behaviors/text/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, CalloutExtension, RichTextExtension] });
        engine.insert('callout', { text: 'x', variant: 'warning' });
        await engine.commit();

        const roots = engine.tree.roots();
        const calloutNode = roots.find(r => r.data.get('type') === 'callout');
        expect(calloutNode).toBeTruthy();
        expect(calloutNode.data.get('type')).toBe('callout');
        expect(calloutNode.data.get('variant')).toBe('warning');

        const block = engine.blocks.get(calloutNode.id.toString());
        expect(block).toBeTruthy();
        expect(block.splitsOnEnter).toBe(false);
        expect(block.transformsEnabled).toBe(false);
        expect(block.marksEnabled).toBe(true);
    });
});
