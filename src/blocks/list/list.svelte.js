import { MegaBlock } from "../megablock.svelte";
import ListComponent from "./List.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte";
 */

/**
 * @typedef {NabuNode<{type: "list", listType: "bullet" | "ordered"}>} ListNode
 */

export class List extends MegaBlock {
    /** @param {Nabu} nabu @param {ListNode} node */
    constructor(nabu, node) {
        super(nabu, node);
        
        const data = node.data;
        this.listType = data.get("listType") || "bullet";
        
        // Synchronisation du type de liste (si on passe de ul à ol)
        this.node.data.subscribe(() => {
            this.listType = this.node.data.get("listType") || "bullet";
        });
    }

    /** @type {"bullet" | "ordered"} */
    listType = $state("bullet");

    component = $derived(this.nabu.components.get("list") || ListComponent);

    root = $derived(!this.parent);

    /** 
     * @param {Event | null} event
     * @param {{from: import('./list-item.svelte.js').ListItem, offset: number, delta: import('loro-crdt').Delta<string>}} data 
     */
    onSplit(event, data) {
        console.log("Split demandé sur List avec data:", data);
        console.log("List actuelle:", this);
        console.log("Item source:", data.from);
        console.log("Is root list?", !this.parent);
        
        const { from: sourceItem, offset, delta } = data;
        
        // --- CAS 1 : L'item est vide (Demande de sortie de liste) ---
        if (sourceItem.text.length === 0) {
            // (À implémenter dans un second temps : le split complexe de la liste)
            console.log("Sortie de liste demandée !");
            return null; // Temporaire
        }
        
        // --- CAS 2 : Comportement normal (Créer un nouvel item en dessous) ---
        
        // 1. On efface la fin du texte dans l'item source
        sourceItem.delete({from: offset, to: -1});
        
        // 2. On trouve l'index de l'item source dans la liste
        const currentIndex = sourceItem.node.index();

        console.log("Index de l'item source:", currentIndex);

        
        // 3. On demande à Nabu d'insérer un nouveau list-item au même niveau
        const newItem = this.nabu.insert(
            "list-item", 
            { delta }, 
            this.node.id.toString(), // Le parent est la liste actuelle
            currentIndex + 1
        );
        
        this.nabu.doc.commit();
        
        // 4. On replace le curseur au début du nouvel item
        setTimeout(() => {
            this.nabu.selection.setCursor(newItem, 0);
        }, 0);
        
        return { block: newItem };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index || undefined);
        node.data.set("type", "list");
        node.data.set("listType", props.listType || "bullet");
        const block = new List(nabu, node);
        return block;
    }
}
