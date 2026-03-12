import { extension } from "../../utils/extensions";
import { Paragraph } from "./paragraph.svelte.js";
import ParagraphComponent from "./Paragraph.svelte";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 */

const ParagraphExtension = extension("paragraph", {
    block: Paragraph,
    component: ParagraphComponent,
    hooks: {
        onInit: (nabu) => {
            if (nabu.children.length === 0) {
                nabu.insert("paragraph", {
                    text: ""
                });
                
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

            block.commit();
            
            setTimeout(() => {
                nabu.selection.setCursor(newBlock, 0);
            }, 0);

            return { block: newBlock };
        }
    }
})

export {ParagraphExtension, ParagraphComponent, Paragraph };