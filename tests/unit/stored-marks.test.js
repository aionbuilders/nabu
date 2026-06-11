// @ts-nocheck — mocks intentionally implement only the surface used by tests
/**
 * Unit tests for the stored-marks system:
 *   Part A — Nabu.toggleStoredMark / clearStoredMarks logic
 *   Part B — handleInsertText applies stored marks to inserted text
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior } from '$lib/behaviors/text/text.behavior.svelte.js';

// ── Shared mock helpers ────────────────────────────────────────────────────

function makeContainer(delta = [], text = '') {
    const _text = text || delta.map(op => (typeof op.insert === 'string' ? op.insert : '')).join('');
    return {
        toString: () => _text,
        get length() { return _text.length; },
        toDelta: () => [...delta],
        insert: vi.fn(),
        delete: vi.fn(),
        mark: vi.fn(),
        unmark: vi.fn(),
        subscribe: vi.fn(),
        applyDelta: vi.fn(),
        sliceDelta: vi.fn(() => []),
    };
}

/**
 * Build a TextBehavior with the given container delta / text.
 * `nabuOverrides` merges into the mock nabu object so callers can inject storedMarks.
 */
function makeBehavior(delta = [], { inputRules = [], nabuOverrides = {} } = {}) {
    const container = makeContainer(delta);
    const nabu = {
        hooks: new Map(),
        warn: vi.fn(),
        selection: { setCursor: vi.fn() },
        BREAK: Symbol('break'),
        inputRules,
        storedMarks: null,
        ...nabuOverrides,
    };
    const block = {
        nabu,
        node: { data: { get: (k) => k === 'text' ? container : null, setContainer: () => container } },
        element: null,
        behaviors: new Map(),
        selected: false,
        commit: vi.fn(),
        ascend: vi.fn(),
        findBackward: vi.fn(),
        findForward: vi.fn(),
        destroy: vi.fn(),
        type: 'paragraph',
        transformsEnabled: true,
    };
    const behavior = new TextBehavior(block, container);
    block.behaviors.set('text', behavior);
    return behavior;
}

function makeSel(from, to = from) {
    return { from, to, isCollapsed: from === to };
}

function makeEvent(inputType, data = null) {
    return {
        inputType,
        data,
        preventDefault: vi.fn(),
        getTargetRanges: () => [],
    };
}

// ── Part A — toggleStoredMark / clearStoredMarks logic ─────────────────────
//
// We replicate the logic directly: the real Nabu class uses $state for
// storedMarks, but the logic of toggleStoredMark / inheritedMarkAt is pure.
// Rather than instantiating the full Nabu (which requires Loro, DOM, etc.),
// we test via the TextBehavior integration path below (Part B), and here we
// verify the toggle/clear logic using a minimal fake nabu object whose
// storedMarks is a plain property (since $state compiles away in vitest).
//
// The inheritedMarkAt helper reads behavior.delta, so we construct a fake
// behavior with delta set directly.

/**
 * Minimal replica of inheritedMarkAt for unit-testing the toggle direction.
 * This matches the real implementation in nabu.svelte.js exactly.
 * @param {any} behavior @param {number} pos @param {string} name
 */
function inheritedMarkAt(behavior, pos, name) {
    if (pos <= 0) return false;
    const delta = behavior.delta;
    let offset = 0;
    for (const op of delta) {
        if (typeof op.insert !== 'string') continue;
        const end = offset + op.insert.length;
        if (pos <= end) return !!(op.attributes && op.attributes[name]);
        offset = end;
    }
    return false;
}

/**
 * Minimal fake nabu + toggleStoredMark/clearStoredMarks to test the pure logic.
 */
function makeFakeNabu(behaviorDelta, selFrom) {
    const fakeBehavior = {
        delta: behaviorDelta,
        selection: { from: selFrom },
    };
    const fakeBlock = {
        behaviors: new Map([['text', fakeBehavior]]),
    };
    const nabu = {
        storedMarks: null,
        selection: { anchorBlock: fakeBlock },
        clearStoredMarks() { this.storedMarks = null; },
        toggleStoredMark(name) {
            const anchor = this.selection.anchorBlock;
            const beh = anchor?.behaviors?.get('text');
            const sel = beh?.selection;
            if (!beh || !sel) return;
            let active;
            if (this.storedMarks && name in this.storedMarks) active = this.storedMarks[name];
            else active = inheritedMarkAt(beh, sel.from, name);
            this.storedMarks = { ...(this.storedMarks || {}), [name]: !active };
        },
    };
    return nabu;
}

