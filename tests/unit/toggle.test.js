// @ts-nocheck
/**
 * Unit + integration tests for ToggleBlock (collapsible block).
 */

import { describe, it, expect } from 'vitest';
import { ToggleBlock } from '$lib/blocks/toggle/toggle.svelte.js';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';

// ── ToggleBlock.toHtml ──────────────────────────────────────────────────────

describe('ToggleBlock.toHtml', () => {
    it('renders <details open> with <summary> when collapsed=false', async () => {
        const pb = { type: 'toggle', props: { collapsed: false }, delta: [{ insert: 'Header' }], children: [] };
        const result = ToggleBlock.toHtml(pb, { recurse: () => '' });
        expect(result).toContain('<details open>');
        expect(result).toContain('<summary>Header</summary>');
        expect(result).toContain('</details>');
    });

    it('renders <details> WITHOUT " open" when collapsed=true', async () => {
        const pb = { type: 'toggle', props: { collapsed: true }, delta: [{ insert: 'Header' }], children: [] };
        const result = ToggleBlock.toHtml(pb, { recurse: () => '' });
        expect(result).toContain('<details>');
        expect(result).not.toContain('<details open>');
        expect(result).not.toContain('details open');
    });

    it('renders body children via recurse', async () => {
        const child = { type: 'paragraph', delta: [{ insert: 'body text' }] };
        const pb = { type: 'toggle', props: { collapsed: false }, delta: [{ insert: 'H' }], children: [child] };
        const result = ToggleBlock.toHtml(pb, { recurse: () => '<p>body text</p>' });
        expect(result).toContain('<p>body text</p>');
    });

    it('defaults to open when props is absent', async () => {
        const pb = { type: 'toggle', props: {}, delta: [], children: [] };
        const result = ToggleBlock.toHtml(pb, { recurse: () => '' });
        expect(result).toContain('<details open>');
    });
});

// ── ToggleBlock.toMarkdown ──────────────────────────────────────────────────

describe('ToggleBlock.toMarkdown', () => {
    it('wraps header in <details> + <summary>…</summary> (<details open> when expanded)', async () => {
        const pb = { delta: [{ insert: 'H' }], children: [] };
        expect(ToggleBlock.toMarkdown({ ...pb, props: { collapsed: true } }, { recurse: () => '' })).toBe('<details>\n<summary>H</summary>\n\n</details>');
        expect(ToggleBlock.toMarkdown({ ...pb, props: { collapsed: false } }, { recurse: () => '' })).toMatch(/^<details open>\n<summary>H<\/summary>/);
    });

    it('includes body children serialized by recurse', async () => {
        const pb = { delta: [{ insert: 'H' }], children: [{}] };
        const result = ToggleBlock.toMarkdown(pb, { recurse: () => 'body line' });
        expect(result).toContain('body line');
        expect(result).toContain('</details>');
    });

    it('closes with </details>', async () => {
        const pb = { delta: [{ insert: 'X' }], children: [] };
        const result = ToggleBlock.toMarkdown(pb, { recurse: () => '' });
        expect(result).toContain('</details>');
    });
});

// ── ToggleBlock.fromHTML ────────────────────────────────────────────────────

/**
 * Helper: build a DOM element from HTML string using the global document
 * (happy-dom environment is available in vitest).
 * @param {string} str
 * @returns {Element}
 */
function html(str) {
    const div = document.createElement('div');
    div.innerHTML = str;
    return div.firstElementChild;
}

describe('ToggleBlock.fromHTML', () => {
    it('parses <details open> as collapsed=false with summary delta', async () => {

        const el = html('<details open><summary>Hi</summary></details>');

        const result = ToggleBlock.fromHTML(el, {
            parseInline: (el) => [{ insert: el.textContent || '' }],
            parseChildren: () => [],
        });

        expect(result).not.toBeNull();
        expect(result.type).toBe('toggle');
        expect(result.props.collapsed).toBe(false);
        expect(result.delta).toEqual([{ insert: 'Hi' }]);
        expect(result.partial).toBe(false);
    });

    it('parses <details> WITHOUT open as collapsed=true', async () => {

        const el = html('<details><summary>Closed</summary></details>');

        const result = ToggleBlock.fromHTML(el, {
            parseInline: (el) => [{ insert: el.textContent || '' }],
            parseChildren: () => [],
        });

        expect(result.props.collapsed).toBe(true);
        expect(result.delta).toEqual([{ insert: 'Closed' }]);
    });

    it('returns empty delta when no summary element present', async () => {

        const el = html('<details open><p>body only</p></details>');

        const result = ToggleBlock.fromHTML(el, {
            parseInline: (el) => [{ insert: el.textContent || '' }],
            parseChildren: () => [],
        });

        expect(result.delta).toEqual([]);
    });
});

// ── ToggleBlock.htmlRules ───────────────────────────────────────────────────

describe('ToggleBlock.htmlRules', () => {
    it('has a rule matching the "details" selector', async () => {
        const selectors = ToggleBlock.htmlRules.map(r => r.selector);
        expect(selectors).toContain('details');
    });
});

// ── ToggleBlock integration ─────────────────────────────────────────────────

describe('ToggleBlock integration', () => {
    it('creates a toggle with correct type, text, and collapsed=false by default', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ToggleExtension, RichTextExtension] });

        const t = ToggleBlock.create(engine, 'toggle', { text: 'Head' });
        await engine.commit();

        expect(t.node.data.get('type')).toBe('toggle');
        expect(t.collapsed).toBe(false);
        expect(t.text).toBe('Head');
    });

    it('setCollapsed(true) persists to Loro and updates reactive state', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ToggleExtension, RichTextExtension] });

        const t = ToggleBlock.create(engine, 'toggle', { text: 'Title' });
        await engine.commit();

        t.setCollapsed(true);
        await engine.commit();

        expect(t.collapsed).toBe(true);
        expect(t.node.data.get('collapsed')).toBe(true);
    });

    it('collapsed positions excludes children, expanded positions includes them', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ToggleExtension, RichTextExtension] });

        // Toggle with no children — positions should equal behavior.positions regardless of collapse
        const t = ToggleBlock.create(engine, 'toggle', { text: 'ABC' });
        await engine.commit();

        const textPositions = t.behavior.positions; // text.length + 1 = 4
        expect(t.collapsed).toBe(false);
        expect(t.positions).toBe(textPositions);

        t.setCollapsed(true);
        await engine.commit();
        expect(t.positions).toBe(textPositions); // still same — no children

        // Now add a paragraph child and verify positions difference
        t.setCollapsed(false);
        await engine.commit();

        const child = ParagraphExtension.block.create(engine, 'paragraph', { text: 'body' }, t.node.id.toString());
        await engine.commit();

        const expandedPositions = t.positions;
        expect(expandedPositions).toBeGreaterThan(textPositions); // header + child

        t.setCollapsed(true);
        await engine.commit();
        expect(t.positions).toBe(textPositions); // collapsed: children excluded
    });

    it('capability flags are set correctly', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ToggleExtension, RichTextExtension] });
        const t = ToggleBlock.create(engine, 'toggle', {});
        await engine.commit();

        expect(t.transformsEnabled).toBe(false);
        expect(t.marksEnabled).toBe(true); // default, not overridden
    });
});
