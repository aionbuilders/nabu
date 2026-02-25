import { MegaBlock } from "../megablock.svelte";
import ListItemComponent from "./ListItem.svelte";
import { LoroText } from "loro-crdt";
import { TextBehavior } from "../../behaviors/text";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte";
 */

/**
 * @typedef {NabuNode<{type: "list-item", text: LoroText}>} ListItemNode
 */

export class ListItem extends MegaBlock {
    /** @param {Nabu} nabu @param {ListItemNode} node */
    constructor(nabu, node) {
        super(nabu, node);
        
        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);
    }

    component = $derived(this.nabu.components.get("list-item") || ListItemComponent);
    
    get text() {
        return this.behavior.text;
    }

    selection = $derived(this.behavior.selection);

    sublist = $derived(this.children.find(child => child.node.data.get("type") === "list"));

    /**
     * Retourne la sous-liste existante, ou en crée une nouvelle à la fin des enfants.
     * @param {"bullet" | "ordered"} [listType="bullet"] 
     */
    getOrCreateSublist(listType = "bullet") {
        if (this.sublist) return this.sublist;
        
        // S'il n'y en a pas, on demande à Nabu d'en créer une en tant qu'enfant de ce ListItem
        const newList = this.nabu.insert("list", { listType }, this.node.id.toString());
        return newList;
    }

    /** @param {KeyboardEvent} event */
    keydown(event) {
        if (event.key === "Tab") {
            event.preventDefault(); // On bloque le comportement natif
            
            if (event.shiftKey) {
                // --- Shift+Tab (Unindent with Carry) ---
                
                // 1. Notre parent immédiat (une List)
                const parentListNode = this.node.parent();
                if (!parentListNode) return true;
                
                // 2. Le ListItem qui contient cette liste (le "grand-parent" logique)
                const grandParentItemNode = parentListNode.parent();
                
                // Si on n'a pas de ListItem au-dessus (on est déjà au premier niveau)
                if (!grandParentItemNode || grandParentItemNode.data.get("type") !== "list-item") {
                    return true;
                }

                // 3. Gérer le "Carry" : emporter les frères suivants avec nous
                const myIndex = this.node.index();
                const siblings = parentListNode.children();
                const followers = siblings.slice(myIndex + 1);
                
                if (followers.length > 0) {
                    // On s'assure d'avoir notre propre sous-liste pour accueillir nos anciens frères
                    const mySublist = this.getOrCreateSublist();
                    for (const follower of followers) {
                        this.nabu.tree.move(follower.id.toString(), mySublist.node.id.toString());
                    }
                }
                
                // 4. Le parent cible est la List qui contient notre grand-parent
                const targetParentListNode = grandParentItemNode.parent();
                if (!targetParentListNode) return true;
                
                // 5. On se place juste après notre ancien grand-parent
                const targetIndex = grandParentItemNode.index() + 1;
                
                this.nabu.tree.move(this.node.id.toString(), targetParentListNode.id.toString(), targetIndex);
                
                this.commit();
                
                // 6. Restauration du focus
                setTimeout(() => this.behavior.block.focus(), 0);
            } else {
                // --- Tab (Indent with Hoist) ---
                
                // 1. On trouve notre index actuel
                const currentIndex = this.node.index();
                if (currentIndex === 0) return true; // Impossible d'indenter le premier item
                
                // 2. On trouve le frère précédent (qui va devenir notre parent "logique")
                const parentList = this.node.parent();
                if (!parentList) return true;
                
                const previousNode = parentList.children()?.[currentIndex - 1];
                if (!previousNode) return true;
                const previousItem = this.nabu.blocks.get(previousNode.id.toString());
                
                // Si le frère précédent n'est pas un ListItem
                if (!previousItem || previousItem.type !== "list-item") return true;
                
                // 3. On demande au frère précédent sa sous-liste (ou de la créer)
                // @ts-ignore : On sait que c'est un ListItem
                const targetSublist = previousItem.getOrCreateSublist();
                const targetSublistId = targetSublist.node.id.toString();
                
                // 4. On se déplace à la fin de cette sous-liste cible
                this.nabu.tree.move(this.node.id.toString(), targetSublistId);
                
                // 5. Si on avait des enfants (Hoist), on les remonte avec nous en tant que frères
                if (this.sublist) {
                    const childrenNodes = this.sublist.node.children();
                    for (const childNode of childrenNodes) {
                        // Ils se placeront après nous dans la nouvelle liste
                        this.nabu.tree.move(childNode.id.toString(), targetSublistId);
                    }
                }

                this.commit();
                
                // 6. On restaure le curseur
                setTimeout(() => this.behavior.block.focus(), 0);
            }
            return true;
        }
        
        // On délègue les flèches etc.
        return false;
    }

    /** @param {InputEvent} event */
    beforeinput(event) {
        return this.behavior.handleBeforeInput(event);
    }

    /**
     * @param {number} targetOffset 
     * @returns {{node: Node, offset: number} | null}
     */
    getDOMPoint(targetOffset) { return this.behavior.getDOMPoint(targetOffset); }

    /** @param {import('../block.svelte').Block} block */
    mergeWith(block) { return this.behavior.mergeWith(block); }

    /** @param {number} index @param {string} text */
    insert(index, text) { return this.behavior.insert(index, text); }
    
    /** @param {Parameters<import('../block.svelte').Block["delete"]>[0]} [deletion] */
    delete(deletion) { return this.behavior.delete(deletion); }

    /** @param {import('loro-crdt').Delta<string>[]} data */
    delta(data = []) { return this.behavior.delta(data); } 

    /** @param {Parameters<import('../block.svelte').Block["split"]>[0]} [options] @returns {ReturnType<import('../block.svelte').Block["split"]>} */
    split(options) { 
        return this.ascend("onSplit", null, { 
            offset: options?.offset || 0,
            delta: this.behavior.container.sliceDelta(options?.offset || 0, this.text.length)
        });
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index || undefined);
        node.data.set("type", "list-item");
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new ListItem(nabu, node);
        return block;
    }
}
