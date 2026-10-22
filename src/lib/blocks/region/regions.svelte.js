import { formatLabel, resolveConfig } from "./types.js";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { RegionBlock } from "./region.svelte.js";
 * @import { RegionsConfig, RegionTypeDef } from "./types.js";
 */

/** Block type of a region marker (the registry detects markers by it, without importing the block class). */
const MARKER_TYPE = 'region';

/**
 * One division of the document, as computed by the registry (ADR 016 §2, §3.3). A read-only VIEW: the
 * structure (`level`, `parent`, `children`, `index`, `path`, extent) is derived from the root blocks; `title` /
 * `fields` / `label` / `wordCount` read reactive state when you read them.
 *
 * The RANGE of a region is `first` (its marker) … `last`: from its marker to the block before the next marker
 * of the same or a higher level (or the end of the document). It includes the content of its sub-regions.
 */
export class Region {
    /** @type {Regions} */ #registry;

    /**
     * @param {Regions} registry
     * @param {{ marker: RegionBlock, def: RegionTypeDef | undefined, type: string, level: number, position: number, start: number }} init
     */
    constructor(registry, { marker, def, type, level, position, start }) {
        this.#registry = registry;
        /** The marker block. @type {RegionBlock} */
        this.marker = marker;
        /** The declared type, or `undefined` when the marker's type is not declared (a document from a richer editor). @type {RegionTypeDef | undefined} */
        this.def = def;
        /** The region type id. */
        this.type = type;
        /** Depth, 1 = highest. A marker whose type is not declared gets the deepest declared level. */
        this.level = level;
        /** Rank among all regions, in document order (0-based). */
        this.position = position;
        /** Root index of the marker. */
        this.start = start;
        /** Root index just after the last block of the range (exclusive). Set by the registry pass. */
        this.end = start + 1;
        /** Root index where the first sub-region starts, or `end` when there is none: the end of the region's OWN content. */
        this.ownEnd = start + 1;
        /** The number within its numbering scope (see `numbering` in ADR 016 §3.2), `null` when not numbered. @type {number | null} */
        this.index = null;
        /** The indexes of the numbered ancestors, then of this region ([2, 1]). @type {number[]} */
        this.path = [];
        /** @type {Region | null} */ this.parent = null;
        /** The direct sub-regions, in order. @type {Region[]} */ this.children = [];
    }

    /** The path as text ("2.1"; empty when nothing on the way is numbered). */
    get pathString() { return this.path.join('.'); }

    /** The fields of the marker (reactive). @type {Record<string, any>} */
    get fields() { return this.marker.fields; }

    /** The title (reactive). */
    get title() { return this.marker.fields.title; }

    /** The label template applied ("1.1 The ferryman"). Reactive (the title). Empty when the template yields nothing. */
    get label() {
        return formatLabel(this.def?.label ?? '{title}', {
            index: this.index, path: this.pathString, title: this.title, type: this.type, level: this.level,
        });
    }

    /** The first block of the range: the marker. @type {Block} */
    get first() { return this.marker; }

