/**
 * @import { Nabu } from '../../blocks/nabu.svelte.js'
 */

import { Extension } from '../../utils/extensions.js';
import { TextBehavior } from './text.behavior.svelte.js';

/** @type {Record<string, string>} */
const MARK_SHORTCUTS = {
    b: 'bold',
    i: 'italic',
    u: 'underline',
    e: 'code',
};

/**
 * Collect all selected blocks with a TextBehavior and a non-collapsed selection.
 * @param {Nabu} nabu
 * @returns {{ behavior: TextBehavior, sel: any }[]}
 */
function collectMarkTargets(nabu) {
    const targets = [];
    for (const [, block] of nabu.blocks) {
        if (!block.selected) continue;
        const behavior = block.behaviors?.get('text');
        if (!(behavior instanceof TextBehavior)) continue;
        const sel = behavior.selection;
        if (!sel || sel.isCollapsed) continue;
        targets.push({ behavior, sel });
    }
    return targets;
}

/**
 * Toggle a mark on all selected text targets.
 * @param {Nabu} nabu
 * @param {string} markName
 */
function toggleMark(nabu, markName) {
    const startBlock = nabu.selection.startBlock;
    const endBlock = nabu.selection.endBlock;
    const startFocusData = startBlock?.focus(null, true);
    const endFocusData = endBlock?.focus(null, true);

    const targets = collectMarkTargets(nabu);
    if (!targets.length) return false;

    const isFullyActive = targets.every(({ behavior, sel }) => behavior.isMarkActive(markName, sel));
    for (const { behavior, sel } of targets) {
        if (isFullyActive) {
            behavior.removeMark(markName, sel);
        } else {
            behavior.applyMark(markName, true, sel);
        }
    }

    nabu.commit();
    if (startBlock && endBlock) {
        nabu.focus({
            from: { block: startBlock, offset: startFocusData?.start?.offset ?? 0 },
            to: { block: endBlock, offset: endFocusData?.end?.offset ?? 0 }
        });
    }
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
    for (const { behavior, sel } of targets) {
        behavior.applyMark(markName, value, sel);
    }
    nabu.commit();
}

/**
 * Remove a mark from all selected text targets.
 * @param {Nabu} nabu
 * @param {string} markName
 */
function removeMark(nabu, markName) {
    const targets = collectMarkTargets(nabu);
    if (!targets.length) return;
    for (const { behavior, sel } of targets) {
        behavior.removeMark(markName, sel);
    }
    nabu.commit();
}

/**
 * @param {Nabu} nabu
 * @param {KeyboardEvent} event
 */
function onKeyDown(nabu, event) {
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;

    let markName = null;
    if (!event.shiftKey) {
        markName = MARK_SHORTCUTS[event.key.toLowerCase()] ?? null;
    } else if (event.key.toLowerCase() === 'x') {
        markName = 'strikethrough';
    }

    if (!markName) return;

    event.preventDefault();
    nabu.exec('mark:toggle', { mark: markName });
    return nabu.BREAK;
}

export const RichTextExtension = new Extension('rich-text', {
    // Declare all mark attributes so Loro's applyDelta can handle them correctly.
    // 'expand: after' means the style extends when typing at the end of a marked span.
    loroTextStyles: {
        bold:          { expand: 'after' },
        italic:        { expand: 'after' },
        underline:     { expand: 'after' },
        code:          { expand: 'none' },  // code spans don't expand on insert
        strikethrough: { expand: 'after' },
    },
    actions: {
        // Full API
        'mark:toggle': (nabu, data) => toggleMark(nabu, data?.mark),
        'mark:apply':  (nabu, data) => applyMark(nabu, data?.mark, data?.value),
        'mark:remove': (nabu, data) => removeMark(nabu, data?.mark),
        // Aliases
        'bold':          (nabu) => toggleMark(nabu, 'bold'),
        'italic':        (nabu) => toggleMark(nabu, 'italic'),
        'underline':     (nabu) => toggleMark(nabu, 'underline'),
        'code':          (nabu) => toggleMark(nabu, 'code'),
        'strikethrough': (nabu) => toggleMark(nabu, 'strikethrough'),
    },
    hooks: { onKeyDown }
});
