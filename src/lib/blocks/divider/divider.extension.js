import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { DividerBlock } from "./divider.svelte.js";
import DividerComponent from "./Divider.svelte";

/**
 * @import { Nabu, Block } from "..";
 */

/**
 * Divider hooks:
 * - `---` + space in a block containing only `---` → replace it with a
 *   divider and insert an empty paragraph after.
 * - Backspace at the start of a block whose previous sibling is a divider
 *   → delete the divider (otherwise the text merge would skip over it and
 *   leave it orphaned).
 *
 * @param {Nabu} nabu @param {InputEvent} event @param {Block} block
 */
const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    const behavior = block.behaviors.get("text");
    if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;
    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    // Backspace right after a divider → delete the divider
    if (event.inputType === "deleteContentBackward" && sel.from === 0) {
        const { previous } = block.getAdjacentSiblings();
        if (previous?.type !== 'divider') return CONTINUE;
        const blockId = block.id;
        nabu.tree.delete(previous.node.id);
        nabu.commit().then(() => {
            const fresh = nabu.blocks.get(blockId);
            if (fresh) nabu.selection.setCursor(fresh, 0);
        });
        return BREAK;
    }

    // `--- ` markdown shortcut: block contains exactly `---` and a space is typed
    if (event.inputType === "insertText" && event.data === " ") {
        if (behavior.text !== "---" || sel.from !== 3) return CONTINUE;

        const node = block.node;
        const parentId = node.parent()?.id.toString() || null;
        const index = node.index() ?? 0;

        behavior.delete({ index: 0, length: 3 });
        block.node.data.set("type", "divider");

        const PClass = nabu.registry.get('paragraph');
        const newParagraph = PClass ? PClass.create(nabu, 'paragraph', {}, parentId, index + 1) : null;

        nabu.commit().then(() => {
            if (!newParagraph) return;
            const fresh = nabu.blocks.get(newParagraph.id);
            if (fresh) nabu.selection.setCursor(fresh, 0);
        });
        return BREAK;
    }

    return CONTINUE;
};

export const DividerExtension = extension("divider", {
    // @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
    block: DividerBlock,
    component: DividerComponent,
    actions: {
        /**
         * Insert a divider after the anchor block's position.
         * @param {Nabu} nabu
         */
        'divider:insert': (nabu) => {
            const anchor = nabu.selection.anchorBlock;
            if (!anchor) return;
            const parentId = anchor.node.parent()?.id.toString() || null;
            const index = anchor.node.index() ?? 0;
            DividerBlock.create(nabu, 'divider', {}, parentId, index + 1);
            return nabu.commit();
        },
    },
    hooks: {
        onBeforeInput,
    }
});
