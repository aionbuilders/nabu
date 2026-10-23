/**
 * Programmatic creation of a region (ADR 018). The neutral building block of the region commands (see actions.js) and what
 * tests / playgrounds call. A region is a container block: it is created EMPTY (a title, no body), at the root or in the
 * body of another region.
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 */

/**
 * Where to insert, relative to the BODY of the parent (the root of the document by default):
 *  - `'start'` | `'end'`         first / last position;
 *  - a number                    that index (clamped);
 *  - `{ after: Block }`          right after that block (a child of the parent; a deeper block counts as its ancestor in the parent);
 *  - `{ before: Block }`         right before it.
 * @typedef {'start' | 'end' | number | { after: Block } | { before: Block }} InsertRegionAt
 */

/** The class of the region block, or a thrown error when the extension is not installed. @param {Nabu} nabu @returns {any} */
function regionClass(nabu) {
    const BlockClass = /** @type {any} */ (nabu.registry.get('region'));
    if (!BlockClass) throw new Error('insertRegion: the Regions extension is not installed.');
    return BlockClass;
}

/** The blocks of a body: the children of the parent block, or the root blocks. @param {Nabu} nabu @param {Block | null} parent @returns {Block[]} */
const siblingsOf = (nabu, parent) => /** @type {Block[]} */ (parent ? /** @type {any} */ (parent).children ?? [] : nabu.children);

/** Index of the child of `parent` that holds `block` (itself, or its closest ancestor in that body); -1 when it is not under `parent`. @param {Nabu} nabu @param {Block | null} parent @param {Block} block @returns {number} */
function indexUnder(nabu, parent, block) {
    /** @type {Block | null} */
    let current = block;
    while (current && (current.parent ?? null) !== parent) current = current.parent ?? null;
    return current ? siblingsOf(nabu, parent).indexOf(current) : -1;
}

/**
 * Index in the body of `parent` for an `at`.
 * @param {Nabu} nabu @param {Block | null} parent @param {InsertRegionAt} at @returns {number}
 */
function resolveIndex(nabu, parent, at) {
    const count = siblingsOf(nabu, parent).length;
    if (at === 'start') return 0;
    if (at === 'end') return count;
    if (typeof at === 'number') return Math.max(0, Math.min(count, Math.trunc(at)));
    if (at && typeof at === 'object' && 'before' in at) { const i = indexUnder(nabu, parent, at.before); return i < 0 ? count : i; }
    if (at && typeof at === 'object' && 'after' in at) { const i = indexUnder(nabu, parent, at.after); return i < 0 ? count : i + 1; }
    return count;
}

/**
 * Creates a region WITHOUT committing: the caller owns the transaction (an action that splits a block and creates a region is
 * one undo step). `parentId` is the id of a region block (its body), `null` for the root; `index` is clamped. The title is
 * the header text. Throws on an unknown type or when the extension is not installed.
 * @param {Nabu} nabu
 * @param {{ type?: string, parentId?: string | null, index?: number | null, title?: string, fields?: Record<string, any> }} [options]
 *   `type` defaults to the lowest-level declared type; `index` defaults to the end of the body.
 * @returns {import("./region.svelte.js").RegionBlock}
 */
export function createRegion(nabu, { type, parentId = null, index = null, title, fields } = {}) {
    const BlockClass = regionClass(nabu);
    if (type !== undefined && !BlockClass.config.types.has(type)) throw new Error(`insertRegion: region type "${type}" is not declared.`);
    const count = parentId ? (/** @type {any} */ (nabu.blocks.get(parentId))?.children?.length ?? 0) : nabu.tree.roots().length;
    const at = index == null ? count : Math.max(0, Math.min(count, Math.trunc(index)));
    return BlockClass.create(nabu, 'region', { regionType: type, title, fields }, parentId, at);
}

/**
 * Inserts a region as one undo step.
 * @param {Nabu} nabu
 * @param {{ type?: string, at?: InsertRegionAt, title?: string, fields?: Record<string, any>, parent?: Block | null }} [options]
 *   `type` defaults to the lowest-level declared type; `at` defaults to `'end'`; `parent` is the region whose body receives
 *   the new one (the root of the document by default).
 * @returns {Promise<import("./region.svelte.js").RegionBlock>}
 */
export async function insertRegion(nabu, { type, at = 'end', title, fields, parent = null } = {}) {
    const index = resolveIndex(nabu, parent, at);
    const block = createRegion(nabu, { type, parentId: parent?.id ?? null, index, title, fields });
    await nabu.commit();
    return /** @type {import("./region.svelte.js").RegionBlock} */ (nabu.blocks.get(block.id) ?? block);
}

// ── Root helpers of the first region commands (ADR 016), until their rewrite on the tree (ADR 018 lot A2) ──

/** Root index of the top-level block holding `block` (the end of the document when it is not found). @param {Nabu} nabu @param {Block} block @returns {number} */
export function rootIndexOf(nabu, block) {
    /** @type {Block} */
    let root = block;
    while (root.parent) root = /** @type {Block} */ (root.parent);
    const index = nabu.children.indexOf(root);
    return index < 0 ? nabu.children.length : index;
}

/**
 * Creates a region at a ROOT index WITHOUT committing.
 * @param {Nabu} nabu
 * @param {{ type?: string, index: number, title?: string, fields?: Record<string, any> }} options
 * @returns {import("./region.svelte.js").RegionBlock}
 */
export function createMarker(nabu, { type, index, title, fields }) {
    return createRegion(nabu, { type, parentId: null, index, title, fields });
}
