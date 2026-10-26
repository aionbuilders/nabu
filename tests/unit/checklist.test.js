// @ts-nocheck
/**
 * Unit + integration tests for todo list (checklist) support.
 */

import { describe, it, expect } from 'vitest';
import { List } from '$lib/blocks/list/list.svelte.js';
import { ListItem } from '$lib/blocks/list/list-item.svelte.js';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';

function parseInline(text) {
    return [{ insert: text }];
}

// ── List.fromMarkdown — task list parsing ──────────────────────────────────

describe('List.fromMarkdown — todo list', () => {
    it('parses "- [ ] a" and "- [x] b" as a todo list', () => {
        const result = List.fromMarkdown(['- [ ] a', '- [x] b'], { parseInline });
        expect(result).not.toBeNull();
        expect(result.props.listType).toBe('todo');
        expect(result.children).toHaveLength(2);
        expect(result.children[0].props.checked).toBe(false);
        expect(result.children[0].delta).toEqual([{ insert: 'a' }]);
        expect(result.children[1].props.checked).toBe(true);
        expect(result.children[1].delta).toEqual([{ insert: 'b' }]);
    });

    it('handles uppercase [X] as checked', () => {
        const result = List.fromMarkdown(['- [X] done'], { parseInline });
        expect(result.props.listType).toBe('todo');
        expect(result.children[0].props.checked).toBe(true);
    });

    it('handles compact "- []" (no space) as unchecked', () => {
        const result = List.fromMarkdown(['- [] task'], { parseInline });
        expect(result.props.listType).toBe('todo');
        expect(result.children[0].props.checked).toBe(false);
        expect(result.children[0].delta).toEqual([{ insert: 'task' }]);
    });

    it('REGRESSION: plain bullet list still returns listType bullet with no checked prop', () => {
        const result = List.fromMarkdown(['- a', '- b'], { parseInline });
        expect(result.props.listType).toBe('bullet');
        expect(result.children[0].props).toBeUndefined();
        expect(result.children[1].props).toBeUndefined();
    });

    it('REGRESSION: ordered list still returns listType ordered with no checked prop', () => {
        const result = List.fromMarkdown(['1. first', '2. second'], { parseInline });
        expect(result.props.listType).toBe('ordered');
        expect(result.children[0].props).toBeUndefined();
        expect(result.children[1].props).toBeUndefined();
    });
});

// ── ListItem.toMarkdown — static ────────────────────────────────────────────

describe('ListItem.toMarkdown — todo items', () => {
    it('renders unchecked task item', () => {
        const pb = { type: 'list-item', props: { checked: false }, delta: [{ insert: 'x' }] };
        const result = ListItem.toMarkdown(pb, { recurse: () => '', listType: 'todo', index: 0, depth: 0 });
        expect(result).toBe('- [ ] x');
    });

    it('renders checked task item', () => {
        const pb = { type: 'list-item', props: { checked: true }, delta: [{ insert: 'x' }] };
        const result = ListItem.toMarkdown(pb, { recurse: () => '', listType: 'todo', index: 0, depth: 0 });
        expect(result).toBe('- [x] x');
    });

    it('REGRESSION: bullet item still renders as "- text"', () => {
        const pb = { type: 'list-item', delta: [{ insert: 'x' }] };
        const result = ListItem.toMarkdown(pb, { recurse: () => '', listType: 'bullet', index: 0, depth: 0 });
        expect(result).toBe('- x');
    });

    it('REGRESSION: ordered item still renders as "1. text"', () => {
        const pb = { type: 'list-item', delta: [{ insert: 'y' }] };
        const result = ListItem.toMarkdown(pb, { recurse: () => '', listType: 'ordered', index: 0, depth: 0 });
        expect(result).toBe('1. y');
    });
});

// ── List.toHtml — todo list ─────────────────────────────────────────────────

describe('List.toHtml — todo list', () => {
    it('renders todo list with class="contains-task-list"', async () => {
        const pb = {
            type: 'list',
            props: { listType: 'todo' },
            children: [
                { type: 'list-item', props: { checked: false }, delta: [{ insert: 'a' }] },
            ],
        };
        const result = List.toHtml(pb, { recurse: () => '<li>a</li>' });
        expect(result).toContain('contains-task-list');
        expect(result).toMatch(/^<ul/);
    });

    it('REGRESSION: bullet list still renders as plain <ul>', async () => {
        const pb = {
            type: 'list',
            props: { listType: 'bullet' },
            children: [{ type: 'list-item', delta: [{ insert: 'x' }] }],
        };
        const result = List.toHtml(pb, { recurse: () => '<li>x</li>' });
        expect(result).toBe('<ul><li>x</li></ul>');
    });

    it('REGRESSION: ordered list still renders as plain <ol>', async () => {
        const pb = {
            type: 'list',
            props: { listType: 'ordered' },
            children: [{ type: 'list-item', delta: [{ insert: 'x' }] }],
        };
        const result = List.toHtml(pb, { recurse: () => '<li>x</li>' });
        expect(result).toBe('<ol><li>x</li></ol>');
    });
});

// ── ListItem.toHtml — checkbox ──────────────────────────────────────────────

describe('ListItem.toHtml — task items', () => {
    it('renders unchecked task with disabled checkbox', () => {
        const pb = { type: 'list-item', props: { checked: false }, delta: [{ insert: 'task' }] };
        const result = ListItem.toHtml(pb, { recurse: () => '' });
        expect(result).toContain('<input type="checkbox" disabled>');
        expect(result).toContain('task');
        expect(result).not.toContain('checked');
    });

    it('renders checked task with checked attribute', () => {
        const pb = { type: 'list-item', props: { checked: true }, delta: [{ insert: 'done' }] };
        const result = ListItem.toHtml(pb, { recurse: () => '' });
        expect(result).toContain('<input type="checkbox" disabled checked>');
    });

    it('REGRESSION: regular item still renders as plain <li>', () => {
        const pb = { type: 'list-item', delta: [{ insert: 'item' }] };
        const result = ListItem.toHtml(pb, { recurse: () => '' });
        expect(result).toBe('<li>item</li>');
    });
});

// ── Integration test ────────────────────────────────────────────────────────

describe('ListItem integration — checked metadata', () => {
    it('persists checked=true in Loro data and exposes isTodo + checked', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension] });

        // Use static create directly so we bypass registry lookup (integration: Loro data)
        const list = List.create(engine, 'list', { listType: 'todo' });
        const item = ListItem.create(engine, 'list-item', { text: 'task', checked: true }, list.node.id.toString());

        await engine.commit();

        // Verify Loro data
        expect(item.node.data.get('checked')).toBe(true);

        // Verify reactive state
        expect(item.checked).toBe(true);
        expect(item.isTodo).toBe(true);
    });

    it('persists checked=false in Loro data', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension] });

        const list = List.create(engine, 'list', { listType: 'todo' });
        const item = ListItem.create(engine, 'list-item', { text: 'pending', checked: false }, list.node.id.toString());

        await engine.commit();

        expect(item.node.data.get('checked')).toBe(false);
        expect(item.checked).toBe(false);
        expect(item.isTodo).toBe(true);
    });
});
