import { MegaBlock } from "../megablock.svelte.js";
import ListItemComponent from "./ListItem.svelte";
import { LoroText } from "loro-crdt";
import { TextBehavior } from "../../behaviors/text";

/**
 * @import { Nabu, NabuNode, Block } from "..";
 */

/**
 * @typedef {NabuNode<{type: "list-item", text: LoroText}>} ListItemNode
 */

/**
 * Indent a list item (Tab behavior): move into previous sibling's sublist, hoist own children.
 * @param {ListItem} item
 * @returns {boolean}
 */
export function indentListItem(item) {
    const currentIndex = item.node.index();
    if (currentIndex === 0) return false;

    const parentList = item.node.parent();
    if (!parentList) return false;

    const previousNode = parentList.children()?.[currentIndex - 1];
    if (!previousNode) return false;
    const previousItem = item.nabu.blocks.get(previousNode.id.toString());
    if (!previousItem || previousItem.type !== 'list-item') return false;

    // @ts-ignore
    const targetSublist = previousItem.getOrCreateSublist();
    const targetSublistId = targetSublist.node.id.toString();

    item.nabu.tree.move(item.node.id.toString(), targetSublistId);

    if (item.sublist) {
        for (const childNode of item.sublist.node.children()) {
            item.nabu.tree.move(childNode.id.toString(), targetSublistId);
        }
    }

    item.commit();
    setTimeout(() => item.behavior.block.focus(), 0);
    return true;
}

/**
 * Unindent a list item (Shift+Tab behavior): move out of parent sublist, carry followers.
 * @param {ListItem} item
 * @returns {boolean}
 */
export function unindentListItem(item) {
    const parentListNode = item.node.parent();
    if (!parentListNode) return false;

    const grandParentItemNode = parentListNode.parent();
    if (!grandParentItemNode || grandParentItemNode.data.get('type') !== 'list-item') return false;

    const myIndex = item.node.index();
    const followers = parentListNode.children().slice(myIndex + 1);

    if (followers.length > 0) {
        const mySublist = item.getOrCreateSublist();
        for (const follower of followers) {
            item.nabu.tree.move(follower.id.toString(), mySublist.node.id.toString());
        }
    }

    const targetParentListNode = grandParentItemNode.parent();
    if (!targetParentListNode) return false;

    const targetIndex = grandParentItemNode.index() + 1;
    item.nabu.tree.move(item.node.id.toString(), targetParentListNode.id.toString(), targetIndex);

    item.commit();
    setTimeout(() => item.behavior.block.focus(), 0);
    return true;
}

export class ListItem extends MegaBlock {
    /** @param {Nabu} nabu @param {ListItemNode} node */
    constructor(nabu, node) {
        super(nabu, node);
        
        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);

        this.serializers.set('markdown', () => {
            const depth = this.parents.filter(p => p.type === 'listItem').length;
            const indent = '  '.repeat(depth);
            const listType = /** @type {any} */ (this.parent)?.listType ?? 'bullet';
            const prefix = listType === 'ordered' ? `${this.index + 1}.` : '-';
            const lines = [`${indent}${prefix} ${this.behavior.toMarkdown()}`];
            if (this.sublist) {
                const sublistMd = this.sublist.serialize('markdown');
                if (sublistMd) lines.push(sublistMd);
            }
            return lines.join('\n');
        });
        this.serializers.set('json', () => {
            /** @type {Record<string, any>} */
            const result = {
                id: this.id,
                type: 'list-item',
                content: this.behavior.toJSON()
            };
            const childrenJson = this.children.map(c => c.serialize('json')).filter(Boolean);
            if (childrenJson.length) result.children = childrenJson;
            return result;
        });
        this.serializers.set('application/x-nabu+json', (ctx = {}) => this.behavior.toClipboardBlock(ctx));
    }

    component = $derived(this.nabu.components.get("list-item") || ListItemComponent);
    
    get text() {
        return this.behavior.text;
    }

    get delta() {
        return this.behavior.delta;
    }

    selection = $derived(this.behavior.selection);

    sublist = $derived(this.children.find(child => child.node.data.get("type") === "list"));

    /**
     * A ListItem must always live inside a List.
     * wrapOrphan() uses this to auto-create a List wrapper when a ListItem
     * is relocated to a context that doesn't have a List parent.
     * props() reads this.parent (stale Svelte state) which still points to the
     * original List at relocation time, giving us the correct listType.
     * @returns {{ type: string, props: () => Record<string, any> }}
     */
    get requiredParent() {
        return {
            type: "list",
            props: () => ({
                listType: this.parent?.behaviors?.get("list")?.listType || "bullet"
            })
        };
    }

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
        if (event.key === 'Tab') {
            event.preventDefault();
            if (event.shiftKey) {
                unindentListItem(this);
            } else {
                indentListItem(this);
            }
            return true;
        }
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

    /** @param {import('../block.svelte.js').Block} block */
    absorbs(block) { return this.behavior.absorbs(block); }

    

    /** @param {number} index @param {string} text */
    insert(index, text) { return this.behavior.insert(index, text); }
    
    /** @param {Parameters<import('../block.svelte.js').Block["delete"]>[0]} [deletion] */
    delete(deletion) { return this.behavior.delete(deletion); }

    /** @param {import('loro-crdt').Delta<string>[]} data */
    applyDelta(data = []) { return this.behavior.applyDelta(data); }

    /** @param {Parameters<import('../block.svelte.js').Block["split"]>[0]} [options] @returns {ReturnType<import('../block.svelte.js').Block["split"]>} */
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
