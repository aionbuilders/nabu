import { extension } from "../../utils/extensions";
import { Paragraph } from "./paragraph.svelte.js";
import ParagraphComponent from "./Paragraph.svelte";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 */

const ParagraphExtension = extension("paragraph", {
    block: Paragraph,
    defaultBlock: true,
    component: ParagraphComponent,
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
        /** @param {Nabu} nabu */
        onBeforeTransaction: (nabu) => {
            const roots = nabu.tree.roots();
            roots.forEach(root => {
                const type = root.data.get("type");
                root.children()?.forEach(child => {
                    const childType = child.data.get("type");
                });
            })
            if (roots.length === 0) {
                nabu.insert("paragraph", { text: "" });
            }
        },
        /** @param {Nabu} nabu @param {Paragraph} block @param {Event} event @param {{offset: number, delta: import('loro-crdt').Delta<string>}} data */
        onSplit: (nabu, block, event, data) => {
            const { offset, delta } = data;
            
            block.delete({from: offset, to: -1});
            
            const currentIndex = block.node.index();
            const parent = block.node.parent();
            const parentId = parent?.id.toString() || null;
            
            const newBlock = nabu.insert("paragraph", { delta }, parentId, currentIndex + 1);

            block.commit().then(() => nabu.selection.setCursor(newBlock, 0));

            return { block: newBlock };
        }
    }
})

export {ParagraphExtension, ParagraphComponent, Paragraph };