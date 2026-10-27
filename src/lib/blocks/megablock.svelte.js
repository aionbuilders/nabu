import { Block } from "./block.svelte.js";
import { handleContainerBeforeInput, findDirectChildOf } from "./container.utils.js";

/**
 * @import { Nabu, NabuNode } from "./nabu.svelte.js";
 */

export class MegaBlock extends Block {

    /** @param {Nabu} nabu @param {NabuNode} node */
	constructor(nabu, node) {
		super(nabu, node);
        this.updateChildren();
	}

    /**
     * @type {Block[]}
     * @public
     */
    children = $state([]);
    /** @public */
    positions = $derived(this.children.reduce((sum, child) => sum + (child.positions ?? 0), 0));
    /** @public */
    wordCount = $derived(this.children.reduce((sum, c) => sum + (c.wordCount ?? 0), 0));

    /**
     * Pure container: no own text, delegate entirely to children.
     * @param {number} localOffset
     * @returns {{ block: Block, offset: number } | null}
     * @public
     */
    resolveOffset(localOffset) {
        let remaining = localOffset;
        for (const child of this.children) {
            const childPositions = child.positions ?? 0;
            if (remaining < childPositions) return child.resolveOffset(remaining);
            remaining -= childPositions;
        }
        // Fallback: clamp to end of last child
        const last = this.children[this.children.length - 1];
        return last ? last.resolveOffset(Math.max(0, (last.positions ?? 1) - 1)) : null;
    }

    /**
     * @param {Set<string>} [retyped]  ids whose `type` just changed; without it, the type of every child is checked
     * @public
     */
    updateChildren(retyped) {
        const childrenNodes = this.node.children();
        if (!childrenNodes) return;
        this.children = childrenNodes.map((childNode, i) => {
            const id = childNode.id.toString();
            let block = this.nabu.blocks.get(id);

            if (!block || !retyped || retyped.has(id)) {
                const currentType = childNode.data.get("type");
                if (!block || block.type !== currentType) {
                    if (block) {
                        this.nabu.blocks.delete(id);
                        this.nabu.blocksByType.get(block.type)?.delete(block);
                    }
                    block = Block.load(this.nabu, childNode);
                }
            }
            block.parent = this;
            block.index = i;
            return block;
        });
    }


    /**
     * @param {Block[]} children
     * @param {number | null} [index]
     * @public
     */
    adoptChildren(children, index = null) {
        // Reverse so that when index is specified, children are inserted in original
        // order (each insert at the same position pushes others down, so reverse of
        // reverse = original). With index=null (append), order doesn't matter.
        // Spread to avoid mutating the input array (which may be a reactive Svelte array).
        [...children].reverse().forEach(child => {
            if (!child.node) return;
            this.nabu.tree.move(child.node.id, this.node.id, index);
        });
    }


    /**
     * @param {InputEvent} event
     * @public
     */
    beforeinput(event) {
        return handleContainerBeforeInput(this, this.nabu, event);
    }

    /**
     * Props to include in the clipboard representation of this container block.
     * Override in subclasses that carry structural props (e.g. List -> { listType }, ListItem -> { checked },
     * Toggle -> { collapsed }).
     * @returns {Record<string, any>}
     * @public
     */
    get clipboardProps() { return {}; }

    /**
     * Clipboard props when the copied slice starts at `firstChildIndex` (the children before it are NOT copied).
     * Containers whose props depend on their first copied child (an ordered list's `start`) override this.
     * @param {number} firstChildIndex
     * @returns {Record<string, any>}
     * @public
     */
    clipboardPropsFrom(firstChildIndex) { return this.clipboardProps; }

