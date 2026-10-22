/**
 * @import { Nabu } from '../../blocks/nabu.svelte.js'
 */

import { Extension } from '../../utils/extensions.js';
import { TextBehavior } from './text.behavior.svelte.js';
import { sanitizeUrl } from '../../utils/html.js';
import { livePoints, placePoints } from '../../blocks/undo-selection.js';
import { tick } from 'svelte';

/**
 * Collect all selected blocks with a TextBehavior and a non-collapsed selection.
 * @param {Nabu} nabu
 * @returns {{ behavior: TextBehavior, sel: any }[]}
 */
function collectMarkTargets(nabu) {
    const targets = [];
    for (const [, block] of nabu.blocks) {
        if (!block.selected) continue;
        if (block.marksEnabled === false) continue;
        const behavior = block.behaviors?.get('text');
        if (!(behavior instanceof TextBehavior)) continue;
        const sel = behavior.selection;
        if (!sel || sel.isCollapsed) continue;
        targets.push({ behavior, sel });
    }
    return targets;
}

/**
 * Run a mark mutation as one transaction and leave the selection EXACTLY on the same characters (anchor, focus and so the
 * direction). A mark rewrites the spans of the text, so the DOM point of an offset changes (a plain text node becomes
 * text / `<strong>` / text): the selection is kept as MODEL points (block + text offset) and put back on the new DOM once it
 * is rendered. Never derive a model offset from a DOM point.
 * @param {Nabu} nabu
 * @param {() => void} mutate
 */
async function markTransaction(nabu, mutate) {
    const kept = livePoints(nabu);
    await nabu.transact(mutate);
    if (!kept) return;
    await tick();
    placePoints(nabu, kept);
}

/**
 * Toggle a mark on all selected text targets.
 * @param {Nabu} nabu
 * @param {string} markName
 */
async function toggleMark(nabu, markName) {
    const targets = collectMarkTargets(nabu);
    if (!targets.length) {
        // Collapsed cursor: toggle the pending stored mark for the next typed char.
        if (nabu.selection.anchorBlock?.behaviors?.has('text')) nabu.toggleStoredMark(markName);
        return false;
    }

    const isFullyActive = targets.every(({ behavior, sel }) => behavior.isMarkActive(markName, sel));
    await markTransaction(nabu, () => {
        for (const { behavior, sel } of targets) {
            if (isFullyActive) {
                behavior.removeMark(markName, sel);
            } else {
                behavior.applyMark(markName, true, sel);
            }
        }
    });
    return true;
}

/**
 * Apply a mark on all selected text targets.
 * @param {Nabu} nabu
 * @param {string} markName
 * @param {any} value
 */
function applyMark(nabu, markName, value = true) {
    const targets = collectMarkTargets(nabu);
    if (!targets.length) return;
    return markTransaction(nabu, () => {
        for (const { behavior, sel } of targets) {
            behavior.applyMark(markName, value, sel);
        }
    });
}

/**
 * Remove a mark from all selected text targets.
 * @param {Nabu} nabu
 * @param {string} markName
 */
function removeMark(nabu, markName) {
    const targets = collectMarkTargets(nabu);
    if (!targets.length) return;
    return markTransaction(nabu, () => {
        for (const { behavior, sel } of targets) {
            behavior.removeMark(markName, sel);
        }
    });
}

/**
 * The mark shortcuts are COMMANDS (`mark:bold`…, keys below, replaceable through the `keymap` option). This legacy hook only
 * runs when no command took the key: the browser's own Ctrl/Cmd+B / I / U would then format the text natively
 * (`beforeinput` `formatBold`…), so a shortcut a `keymap` removed or moved stays dead instead of coming back through the
 * native path.
 * @param {Nabu} nabu
 * @param {KeyboardEvent} event
 */
function onKeyDown(nabu, event) {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    if (key !== 'b' && key !== 'i' && key !== 'u') return;
    event.preventDefault();
    return nabu.BREAK;
}

/** `beforeinput` format types (browser / OS formatting commands) -> the mark they toggle. Sub/superscript have no mark here: ignored. */
const FORMAT_INPUT_MARKS = /** @type {Record<string, string>} */ ({
    formatBold: 'bold',
    formatItalic: 'italic',
    formatUnderline: 'underline',
    formatStrikeThrough: 'strikethrough',
});

/** Marks `formatRemove` clears (links are content, not formatting: they stay). */
const FORMAT_REMOVE_MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code'];

/**
 * Native formatting commands (Cmd+B from the OS menu, "Format > Bold", Touch Bar, accessibility APIs…) arrive as
 * `beforeinput` events of type `formatBold` etc. They go through the same actions as the keyboard shortcuts.
 * @param {Nabu} nabu
 * @param {InputEvent} event
 */
