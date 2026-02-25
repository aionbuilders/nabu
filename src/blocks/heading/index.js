import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { Heading } from "./heading.svelte";
import HeadingComponent from "./Heading.svelte";
import { onBeforeInput } from "./hooks/onBeforeInput.hook";

/**
 * @import { Nabu } from "../nabu.svelte";
 */

const HeadingExtension = extension("heading", {
    block: Heading,
    component: HeadingComponent,
    hooks: {
        /** @param {Nabu} nabu @param {Heading} block @param {Event} event @param {{offset: number, delta: import('loro-crdt').Delta<string>}} data */
        onSplit: (nabu, block, event, data) => {
            const { offset, delta } = data;
            
            block.delete({from: offset, to: -1});
            
            const currentIndex = block.node.index();
            const parent = block.node.parent();
            const parentId = parent?.id.toString() || null;
            
            // On split souvent un titre pour créer un paragraphe après
            const newBlock = nabu.insert("paragraph", { delta }, parentId, currentIndex + 1);

            block.commit();
            
            setTimeout(() => {
                nabu.selection.setCursor(newBlock, 0);
            }, 0);

            return { block: newBlock };
        },
        onBeforeInput,
    }
})

export { HeadingExtension, HeadingComponent, Heading };