    /**
     * Serializes the portion of this MegaBlock that falls within the given selection boundaries, recursively.
     *
     * The context carries the selection boundary blocks that belong to THIS subtree (`startBlock` / `endBlock`, null =
     * the selection extends past this block on that side, i.e. it is fully selected on that side). Document order of a
     * block is: own text (hybrid blocks only), then its children. So:
     *   - own text is copied unless the selection starts inside a child; it is clipped to `startFrom` when this block IS
     *     the start boundary, and to `endTo` when it IS the end boundary;
     *   - children are copied unless the selection ends in the own text; only those between the child holding the start
     *     boundary and the child holding the end boundary (inclusive) are kept, each one recursively clipped.
     * A pure container (no text) simply has no own-text part. Nothing here depends on a concrete block type.
     *
     * With `textOnly` (the context of a TEXT selection: copy, cut, drag), a block that ISOLATES its text (`isolatesSelection`) is
     * transparent to a selection that is not entirely inside it: its own text is not copied and its container is not created, its
     * selected children are returned directly (an ARRAY, to be spliced in the list of its siblings). Without it (the structure of
     * a whole block), the container is serialized as it is.
     *
     * @param {{ startBlock?: Block|null, startFrom?: number, endBlock?: Block|null, endTo?: number|null, textOnly?: boolean }} [ctx]
     * @returns {import('../utils/extensions.js').PasteBlock | import('../utils/extensions.js').PasteBlock[] | null}
     * @public
     */
    serializeForClipboard({ startBlock = null, startFrom = 0, endBlock = null, endTo = null, textOnly = false } = {}) {
        const tb = this.behaviors?.get('text');
        const imStart = startBlock === this;
        const imEnd   = endBlock   === this;
        const childOfThis = (/** @type {Block|null} */ block) => {
            for (let cur = block; cur; cur = cur.parent ?? null) if (cur.parent === this) return cur;
            return null;
        };
        const startChild = startBlock && !imStart ? childOfThis(startBlock) : null;
        const endChild   = endBlock   && !imEnd   ? childOfThis(endBlock)   : null;

        const isolated         = textOnly && this.isolatesSelection && !(imStart && imEnd);
        const textIncluded     = !!tb && !startChild && !isolated;
        const childrenIncluded = !imEnd && !!this.children?.length;
        if (!textIncluded && imEnd) return null;

        // ── Own text ──
        /** @type {import('../utils/extensions.js').PasteBlock | null} */
        let result = null;
        if (tb && textIncluded) {
            const length  = tb.container.length;
            const from    = imStart ? startFrom : 0;
            const to      = imEnd   ? (endTo ?? length) : length;
            const partial = imStart && imEnd ? 'both' : imStart ? 'start' : imEnd ? 'end' : false;
            result = /** @type {import('../utils/extensions.js').PasteBlock} */ (
                { type: this.type, props: this.clipboardProps, partial, delta: tb.container.sliceDelta(from, to) }
            );
        }

        // ── Children inside the selection ──
        /** @type {any[]} */
        let kids = [];
        let firstIndex = 0;
        if (childrenIncluded) {
            const si = startChild ? this.children.indexOf(/** @type {Block} */ (startChild)) : 0;
            const ei = endChild   ? this.children.indexOf(/** @type {Block} */ (endChild))   : this.children.length - 1;
            if (si === -1 || ei === -1 || si > ei) return result;
            firstIndex = si;
            const relevant = this.children.slice(si, ei + 1);
            const lastI = relevant.length - 1;
            kids = relevant.map((child, i) => {
                const cs = i === 0     && startChild ? startBlock : null;
                const ce = i === lastI && endChild   ? endBlock   : null;
                const mb = /** @type {any} */ (child);
                if (typeof mb.serializeForClipboard === 'function') {
                    return mb.serializeForClipboard({ startBlock: cs, startFrom: cs ? startFrom : 0, endBlock: ce, endTo: ce ? endTo : null, textOnly });
                }
                return child.serialize('application/x-nabu+json', {
                    from:    cs ? startFrom : 0,
                    to:      ce ? endTo     : null,
                    partial: cs && ce ? 'both' : cs ? 'start' : ce ? 'end' : false,
                });
            }).flat().filter(Boolean);
        }

        if (result) {
            if (kids.length) result.children = kids;
            return result;
        }
        if (isolated) return /** @type {import('../utils/extensions.js').PasteBlock[]} */ (kids);
        return kids.length ? { type: this.type, props: this.clipboardPropsFrom(firstIndex), children: kids } : null;
    }
}
