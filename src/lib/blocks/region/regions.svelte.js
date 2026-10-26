import { formatLabel, resolveConfig } from "./types.js";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { RegionBlock } from "./region.svelte.js";
 * @import { RegionsConfig, RegionTypeDef } from "./types.js";
 */

/** Block type of a region (the registry detects regions by it, without importing the block class). */
const REGION_TYPE = 'region';

/**
 * One division of the document, as computed by the registry (ADR 018 §3.4). A read-only VIEW over a region BLOCK, a container
 * of the tree: the structure (`level`, `parent`, `children`, `index`, `path`) is derived from the tree; `title` / `fields` /
 * `label` / `blocks` / `wordCount` read reactive state when you read them.
 *
 * A region is a `region` block at the root of the document or directly in the body of another region. Its BODY is the
 * children of its block: any blocks, sub-regions included.
 */
export class Region {
    /**
     * @param {Regions} registry
     * @param {{ block: RegionBlock, def: RegionTypeDef | undefined, type: string, level: number, position: number }} init
     */
    constructor(registry, { block, def, type, level, position }) {
        /** The region block. @type {RegionBlock} */
        this.block = block;
        /** The declared type, or `undefined` when the block's type is not declared (a document from a richer editor). @type {RegionTypeDef | undefined} */
        this.def = def;
        /** The region type id. */
        this.type = type;
        /** Depth, 1 = highest. A region whose type is not declared gets the deepest declared level. */
        this.level = level;
        /** Rank among all regions, in document order (0-based). */
        this.position = position;
        /** The number within its numbering scope (see `numbering` in ADR 016 §3.2), `null` when not numbered. @type {number | null} */
        this.index = null;
        /** The indexes of the numbered ancestors, then of this region ([2, 1]). @type {number[]} */
        this.path = [];
        /** The nearest region ancestor. @type {Region | null} */ this.parent = null;
        /** The direct sub-regions, in order. @type {Region[]} */ this.children = [];
    }

    /** Alias of {@link Region#block}, from the time a region was a marker. @type {RegionBlock} */
    get marker() { return this.block; }

    /** The path as text ("2.1"; empty when nothing on the way is numbered). */
    get pathString() { return this.path.join('.'); }

    /** The fields of the region (reactive); `title` is the plain text of the header. @type {Record<string, any>} */
    get fields() { return this.block.fields; }

    /** The title: the plain text of the header (reactive). */
    get title() { return this.block.title; }

