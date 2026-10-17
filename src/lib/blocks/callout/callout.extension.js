import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { CalloutBlock } from "./callout.svelte.js";
import CalloutComponent from "./Callout.svelte";

/**
 * @import { Nabu, Block } from "..";
 */

/**
 * onBeforeInput hook for CalloutBlock:
 * - Inside a callout block: Backspace on empty → transform back to paragraph.
 * - In any other text block: "! " at the start → transform into a callout.
 *   (The "> " prefix is taken by Blockquote, so callouts use "! " — mnemonic
 *   for alert/important, and free of collisions.)
 *
 * @param {Nabu} nabu @param {InputEvent} event @param {Block} block
 */
const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    const behavior = block.behaviors.get('text');
    if (!(behavior instanceof TextBehavior)) return CONTINUE;
    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    if (block instanceof CalloutBlock) {
        // Backspace at position 0 in an empty callout block → back to paragraph
        if (event.inputType === 'deleteContentBackward' && sel.from === 0 && behavior.text.length === 0) {
            const blockId = block.node.id.toString();
            block.transformTo('paragraph');
            tick().then(() => {
                const fresh = nabu.blocks.get(blockId);
                if (fresh) fresh.focus({ start: 0, end: 0 });
            });
            return BREAK;
        }
        return CONTINUE;
    }

    // "! " at the start of a text block → transform into a callout (variant note)
    if (event.inputType === 'insertText' && event.data === ' ') {
        if (behavior.text.slice(0, sel.from) !== '!') return CONTINUE;
        const blockId = block.node.id.toString();
        // Undo gives back "! " (trigger space included): see Nabu.shortcut()
        nabu.shortcut(block, ' ', (b) => {
            b.delete({ index: 0, length: 2 });
            block.transformTo('callout');
        });
        tick().then(() => {
            const fresh = nabu.blocks.get(blockId);
            if (fresh) fresh.focus({ start: 0, end: 0 });
        });
        return BREAK;
    }

    return CONTINUE;
};

export const CalloutExtension = extension("callout", {
    // @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
    block: CalloutBlock,
    component: CalloutComponent,
    actions: {
        'callout': (nabu) => nabu.exec('block:transform', { type: 'callout' }),
    },
    hooks: {
        onBeforeInput,
    }
});
