import { tick } from "svelte";
import { extension } from "../../utils/extensions";
import { Dialogue } from "./dialogue.svelte.js";
import DialogueComponent from "./Dialogue.svelte";
import { onBeforeInput } from "./hooks/onBeforeInput.hook.js";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 */

/**
 * Dialogue extension factory.
 * @param {{ dash?: string }} [options]
 *   `dash` (default `–`, EN dash): the marker DISPLAYED in front of a dialogue line (CSS custom property
 *   `--nb-dialogue-dash`, which a host can also override in CSS). Display only: the markdown syntax of a
 *   dialogue line is always `-- text`, whatever the dash.
 */
export function createDialogueExtension({ dash = '–' } = {}) {
    const BlockClass = dash === Dialogue.dash
        ? Dialogue
        : class extends Dialogue { static dash = dash; };
    return extension("dialogue", {
        // @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
        block: BlockClass,
        component: DialogueComponent,
        hooks: {
            /** @param {Nabu} nabu @param {Dialogue} block @param {Event | null} event @param {import('../../utils/extensions.js').SplitData} data */
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

                const currentIndex = block.node.index() ?? 0;
                const parent = block.node.parent();
                const parentId = parent?.id.toString() || null;

                const newBlock = nabu.insert("dialogue", { delta }, parentId, currentIndex + 1);

                block.commit().then(() => nabu.selection.setCursor(newBlock, 0));

                return { block: newBlock };
            },
            onBeforeInput,
        }
    });
}

/** Default instance (dash `–`). */
const DialogueExtension = createDialogueExtension();

export { DialogueExtension, DialogueComponent, Dialogue };
