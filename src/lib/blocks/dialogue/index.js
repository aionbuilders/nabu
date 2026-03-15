import { tick } from "svelte";
import { extension } from "../../utils/extensions";
import { Dialogue } from "./dialogue.svelte.js";
import DialogueComponent from "./Dialogue.svelte";
import { onBeforeInput } from "./hooks/onBeforeInput.hook.js";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 */

const DialogueExtension = extension("dialogue", {
    block: Dialogue,
    component: DialogueComponent,
    hooks: {
        /** @param {Nabu} nabu @param {Dialogue} block @param {Event} event @param {{offset: number, delta: import('loro-crdt').Delta<string>}} data */
        onSplit: (nabu, block, event, data) => {
            const { offset, delta } = data;

            // Bloc dialogue vide + Entrée → sortir du mode dialogue
            if (block.text.length === 0) {
                const blockId = block.node.id.toString();
                block.transformTo("paragraph");
                tick().then(() => {
                    const b = nabu.blocks.get(blockId);
                    if (b) b.focus({ start: 0, end: 0 });
                });
                return { block };
            }

            // Bloc non vide + Entrée → créer un nouveau bloc dialogue après
            block.delete({ from: offset, to: -1 });

            const currentIndex = block.node.index();
            const parent = block.node.parent();
            const parentId = parent?.id.toString() || null;

            const newBlock = nabu.insert("dialogue", { delta }, parentId, currentIndex + 1);

            block.commit();

            setTimeout(() => {
                nabu.selection.setCursor(newBlock, 0);
            }, 0);

            return { block: newBlock };
        },
        onBeforeInput,
    }
});

export { DialogueExtension, DialogueComponent, Dialogue };
