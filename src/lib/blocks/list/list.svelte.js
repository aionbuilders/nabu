import { MegaBlock } from "../megablock.svelte.js";
import { ListBehavior } from "./list.behavior.svelte.js";
import ListComponent from "./List.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
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

    get clipboardProps() { return { listType: this.listType }; }

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

            this.nabu.commit().then(() => this.nabu.selection.setCursor(newParagraph, 0));
            
            return { block: newParagraph };
        }
        
        // --- CAS 2 : Comportement normal (Créer un nouvel item en dessous) ---
        
        // 1. On efface la fin du texte dans l'item source
        sourceItem.delete({from: offset, to: -1});
        
        // 2. On trouve l'index de l'item source dans la liste
        const currentIndex = sourceItem.node.index();

        
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

        this.nabu.commit().then(() => this.nabu.selection.setCursor(newItem, 0));
        
        return { block: newItem };
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock, ctx?: object) => string, depth?: number }} helpers
     */
    static toMarkdown(pb, { recurse, depth = 0 }) {
        const listType = pb.props?.listType ?? 'bullet';
        return (pb.children || [])
            .map((child, i) => recurse(child, { listType, index: i, depth }))
            .join('\n');
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock) => string }} helpers
     */
    static toHtml(pb, { recurse }) {
        const tag = pb.props?.listType === 'ordered' ? 'ol' : 'ul';
        return `<${tag}>${(pb.children || []).map(recurse).join('')}</${tag}>`;
    }

    static markdownRules = [
        {
            priority: 10,
            detect: /^[ \t]*([-*+]|\d+[.)]) /,
            consume(/** @type {string[]} */ lines, /** @type {number} */ i) {
                const LIST_RE = /^[ \t]*([-*+]|\d+[.)]) /;
                let j = i;
                while (j < lines.length && lines[j].trim() && LIST_RE.test(lines[j])) j++;
                return Math.max(1, j - i);
            },
        }
    ];

    /**
     * Parse markdown list lines into a nested List/ListItem PasteBlock tree.
     * Uses indent depth to reconstruct nesting recursively.
     *
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline }) {
        /** @typedef {{ depth: number, ordered: boolean, text: string }} ListToken */

        /** @type {ListToken[]} */
        const tokens = lines.flatMap(line => {
            const m = line.match(/^([ \t]*)([-*+]|\d+[.)]) +(.*)/);
            if (!m) return [];
            return [{ depth: m[1].length, ordered: /^\d/.test(m[2]), text: m[3] }];
        });

        if (!tokens.length) return null;

        /**
         * Recursively build a List PasteBlock from a flat token array.
         * Items at `baseDepth` become direct children; deeper tokens become sublists.
         * @param {ListToken[]} toks
         * @returns {import('../../utils/extensions.js').PasteBlock}
         */
        function buildList(toks) {
            const baseDepth = Math.min(...toks.map(t => t.depth));
            const listType = toks.find(t => t.depth === baseDepth)?.ordered ? 'ordered' : 'bullet';
            /** @type {import('../../utils/extensions.js').PasteBlock[]} */
            const items = [];
            let i = 0;

            while (i < toks.length) {
                if (toks[i].depth !== baseDepth) { i++; continue; }

                // Collect all sub-tokens directly following this item (deeper indent)
                const subToks = /** @type {ListToken[]} */ ([]);
                let j = i + 1;
                while (j < toks.length && toks[j].depth > baseDepth) {
                    subToks.push(toks[j]);
                    j++;
                }

                /** @type {import('../../utils/extensions.js').PasteBlock} */
                const item = { type: 'list-item', delta: parseInline(toks[i].text), partial: false };
                if (subToks.length) item.children = [buildList(subToks)];

                items.push(item);
                i = j;
            }

            return { type: 'list', props: { listType }, children: items, partial: false };
        }

        return buildList(tokens);
    }

    static htmlRules = [
        { selector: 'ul', props: { listType: 'bullet' } },
        { selector: 'ol', props: { listType: 'ordered' } },
    ];

    /**
     * @param {Element} el
     * @param {{ parseChildren: (el: Element) => import('../../utils/extensions.js').PasteBlock[] }} helpers
     * @param {{ props?: { listType?: string } }} [rule]
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseChildren }, rule) {
        const children = parseChildren(el);
        if (!children.length) return null;
        return { type: 'list', props: { listType: rule?.props?.listType ?? 'bullet' }, children, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index != null ? index : undefined);
        node.data.set("type", "list");
        node.data.set("listType", props.listType || "bullet");
        const block = new List(nabu, node);
        return block;
    }
}