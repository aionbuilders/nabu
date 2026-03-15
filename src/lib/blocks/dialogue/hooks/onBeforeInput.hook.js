import { tick } from "svelte";
import { TextBehavior } from "../../../behaviors/text";
import { Dialogue } from "../dialogue.svelte.js";

/**
 * @import { Nabu, Block } from "../../..";
 */

/** @param {Nabu} nabu @param {InputEvent} event @param {Block} block */
export const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    // Backspace au début d'un bloc dialogue → retour en paragraphe
    if (event.inputType === "deleteContentBackward" && block instanceof Dialogue) {
        const behavior = block.behaviors.get("text");
        if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;
        const sel = behavior.selection;
        if (!sel || !sel.isCollapsed || sel.from !== 0) return CONTINUE;
        const blockId = block.node.id.toString();
        block.transformTo("paragraph");
        tick().then(() => {
            const b = nabu.blocks.get(blockId);
            if (b) b.focus({ start: 0, end: 0 });
        });
        return BREAK;
    }

    // `-- ` en début de paragraphe → transforme en bloc dialogue
    if (event.data !== " ") return CONTINUE;
    if (block.type !== "paragraph") return CONTINUE;

    const behavior = block.behaviors.get("text");
    if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;

    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    const textBeforeCursor = behavior.text.slice(0, sel.from);
    if (textBeforeCursor !== "--") return CONTINUE;

    behavior.delete({ index: 0, length: 2 });

    const blockId = block.node.id.toString();
    block.transformTo("dialogue");

    tick().then(() => {
        const b = nabu.blocks.get(blockId);
        if (b) b.focus({ start: 0, end: 0 });
    });

    return BREAK;
};
