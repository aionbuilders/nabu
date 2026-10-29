// @ts-nocheck
/**
 * Unit tests for CodeBlock — static serializers/parsers and integration flags.
 */

import { describe, it, expect, vi } from 'vitest';
import { CodeBlock } from '#lib/blocks/code/code.svelte.js';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { CodeExtension } from '#lib/blocks/code/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';

describe('CodeBlock statics', () => {
    it('toMarkdown wraps in fenced code block with language', async () => {
        const pb = { type: 'code', props: { language: 'js' }, delta: [{ insert: 'a=1' }] };
        expect(CodeBlock.toMarkdown(pb)).toBe('```js\na=1\n```');
    });

    it('toMarkdown wraps in fenced code block without language', async () => {
        const pb = { type: 'code', props: { language: null }, delta: [{ insert: 'hello' }] };
        expect(CodeBlock.toMarkdown(pb)).toBe('```\nhello\n```');
    });

    it('toHtml wraps in <pre><code> and escapes HTML', async () => {
        const pb = { type: 'code', delta: [{ insert: '<div>&amp;</div>' }] };
        expect(CodeBlock.toHtml(pb)).toBe('<pre><code>&lt;div&gt;&amp;amp;&lt;/div&gt;</code></pre>');
    });

    it('toHtml escapes < characters', async () => {
        const pb = { type: 'code', delta: [{ insert: 'x < y' }] };
        expect(CodeBlock.toHtml(pb)).toBe('<pre><code>x &lt; y</code></pre>');
    });

    it('toHtml names the language in a language-xxx class (what fromHTML reads back), only when it is safe', async () => {
        expect(CodeBlock.toHtml({ type: 'code', props: { language: 'js' }, delta: [{ insert: 'a' }] })).toBe('<pre><code class="language-js">a</code></pre>');
        expect(CodeBlock.toHtml({ type: 'code', props: { language: 'c++' }, delta: [{ insert: 'a' }] })).toBe('<pre><code class="language-c++">a</code></pre>');
        expect(CodeBlock.toHtml({ type: 'code', props: { language: 'x" onload="y' }, delta: [{ insert: 'a' }] })).toBe('<pre><code>a</code></pre>');
    });

    it('fromHTML reads the language from code, pre, data attributes and the GitHub wrapper', async () => {
        const read = (html) => {
            const root = document.createElement('div');
            root.innerHTML = html;
            return CodeBlock.fromHTML(root.querySelector('pre'));
        };
        expect(read('<pre><code class="hljs language-ts">x</code></pre>').props.language).toBe('ts');
        expect(read('<pre class="lang-python"><code>x</code></pre>').props.language).toBe('python');
        expect(read('<pre><code class="language-c++">x</code></pre>').props.language).toBe('c++');
        expect(read('<pre data-language="rust">x</pre>').props.language).toBe('rust');
        expect(read('<div class="highlight highlight-source-js"><pre>x</pre></div>').props.language).toBe('js');
        expect(read('<div class="lang-selector"><pre>x</pre></div>').props.language).toBeNull();
        expect(read('<pre><code>x</code></pre>').props.language).toBeNull();
    });

    it('fromHTML keeps the line breaks that are <br> (textContent alone would glue the lines)', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<pre>a<br>b<br/>c</pre>';
        expect(CodeBlock.fromHTML(root.querySelector('pre')).delta).toEqual([{ insert: 'a\nb\nc' }]);
    });

    it('fromMarkdown parses language and body', async () => {
        const result = CodeBlock.fromMarkdown(['```js', 'a=1', '```']);
        expect(result).toEqual({
            type: 'code',
            props: { language: 'js' },
            delta: [{ insert: 'a=1' }],
            partial: false,
        });
    });

    it('fromMarkdown handles empty language', async () => {
        const result = CodeBlock.fromMarkdown(['```', 'const x = 1;', '```']);
        expect(result).toEqual({
            type: 'code',
            props: { language: null },
            delta: [{ insert: 'const x = 1;' }],
            partial: false,
        });
    });

    it('fromMarkdown handles multi-line body', async () => {
        const result = CodeBlock.fromMarkdown(['```python', 'def foo():', '    pass', '```']);
        expect(result).toEqual({
            type: 'code',
            props: { language: 'python' },
            delta: [{ insert: 'def foo():\n    pass' }],
            partial: false,
        });
    });

    it('markdownRules detect ``` and consume the full fence', async () => {
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
        const rule = CodeBlock.markdownRules[0];
        // No closing ```, should consume all lines from i
        expect(rule.consume(['```js', 'line1', 'line2'], 0)).toBe(3);
    });
});

describe('CodeBlock integration', () => {
    it('engine.insert("code") creates a code block with correct flags', async () => {

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


describe('action topics: `code` is the inline mark, `code:block` the block (P-115)', () => {
    async function make() {
        const engine = new Nabu({ extensions: [ParagraphExtension, CodeExtension, RichTextExtension, BlockExtension] });
        engine.insert('paragraph', { text: 'abc' });
        await engine.commit();
        const block = engine.children[0];
        engine.selection = { anchorBlock: block, focusBlock: block, startBlock: block, endBlock: block, blocks: new Set([block]), isCollapsed: true, sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn() };
        return { engine, id: block.id };
    }
    const typeOf = (engine, id) => engine.tree.roots().find((r) => r.id.toString() === id.toString()).data.get('type');

    it('exec("code") only toggles the mark: the block is not transformed', async () => {
        const { engine, id } = await make();
        const stored = vi.spyOn(engine, 'toggleStoredMark');
        await engine.exec('code');
        expect(stored).toHaveBeenCalledWith('code');
        expect(typeOf(engine, id)).toBe('paragraph');
    });

    it('exec("code:block") transforms the block and does not touch the mark', async () => {
        const { engine, id } = await make();
        const stored = vi.spyOn(engine, 'toggleStoredMark');
        await engine.exec('code:block');
        expect(stored).not.toHaveBeenCalled();
        expect(typeOf(engine, id)).toBe('code');
    });

    it('the slash entry "Code" runs code:block', async () => {
        const { engine, id } = await make();
        const stored = vi.spyOn(engine, 'toggleStoredMark');
        const entry = engine.slashCommands.find((c) => c.title === 'Code');
        await entry.run(engine);
        expect(stored).not.toHaveBeenCalled();
        expect(typeOf(engine, id)).toBe('code');
    });
});