    /** The last root block of the range (the marker itself for an empty region). @type {Block} */
    get last() { return this.#registry.rootAt(this.end - 1) ?? this.marker; }

    /** The root blocks of the range, marker excluded, sub-regions' markers and content included. @type {Block[]} */
    get blocks() { return this.#registry.rootsBetween(this.start + 1, this.end); }

    /** The root blocks of the region's own content: from after its marker to its first sub-region. @type {Block[]} */
    get ownBlocks() { return this.#registry.rootsBetween(this.start + 1, this.ownEnd); }

    /** Words of the range (sub-regions included), summed from the blocks' own `wordCount` (no rendering). Reactive. */
    get wordCount() { return this.#registry.words(this.start + 1, this.end); }

    /** Words of the region's own content (sub-regions excluded). Reactive. */
    get ownWordCount() { return this.#registry.words(this.start + 1, this.ownEnd); }

    /** Sets a field of the marker (validated, own undo step). @param {string} name @param {unknown} value */
    setField(name, value) { return this.marker.setField(name, value); }
}

/**
 * The content before the first marker: outside any region (ADR 016 §3.1).
 */
export class Preamble {
    /** @type {Regions} */ #registry;
    /** @param {Regions} registry @param {number} end */
    constructor(registry, end) {
        this.#registry = registry;
        /** Root index just after the last block of the preamble (exclusive). */
        this.end = end;
    }
    /** @type {Block[]} */
    get blocks() { return this.#registry.rootsBetween(0, this.end); }
    get wordCount() { return this.#registry.words(0, this.end); }
}

/**
 * Document-level reactive registry of the regions (ADR 016 §3.3): a pure, derived view over the root blocks (stores
 * nothing in Loro). Lazy and cheap: ONE linear pass over the root children builds everything, and it only re-runs when
 * the ROOT structure changes (a marker inserted / moved / deleted / retyped), not when text is typed.
 * Obtain it with `Regions.get(nabu)`; `RegionsExtension` also installs it as `nabu.regions`.
 */
export class Regions {
    /** @type {Nabu} */ #nabu;
    /** @type {RegionsConfig} */ #config;

    /** @param {Nabu} nabu @param {RegionsConfig} config */
    constructor(nabu, config) { this.#nabu = nabu; this.#config = config; }

    /**
     * @param {Nabu} nabu
     * @returns {Regions}
     */
    static get(nabu) {
        if (!nabu.systems.has('regions')) {
            const config = /** @type {any} */ (nabu.registry.get(MARKER_TYPE))?.config ?? resolveConfig();
            nabu.systems.set('regions', new Regions(nabu, config));
        }
        return /** @type {Regions} */ (nabu.systems.get('regions'));
    }

    /** The resolved configuration (declared types). */
    get config() { return this.#config; }

    /** The one linear pass. @type {{ list: Region[], tree: Region[], preambleEnd: number, byId: Map<string, Region>, rootIndex: Map<string, number> }} */
    #structure = $derived.by(() => {
        const roots = this.#nabu.children;
        /** @type {Region[]} */ const list = [];
        /** @type {Region[]} */ const tree = [];
        /** @type {Map<string, Region>} */ const byId = new Map();
        /** @type {Map<string, number>} */ const rootIndex = new Map();
        /** @type {Region[]} */ const stack = [];
        /** @type {Map<string, number>} */ const counters = new Map(); // numbering: per (parent, type) or per type
        let preambleEnd = roots.length;

        roots.forEach((block, i) => {
            rootIndex.set(block.id, i);
            if (block.type !== MARKER_TYPE) return;
            const marker = /** @type {RegionBlock} */ (block);
            const type = marker.regionType;
            const def = this.#config.types.get(type);
            const level = def ? def.level : this.#config.maxLevel;
            if (!list.length) preambleEnd = i;

            // Close the regions this marker ends: the ones of the same or a deeper level.
            while (stack.length && stack[stack.length - 1].level >= level) {
                const closed = /** @type {Region} */ (stack.pop());
                closed.end = i;
                if (!closed.children.length) closed.ownEnd = i;
            }
            const region = new Region(this, { marker, def, type, level, position: list.length, start: i });
            const parent = stack.length ? stack[stack.length - 1] : null;
            region.parent = parent;
            (parent ? parent.children : tree).push(region);
            if (parent && parent.children.length === 1) parent.ownEnd = i; // the first sub-region ends the parent's own content

            const numbering = def ? def.numbering : 'none';
            if (numbering !== 'none') {
                const key = numbering === 'document' ? `d|${type}` : `p|${parent ? parent.position : -1}|${type}`;
                region.index = (counters.get(key) ?? 0) + 1;
                counters.set(key, region.index);
            }
            region.path = [...(parent ? parent.path : []), ...(region.index == null ? [] : [region.index])];

            list.push(region);
            byId.set(block.id, region);
            stack.push(region);
        });
        for (const open of stack) {
            open.end = roots.length;
            if (!open.children.length) open.ownEnd = roots.length;
        }
        return { list, tree, preambleEnd, byId, rootIndex };
    });

    /** Running sum of the root blocks' word counts: `prefix[i]` = words of the roots before index `i`. @type {number[]} */
    #prefix = $derived.by(() => {
        const prefix = [0];
        for (const block of this.#nabu.children) prefix.push(prefix[prefix.length - 1] + (block.wordCount ?? 0));
        return prefix;
    });

    /** Every region, in document order. @type {Region[]} */
    get list() { return this.#structure.list; }

    /** The top-level regions; each one holds its `children`. @type {Region[]} */
    get tree() { return this.#structure.tree; }

    /** The number of regions. */
    get count() { return this.#structure.list.length; }

    /**
     * The content before the first marker (the whole document when there is no marker). It is outside any region.
     * @type {Preamble}
     */
    get preamble() { return new Preamble(this, this.#structure.preambleEnd); }

    /**
     * The deepest region containing a block. `target` is a block anywhere in the document (it is resolved to its root
     * block), a marker (which belongs to its own region), an `{ block }` position (as the selection offers), or a root
     * index; omitted = the block holding the selection anchor. `null` in the preamble or when there is nothing to resolve.
     * @param {Block | { block: Block } | number | null} [target]
     * @returns {Region | null}
     */
    at(target) {
        const { list, rootIndex } = this.#structure;
        let index = -1;
        if (typeof target === 'number') index = target;
        else {
            /** @type {Block | null | undefined} */
            let block = target === undefined ? this.#nabu.selection.anchorBlock : (target && typeof (/** @type {any} */ (target)).id === 'string' ? /** @type {Block} */ (target) : /** @type {any} */ (target)?.block);
            while (block?.parent) block = /** @type {Block} */ (block.parent);
            if (block) index = rootIndex.get(block.id) ?? -1;
        }
        if (index < 0 || !list.length) return null;
        // last region starting at or before `index`, then up to the one whose range holds it
        let lo = 0, hi = list.length - 1, found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (list[mid].start <= index) { found = mid; lo = mid + 1; } else hi = mid - 1;
        }
        /** @type {Region | null} */
        let region = found < 0 ? null : list[found];
        while (region && index >= region.end) region = region.parent;
        return region;
    }

    /** The region opened by a marker. @param {Block | string} marker @returns {Region | null} */
    of(marker) {
        return this.#structure.byId.get(typeof marker === 'string' ? marker : marker.id) ?? null;
    }

    /** The region after this one, in document order (a sub-region, then the following sibling…). @param {Region} region @returns {Region | null} */
    next(region) { return this.#structure.list[region.position + 1] ?? null; }

    /** The region before this one, in document order. @param {Region} region @returns {Region | null} */
    prev(region) { return this.#structure.list[region.position - 1] ?? null; }

    /** @param {Region} region @returns {Region | null} */
    parentOf(region) { return region.parent; }

    // ── internals shared with Region / Preamble ─────────────────────────────

    /** @param {number} i @returns {Block | undefined} */
    rootAt(i) { return this.#nabu.children[i]; }

    /** @param {number} from @param {number} to @returns {Block[]} */
    rootsBetween(from, to) { return this.#nabu.children.slice(from, to); }

    /** @param {number} from @param {number} to @returns {number} */
    words(from, to) {
        const prefix = this.#prefix;
        return Math.max(0, (prefix[Math.min(to, prefix.length - 1)] ?? 0) - (prefix[from] ?? 0));
    }
}
