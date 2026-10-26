// @ts-nocheck
/**
 * Unit + integration tests for the Todos aggregation system.
 */

import { describe, it, expect } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem, Todos } from '$lib/blocks/list/index.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';

describe('Todos aggregation system', () => {
    it('aggregates 3 todo items, counts done/remaining, and reports progress', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension] });
        const list = List.create(engine, 'list', { listType: 'todo' });
        const a = ListItem.create(engine, 'list-item', { text: 'a', checked: true }, list.node.id.toString());
        const b = ListItem.create(engine, 'list-item', { text: 'b', checked: false }, list.node.id.toString());
        const c = ListItem.create(engine, 'list-item', { text: 'c', checked: true }, list.node.id.toString());
        await engine.commit();

        const todos = Todos.get(engine);

        // $derived.by fields are lazy getters in compiled Svelte 5 — readable directly.
        expect(todos.all.length).toBe(3);
        expect(todos.count).toBe(3);
        expect(todos.doneCount).toBe(2);
        expect(todos.remaining.length).toBe(1);
        expect(todos.progress).toBeCloseTo(2 / 3);
    });

    it('uncheckAll sets all todos to unchecked', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension] });
        const list = List.create(engine, 'list', { listType: 'todo' });
        ListItem.create(engine, 'list-item', { text: 'a', checked: true }, list.node.id.toString());
        ListItem.create(engine, 'list-item', { text: 'b', checked: false }, list.node.id.toString());
        ListItem.create(engine, 'list-item', { text: 'c', checked: true }, list.node.id.toString());
        await engine.commit();

        const todos = Todos.get(engine);

        todos.uncheckAll();
        await engine.commit();

        expect(todos.doneCount).toBe(0);
        expect(todos.all.filter(t => t.checked).length).toBe(0);
    });

    it('checkAll sets all todos to checked', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension] });
        const list = List.create(engine, 'list', { listType: 'todo' });
        ListItem.create(engine, 'list-item', { text: 'a', checked: true }, list.node.id.toString());
        ListItem.create(engine, 'list-item', { text: 'b', checked: false }, list.node.id.toString());
        ListItem.create(engine, 'list-item', { text: 'c', checked: true }, list.node.id.toString());
        await engine.commit();

        const todos = Todos.get(engine);

        todos.checkAll();
        await engine.commit();

        expect(todos.doneCount).toBe(3);
        expect(todos.all.filter(t => t.checked).length).toBe(3);
    });

    it('Todos.get returns the same singleton instance', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension] });

        const todos1 = Todos.get(engine);
        const todos2 = Todos.get(engine);

        expect(todos1).toBe(todos2);
    });

    it('progress is 0 when there are no todos', async () => {

        const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension] });
        await engine.commit();

        const todos = Todos.get(engine);

        expect(todos.count).toBe(0);
        expect(todos.progress).toBe(0);
    });
});
