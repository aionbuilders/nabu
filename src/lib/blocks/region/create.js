/**
 * Creating a region where the caret is (ADR 018 §3.5, "Créer une région"): the operation behind `region:create`, the `:::` +
 * Space chooser and the slash-menu entries.
 *
 * WHERE a region may be created. The caret block must be a direct child of the root or of a region body (not in a list, a
 * toggle, a callout, not a title). The place is the BODY of its parent region (`null` = the root). The nesting rule (a
 * declared sub-region is strictly deeper than its region parent) splits the declared types in two, each in declaration order:
 *
 *  - `here`   the types that fit INSIDE this body: every type at the root, else the types of a level strictly deeper than the
 *             region (so a region of the deepest level offers none);
 *  - `next`   the other types (a level equal to or higher than the region, root excluded): a new region of such a type cannot
 *             be a child of the current one. It is created as a SIBLING after the nearest ancestor region (the current one
 *             included) whose parent accepts it (the root, or a shallower region). Like `region:split`, it takes what follows
 *             the caret in document order inside that ancestor, so nothing is reordered: the following siblings of the caret
 *             block, then those of each region up to (excluding) that ancestor.
 *
 * `region:create { type }` accepts any declared type: a `here` type nests, a `next` type is the sibling. The caret block is
 * REPLACED by the region when it is an empty default paragraph (also `:::` / `::: `, the typed trigger); any other block stays
 * and the region follows it. A region that takes nothing gets one empty default paragraph. One undo step; the caret lands in
 * the title.
 *
 * The chooser (`createOptions`) shows the two lists as two GROUPS ("Here", "Next"), each option with the numbering prefix the new
 * region would get (`previewPrefix`, computed from the registry's numbering rules as if it were created there).
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { Region } from "./regions.svelte.js";
 * @import { RegionTypeDef } from "./types.js";
 * @import { createMessages } from "./messages.js";
 */

import { tick } from "svelte";
import { Regions } from "./regions.svelte.js";
import { createRegion } from "./insert.js";
import { createDefaultBlock, defaultType, kids, parentIdOf } from "./actions.js";
import { siblingsOf } from "./facts.js";
import { formatLabel } from "./types.js";

/**
 * Where a region could be created from `block`: `{ parent }` (the region whose body holds it, `null` for the root), or `null`
 * when it is nowhere (no block, a title, a block nested in a list / toggle / callout…).
 * @param {Nabu} nabu @param {Block | null | undefined} block
 * @returns {{ parent: Region | null } | null}
 */
export function placeOf(nabu, block) {
    if (!block || block.type === 'region') return null;
    if (!block.parent) return { parent: null };
    if (block.parent.type !== 'region') return null;
    const parent = Regions.get(nabu).of(block.parent);
    return parent ? { parent } : null;
}

/**
 * The declared types by what they can do at a place (see the module doc).
 * @param {Nabu} nabu @param {Region | null} parent  the region whose body is the place, `null` for the root
 * @returns {{ here: RegionTypeDef[], next: RegionTypeDef[] }}
 */
export function regionChoices(nabu, parent) {
    const types = [...Regions.get(nabu).config.types.values()];
    if (!parent) return { here: types, next: [] };
    return { here: types.filter((def) => def.level > parent.level), next: types.filter((def) => def.level <= parent.level) };
}

/**
 * The type `region:create` uses without `type`: at the root the default (top-level) type; in a region the shallowest type that
 * fits inside (first declared of its level), else, in a region of the deepest level, the type of the region itself (a sibling).
 * @param {Nabu} nabu @param {Region | null} parent
 * @returns {string}
 */
export function defaultTypeAt(nabu, parent) {
    const regions = Regions.get(nabu);
    if (!parent) return regions.config.defaultType;
    const { here, next } = regionChoices(nabu, parent);
    const pick = (/** @type {RegionTypeDef[]} */ list, /** @type {1 | -1} */ sign) => list.reduce((/** @type {RegionTypeDef | null} */ best, def) => (!best || sign * def.level < sign * best.level ? def : best), null);
    return (pick(here, 1) ?? pick(next, -1))?.id ?? regions.config.defaultType;
}

/**
 * The region after which a `next` type (not nestable in `parent`) is created as a sibling: the nearest ancestor region (`parent`
 * included) whose own parent accepts the type (the root, or a region of a shallower level).
 * @param {Region} parent @param {RegionTypeDef} def
 * @returns {Region}
 */
export function siblingAnchor(parent, def) {
    let ancestor = parent;
    while (ancestor.parent && ancestor.parent.level >= def.level) ancestor = ancestor.parent;
    return ancestor;
}

/** The position of a block in the document, as the indexes from the root down (ancestors are prefixes). @param {Nabu} nabu @param {Block} block @returns {number[]} */
function docPath(nabu, block) {
    /** @type {number[]} */ const out = [];
    /** @type {Block | null} */ let b = block;
    while (b) { out.unshift(siblingsOf(nabu, b).indexOf(b)); b = /** @type {Block | null} */ (b.parent); }
    return out;
}

/** Whether `a` is before `b` in document order, an ancestor of `b` included. @param {number[]} a @param {number[]} b */
function startsBefore(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
    return a.length <= b.length;
}

/**
 * The numbering prefix a region of type `def` would get if it were created from `block` inside `parent` (`null` = the root): the
 * label template of the type applied with an empty title, with the index the registry's numbering rule would give it ("2.1", "3.",
 * "Chapter 4"). Empty when the type has nothing to show (unnumbered, label made of the title). Pure: reads the tree, changes nothing.
 *
 * A nestable type goes into the body of `parent`, at the caret block; any other becomes the sibling of {@link siblingAnchor}, and
 * takes everything that follows the caret, so in both cases it starts at the caret in document order.
 * @param {Nabu} nabu @param {RegionTypeDef} def @param {Block} block  the caret block @param {Region | null} parent
 * @returns {string}
 */
