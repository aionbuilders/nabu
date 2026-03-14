
import { SvelteSelection } from "../utils/selection.svelte.js";

/**
* @import { Nabu } from "./nabu.svelte.js";
* @import { Block } from "./block.svelte.js";
* @import { LoroTree, LoroTreeNode } from "loro-crdt";
*/

export class NabuSelection extends SvelteSelection {
    /** @param {Nabu} nabu */
    constructor(nabu) {
        super();
        this.nabu = nabu;

        $effect.root(() => {
            $effect(() => {
            if (this.blocks) {
                this.previous.forEach(block => block.clearSelection());
                let i = 0;
                const lastIndex = this.blocks.size - 1;
                this.blocks.forEach((block) => {
                    block.selected = true;
                    block.isSelectionStart = (i === 0);
                    block.isSelectionEnd = i === lastIndex;
                    i++;
                });
                this.previous = new Set(this.blocks);
            }
        })

        })

        
    }
    
    anchorBlock = $derived.by(() => {
        this.anchorNode;
        const id = this.anchorNode?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });
    
    focusBlock = $derived.by(() => {
        this.focusNode;
        const id = this.focusNode?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });
    
    startBlock = $derived.by(() => {
        this.range;
        const id = this.range?.startContainer?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });
    
    endBlock = $derived.by(() => {
        this.range;
        const id = this.range?.endContainer?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });

    start = $derived(this.startBlock?.selection && {
        block: this.startBlock,
        ...this.startBlock.selection
    });

    end = $derived(this.endBlock?.selection && {
        block: this.endBlock,
        ...this.endBlock.selection
    });

    /**
     * Définit le curseur à un endroit précis du document (Modèle -> DOM)
     * @param {Block} block 
     * @param {number} offset 
     */
    setCursor(block, offset) {
        if (!block.element) return;
        
        // On délègue au bloc le soin de trouver le bon point DOM
        // (Chaque type de bloc sait comment il affiche son texte)
        //@ts-ignore
        const point = block.getDOMPoint?.(offset);
        if (!point) return;

        this.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
    }

    /** @type {Set<Block>} */
    previous = new Set();
    blocks = $derived(new Set(getNodesBetween(this.nabu.tree, this.startBlock?.node.id.toString() || "", this.endBlock?.node.id.toString() || "").map(node => {
        return this.nabu.blocks.get(node.id.toString());
    }).filter(b => !!b)));
    
}



/**
* Récupère tous les nœuds situés entre deux nœuds dans un arbre Loro (version aplatie).
* L'ordre dans lequel on passe A et B n'a pas d'importance.
* @param {LoroTree} tree - L'arbre Loro à parcourir
* @param {string} nodeIdA - ID du premier nœud de la sélection
* @param {string} nodeIdB - ID du second nœud de la sélection
*/
function getNodesBetween(tree, nodeIdA, nodeIdB) {
    const roots = tree.roots();
    
    let isRecording = false;
    /** @type {LoroTreeNode[]} */
    const nodesInRange = [];
    
    
    // if (nodeIdA && nodeIdA === nodeIdB) {
    //     
    // }
    
    /** @param {LoroTreeNode[]} nodes */
    function traverse(nodes) {
        for (const node of nodes) {
            const currentId = node.id.toString();

            if (currentId === nodeIdA) {
                isRecording = true;
                nodesInRange.push(node);
                
                if (currentId === nodeIdB) {
                    return true;
                }
            } else if (isRecording) {
                nodesInRange.push(node);
                if (currentId === nodeIdB) {
                    return true; 
                }
            }
            
            const children = node.children();
            if (children && children.length > 0) {
                if (traverse(children)) {
                    return true; 
                }
            }
        }
        return false; // La fin n'a pas été trouvée dans cette branche
    }
    
    traverse(roots);
    return nodesInRange;
}