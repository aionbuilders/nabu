/**
 * The `tab` option (P-41): what Tab / Shift+Tab do in a plain text block, i.e. when NOTHING structural took the key.
 *
 * Structural meanings always come first and are never affected by this option: list indent / outdent, code indentation, region
 * title promote / demote (a command, ADR 017) and anything an extension handles in its own `onKeyDown` / `keydown`. The engine
 * calls {@link handleTabKey} AFTER all of them, only for a key that is still not `defaultPrevented`. Agnostic: it names no block
 * type, it only asks a block for its `text` behavior.
 *
 * Modes:
 *  - `'focus'`: the browser default, Tab leaves the editor (like a `<textarea>`). Nothing is prevented.
 *  - `'stay'`: Tab and Shift+Tab are swallowed, the caret stays. Escape then Tab leaves: after an Escape that nothing consumed
 *    (no slash menu, chooser or pending command), the NEXT Tab / Shift+Tab is left to the browser; any other key or a click
 *    arms the trap again. Announced to screen readers through `aria-description` on the editor root (option `tabHint`).
 *  - `'indent'`: Tab inserts a `\t` at the caret (it replaces a selection inside ONE block); Shift+Tab removes one `\t` right
 *    before the caret, if there is one, else nothing. With a selection spanning several blocks, or in a block without a text
 *    behavior or whose text is isolated (a region title), it behaves like `'stay'`. Same Escape-then-Tab way out as `'stay'`
 *    (otherwise the editor would be a keyboard trap) and the same announcement.
 *  - `'nest'` (Notion-style nesting) is planned, NOT implemented: asking for it warns and falls back to the default.
 *
 * @import { Nabu } from '../blocks/nabu.svelte.js'
 */

import { tick } from 'svelte';

/** @typedef {'focus' | 'stay' | 'indent'} TabMode */

/** The implemented modes. */
export const TAB_MODES = /** @type {const} */ (['focus', 'stay', 'indent']);

/** Default announcement of the Escape-then-Tab way out (option `tabHint`). */
export const DEFAULT_TAB_HINT = 'Press Escape then Tab to leave the editor';

/**
 * Whether `value` is an implemented mode.
 * @param {unknown} value
 * @returns {value is TabMode}
 */
export function isTabMode(value) {
    return typeof value === 'string' && /** @type {readonly string[]} */ (TAB_MODES).includes(value);
}

/**
 * Resolve the `tab` option: a valid mode wins; `undefined` gives the default silently; anything else (unknown mode,
 * `'nest'`, a wrong type) warns and gives the default.
 * @param {unknown} value
 * @param {TabMode} fallback
 * @param {(message: string) => void} [warn]
 * @returns {TabMode}
 */
export function resolveTabMode(value, fallback, warn) {
    if (value === undefined || value === null) return fallback;
    if (isTabMode(value)) return value;
    warn?.(value === 'nest'
        ? `Option "tab": 'nest' is not implemented yet, using '${fallback}'`
        : `Ignoring invalid option "tab" (${JSON.stringify(value)}; expected 'focus', 'stay' or 'indent'), using '${fallback}'`);
    return fallback;
}

/** Keys that are only modifiers: pressing one (e.g. the Shift of Shift+Tab) is not "another key". @type {Set<string>} */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock']);

/** @param {KeyboardEvent} e */
export const isModifierKey = (e) => MODIFIER_KEYS.has(e.key);

/**
 * Apply the `tab` option to a Tab / Shift+Tab that nothing structural handled. Call it last in the keydown chain.
 * @param {Nabu} nabu
 * @param {KeyboardEvent} e
 * @param {boolean} escaped  an Escape that nothing consumed was the previous key: the way out is open for this key
 * @returns {boolean} whether the key was swallowed
 */
export function handleTabKey(nabu, e, escaped) {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return false;
    if (e.isComposing || e.keyCode === 229 || nabu.composing) return false;
    const mode = nabu.tab;
    if (mode === 'focus' || escaped) return false; // the browser moves the focus
    e.preventDefault();
    if (mode === 'indent') indentWithTab(nabu, e.shiftKey);
    return true;
}

/**
 * @param {Nabu} nabu
 * @param {boolean} outdent  Shift+Tab
 */
function indentWithTab(nabu, outdent) {
    const sel = nabu.selection;
    const block = sel.anchorBlock;
    if (!block || block !== sel.focusBlock || block.isolatesSelection) return; // several blocks, or no editable text: like 'stay'
    const behavior = block.behaviors?.get('text');
    const range = behavior?.selection;
    if (!behavior || !range) return;

    if (outdent) {
        if (!range.isCollapsed || range.from <= 0 || behavior.text[range.from - 1] !== '\t') return;
        behavior.delete({ index: range.from - 1, length: 1 });
        nabu.storedMarks = null;
        block.commit();
        tick().then(() => nabu.selection.setCursor(block, range.from - 1));
        return;
    }

    const from = range.from;
    if (!range.isCollapsed) behavior.delete({ index: from, length: range.to - from }, range);
    behavior.insert(from, '\t');
    // The cursor's pending marks apply to what is typed, like any inserted character (see TextBehavior#handleInsertText).
    const stored = nabu.storedMarks;
    if (stored) {
        const span = { from, to: from + 1, isCollapsed: false };
        for (const [name, on] of Object.entries(stored)) {
            if (on) behavior.applyMark(name, true, span);
            else behavior.removeMark(name, span);
        }
    }
    block.commit();
    tick().then(() => nabu.selection.setCursor(block, from + 1));
}
