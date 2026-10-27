import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { BlockquoteBlock } from "./blockquote.svelte.js";
import BlockquoteComponent from "./Blockquote.svelte";

/**
 * @import { Nabu, Block } from "..";
 */

/**
 * Markdown shortcut + de-transformation hooks for blockquotes:
 * - `> ` at the start of a block → transform into blockquote
 * - Backspace at the start of a blockquote → transform back into paragraph
 * - Enter in an empty blockquote → exit the quote (becomes a paragraph)
 *
 * @param {Nabu} nabu @param {InputEvent} event @param {Block} block
 */
const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    const behavior = block.behaviors.get("text");
    if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;
    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    /** @param {string} type @param {() => void} [transform] */
    const transformAndFocus = (type, transform = () => block.transformTo(type)) => {
        const blockId = block.node.id.toString();
        transform();
        tick().then(() => {
            const fresh = nabu.blocks.get(blockId);
            if (fresh) fresh.focus({ start: 0, end: 0 });
        });
        return BREAK;
    };

    if (block instanceof BlockquoteBlock) {
        // Backspace at the very start → back to paragraph
        if (event.inputType === "deleteContentBackward" && sel.from === 0) {
            return transformAndFocus("paragraph");
        }
        // Enter in an empty blockquote → exit the quote
        if (event.inputType === "insertParagraph" && behavior.text.length === 0) {
            return transformAndFocus("paragraph");
        }
        return CONTINUE;
    }

    // `> ` markdown shortcut (typed space after a lone ">" at block start)
    if (event.inputType === "insertText" && event.data === " ") {
        const textBeforeCursor = behavior.text.slice(0, sel.from);
        if (textBeforeCursor !== ">") return CONTINUE;
        // Undo gives back "> " (trigger space included): see Nabu.shortcut()
        return transformAndFocus("blockquote", () => nabu.shortcut(block, " ", (b) => {
            b.delete({ index: 0, length: 2 });
            block.transformTo("blockquote");
        }));
    }

    return CONTINUE;
};

export const BlockquoteExtension = extension("blockquote", {
    // @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
    block: BlockquoteBlock,
    component: BlockquoteComponent,
    slashCommands: [
        { title: 'Quote', icon: '"', aliases: ['quote', 'blockquote'], group: 'blocks', order: 20, run: (e) => e.exec('blockquote') },
    ],
    actions: {
        'blockquote': (nabu) => nabu.exec('block:transform', { type: 'blockquote' }),
    },
    hooks: {
        onBeforeInput,
    }
});
