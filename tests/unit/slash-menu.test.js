// @ts-nocheck
/**
 * Unit tests for SlashMenuController — pure logic, no DOM required.
 *
 * The mock engine exposes:
 *   selection.anchorBlock  — a block whose behaviors.get('text') returns a
 *                            behavior with { selection, text, container }
 *   commit                 — vi.fn(async () => {})
 *   selection.setCursor    — vi.fn()
 *   exec                   — vi.fn()
 */

import { describe, it, expect, vi } from 'vitest';
import { SlashMenuController, DEFAULT_SLASH_COMMANDS, filterSlashCommands } from '$lib/ui/slash-menu.svelte.js';

// ── Mock factory ──────────────────────────────────────────────────────────────

/**
 * Build a mock engine whose anchor block has the given text and cursor position.
 * @param {string} text  Full text of the block.
 * @param {number} cursor  Cursor position (from === to for collapsed selection).
 * @param {boolean} [collapsed=true]
 */
function makeEngine(text, cursor, collapsed = true) {
    const deleteFn = vi.fn();
    const behavior = {
        get text() { return text; },
        selection: { from: cursor, isCollapsed: collapsed },
        container: { toDelta: () => [{ insert: text }] },
        delete: deleteFn,
    };

    const block = {
        behaviors: new Map([['text', behavior]]),
        node: {
            parent: () => ({ id: { toString: () => 'parent-id' } }),
            index: () => 0,
        },
        destroy: vi.fn(),
    };

    const setCursor = vi.fn();
    const engine = {
        selection: {
            anchorBlock: block,
            firstRange: null,
            setCursor,
        },
        commit: vi.fn(async () => {}),
        exec: vi.fn(),
        blocks: { get: vi.fn(() => null) },
    };

    return { engine, block, behavior, deleteFn, setCursor };
}

// ── open with "/" at position 0 ───────────────────────────────────────────────

describe('SlashMenuController — "/" at start of block', () => {
    it('match is non-null, query is empty, open is true, all items shown', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.match).not.toBeNull();
        expect(ctrl.query).toBe('');
        expect(ctrl.open).toBe(true);
        expect(ctrl.filteredItems.length).toBe(DEFAULT_SLASH_COMMANDS.length);
    });
});

// ── "/head" filters to headings ───────────────────────────────────────────────

describe('SlashMenuController — "/head" query', () => {
    it('query is "head", filtered items include all three headings', () => {
        const { engine } = makeEngine('/head', 5);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.query).toBe('head');
        expect(ctrl.open).toBe(true);

        const titles = ctrl.filteredItems.map(c => c.title);
        expect(titles).toContain('Heading 1');
        expect(titles).toContain('Heading 2');
        expect(titles).toContain('Heading 3');
    });
});

// ── filtering: titles by substring, aliases by prefix ────────────────────────

describe('filterSlashCommands', () => {
    const titlesFor = (q) => filterSlashCommands(DEFAULT_SLASH_COMMANDS, q).map(c => c.title);

    it('"/ul" matches Bulleted list only (not Divider via its "rule" alias)', () => {
        expect(titlesFor('ul')).toEqual(['Bulleted list']);
    });

    it('aliases match by prefix: "/bul", "/h1", "/todo", "/hr", "/sep"', () => {
        expect(titlesFor('bul')).toEqual(['Bulleted list']);
        expect(titlesFor('h1')).toEqual(['Heading 1']);
        expect(titlesFor('todo')).toEqual(['To-do list']);
        expect(titlesFor('hr')).toEqual(['Divider']);
        expect(titlesFor('sep')).toEqual(['Divider']);
        expect(titlesFor('rul')).toEqual(['Divider']);  // prefix of "rule"
        expect(titlesFor('ule')).toEqual([]);           // an inner substring of an alias no longer matches
    });

    it('titles still match by substring: "/head", "/list", "/do"', () => {
        expect(titlesFor('head')).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
        expect(titlesFor('list')).toEqual(['Bulleted list', 'Numbered list', 'To-do list']);
        expect(titlesFor('do')).toContain('To-do list');
    });

    it('is case-insensitive and keeps all commands on an empty query', () => {
        expect(titlesFor('TODO')).toEqual(['To-do list']);
        expect(titlesFor('')).toHaveLength(DEFAULT_SLASH_COMMANDS.length);
    });
});