export function previewPrefix(nabu, def, block, parent) {
    const nested = !parent || def.level > parent.level;
    const anchor = nested ? block : siblingAnchor(/** @type {Region} */ (parent), def).block;
    const container = nested ? parent : siblingAnchor(/** @type {Region} */ (parent), def).parent;
    /** @type {number | null} */
    let index = null;
    if (def.numbering === 'document') {
        const at = docPath(nabu, block);
        index = 1 + Regions.get(nabu).list.filter((r) => r.type === def.id && startsBefore(docPath(nabu, r.block), at)).length;
    } else if (def.numbering === 'parent') {
        const siblings = siblingsOf(nabu, anchor);
        index = 1 + siblings.slice(0, siblings.indexOf(anchor) + 1).filter((b) => b.type === 'region' && /** @type {any} */ (b).regionType === def.id).length;
    }
    const path = [...(container ? container.path : []), ...(index == null ? [] : [index])].join('.');
    return formatLabel(def.label, { index, path, title: '', type: def.id, level: def.level });
}

/**
 * The options of the `region:create` chooser at a place, in two groups. "Here" holds the types created inside the body (every type
 * at the root); "Next" the sibling entries, the current region's own type first (the commonest intent). Each option carries the
 * prefix the new region would get as its `detail`. A group with no entry is absent (so there is no "Next" at the root).
 * @param {Nabu} nabu @param {Block} block  the caret block @param {Region | null} parent
 * @param {ReturnType<typeof createMessages>} text  the region messages (`createMessages`)
 * @returns {Array<{ id: string, type: string, label: string, group: string, detail: string }>}
 */
export function createOptions(nabu, block, parent, text) {
    const { here, next } = regionChoices(nabu, parent);
    const own = parent?.type;
    const ordered = [...next.filter((def) => def.id === own), ...next.filter((def) => def.id !== own)];
    /** @param {RegionTypeDef[]} defs @param {'createOption' | 'createNext'} message @param {string} group */
    const list = (defs, message, group) => defs.map((def) => ({
        id: def.id,
        type: def.id,
        label: text(message, { name: def.name, type: def.id }),
        group,
        detail: previewPrefix(nabu, def, block, parent),
    }));
    return [...list(here, 'createOption', text('groupHere')), ...list(ordered, 'createNext', text('groupNext'))];
}

/** Whether the creation REPLACES `block`: an empty default paragraph, or one holding only the typed `:::` trigger. @param {Nabu} nabu @param {Block} block */
function isReplaceable(nabu, block) {
    if (block.type !== defaultType(nabu) || /** @type {any} */ (block).children?.length) return false;
    const text = /** @type {any} */ (block.behaviors.get('text'))?.text;
    return text === '' || text === ':::' || text === '::: ';
}

/**
 * Creates a region of `type` at the caret block (see the module doc). Resolves to false (nothing changed) when there is no
 * place for a region or the type is not declared.
 * @param {Nabu} nabu
 * @param {Block | null | undefined} block  the block holding the caret
 * @param {string} [type]  default: {@link defaultTypeAt}
 * @returns {Promise<boolean>}
 */
export async function createRegionHere(nabu, block, type) {
    const place = placeOf(nabu, block);
    if (!block || !place) return false;
    const { parent } = place;
    const id = type ?? defaultTypeAt(nabu, parent);
    const def = Regions.get(nabu).config.types.get(id);
    if (!def) { nabu.warn(`region:create: region type "${id}" is not declared`); return false; }

    const replace = isReplaceable(nabu, block);
    const nested = !parent || def.level > parent.level;
    /** @type {import("./region.svelte.js").RegionBlock | null} */
    let created = null;

    const mutate = () => {
        if (nested) {
            const index = (block.node.index() ?? 0) + (replace ? 0 : 1);
            created = createRegion(nabu, { type: id, parentId: parent?.block.id ?? null, index });
            createDefaultBlock(nabu, {}, created.id, 0);
        } else {
            const ancestor = siblingAnchor(/** @type {Region} */ (parent), def);
            /** The siblings that follow `node` in its parent. @param {import("../nabu.svelte.js").NabuNode} node */
            const after = (node) => { const all = kids(/** @type {any} */ (node.parent())); return all.slice(all.findIndex((n) => n.id === node.id) + 1); };
            const followers = after(block.node);
            for (let r = /** @type {Region} */ (parent); r !== ancestor; r = /** @type {Region} */ (r.parent)) followers.push(...after(r.block.node));
            created = createRegion(nabu, { type: id, parentId: parentIdOf(ancestor.block.node), index: (ancestor.block.node.index() ?? 0) + 1 });
            if (followers.length) followers.forEach((n, i) => n.move(/** @type {any} */ (created).node, i));
            else createDefaultBlock(nabu, {}, created.id, 0);
        }
        if (replace) nabu.delete(block);
    };

    // The typed trigger (`::: `) is already in the document: `shortcut` makes the conversion its own undo step, whose undo
    // gives the trigger text back with the caret after it.
    if (block.transformsEnabled !== false && /** @type {any} */ (block.behaviors.get('text'))?.selection) await nabu.shortcut(block, '', mutate);
    else { mutate(); await nabu.commit(); }

    const fresh = created && nabu.blocks.get(/** @type {any} */ (created).id);
    if (fresh) { await tick(); nabu.selection.setCursor(fresh, 0); }
    return true;
}