    /** @param {string} title */
    #format(title) {
        return formatLabel(this.def?.label ?? '{title}', {
            index: this.index, path: this.pathString, title, type: this.type, level: this.level,
        });
    }

    /** The label template applied ("1.1 The ferryman"). Reactive (the title). Empty when the template yields nothing. */
    get label() { return this.#format(this.title); }

    /** The label template applied with an EMPTY title ("1.1", "Chapter 2"): what the seam shows before the editable title. Empty when the template holds only the title. */
    get prefix() { return this.#format(''); }

    /** The direct children of the body (sub-regions included). Reactive. @type {Block[]} */
    get blocks() { return this.block.children; }

    /** The direct children of the body that are not regions: the region's own content. Reactive. @type {Block[]} */
    get ownBlocks() { return this.block.children.filter((b) => b.type !== REGION_TYPE); }

    /** Words of the body (the title excluded, sub-regions included), summed from the blocks' own `wordCount` (no rendering). Reactive. */
    get wordCount() { return this.block.children.reduce((sum, b) => sum + (b.wordCount ?? 0), 0); }

    /** Words of the region's own content (sub-regions excluded). Reactive. */
    get ownWordCount() { return this.ownBlocks.reduce((sum, b) => sum + (b.wordCount ?? 0), 0); }

    /** Sets a field of the region (validated, own undo step); `title` replaces the header text. @param {string} name @param {unknown} value */
    setField(name, value) { return this.block.setField(name, value); }
}

/**
 * The content before the first root region: outside any region (ADR 018 §3.3).
 */
export class Preamble {
    /** @param {Block[]} blocks */
    constructor(blocks) {
        /** The root blocks before the first root region. @type {Block[]} */
        this.blocks = blocks;
    }
    /** Root index just after the last block of the preamble (exclusive). */
    get end() { return this.blocks.length; }
    get wordCount() { return this.blocks.reduce((sum, b) => sum + (b.wordCount ?? 0), 0); }
}

/**
 * Document-level reactive registry of the regions (ADR 018 §3.4): a pure, derived view over the TREE (stores nothing in
 * Loro). Lazy and cheap: ONE pass over the root blocks and the bodies of the regions builds everything, and it only re-runs
 * when the STRUCTURE changes (a region inserted / moved / deleted / retyped, a child added to a region body), not when
 * text is typed. Obtain it with `Regions.get(nabu)`; `RegionsExtension` also installs it as `nabu.regions`.
 */
export class Regions {
    /** @type {Nabu} */ #nabu;
    /** @type {RegionsConfig} */ #config;

    /** Whether the editor of this registry holds the focus (set by `focusin` / `focusout`, see {@link Regions#start}). */
    #focused = $state(false);
    /** @type {(() => void) | null} */
    #stopFocus = null;

    /** @param {Nabu} nabu @param {RegionsConfig} config */
    constructor(nabu, config) { this.#nabu = nabu; this.#config = config; }

    /**
     * System hook (`nabu.systems`, called when the editor mounts): follows the focus of the editor, for {@link Regions#caret}.
     * Idempotent.
     */
    start() {
        if (this.#stopFocus || typeof document === 'undefined') return;
        /** @param {EventTarget | null} target */
        const inEditor = (target) => target instanceof Element && !!target.closest('[data-nabu-root]');
        const onIn = (/** @type {FocusEvent} */ e) => { this.#focused = inEditor(e.target); };
        const onOut = (/** @type {FocusEvent} */ e) => { this.#focused = inEditor(e.relatedTarget); }; // no related target: the focus left the page or went nowhere
        document.addEventListener('focusin', onIn);
        document.addEventListener('focusout', onOut);
        this.#focused = inEditor(document.activeElement);
        this.#stopFocus = () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut); };
    }

    /** System hook: stops following the focus. */
    stop() {
        this.#stopFocus?.();
        this.#stopFocus = null;
        this.#focused = false;
    }

    /**
     * @param {Nabu} nabu
     * @returns {Regions}
     */
    static get(nabu) {
        if (!nabu.systems.has('regions')) {
            const config = /** @type {any} */ (nabu.registry.get(REGION_TYPE))?.config ?? resolveConfig();
            nabu.systems.set('regions', new Regions(nabu, config));
        }
        return /** @type {Regions} */ (nabu.systems.get('regions'));
    }

    /** The resolved configuration (declared types). */
    get config() { return this.#config; }

    /** The one pass. @type {{ list: Region[], tree: Region[], preamble: Preamble, byId: Map<string, Region> }} */
    #structure = $derived.by(() => {
        /** @type {Region[]} */ const list = [];
        /** @type {Region[]} */ const tree = [];
        /** @type {Map<string, Region>} */ const byId = new Map();
        /** @type {Map<string, number>} */ const counters = new Map(); // numbering: per (parent, type) or per type
        const roots = this.#nabu.children;

        /** @param {Block[]} blocks @param {Region | null} parent */
        const walk = (blocks, parent) => {
            for (const block of blocks) {
                if (block.type !== REGION_TYPE) continue; // a region lives at the root or in a region body, nowhere else
                const regionBlock = /** @type {RegionBlock} */ (block);
                const type = regionBlock.regionType;
                const def = this.#config.types.get(type);
                const level = def ? def.level : this.#config.maxLevel;
                const region = new Region(this, { block: regionBlock, def, type, level, position: list.length });
                region.parent = parent;
                (parent ? parent.children : tree).push(region);

                const numbering = def ? def.numbering : 'none';
                if (numbering !== 'none') {
                    const key = numbering === 'document' ? `d|${type}` : `p|${parent ? parent.position : -1}|${type}`;
                    region.index = (counters.get(key) ?? 0) + 1;
                    counters.set(key, region.index);
                }
                region.path = [...(parent ? parent.path : []), ...(region.index == null ? [] : [region.index])];

                list.push(region);
                byId.set(block.id, region);
                walk(regionBlock.children, region);
            }
        };
        walk(roots, null);

        const firstRegion = roots.findIndex((b) => b.type === REGION_TYPE);
        return { list, tree, preamble: new Preamble(firstRegion < 0 ? [...roots] : roots.slice(0, firstRegion)), byId };
    });

    /** Every region, in document order (pre-order of the tree). @type {Region[]} */
    get list() { return this.#structure.list; }

    /** The top-level regions; each one holds its `children`. @type {Region[]} */
    get tree() { return this.#structure.tree; }

    /** The number of regions. */
    get count() { return this.#structure.list.length; }

    /**
     * The root blocks before the first root region (the whole document when there is no region). They are outside any region.
     * @type {Preamble}
     */
    get preamble() { return this.#structure.preamble; }

    /**
     * The deepest region containing a block: its nearest region ancestor, the block itself when it is a region. `target` is a
     * block or an `{ block }` position (as the selection offers); omitted = the block holding the selection anchor. `null`
     * outside any region (the preamble) or when there is nothing to resolve.
     * @param {Block | { block: Block } | null} [target]
     * @returns {Region | null}
     */
    at(target) {
        /** @type {Block | null | undefined} */
        let block = target === undefined
            ? this.#nabu.selection.anchorBlock
            : (target && typeof (/** @type {any} */ (target)).id === 'string' ? /** @type {Block} */ (target) : /** @type {any} */ (target)?.block);
        const { byId } = this.#structure;
        for (; block; block = /** @type {Block | null} */ (block.parent)) {
            const region = byId.get(block.id);
            if (region) return region;
        }
        return null;
    }

    /**
     * The region that shows the caret: the DEEPEST region holding the selection anchor (a title counts), only while the editor has
     * the focus. `null` otherwise. Reactive; computed once for all the regions (each `Region.svelte` compares itself to it).
     * @type {Region | null}
     */
    caret = $derived.by(() => (this.#focused ? this.at() : null));

    /** The region of a region block. @param {Block | string} block @returns {Region | null} */
    of(block) {
        return this.#structure.byId.get(typeof block === 'string' ? block : block.id) ?? null;
    }

    /** The region after this one, in document order (a sub-region, then the following sibling…). @param {Region} region @returns {Region | null} */
    next(region) { return this.#structure.list[region.position + 1] ?? null; }

    /** The region before this one, in document order. @param {Region} region @returns {Region | null} */
    prev(region) { return this.#structure.list[region.position - 1] ?? null; }

    /** @param {Region} region @returns {Region | null} */
    parentOf(region) { return region.parent; }
}