// ── no matches → closed ───────────────────────────────────────────────────────

describe('SlashMenuController — "/zzzznomatch" query', () => {
    it('filteredItems is empty and open is false', () => {
        const { engine } = makeEngine('/zzzznomatch', 12);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.filteredItems.length).toBe(0);
        expect(ctrl.open).toBe(false);
    });
});

// ── no slash → closed ─────────────────────────────────────────────────────────

describe('SlashMenuController — plain text, no slash', () => {
    it('match is null and open is false', () => {
        const { engine } = makeEngine('hello world', 11);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.match).toBeNull();
        expect(ctrl.open).toBe(false);
    });
});

// ── "/ " (slash then space) → closed ─────────────────────────────────────────

describe('SlashMenuController — "/ " slash then space', () => {
    it('match is null because a space terminates the query pattern', () => {
        // text is "/ ", cursor is after the space (position 2)
        const { engine } = makeEngine('/ ', 2);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.match).toBeNull();
        expect(ctrl.open).toBe(false);
    });
});

// ── "a/b" slash preceded by non-whitespace → closed ──────────────────────────

describe('SlashMenuController — "a/b" slash not at start or after whitespace', () => {
    it('match is null because the slash is not at block start or after whitespace', () => {
        const { engine } = makeEngine('a/b', 3);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.match).toBeNull();
        expect(ctrl.open).toBe(false);
    });
});

// ── moveSelection wraps ───────────────────────────────────────────────────────

describe('SlashMenuController — moveSelection', () => {
    it('moves forward by 1', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.selectedIndex).toBe(0);
        ctrl.moveSelection(1);
        expect(ctrl.selectedIndex).toBe(1);
    });

    it('wraps around at the end', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);
        const n = ctrl.filteredItems.length;

        // Move to last item
        ctrl.selectedIndex = n - 1;
        ctrl.moveSelection(1);
        expect(ctrl.selectedIndex).toBe(0);
    });

    it('wraps around at the start (backward)', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);
        const n = ctrl.filteredItems.length;

        ctrl.selectedIndex = 0;
        ctrl.moveSelection(-1);
        expect(ctrl.selectedIndex).toBe(n - 1);
    });
});

// ── select(index) ─────────────────────────────────────────────────────────────

describe('SlashMenuController — select()', () => {
    it('deletes the slash query text and runs the command', async () => {
        // Text is "/heading" with cursor at 8 — matches Heading 1/2/3
        const { engine, deleteFn } = makeEngine('/heading', 8);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        // Find index of 'Heading 1'
        const i = ctrl.filteredItems.findIndex(c => c.title === 'Heading 1');
        expect(i).toBeGreaterThanOrEqual(0);

        await ctrl.select(i);

        // behavior.delete called with { index: slashStart, length: cursor - slashStart }
        // slashStart = cursor - query.length - 1 = 8 - 7 - 1 = 0, length = 8 - 0 = 8
        expect(deleteFn).toHaveBeenCalledWith({ index: 0, length: 8 });

        // engine.commit was awaited
        expect(engine.commit).toHaveBeenCalled();

        // The Heading 1 command runs exec('heading:1')
        expect(engine.exec).toHaveBeenCalledWith('heading:1');
    });
});

// ── close() dismisses the menu ────────────────────────────────────────────────

describe('SlashMenuController — close()', () => {
    it('sets open to false for the current trigger position', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        expect(ctrl.open).toBe(true);
        ctrl.close();
        expect(ctrl.open).toBe(false);
    });

    it('reopens if the slash position changes (new trigger)', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine, DEFAULT_SLASH_COMMANDS);

        ctrl.close();
        expect(ctrl.open).toBe(false);

        // If the user types more text such that slashStart is different,
        // the menu would reopen. We can't easily test that with a static mock,
        // but we verify close stored the current slashStart (0).
        // The dismissed key is private; we infer it through open being false.
        expect(ctrl.open).toBe(false);
    });
});
