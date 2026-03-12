import { MegaBlock } from "../megablock.svelte";
import { ListBehavior } from "./list.behavior.svelte";
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

        this.behavior = new ListBehavior(this);
        this.behaviors.set("list", this.behavior);

        this.serializers.set('markdown', () =>
            this.children
                .map(child => child.serialize('markdown'))
                .filter(Boolean)
                .join('\n')
        );
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'list',
            props: { listType: this.listType },
            children: this.children.map(child => child.serialize('json')).filter(Boolean)
        }));
    }

    listType = $derived(this.behavior.listType);

    component = $derived(this.nabu.components.get("list") || ListComponent);

    root = $derived(!this.parent);


    /** @param {List} otherList */
    absorbs(otherList) {
        return this.behavior.absorbs(otherList);
    }

    /** 
     * @param {Event | null} event
     * @param {{from: import('./list-item.svelte.js').ListItem, offset: number, delta: import('loro-crdt').Delta<string>}} data 
     */
    onSplit(event, data) {
        const { from: sourceItem, offset, delta } = data;
        
        // --- CAS 1 : L'item est vide (Demande de sortie de liste) ---
        if (sourceItem.text.length === 0) {
            const currentIndex = sourceItem.node.index();
            const siblings = this.node.children();
            const followers = siblings.slice(currentIndex + 1);
            
            // 1. On identifie le point d'insertion (juste après la liste actuelle)
            const parentNode = this.node.parent();
            const grandParentId = parentNode?.id.toString() || null;
            const myIndexInGrandParent = this.node.index();
            
            // 2. On insère le paragraphe de sortie juste après cette liste
            const newParagraph = this.nabu.insert("paragraph", {}, grandParentId, myIndexInGrandParent + 1);
            
            // 3. Si on était au milieu de la liste, on crée une nouvelle liste après le paragraphe pour les "followers"
            if (followers.length > 0) {
                const newList = this.nabu.insert("list", { listType: this.listType }, grandParentId, myIndexInGrandParent + 2);
                for (const follower of followers) {
                    this.nabu.tree.move(follower.id.toString(), newList.node.id.toString());
                }
            }
            
            // 4. On détruit l'item vide actuel
            sourceItem.destroy();
            
            // 5. Si la liste d'origine est devenue vide, on la supprime aussi
            if (currentIndex === 0 && followers.length === 0) {
                this.destroy();
            }

            this.nabu.commit();
            
            setTimeout(() => {
                this.nabu.selection.setCursor(newParagraph, 0);
            }, 0);
            
            return { block: newParagraph };
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

        // 3.1. On transfère TOUS les enfants du sourceItem vers le newItem
        const sourceChildren = sourceItem.node.children();
        if (sourceChildren && sourceChildren.length > 0) {
            for (const childNode of sourceChildren) {
                // @ts-ignore - Le type string fonctionne avec move()
                this.nabu.tree.move(childNode.id.toString(), newItem.node.id.toString());
            }
        }

        this.nabu.commit();
        
        // 4. On replace le curseur au début du nouvel item
        setTimeout(() => {
            this.nabu.selection.setCursor(newItem, 0);
        }, 0);
        
        return { block: newItem };
    }


    /** @param {InputEvent} event */
    // beforeinput(event) {
    //     console.log("List beforeinput event:", event);

    // }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index || undefined);
        node.data.set("type", "list");
        node.data.set("listType", props.listType || "bullet");
        const block = new List(nabu, node);
        return block;
    }
}