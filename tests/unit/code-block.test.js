// @ts-nocheck
/**
 * Unit tests for CodeBlock — static serializers/parsers and integration flags.
 */

import { describe, it, expect } from 'vitest';

describe('CodeBlock statics', () => {
    it('toMarkdown wraps in fenced code block with language', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const pb = { type: 'code', props: { language: 'js' }, delta: [{ insert: 'a=1' }] };
        expect(CodeBlock.toMarkdown(pb)).toBe('```js\na=1\n```');
    });

    it('toMarkdown wraps in fenced code block without language', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const pb = { type: 'code', props: { language: null }, delta: [{ insert: 'hello' }] };
        expect(CodeBlock.toMarkdown(pb)).toBe('```\nhello\n```');
    });

    it('toHtml wraps in <pre><code> and escapes HTML', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const pb = { type: 'code', delta: [{ insert: '<div>&amp;</div>' }] };
        expect(CodeBlock.toHtml(pb)).toBe('<pre><code>&lt;div&gt;&amp;amp;&lt;/div&gt;</code></pre>');
    });

    it('toHtml escapes < characters', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const pb = { type: 'code', delta: [{ insert: 'x < y' }] };
        expect(CodeBlock.toHtml(pb)).toBe('<pre><code>x &lt; y</code></pre>');
    });

    it('fromMarkdown parses language and body', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const result = CodeBlock.fromMarkdown(['```js', 'a=1', '```']);
        expect(result).toEqual({
            type: 'code',
            props: { language: 'js' },
            delta: [{ insert: 'a=1' }],
            partial: false,
        });
    });

    it('fromMarkdown handles empty language', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const result = CodeBlock.fromMarkdown(['```', 'const x = 1;', '```']);
        expect(result).toEqual({
            type: 'code',
            props: { language: null },
            delta: [{ insert: 'const x = 1;' }],
            partial: false,
        });
    });

    it('fromMarkdown handles multi-line body', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const result = CodeBlock.fromMarkdown(['```python', 'def foo():', '    pass', '```']);
        expect(result).toEqual({
            type: 'code',
            props: { language: 'python' },
            delta: [{ insert: 'def foo():\n    pass' }],
            partial: false,
        });
    });

    it('markdownRules detect ``` and consume the full fence', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const rule = CodeBlock.markdownRules[0];
        expect(rule.detect.test('```js')).toBe(true);
        rule.detect.lastIndex = 0;
        expect(rule.detect.test('```')).toBe(true);
        rule.detect.lastIndex = 0;
        expect(rule.detect.test('hello')).toBe(false);
        // consume: opening line + 2 body lines + closing fence = 4 lines
        expect(rule.consume(['```js', 'a=1', 'b=2', '```', 'after'], 0)).toBe(4);
    });

    it('markdownRules consume runs to EOF if no closing fence', async () => {
        const { CodeBlock } = await import('$lib/blocks/code/code.svelte.js');
        const rule = CodeBlock.markdownRules[0];
        // No closing ```, should consume all lines from i
        expect(rule.consume(['```js', 'line1', 'line2'], 0)).toBe(3);
    });
});

describe('CodeBlock integration', () => {
    it('engine.insert("code") creates a code block with correct flags', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { CodeExtension } = await import('$lib/blocks/code/index.js');
        const { RichTextExtension } = await import('$lib/behaviors/text/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, CodeExtension, RichTextExtension] });
        engine.insert('code', { text: 'x' });
        await engine.commit();

        const roots = engine.tree.roots();
        const codeNode = roots.find(r => r.data.get('type') === 'code');
        expect(codeNode).toBeTruthy();
        expect(codeNode.data.get('type')).toBe('code');

        const block = engine.blocks.get(codeNode.id.toString());
        expect(block).toBeTruthy();
        expect(block.splitsOnEnter).toBe(false);
        expect(block.transformsEnabled).toBe(false);
        expect(block.marksEnabled).toBe(false);
    });
});
