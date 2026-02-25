import { tick } from "svelte";
import { TextBehavior } from "../../../behaviors/text";
import {Heading} from "../heading.svelte";

/**
 * @import { Nabu, Block } from "../..";
 */

/** @param {Nabu} nabu @param {InputEvent} event @param {Block} block */
export const onBeforeInput = (nabu, event, block) => {
    const {BREAK, CONTINUE} = nabu;
    if (event.inputType === "deleteContentBackward" && block instanceof Heading) {
        const behavior = block.behaviors.get("text");
        if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;
        const sel = behavior.selection;
        if (!sel || !sel.isCollapsed || sel.from !== 0) return CONTINUE;
        const blockId = block.node.id.toString();
        block.transformTo("paragraph");
        tick().then(() => {
            const block = nabu.blocks.get(blockId);
            if (block) block.focus({start: 0, end: 0});
        });
        return BREAK;
    }


    if (event.data !== " ") return CONTINUE;
    
    const behavior = block.behaviors.get("text");
    if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;
    
    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;
    
    const text = behavior.text;
    const textBeforeCursor = text.slice(0, sel.from);
    
    const match = textBeforeCursor.match(/^(#{1,6})$/);
    if (!match) return CONTINUE;
    
    const level = match[1].length;
    
    if (block.type === "heading" && block.level === level) return CONTINUE;
    
    behavior.delete({index: 0, length: level});
    
    const blockId = block.node.id.toString();
    
    block.transformTo("heading", { level });
    
    tick().then(() => {
        const block = nabu.blocks.get(blockId);
        if (block) block.focus({start: 0, end: 0});
    });
    
    return BREAK;
}

