/**
 * @import { Nabu } from '../../blocks/nabu.svelte.js'
 */

import { tick } from 'svelte';
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
 * @param {Nabu} nabu
 * @param {KeyboardEvent} event
 */
function onKeyDown(nabu, event) {
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;

    const endBlock = nabu.selection.endBlock;
    const startBlock = nabu.selection.startBlock;
    const startFocusData = startBlock?.focus(null, true);
    const endFocusData = endBlock?.focus(null, true);
    console.log("Keydown event:", { key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey });

    let markName = null;
    if (!event.shiftKey) {
        markName = MARK_SHORTCUTS[event.key.toLowerCase()] ?? null;
    } else if (event.key.toLowerCase() === 'x') {
        markName = 'strikethrough';
    }

    if (!markName) return;

    // Collect all targeted block/selection pairs
    const targets = [];
    for (const [, block] of nabu.blocks) {
        if (!block.selected) continue;
        const behavior = block.behaviors?.get('text');
        if (!(behavior instanceof TextBehavior)) continue;
        const sel = behavior.selection;
        if (!sel || sel.isCollapsed) continue;
        targets.push({ behavior, sel });
    }

    if (!targets.length) return;

    // Classic editor behavior: remove if mark is fully active across all targets, apply otherwise
    const isFullyActive = targets.every(({ behavior, sel }) => behavior.isMarkActive(markName, sel));
    for (const { behavior, sel } of targets) {
        if (isFullyActive) {
            behavior.removeMark(markName, sel);
        } else {
            behavior.applyMark(markName, true, sel);
        }
    }
    const applied = true;

    if (applied) {
        nabu.commit();
        console.log('Applied mark:', markName);
        if (!startBlock || !endBlock) return;
        console.log("Refocusing blocks after mark application:", { startBlockId: startBlock.id, endBlockId: endBlock.id, startFocusData, endFocusData });
        nabu.focus({ from: { block: startBlock, offset: startFocusData?.start?.offset }, to: { block: endBlock, offset: endFocusData?.end?.offset } });
        

        return nabu.BREAK;
    }
}

export const RichTextExtension = new Extension('rich-text', {
    hooks: { onKeyDown }
});
