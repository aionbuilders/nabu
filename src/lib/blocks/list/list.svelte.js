import { MegaBlock } from "../megablock.svelte.js";
import { ListBehavior } from "./list.behavior.svelte.js";
import ListComponent from "./List.svelte";
import { stepBack } from "./step-back.js";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "list", listType: "bullet" | "ordered" | "todo", start?: number}>} ListNode
 */

/**
 * Normalize a list's `start` number: only meaningful for ORDERED lists, and `1` is the default.
 * @param {string | undefined} listType
 * @param {any} start  a number, a numeric string (markdown / `<ol start>`), or nothing
 * @returns {number | null}  the number to store / emit, or null = default (omit it)
 */
export function listStart(listType, start) {
    if (listType !== 'ordered' || start === undefined || start === null || start === '') return null;
    const n = Number(start);
    return Number.isInteger(n) && n >= 0 && n !== 1 ? n : null;
}



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
            props: this.clipboardProps,
            children: this.children.map(child => child.serialize('json')).filter(Boolean)
        }));
    }

    listType = $derived(this.behavior.listType);

    /** First number of an ORDERED list (`<ol start>`); null = 1, the default. @type {number | null} */
    start = $derived(listStart(this.behavior.listType, this.behavior.start));

    /** `start` is only emitted when it is not the default. */
    get clipboardProps() {
        return this.start === null ? { listType: this.listType } : { listType: this.listType, start: this.start };
    }

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
        
        // --- CAS 1 : empty item = step back one level (nested: unindent; top-level: leave the list as a paragraph) ---
        if (sourceItem.text.length === 0) {
            // Same node in both cases (a top-level item is retyped), so the returned block stays valid.
            stepBack(this.nabu, /** @type {import('../nabu.svelte.js').NabuNode} */ (sourceItem.node));
            return { block: sourceItem };
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
        const start = listStart(listType, pb.props?.start) ?? 1;
        return (pb.children || [])
            .map((child, i) => recurse(child, { listType, index: i, depth, start }))
            .join('\n');
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock) => string }} helpers
     */
    static toHtml(pb, { recurse }) {
        const tag = pb.props?.listType === 'ordered' ? 'ol' : 'ul';
        const cls = pb.props?.listType === 'todo' ? ' class="contains-task-list"' : '';
        const start = listStart(pb.props?.listType, pb.props?.start);
        return `<${tag}${cls}${start === null ? '' : ` start="${start}"`}>${(pb.children || []).map(recurse).join('')}</${tag}>`;
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
        /** @typedef {{ depth: number, ordered: boolean, num: number, task: boolean, checked: boolean, text: string }} ListToken */

        /** @type {ListToken[]} */
        const tokens = lines.flatMap(/** @returns {ListToken[]} */ (line) => {
            const m = line.match(/^([ \t]*)([-*+]|\d+[.)]) +(.*)/);
            if (!m) return [];
            const rawText = m[3];
            const num = parseInt(m[2], 10); // NaN for bullets
            const taskMatch = rawText.match(/^\[( |x|X)?\]\s*(.*)/);
            if (taskMatch) {
                const inner = taskMatch[1] ?? '';
                const rest = taskMatch[2];
                return [{ depth: m[1].length, ordered: /^\d/.test(m[2]), num, task: true, checked: /[xX]/.test(inner), text: rest }];
            }
            return [{ depth: m[1].length, ordered: /^\d/.test(m[2]), num, task: false, checked: false, text: rawText }];
        });

        if (!tokens.length) return null;

        /**
         * Builds ONE List PasteBlock from a flat token array. Items at the shallowest depth become direct
         * children; deeper tokens become the sublists of the item they follow.
         * @param {ListToken[]} toks
         * @returns {import('../../utils/extensions.js').PasteBlock}
         */
        function buildList(toks) {
            const baseDepth = Math.min(...toks.map(t => t.depth));
            const baseItems = toks.filter(t => t.depth === baseDepth);
            // Task takes precedence: if ANY base-depth item is a task, list is todo
            const hasTask = baseItems.some(t => t.task);
            const listType = hasTask ? 'todo' : (baseItems.find(t => t.depth === baseDepth)?.ordered ? 'ordered' : 'bullet');
            // CommonMark: an ordered list starts at the number of its first item (`3. a` / `4. b` -> start 3)
            const start = listStart(listType, baseItems[0].num);
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
                if (toks[i].task) item.props = { checked: toks[i].checked };
                if (subToks.length) item.children = buildSublists(subToks);

                items.push(item);
                i = j;
            }

            return { type: 'list', props: start === null ? { listType } : { listType, start }, children: items, partial: false };
        }

        /**
         * The sublists of an item (P-28): consecutive base-depth items of a different kind (numbered vs
         * bulleted / to-do) are separate sublists, in order (`- a` / `  - s1` / `  1. s2` / `  - s3` gives
         * ul[s1], ol[s2], ul[s3]). Each item keeps its own deeper tokens.
         * @param {ListToken[]} toks
         * @returns {import('../../utils/extensions.js').PasteBlock[]}
         */
        function buildSublists(toks) {
            const baseDepth = Math.min(...toks.map(t => t.depth));
            /** @type {ListToken[][]} */
            const runs = [];
            /** @type {boolean | null} */
            let runOrdered = null;
            for (const tok of toks) {
                if (tok.depth === baseDepth) {
                    if (tok.ordered !== runOrdered) { runs.push([]); runOrdered = tok.ordered; }
                } else if (!runs.length) continue; // deeper tokens before any base item: dropped, as buildList does
                runs[runs.length - 1].push(tok);
            }
            return runs.map(buildList);
        }

        return buildList(tokens);
    }

    static htmlRules = [
        { selector: 'ul.contains-task-list', props: { listType: 'todo' }, priority: 10 },
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
        // Determine listType: prefer rule, but promote to 'todo' if any child has checked prop
        let listType = rule?.props?.listType ?? 'bullet';
        if (listType !== 'todo' && children.some(c => c.props?.checked !== undefined)) {
            listType = 'todo';
        }
        const start = listStart(listType, el.getAttribute?.('start'));
        return { type: 'list', props: start === null ? { listType } : { listType, start }, children, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index != null ? index : undefined);
        node.data.set("type", "list");
        node.data.set("listType", props.listType || "bullet");
        const start = listStart(props.listType, /** @type {any} */ (props).start);
        if (start !== null) /** @type {any} */ (node.data).set("start", start);
        const block = new List(nabu, node);
        return block;
    }
}