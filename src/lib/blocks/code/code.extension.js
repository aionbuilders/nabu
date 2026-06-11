import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { CodeBlock } from "./code.svelte.js";
import CodeComponent from "./Code.svelte";

/**
 * @import { Nabu, Block } from "..";
 */

/**
 * onBeforeInput hook for CodeBlock:
 * - Inside a code block: Backspace on empty → transform back to paragraph.
 * - Inside a non-code text block: ``` + Enter → transform to code block.
 *
 * @param {Nabu} nabu @param {InputEvent} event @param {Block} block
 */
const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    const behavior = block.behaviors.get('text');
    if (!(behavior instanceof TextBehavior)) return CONTINUE;
    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    if (block instanceof CodeBlock) {
        // Backspace at position 0 in an empty code block → back to paragraph
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

    // ``` + Enter in a non-code text block → transform to code
    if (event.inputType === 'insertParagraph') {
        const m = behavior.text.match(/^```(\w*)$/);
        if (!m) return CONTINUE;
        const language = m[1] || null;
        behavior.delete({ index: 0, length: behavior.text.length });
        const blockId = block.node.id.toString();
        block.transformTo('code', language ? { language } : {});
        tick().then(() => {
            const fresh = nabu.blocks.get(blockId);
            if (fresh) fresh.focus({ start: 0, end: 0 });
        });
        return BREAK;
    }

    return CONTINUE;
};

export const CodeExtension = extension("code", {
    // @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
    block: CodeBlock,
    component: CodeComponent,
    actions: {
        'code': (nabu) => nabu.exec('block:transform', { type: 'code' }),
    },
    hooks: {
        onBeforeInput,
    }
});
