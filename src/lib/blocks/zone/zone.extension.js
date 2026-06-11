import { Extension } from '../../utils/extensions.js';
import { ZoneBlock } from './zone.svelte.js';
import ZoneComponent from './Zone.svelte';
import { findLCA, findDirectChildOf } from '../container.utils.js';
import { onBeforeInput as zoneInsertTrigger } from './hooks/onBeforeInput.hook.js';

/**
 * @import { Nabu } from '../nabu.svelte.js';
 */

/**
 * onBeforeInput hook — intercepts deleteContentBackward at the start of the
 * first content block inside a Zone, before TextBehavior's findBackward() can
 * traverse up and out of the Zone boundary.
 *
 * Fires BEFORE block routing in Nabu.dispatchEventToSelection.
 *
 * @param {Nabu} nabu
 * @param {InputEvent} event
 * @param {import('../block.svelte.js').Block} block
 */
function zoneBackspaceGuard(nabu, event, block) {
    if (event.inputType !== 'deleteContentBackward') return;

    // Use the block's model selection (TextBehavior.selection) rather than the raw
    // DOM startOffset, which varies by text node structure and is unreliable here.
    const blockSel = block.selection;
    if (!blockSel || !blockSel.isCollapsed || blockSel.from !== 0) return;

    // Walk up from block. If every ancestor up to a Zone is the first child (index 0),
    // the cursor is at the very start of the Zone — block the event.
    // Stop early if a non-first-child is found (there's something to merge with inside).
    let current = block;
    while (current && current.parent) {
        if (current.parent.type === 'zone') {
            if (current.index === 0) return nabu.BREAK;
            break; // Has a previous sibling inside the zone — allow normal merge
        }
        if (current.index !== 0) break; // Has a previous sibling in a sub-container
        current = current.parent;
    }
}

