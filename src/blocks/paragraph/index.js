import { extension } from "../../utils/extensions";
import { Paragraph } from "./paragraph.svelte";
import ParagraphComponent from "./Paragraph.svelte";

const ParagraphExtension = extension("paragraph", {
    block: Paragraph,
    component: ParagraphComponent,
    hooks: {
        onInit: (nabu) => {
            if (nabu.children.length === 0) {
                nabu.insert("paragraph", {
                    text: "Start writing..."
                });
                nabu.insert("paragraph", {
                    text: "Start writing..."
                });
                nabu.insert("paragraph", {
                    text: "Start writing..."
                });

            }
        },
        onSplit: (nabu, block, event, data) => {
            const { offset, delta } = data;
            
            // 1. Extraire le texte à déplacer
            const textToMove = block.text.slice(offset);
            
            // 2. Tronquer le bloc actuel
            block.delete(offset, textToMove.length);
            
            // 3. Insérer le nouveau bloc juste après
            const currentIndex = block.node.index();
            const parent = block.node.parent();
            const parentId = parent?.id.toString() || null;
            
            const newBlock = nabu.insert("paragraph", { delta }, parentId, currentIndex + 1);
            
            // 4. Placer le curseur au début du nouveau bloc
            setTimeout(() => {
                nabu.selection.setCursor(newBlock, 0);
            }, 0);

            return true;
        }
    }
})

export {ParagraphExtension, ParagraphComponent, Paragraph };