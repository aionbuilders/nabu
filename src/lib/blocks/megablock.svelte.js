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

    /** @type {Block[]} */
    children = $state([]);
    positions = $derived(this.children.reduce((sum, child) => sum + (child.positions ?? 0), 0));

    /**
     * Pure container: no own text, delegate entirely to children.
     * @param {number} localOffset
     * @returns {{ block: Block, offset: number } | null}
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

    updateChildren() {
        const childrenNodes = this.node.children();
        if (!childrenNodes) return;
        this.children = childrenNodes.map((childNode, i) => {
            const id = childNode.id.toString();
            let block = this.nabu.blocks.get(id);
            const currentType = childNode.data.get("type");

            if (!block || block.type !== currentType) {
                if (block) {
                    this.nabu.blocks.delete(id);
                    this.nabu.blocksByType.get(block.type)?.delete(block);
                }
                block = Block.load(this.nabu, childNode);
            }
            block.parent = this;
            block.index = i;
            return block;
        });
    }


    /** @param {Block[]} children @param {number | null} [index] */
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


    /** @param {InputEvent} event */
    beforeinput(event) {
        return handleContainerBeforeInput(this, this.nabu, event);
    }

    /**
     * Props to include in the clipboard representation of this container block.
     * Override in subclasses that carry structural props (e.g. List → { listType }).
     * @returns {Record<string, any>}
     */
    get clipboardProps() { return {}; }

    /**
     * Serializes the portion of this MegaBlock that falls within the given
     * selection boundaries, recursively.
     *
     * For hybrid blocks (MegaBlock + text behavior, like ListItem):
     *   if startBlock or endBlock IS this block, serialize text directly.
     *   if neither boundary is set, this block is fully selected — serialize all text.
     *
     * For pure containers (like List):
     *   find direct children that contain/are the boundaries, slice children in range,
     *   recurse into each with propagated context.
     *
     * @param {{ startBlock?: Block|null, startFrom?: number, endBlock?: Block|null, endTo?: number|null }} [ctx]
     * @returns {import('../utils/extensions.js').PasteBlock | null}
     */
    serializeForClipboard({ startBlock = null, startFrom = 0, endBlock = null, endTo = null } = {}) {
        const tb = this.behaviors?.get('text');
        const imStart = startBlock === this;
        const imEnd   = endBlock   === this;

        // ── Hybrid block (has text): this block IS a selection boundary or fully selected ──
        if (tb && (imStart || imEnd || (!startBlock && !endBlock))) {
            const from    = imStart ? startFrom : 0;
            const to      = imEnd   ? endTo     : tb.container.length;
            const partial = imStart && imEnd ? 'both' : imStart ? 'start' : imEnd ? 'end' : false;
            const delta   = tb.container.sliceDelta(from, to ?? tb.container.length);
            const result  = /** @type {import('../utils/extensions.js').PasteBlock} */ (
                { type: this.type, props: this.clipboardProps, partial, delta }
            );
            // If fully selected and has children (e.g. ListItem with sublist), include them too
            if (!imStart && !imEnd && this.children?.length) {
                const childrenSerialized = this.children.map(child =>
                    typeof child.serializeForClipboard === 'function'
                        ? child.serializeForClipboard({})
                        : child.serialize('application/x-nabu+json', { partial: false })
                ).filter(Boolean);
                if (childrenSerialized.length) result.children = childrenSerialized;
            }
            return result;
        }

        // ── Pure container: find relevant children by walking up from boundaries ──
        if (!this.children?.length) return null;

        const sc = (startBlock ? findDirectChildOf(startBlock, this) : null) ?? this.children[0];
        const ec = (endBlock   ? findDirectChildOf(endBlock,   this) : null) ?? this.children.at(-1);
        if (!sc || !ec) return null;

        const si = this.children.indexOf(sc);
        const ei = this.children.indexOf(ec);
        if (si === -1 || ei === -1) return null;

        const relevant = this.children.slice(si, ei + 1);
        const lastI = relevant.length - 1;

        const children = relevant.map((child, i) => {
            const isFirst = i === 0;
            const isLast  = i === lastI;
            const childCtx = {
                startBlock: isFirst ? startBlock : null,
                startFrom:  isFirst ? startFrom  : 0,
                endBlock:   isLast  ? endBlock   : null,
                endTo:      isLast  ? endTo      : null,
            };
            if (typeof child.serializeForClipboard === 'function') {
                return child.serializeForClipboard(childCtx);
            }
            return child.serialize('application/x-nabu+json', {
                from:    isFirst && startBlock ? startFrom : 0,
                to:      isLast  && endBlock   ? endTo     : null,
                partial: isFirst && isLast ? 'both' : isFirst ? 'start' : isLast ? 'end' : false,
            });
        }).filter(Boolean);

        return children.length ? { type: this.type, props: this.clipboardProps, children } : null;
    }
}