export const ZoneExtension = new Extension('zone', {
    block: ZoneBlock,
    component: ZoneComponent,

    hooks: {
        onBeforeInput: (nabu, event, block) => {
            return zoneBackspaceGuard(nabu, event, block) ?? zoneInsertTrigger(nabu, event, block);
        },
    },

    actions: {
        /**
         * Move all children of the Zone to its parent position, then delete the Zone.
         * @param {Nabu} nabu
         * @param {{ zoneId: string }} data
         */
        'zone:unwrap': (nabu, { zoneId }) => {
            const zone = nabu.blocks.get(zoneId);
            if (!zone || zone.type !== 'zone') return;

            const parentNode = zone.node.parent();
            const parentId = parentNode ? parentNode.id : undefined;
            const zoneIndex = zone.node.index();

            // Reverse so that when each child is inserted at zoneIndex, the original
            // order is preserved (each insert pushes the previous one down).
            // @ts-ignore — zone.children comes from MegaBlock
            const children = /** @type {import('../block.svelte.js').Block[]} */ ([...zone.children]);
            children.reverse().forEach(child => {
                nabu.tree.move(child.node.id, parentId, zoneIndex);
            });

            nabu.tree.delete(zone.node.id);
            nabu.commit();
        },

        /**
         * @param {Nabu} nabu
         * @param {{ zoneId: string, status: string }} data
         */
        'zone:setStatus': (nabu, { zoneId, status }) => {
            const zone = /** @type {import('./zone.svelte.js').ZoneBlock | undefined} */ (nabu.blocks.get(zoneId));
            if (!zone || zone.type !== 'zone') return;
            return nabu.transact(() => {
                zone._status = status;
                /** @type {any} */ (zone.node.data).set('status', status);
            });
        },

        /**
         * @param {Nabu} nabu
         * @param {{ zoneId: string, text: string }} data
         */
        'zone:setSynopsis': (nabu, { zoneId, text }) => {
            const zone = /** @type {import('./zone.svelte.js').ZoneBlock | undefined} */ (nabu.blocks.get(zoneId));
            if (!zone || zone.type !== 'zone') return;
            return nabu.transact(() => {
                const len = zone.synopsisContainer.length;
                if (len > 0) zone.synopsisContainer.delete(0, len);
                if (text) zone.synopsisContainer.insert(0, text);
            });
        },

        /**
         * @param {Nabu} nabu
         * @param {{ zoneId: string, target: number | null }} data
         */
        'zone:setWordCountTarget': (nabu, { zoneId, target }) => {
            const zone = /** @type {import('./zone.svelte.js').ZoneBlock | undefined} */ (nabu.blocks.get(zoneId));
            if (!zone || zone.type !== 'zone') return;
            return nabu.transact(() => {
                zone._wordCountTarget = target ?? null;
                /** @type {any} */ (zone.node.data).set('wordCountTarget', target ?? null);
            });
        },

        /**
         * Insert a new empty zone (with one paragraph) after the anchor block's
         * root-level ancestor. Moves the cursor into the new paragraph.
         * @param {Nabu} nabu
         * @param {{ props?: Object }} [data]
         */
        'zone:insert': (nabu, data) => {
            const anchor = nabu.selection.anchorBlock;
            if (!anchor) return;

            // If the cursor is inside a zone, insert there; otherwise insert at root level.
            let nearestZone = anchor.parent;
            while (nearestZone && nearestZone.type !== 'zone') nearestZone = nearestZone.parent;

            let insertIndex, parentId;
            if (nearestZone) {
                const directChild = findDirectChildOf(anchor, nearestZone);
                insertIndex = (directChild?.index ?? 0) + 1;
                parentId = nearestZone.node.id.toString();
            } else {
                let rootBlock = anchor;
                while (rootBlock.parent) rootBlock = rootBlock.parent;
                insertIndex = (nabu.children.indexOf(rootBlock)) + 1;
                parentId = null;
            }

            // Create zone + paragraph in one transaction
            const zone = ZoneBlock.create(nabu, 'zone', data?.props ?? {}, parentId, insertIndex);

            const ParagraphClass = nabu.registry.get('paragraph');
            let newParagraph = null;
            if (ParagraphClass) {
                newParagraph = ParagraphClass.create(nabu, 'paragraph', {}, zone.node.id.toString(), 0);
            }

            nabu.commit().then(() => {
                const target = newParagraph ? nabu.blocks.get(newParagraph.id) ?? newParagraph : null;
                if (target) nabu.selection.setCursor(target, 0);
            });
        },

        /**
         * Wrap the selected blocks in a new zone.
         *
         * - Collapsed / single block: wraps the block's direct child of its
         *   nearest non-zone ancestor (or the root-level block).
         * - Multi-block selection: finds the LCA of startBlock/endBlock, resolves
         *   their direct children inside that container, and wraps the whole range.
         * - No-op if every candidate is already a zone.
         *
         * @param {Nabu} nabu
         * @param {{ props?: Object }} [data]
         */
        'zone:wrap': (nabu, data) => {
            const sel = nabu.selection;
            const startBlock = sel.startBlock ?? sel.anchorBlock;
            const endBlock   = sel.endBlock   ?? sel.focusBlock;
            if (!startBlock) return;

            const savedOffset = startBlock.behaviors?.get('text')?.selection?.from ?? 0;

            /** @type {import('../block.svelte.js').Block[]} */
            let toWrap;
            /** @type {string | null} */
            let parentId;
            /** @type {number} */
            let insertIndex;

            if (!endBlock || startBlock === endBlock || sel.isCollapsed) {
                // ── Single-block path ──────────────────────────────────────────
                // Find direct child of the nearest container (zone or root level).
                // The while loop stops at zone boundaries, so wrapping inside a zone
                // creates a nested zone — which is now intentionally supported.
                let target = startBlock;
                while (target.parent && target.parent.type !== 'zone') {
                    target = target.parent;
                }

                toWrap      = [target];
                parentId    = target.parent ? target.parent.node.id.toString() : null;
                insertIndex = target.index ?? 0;
            } else {
                // ── Multi-block path ───────────────────────────────────────────
                const lca = findLCA(startBlock, endBlock);
                // Container is the LCA block, or nabu itself if blocks are root-level
                const container = lca ?? nabu;

                const sc = findDirectChildOf(startBlock, container);
                const ec = findDirectChildOf(endBlock,   container);
                if (!sc || !ec) return;

                const containerChildren = /** @type {import('../block.svelte.js').Block[]} */ (
                    lca ? /** @type {any} */ (lca).children : nabu.children
                );
                const si = containerChildren.indexOf(sc);
                const ei = containerChildren.indexOf(ec);
                if (si === -1 || ei === -1 || si > ei) return;

                toWrap      = containerChildren.slice(si, ei + 1);
                parentId    = lca ? lca.node.id.toString() : null;
                insertIndex = si;
            }

            const zone = ZoneBlock.create(nabu, 'zone', data?.props ?? {}, parentId, insertIndex);
            toWrap.forEach((block, i) => nabu.tree.move(block.node.id, zone.node.id, i));

            const zoneId = zone.id;
            nabu.commit().then(() => {
                const fresh = nabu.blocks.get(startBlock.id);
                if (fresh) nabu.selection.setCursor(fresh, savedOffset);
                if (/** @type {any} */ (data)?.focusTitle) {
                    const freshZone = /** @type {import('./zone.svelte.js').ZoneBlock | undefined} */ (nabu.blocks.get(zoneId));
                    freshZone?.focusTitle();
                }
            });
        },
    },
});