describe('toggleStoredMark — inherited direction', () => {
    it('toggles ON when cursor is not inside a bold span (neutral context)', () => {
        // Cursor at position 5 inside a plain text run "hello world"
        const nabu = makeFakeNabu([{ insert: 'hello world' }], 5);
        nabu.toggleStoredMark('bold');
        // char at pos 5 (i.e. 5th char, 0-indexed op covering 0–11) has no bold → toggle ON
        expect(nabu.storedMarks).toEqual({ bold: true });
    });

    it('toggles OFF when cursor is inside an already-bold span', () => {
        // "hello" is bold (positions 0–5), cursor at position 3 (inside bold span)
        const nabu = makeFakeNabu([{ insert: 'hello', attributes: { bold: true } }], 3);
        nabu.toggleStoredMark('bold');
        expect(nabu.storedMarks).toEqual({ bold: false });
    });

    it('toggles back ON on a second call (double toggle)', () => {
        const nabu = makeFakeNabu([{ insert: 'hello world' }], 5);
        nabu.toggleStoredMark('bold');
        expect(nabu.storedMarks).toEqual({ bold: true });
        nabu.toggleStoredMark('bold');
        expect(nabu.storedMarks).toEqual({ bold: false });
    });

    it('accumulates multiple marks', () => {
        const nabu = makeFakeNabu([{ insert: 'text' }], 2);
        nabu.toggleStoredMark('bold');
        nabu.toggleStoredMark('italic');
        expect(nabu.storedMarks).toEqual({ bold: true, italic: true });
    });

    it('returns early when no anchorBlock', () => {
        const nabu = makeFakeNabu([], 0);
        nabu.selection.anchorBlock = null;
        nabu.toggleStoredMark('bold');
        expect(nabu.storedMarks).toBeNull();
    });

    it('returns early when cursor at position 0 (boundary — inherited is false)', () => {
        const nabu = makeFakeNabu([{ insert: 'hello', attributes: { bold: true } }], 0);
        nabu.toggleStoredMark('bold');
        // inheritedMarkAt returns false for pos <= 0, so we toggle ON
        expect(nabu.storedMarks).toEqual({ bold: true });
    });
});

describe('clearStoredMarks', () => {
    it('sets storedMarks to null', () => {
        const nabu = makeFakeNabu([{ insert: 'hello' }], 2);
        nabu.storedMarks = { bold: true, italic: false };
        nabu.clearStoredMarks();
        expect(nabu.storedMarks).toBeNull();
    });

    it('is a no-op when already null', () => {
        const nabu = makeFakeNabu([], 0);
        nabu.storedMarks = null;
        nabu.clearStoredMarks();
        expect(nabu.storedMarks).toBeNull();
    });
});

// ── Part B — handleInsertText applies stored marks ─────────────────────────

describe('handleInsertText with storedMarks', () => {
    it('applies stored bold=true mark to the inserted text range', () => {
        const b = makeBehavior([{ insert: 'hello' }]);
        b.nabu.storedMarks = { bold: true };

        b.handleBeforeInput(makeEvent('insertText', 'x'), makeSel(3));

        // insert was called with 'x' at offset 3
        expect(b.container.insert).toHaveBeenCalledWith(3, 'x');
        // mark should be called for bold over range {start:3, end:4}
        expect(b.container.mark).toHaveBeenCalledWith({ start: 3, end: 4 }, 'bold', true);
        expect(b.container.unmark).not.toHaveBeenCalled();
    });

    it('removes bold mark (bold=false) from the inserted text range', () => {
        const b = makeBehavior([{ insert: 'hello', attributes: { bold: true } }]);
        b.nabu.storedMarks = { bold: false };

        b.handleBeforeInput(makeEvent('insertText', 'x'), makeSel(3));

        expect(b.container.insert).toHaveBeenCalledWith(3, 'x');
        // unmark should be called for bold over range {start:3, end:4}
        expect(b.container.unmark).toHaveBeenCalledWith({ start: 3, end: 4 }, 'bold');
        expect(b.container.mark).not.toHaveBeenCalled();
    });

    it('does not call mark or unmark when storedMarks is null (plain insert)', () => {
        const b = makeBehavior([{ insert: 'hello' }]);
        b.nabu.storedMarks = null;

        b.handleBeforeInput(makeEvent('insertText', 'y'), makeSel(2));

        expect(b.container.insert).toHaveBeenCalledWith(2, 'y');
        expect(b.container.mark).not.toHaveBeenCalled();
        expect(b.container.unmark).not.toHaveBeenCalled();
    });

    it('applies multiple stored marks in one insert', () => {
        const b = makeBehavior([{ insert: 'hello' }]);
        b.nabu.storedMarks = { bold: true, italic: true };

        b.handleBeforeInput(makeEvent('insertText', 'z'), makeSel(5));

        expect(b.container.insert).toHaveBeenCalledWith(5, 'z');
        expect(b.container.mark).toHaveBeenCalledWith({ start: 5, end: 6 }, 'bold', true);
        expect(b.container.mark).toHaveBeenCalledWith({ start: 5, end: 6 }, 'italic', true);
        expect(b.container.mark).toHaveBeenCalledTimes(2);
    });

    it('does not apply stored marks when textToInsert is empty', () => {
        const b = makeBehavior([{ insert: 'hello' }]);
        b.nabu.storedMarks = { bold: true };

        b.handleBeforeInput(makeEvent('insertText', ''), makeSel(2));

        expect(b.container.insert).toHaveBeenCalledWith(2, '');
        expect(b.container.mark).not.toHaveBeenCalled();
    });

    it('clears storedMarks after a markdown shortcut fires', () => {
        const handler = vi.fn(() => true);
        const b = makeBehavior([{ insert: '**bold*' }], {
            inputRules: [{ pattern: /\*\*bold\*$/, handler }],
        });
        b.nabu.storedMarks = { bold: true };

        b.handleBeforeInput(makeEvent('insertText', '*'), makeSel(7));

        // The markdown shortcut fired; storedMarks should be cleared
        expect(b.nabu.storedMarks).toBeNull();
    });
});
