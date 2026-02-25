import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { Heading } from "./heading.svelte";
import HeadingComponent from "./Heading.svelte";

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
        onBeforeInput: (nabu, event, block) => {
            const {BREAK, CONTINUE} = nabu;
            if (event.data !== " ") return CONTINUE;
            
            const behavior = block.behaviors.get("text");
            if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;
            
            const sel = behavior.selection;
            if (!sel || !sel.isCollapsed) return CONTINUE;

            const text = behavior.text;
            const textBeforeCursor = text.slice(0, sel.from);
            
            // Regex pour capturer 1 à 6 '#' en début de ligne
            const match = textBeforeCursor.match(/^(#{1,6})$/);
            if (!match) return CONTINUE;
            
            const level = match[1].length;
            
            // Si on est déjà un Heading du même niveau, on ne fait rien
            if (block.type === "heading" && block.level === level) return CONTINUE;

            // 1. Supprimer les symboles '#'
            behavior.delete({index: 0, length: level});
            
            const blockId = block.node.id.toString();

            // 2. Transformer le bloc
            block.transformTo("heading", { level });
            
            // 3. Replacer le curseur au début (après transformation)
            tick().then(() => {
                // nabu.selection.setCursor(block, 0);
                const block = nabu.blocks.get(blockId);
                if (block) block.focus({start: 0, end: 0});
            });

            return BREAK;
        }
    }
})

export { HeadingExtension, HeadingComponent, Heading };
