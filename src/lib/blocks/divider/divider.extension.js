import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { DividerBlock } from "./divider.svelte.js";
import DividerComponent from "./Divider.svelte";

/**
 * @import { Nabu, Block } from "..";
 */

/**
 * The ONE divider-insertion path, shared by the `--- ` markdown shortcut and the `divider:insert`
 * action (slash menu `/divider`). Mutations only: the caller commits.
 * - `block` is EMPTY (a paragraph; also any other childless text block except a list item, so `--- `
 *   still works in a heading / quote…) → it becomes the divider;
 * - otherwise → a divider is inserted right after the block (after its outermost list when the block
 *   sits in one: a divider must not become a child of a list).
 * Either way an empty paragraph is created below the divider, ready for the caret.
 *
 * @param {Nabu} nabu
 * @param {Block} block  the block the divider is typed / inserted in
 * @returns {Block | null}  the new empty paragraph below the divider
 */
export function insertDivider(nabu, block) {
    const behavior = block.behaviors.get("text");
    const isEmpty = behavior instanceof TextBehavior && behavior.container.length === 0
        && block.type !== "list-item" && !(/** @type {any} */ (block).children?.length);

    /** @type {Block} */
    let anchor = block;
    if (!isEmpty) {
        while (anchor.parent && (anchor.parent.type === "list" || anchor.parent.type === "list-item")) anchor = /** @type {Block} */ (/** @type {unknown} */ (anchor.parent));
    }
    const node = anchor.node;
    const parentId = node.parent()?.id.toString() || null;
    let index = node.index() ?? 0;

    if (isEmpty) {
        block.node.data.set("type", "divider");
    } else {
        DividerBlock.create(nabu, "divider", {}, parentId, index + 1);
        index += 1;
    }

    const PClass = nabu.registry.get("paragraph");
    return PClass ? PClass.create(nabu, "paragraph", {}, parentId, index + 1) : null;
}

/**
 * Commit a divider insertion and move the caret into the paragraph below it.
 * @param {Nabu} nabu @param {Block} block @returns {Promise<void>}
 */
async function commitDivider(nabu, block) {
    const paragraph = insertDivider(nabu, block);
    await nabu.commit();
    if (!paragraph) return;
    const fresh = nabu.blocks.get(paragraph.id);
    if (fresh) nabu.selection.setCursor(fresh, 0);
}

/**
 * Divider hooks:
 * - `---` + space in a block containing only `---` → replace it with a
 *   divider and insert an empty paragraph after (see insertDivider).
 * - Backspace at the start of a block whose previous sibling is a divider
 *   → delete the divider (otherwise the text merge would skip over it and
 *   leave it orphaned).
 * - Delete at the end of a block whose next sibling is a divider → delete the divider (symmetric).
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

    // Delete at the END of the block right BEFORE a divider → delete the divider (symmetric with Backspace
    // after it). The text and the caret are kept; one transaction = one undo step.
    if (event.inputType === "deleteContentForward" && sel.from === behavior.text.length) {
        const { next } = block.getAdjacentSiblings();
        if (next?.type !== 'divider') return CONTINUE;
        const blockId = block.id;
        const offset = sel.from;
        nabu.tree.delete(next.node.id);
        nabu.commit().then(() => {
            const fresh = nabu.blocks.get(blockId);
            if (fresh) nabu.selection.setCursor(fresh, offset);
        });
        return BREAK;
    }

    // `--- ` markdown shortcut: block contains exactly `---` and a space is typed
    if (event.inputType === "insertText" && event.data === " ") {
        if (behavior.text !== "---" || sel.from !== 3) return CONTINUE;

        /** @type {Block | null} */
        let paragraph = null;
        // Undo gives back "--- " (trigger space included): see Nabu.shortcut()
        nabu.shortcut(block, " ", (b) => {
            b.delete({ index: 0, length: 4 });
            paragraph = insertDivider(nabu, block);
        }).then(() => {
            const fresh = paragraph && nabu.blocks.get(/** @type {Block} */ (paragraph).id);
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
    slashCommands: [
        { title: 'Divider', icon: '—', aliases: ['divider', 'hr', 'separator', 'rule'], group: 'blocks', order: 40, run: (e) => e.exec('divider:insert') },
    ],
    actions: {
        /**
         * Insert a divider like the `--- ` shortcut does (see insertDivider): an empty paragraph
         * becomes the divider, any other block gets one right after it; the caret lands in a new
         * paragraph below the divider.
         * @param {Nabu} nabu
         */
        'divider:insert': (nabu) => {
            const anchor = nabu.selection.anchorBlock;
            if (!anchor) return;
            return commitDivider(nabu, anchor);
        },
    },
    hooks: {
        onBeforeInput,
    }
});
