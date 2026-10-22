/**
 * Programmatic insertion of a region marker (ADR 016). The keyboard actions (`region:split`, `region:insert`…) are
 * lot 2; this helper is the neutral building block they will use, and what tests / playgrounds call.
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 */

/**
 * Where to insert, at the ROOT of the document (a marker lives nowhere else):
 *  - `'start'` | `'end'`         first / last position;
 *  - a number                    that root index (clamped);
 *  - a `Block` | `{ after }`     right after that block (its top-level block when it is nested);
 *  - `{ before: Block }`         right before that block (its top-level block when it is nested).
 * @typedef {'start' | 'end' | number | Block | { after: Block } | { before: Block }} InsertRegionAt
 */

/** @param {Nabu} nabu @param {Block} block @returns {number} */
function rootIndexOf(nabu, block) {
    /** @type {Block} */
    let root = block;
    while (root.parent) root = /** @type {Block} */ (root.parent);
    const index = nabu.children.indexOf(root);
    return index < 0 ? nabu.children.length : index;
}

/**
 * Inserts a region marker at the root, as one undo step.
 * @param {Nabu} nabu
 * @param {{ type?: string, at?: InsertRegionAt, title?: string, fields?: Record<string, any> }} [options]
 *   `type` defaults to the lowest-level declared type; `at` defaults to `'end'`.
 * @returns {Promise<import("./region.svelte.js").RegionBlock>}
 */
export async function insertRegion(nabu, { type, at = 'end', title, fields } = {}) {
    const BlockClass = /** @type {any} */ (nabu.registry.get('region'));
    if (!BlockClass) throw new Error('insertRegion: the Regions extension is not installed.');
    if (type !== undefined && !BlockClass.config.types.has(type)) throw new Error(`insertRegion: region type "${type}" is not declared.`);

    const count = nabu.children.length;
    let index = count;
    if (at === 'start') index = 0;
    else if (at === 'end') index = count;
    else if (typeof at === 'number') index = Math.max(0, Math.min(count, Math.trunc(at)));
    else if (at && typeof at === 'object' && 'before' in at) index = rootIndexOf(nabu, at.before);
    else if (at && typeof at === 'object' && 'after' in at) index = rootIndexOf(nabu, at.after) + 1;
    else if (at) index = rootIndexOf(nabu, /** @type {Block} */ (at)) + 1;

    const block = BlockClass.create(nabu, 'region', { regionType: type, title, fields }, null, index);
    await nabu.commit();
    return nabu.blocks.get(block.id) ?? block;
}
