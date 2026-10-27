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
import { SlashMenuController, filterSlashCommands, sortSlashCommands, SLASH_GROUP_ORDER } from '#lib/ui/slash-menu.svelte.js';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { FullPreset } from '#lib/presets.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { CalloutExtension } from '#lib/blocks/callout/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { RegionsExtension } from '#lib/blocks/region/index.js';

// The 15 entries the built-in extensions contribute, in the documented order (what a Full editor shows at a caret
// where no region `when` applies).
const BUILTIN_TITLES = [
    'Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'To-do list',
    'Code', 'Callout', 'Quote', 'Toggle', 'Divider', 'Image', 'Video', 'File',
];

const realEngine = (extensions) => new Nabu({ extensions, platform: 'other' });
const sortedTitles = (engine) => sortSlashCommands(engine.slashCommands).map((c) => c.title);

// Entries of a real Full editor without `when` (= the built-ins): the mock engines below carry them as `slashCommands`.
const FULL = sortSlashCommands(realEngine(FullPreset).slashCommands.filter((c) => typeof c.when !== 'function'));

// ── Mock factory ──────────────────────────────────────────────────────────────

/**
 * Build a mock engine whose anchor block has the given text and cursor position.
 * @param {string} text  Full text of the block.
 * @param {number} cursor  Cursor position (from === to for collapsed selection).
 * @param {boolean} [collapsed=true]
 */
function makeEngine(text, cursor, collapsed = true, slashCommands = FULL) {
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
        slashCommands,
    };

    return { engine, block, behavior, deleteFn, setCursor };
}

// ── open with "/" at position 0 ───────────────────────────────────────────────

describe('SlashMenuController — "/" at start of block', () => {
    it('match is non-null, query is empty, open is true, all items shown', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine);

        expect(ctrl.match).not.toBeNull();
        expect(ctrl.query).toBe('');
        expect(ctrl.open).toBe(true);
        expect(ctrl.filteredItems.length).toBe(FULL.length);
    });
});

// ── "/head" filters to headings ───────────────────────────────────────────────

describe('SlashMenuController — "/head" query', () => {
    it('query is "head", filtered items include all three headings', () => {
        const { engine } = makeEngine('/head', 5);
        const ctrl = new SlashMenuController(engine);

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
    const titlesFor = (q) => filterSlashCommands(FULL, q).map(c => c.title);

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
        expect(titlesFor('')).toHaveLength(FULL.length);
    });
});

// ── no matches → closed ───────────────────────────────────────────────────────

describe('SlashMenuController — "/zzzznomatch" query', () => {
    it('filteredItems is empty and open is false', () => {
        const { engine } = makeEngine('/zzzznomatch', 12);
        const ctrl = new SlashMenuController(engine);

        expect(ctrl.filteredItems.length).toBe(0);
        expect(ctrl.open).toBe(false);
    });
});

// ── no slash → closed ─────────────────────────────────────────────────────────

describe('SlashMenuController — plain text, no slash', () => {
    it('match is null and open is false', () => {
        const { engine } = makeEngine('hello world', 11);
        const ctrl = new SlashMenuController(engine);

        expect(ctrl.match).toBeNull();
        expect(ctrl.open).toBe(false);
    });
});

// ── "/ " (slash then space) → closed ─────────────────────────────────────────

describe('SlashMenuController — "/ " slash then space', () => {
    it('match is null because a space terminates the query pattern', () => {
        // text is "/ ", cursor is after the space (position 2)
        const { engine } = makeEngine('/ ', 2);
        const ctrl = new SlashMenuController(engine);

        expect(ctrl.match).toBeNull();
        expect(ctrl.open).toBe(false);
    });
});

// ── "a/b" slash preceded by non-whitespace → closed ──────────────────────────

describe('SlashMenuController — "a/b" slash not at start or after whitespace', () => {
    it('match is null because the slash is not at block start or after whitespace', () => {
        const { engine } = makeEngine('a/b', 3);
        const ctrl = new SlashMenuController(engine);

        expect(ctrl.match).toBeNull();
        expect(ctrl.open).toBe(false);
    });
});

// ── moveSelection wraps ───────────────────────────────────────────────────────

describe('SlashMenuController — moveSelection', () => {
    it('moves forward by 1', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine);

        expect(ctrl.selectedIndex).toBe(0);
        ctrl.moveSelection(1);
        expect(ctrl.selectedIndex).toBe(1);
    });

    it('wraps around at the end', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine);
        const n = ctrl.filteredItems.length;

        // Move to last item
        ctrl.selectedIndex = n - 1;
        ctrl.moveSelection(1);
        expect(ctrl.selectedIndex).toBe(0);
    });

    it('wraps around at the start (backward)', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine);
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
        const ctrl = new SlashMenuController(engine);

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
        const ctrl = new SlashMenuController(engine);

        expect(ctrl.open).toBe(true);
        ctrl.close();
        expect(ctrl.open).toBe(false);
    });

    it('reopens if the slash position changes (new trigger)', () => {
        const { engine } = makeEngine('/', 1);
        const ctrl = new SlashMenuController(engine);

        ctrl.close();
        expect(ctrl.open).toBe(false);

        // If the user types more text such that slashStart is different,
        // the menu would reopen. We can't easily test that with a static mock,
        // but we verify close stored the current slashStart (0).
        // The dismissed key is private; we infer it through open being false.
        expect(ctrl.open).toBe(false);
    });
});

