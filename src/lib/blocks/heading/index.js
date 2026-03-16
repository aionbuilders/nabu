import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { Heading } from "./heading.svelte.js";
import HeadingComponent from "./Heading.svelte";
import { onBeforeInput } from "./hooks/onBeforeInput.hook";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 */

const HeadingExtension = extension("heading", {
    block: Heading,
    component: HeadingComponent,
    actions: {
        'heading:1': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 1 } }),
        'heading:2': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 2 } }),
        'heading:3': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 3 } }),
        'heading:4': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 4 } }),
        'heading:5': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 5 } }),
        'heading:6': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 6 } }),
    },
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
