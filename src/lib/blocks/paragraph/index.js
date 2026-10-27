import { extension } from "../../utils/extensions";
import { Paragraph } from "./paragraph.svelte.js";
import ParagraphComponent from "./Paragraph.svelte";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 */

/**
 * Whether the pending (uncommitted) transaction holds a tree `delete` or `move`: the only ops that can leave the root without a node.
 * @param {Nabu} nabu
 * @returns {boolean}
 */
function mayEmptyRoot(nabu) {
    const pending = nabu.doc.getUncommittedOpsAsJson();
    if (!pending) return false;
    const treeId = nabu.tree.id;
    for (const change of pending.changes) {
        for (const op of change.ops) {
            if (op.container !== treeId) continue;
            const type = /** @type {any} */ (op.content).type;
            if (type === "delete" || type === "move") return true;
        }
    }
    return false;
}

const ParagraphExtension = extension("paragraph", {
    block: Paragraph,
    defaultBlock: true,
    component: ParagraphComponent,
    slashCommands: [
        { title: 'Text', icon: '¶', aliases: ['paragraph', 'p', 'plain'], group: 'text', order: 0, run: (e) => e.exec('paragraph') },
    ],
    actions: {
        'paragraph': (nabu) => nabu.exec('block:transform', { type: 'paragraph' }),
        'gap:click': (nabu, data) => {
            const { parentId = null, insertIndex = undefined } = data ?? {};
            const newBlock = nabu.insert('paragraph', {}, parentId, insertIndex);
            nabu.commit().then(() => {
                const fresh = nabu.blocks.get(newBlock.id);
                if (fresh) nabu.selection.setCursor(fresh, 0);
            });
        },
    },
    hooks: {
        onInit: (nabu) => {
            if (nabu.children.length === 0) {
                nabu.insert("paragraph", {
                    text: ""
                });

            }
        },
        /**
         * "The document is never empty". Only a transaction that DELETES or MOVES a node can have emptied the root, so the
         * check (`tree.roots()`, O(roots)) is skipped for everything else: a keystroke commits text ops only, and pays nothing.
         * @param {Nabu} nabu
         */
        onBeforeTransaction: (nabu) => {
            if (!mayEmptyRoot(nabu)) return;
            if (nabu.tree.roots().length === 0) nabu.insert("paragraph", { text: "" });
        },
        /** @param {Nabu} nabu @param {Paragraph} block @param {Event | null} event @param {import('../../utils/extensions.js').SplitData} data */
        onSplit: (nabu, block, event, data) => {
            const { offset, delta } = data;
            
            block.delete({from: offset, to: -1});
            
            const currentIndex = block.node.index();
            const parent = block.node.parent();
            const parentId = parent?.id.toString() || null;
            
            const newBlock = nabu.insert("paragraph", { delta }, parentId, /** @type {number} */ (currentIndex) + 1);

            block.commit().then(() => nabu.selection.setCursor(newBlock, 0));

            return { block: newBlock };
        }
    }
})

export {ParagraphExtension, ParagraphComponent, Paragraph };