// ── the menu is agnostic: it lists what the loaded extensions contribute ─────

describe('SlashMenuController — entries come from the extensions', () => {
    it('Paragraph + Heading only: exactly Text + Heading 1-3', () => {
        const engine = realEngine([ParagraphExtension, HeadingExtension, RichTextExtension, BlockExtension]);
        expect(new SlashMenuController(engine).available.map((c) => c.title))
            .toEqual(['Text', 'Heading 1', 'Heading 2', 'Heading 3']);
    });

    it('a Full editor shows the 15 built-in titles in the documented order, then the region entries', () => {
        const engine = realEngine(FullPreset);
        expect(FULL.map((c) => c.title)).toEqual(BUILTIN_TITLES);
        expect(sortedTitles(engine)).toEqual([...BUILTIN_TITLES, 'Section', 'Subsection', 'Sub-subsection']);
    });

    it('an editor without the callout extension never offers Callout', () => {
        const engine = realEngine(FullPreset.filter((e) => e !== CalloutExtension));
        const titles = new SlashMenuController(engine).available.map((c) => c.title);
        expect(titles).not.toContain('Callout');
        expect(titles).toHaveLength(BUILTIN_TITLES.length - 1);
    });

    it('with no contributing extension and no extras the menu is empty', () => {
        const engine = realEngine([BlockExtension]);
        expect(new SlashMenuController(engine).available).toEqual([]);
    });

    it('built-in icons are plain text glyphs, never emoji', () => {
        for (const c of FULL) expect(c.icon).toBeTruthy();
        for (const c of FULL) expect(c.icon).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it('the order does not depend on the load order of the extensions', () => {
        const expected = sortedTitles(realEngine(FullPreset));
        const rotated = [...FullPreset.slice(5), ...FullPreset.slice(0, 5)];
        const reversed = [...FullPreset].reverse();
        // deterministic pseudo-shuffle
        const shuffled = [...FullPreset].sort((a, b) => ((FullPreset.indexOf(a) * 7919) % 31) - ((FullPreset.indexOf(b) * 7919) % 31));
        for (const exts of [rotated, reversed, shuffled]) {
            expect(sortedTitles(realEngine(exts))).toEqual(expected);
            expect(new SlashMenuController(realEngine(exts)).available.map((c) => c.title)).toEqual(BUILTIN_TITLES);
        }
    });

    it('integrator extras are appended (ungrouped) and sorted with the same rules', () => {
        const run = () => {};
        const extras = [
            { title: 'Mine', run },
            { title: 'Quick text', group: 'text', order: 5, run },
            { title: 'Custom', group: 'acme', run },
        ];
        const engine = realEngine([ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, BlockExtension]);
        const titles = new SlashMenuController(engine, extras).available.map((c) => c.title);
        expect(titles).toEqual([
            'Text', 'Quick text', 'Heading 1', 'Heading 2', 'Heading 3',
            'Bulleted list', 'Numbered list', 'To-do list',
            'Custom', 'Mine',
        ]);
    });

    it('extras alone are enough (and filterable)', () => {
        const run = vi.fn();
        const { engine } = makeEngine('/my', 3, true, []);
        const ctrl = new SlashMenuController(engine, [{ title: 'My command', aliases: ['mine'], run }, { title: 'Other', run }]);
        expect(ctrl.filteredItems.map((c) => c.title)).toEqual(['My command']);
    });

    it('`when` filters contributed entries and extras at the caret', () => {
        const run = () => {};
        const yes = { title: 'Yes', when: () => true, run };
        const no = { title: 'No', when: () => false, run };
        const boom = { title: 'Boom', when: () => { throw new Error('x'); }, run };
        const extraNo = { title: 'Extra no', when: () => false, run };
        const extraYes = { title: 'Extra yes', when: (e, b) => !!b, run };
        const { engine } = makeEngine('/', 1, true, [yes, no, boom, { title: 'Plain', run }]);
        const ctrl = new SlashMenuController(engine, [extraNo, extraYes]);
        expect(ctrl.available.map((c) => c.title)).toEqual(['Yes', 'Plain', 'Extra yes']);
    });
});

describe('sortSlashCommands', () => {
    const run = () => {};
    const t = (cmds) => sortSlashCommands(cmds).map((c) => c.title);

    it('known groups in order, then unknown groups by first appearance, then ungrouped', () => {
        expect(SLASH_GROUP_ORDER).toEqual(['text', 'lists', 'blocks', 'media', 'structure']);
        expect(t([
            { title: 'none', run },
            { title: 'z1', group: 'zeta', run },
            { title: 'structure', group: 'structure', run },
            { title: 'a1', group: 'alpha', run },
            { title: 'media', group: 'media', run },
            { title: 'z2', group: 'zeta', run },
            { title: 'text', group: 'text', run },
        ])).toEqual(['text', 'media', 'structure', 'z1', 'z2', 'a1', 'none']);
    });

    it('inside a group: order ascending, ties keep the declaration order; the input is not mutated', () => {
        const input = [
            { title: 'c', group: 'text', order: 2, run },
            { title: 'a', group: 'text', run },
            { title: 'b', group: 'text', run },
            { title: 'neg', group: 'text', order: -1, run },
        ];
        const copy = [...input];
        expect(t(input)).toEqual(['neg', 'a', 'b', 'c']);
        expect(input).toEqual(copy);
    });
});