function onBeforeInput(nabu, event) {
    const type = event.inputType;
    if (typeof type !== 'string' || !type.startsWith('format')) return;
    event.preventDefault();
    const mark = FORMAT_INPUT_MARKS[type];
    if (mark) {
        nabu.exec('mark:toggle', { mark });
    } else if (type === 'formatRemove') {
        const targets = collectMarkTargets(nabu);
        if (!targets.length) {
            if (nabu.selection.anchorBlock?.behaviors?.has('text')) {
                nabu.storedMarks = Object.fromEntries(FORMAT_REMOVE_MARKS.map((name) => [name, false]));
            }
        } else {
            markTransaction(nabu, () => {
                for (const { behavior, sel } of targets) for (const name of FORMAT_REMOVE_MARKS) behavior.removeMark(name, sel);
            });
        }
    }
    return nabu.BREAK;
}

/**
 * A link href that may enter the model: http(s), mailto, tel, relative, `#fragment`. Anything else
 * (`javascript:`, `data:`, `vbscript:`…) is refused with a warning. Returns the href, or null.
 * @param {any} nabu @param {unknown} href @returns {string | null}
 */
function safeHref(nabu, href) {
    if (!href) return null;
    const safe = sanitizeUrl(href, { kind: 'link' });
    if (safe === null) nabu.warn('link: refused unsafe href', href);
    return safe;
}

export const RichTextExtension = new Extension('rich-text', {
    // Declare all mark attributes so Loro's applyDelta can handle them correctly.
    // Marks are exact (expand: 'none') — they don't auto-extend at boundaries.
    // Continuation of formatting when typing inside a marked span is handled by
    // stored marks (nabu.storedMarks) toggled via Ctrl+B/I/etc. at a collapsed cursor.
    loroTextStyles: {
        bold:          { expand: 'none' },
        italic:        { expand: 'none' },
        underline:     { expand: 'none' },
        code:          { expand: 'none' },  // code spans don't expand on insert
        strikethrough: { expand: 'none' },
        link:          { expand: 'none' },  // les liens ne s'étendent pas en tapant
    },
    actions: {
        // Full API
        'mark:toggle': (nabu, data) => toggleMark(nabu, data?.mark),
        'mark:apply':  (nabu, data) => applyMark(nabu, data?.mark, data?.value),
        'mark:remove': (nabu, data) => removeMark(nabu, data?.mark),
        // Links — the 'link' mark stores the href as its value
        'link:set': (nabu, data) => {
            const href = safeHref(nabu, data?.href);
            if (!href) return;
            return applyMark(nabu, 'link', href);
        },
        'link:remove': (nabu) => removeMark(nabu, 'link'),
        'link:toggle': (nabu, data) => {
            const targets = collectMarkTargets(nabu);
            if (!targets.length) return;
            const allHaveLink = targets.every(({ behavior, sel }) => behavior.isMarkActive('link', sel));
            if (allHaveLink) return removeMark(nabu, 'link');
            const href = safeHref(nabu, data?.href);
            if (!href) return;
            return applyMark(nabu, 'link', href);
        },
        // Aliases
        'bold':          (nabu) => toggleMark(nabu, 'bold'),
        'italic':        (nabu) => toggleMark(nabu, 'italic'),
        'underline':     (nabu) => toggleMark(nabu, 'underline'),
        'code':          (nabu) => toggleMark(nabu, 'code'),
        'strikethrough': (nabu) => toggleMark(nabu, 'strikethrough'),
    },
    // Keyboard shortcuts (ADR 017). Also actions of the bus: `nabu.exec('mark:bold')`.
    commands: {
        'mark:bold':          { label: 'Bold',          keys: ['Mod-b'],       run: (nabu) => { toggleMark(nabu, 'bold'); } },
        'mark:italic':        { label: 'Italic',        keys: ['Mod-i'],       run: (nabu) => { toggleMark(nabu, 'italic'); } },
        'mark:underline':     { label: 'Underline',     keys: ['Mod-u'],       run: (nabu) => { toggleMark(nabu, 'underline'); } },
        'mark:code':          { label: 'Code',          keys: ['Mod-e'],       run: (nabu) => { toggleMark(nabu, 'code'); } },
        'mark:strikethrough': { label: 'Strikethrough', keys: ['Mod-Shift-x'], run: (nabu) => { toggleMark(nabu, 'strikethrough'); } },
    },
    hooks: { onKeyDown, onBeforeInput }
});
