import { LoroMap, LoroText } from "loro-crdt";
import { MegaBlock } from "../megablock.svelte.js";
import { TextBehavior, deltaToHtml, deltaToMarkdown } from "../../behaviors/text";
import RegionComponent from "./Region.svelte";
import { resolveConfig, fieldSpec, validateField } from "./types.js";
import { scanRegion, parseRegionComment, parseRegionHtml, sanitizeFieldDelta, levelOfType } from "./format.js";
import { regionBlockToMarkdown, regionBlockToHtml, closingNeeded, followOf, regionTypeOf } from "./serialize.js";
import { createMessages } from "./messages.js";
import { readDelta } from "../../utils/delta.js";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 * @import { RegionsConfig, FieldSpec } from "./types.js";
 */

/**
 * @typedef {NabuNode<{type: "region", regionType: string, fields: LoroMap, text: LoroText}>} RegionNode
 */

/** A Loro container handler (map, text…). @param {unknown} v @returns {v is any} */
const isContainer = (v) => !!v && typeof v === 'object' && typeof (/** @type {any} */ (v)).kind === 'function';

/**
 * The `fields` map of a region node's data map, created on first use. It is a MERGEABLE child (`ensureMergeableMap`): two peers that
 * each create it concurrently get the same container id, so their writes converge instead of one branch being hidden by the map's
 * LWW. A document written before the mergeable API holds a REGULAR child there: it is returned as-is (`ensureMergeable*` would
 * refuse a slot holding a non-mergeable value). Anything else in the slot (never written by Nabu) is replaced by a regular map.
 * @param {any} data the node's data map @returns {LoroMap}
 */
export function fieldsMap(data) {
    const existing = data.get('fields');
    if (isContainer(existing) && existing.kind() === 'Map') return /** @type {LoroMap} */ (existing);
    try { return /** @type {LoroMap} */ (data.ensureMergeableMap('fields')); }
    catch { return /** @type {LoroMap} */ (data.setContainer('fields', new LoroMap())); }
}

/**
 * Writes `value` into the `fields` map under `name`, following the declared type of the field.
 * Returns false (and writes nothing) when the value is invalid for a declared field.
 * - declared field: validated (see `validateField`); `null` / `undefined` clear it;
 * - the `title` is NOT a field of the map: it is the header text of the block (see RegionBlock);
 * - UNKNOWN field (not declared by the type): kept as-is, whatever it is (it must be Loro-storable).
 * @param {LoroMap} map @param {FieldSpec | undefined} spec @param {string} name @param {unknown} value
 * @returns {boolean}
 */
function writeField(map, spec, name, value) {
    if (!spec) {
        if (value === undefined) map.delete(name); else map.set(name, /** @type {any} */ (value));
        return true;
    }
    const checked = validateField(spec, value);
    if (!checked.ok) return false;
    if (checked.value === undefined) { map.delete(name); return true; }
    if (spec.kind === 'richtext') {
        const existing = map.get(name);
        const text = isContainer(existing) && existing.kind() === 'Text' ? /** @type {LoroText} */ (/** @type {unknown} */ (existing)) : map.setContainer(name, new LoroText());
        if (text.length) text.delete(0, text.length);
        if (checked.value.length) text.applyDelta(sanitizeFieldDelta(checked.value)); // an unsafe link mark never gets stored
        return true;
    }
    map.set(name, checked.value);
    return true;
}

/** A title is one line: line breaks become spaces. @param {string} s @returns {string} */
const oneLine = (s) => s.replace(/\s*[\r\n]+\s*/g, ' ');

/** A title delta: text runs only, on one line. @param {unknown} delta @returns {{ insert: string, attributes?: Record<string, any> }[]} */
const titleDelta = (delta) => /** @type {{ insert: string, attributes?: Record<string, any> }[]} */ (Array.isArray(delta) ? delta : [])
    .filter((op) => op && typeof op.insert === 'string' && op.insert)
    .map((op) => ({ ...op, insert: oneLine(op.insert) }));

/**
 * A region (ADR 018 §3.1): a CONTAINER block, like the toggle. Its HEADER is its TITLE (a LoroText under the data key `text`,
 * inline marks allowed, edited in place in the seam); its BODY is its children: any blocks, and sub-regions. It also stores
 *  - `regionType`  the id of a declared region type;
 *  - `fields`      a LoroMap holding the fields the type declares.
 * Its level, label, number and parent region are NOT stored: they are derived from the document by the `Regions` registry
 * (`nabu.regions`).
 *
 * The title behaves as a LOCKED FIELD (ADR 018 §3.9) although it is stored as text: Enter never splits it (the caret goes to
 * the body), Backspace at its start and Delete at its end do nothing (the protected merge is a command), a multi-block paste
 * lands flat, and no text merge goes into or out of it (the `onBeforeMerge` veto of the extension).
 *
 * The configuration (declared types) is carried by the class (`static config`): `RegionsExtension(options)` builds a
 * subclass bound to its options, as `createDialogueExtension` does for the dash.
 */
// @ts-ignore — static-side variance on create() (same pattern as the Toggle)
export class RegionBlock extends MegaBlock {
    /** @type {RegionsConfig} */
    static config = resolveConfig();

    /** Texts of the integrator (`RegionsExtension({ messages })`), for the placeholder of the title. @type {import('./messages.js').RegionMessages | undefined} */
    static messages = undefined;

    /** The placeholder of an empty title (the `untitled` message). @param {RegionBlock} block */
    static placeholder = (block) => createMessages(/** @type {typeof RegionBlock} */ (block.constructor).messages)('untitled');

    /** @param {Nabu} nabu @param {RegionNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);

        this.#read();
        // Local commits, imports and remote peers all end up here (the `fields` map is a child container of `data`).
        node.data.subscribe(() => this.#read());

        // Document export: exact round trip (`importJSON` reads `props` and `content` back, see RegionBlock.create).
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'region',
            props: this.exportProps,
            content: this.behavior.toJSON(),
            children: this.children.map(c => c.serialize('json')).filter(Boolean)
        }));
        this.serializers.set('application/x-nabu+json', () => ({
            type: 'region',
            props: this.exportProps,
            delta: this.container.sliceDelta(0, this.container.length),
            children: this.children.map(c => c.serialize('application/x-nabu+json')).filter(Boolean)
        }));
        // Markdown: the data comment + the title as a heading + the body (+ the closing comment when needed, see serialize.js).
        // `context.tail` is what follows the PARENT region (set by a parent region for its children, see `#markdown`).
        this.serializers.set('markdown', (/** @type {{ tail?: import('./serialize.js').Follow }} */ context = {}) => this.#markdown(context.tail ?? 'end'));
    }

    /**
     * The markdown of this region. Whether it closes depends on what follows it in the text: the next siblings (read lazily,
     * a region is compared by level without being serialized), else what follows the parent (`tail`). Its body is told what
     * follows ITS last child: the closing comment of this region when it writes one, else what follows this region.
     * @param {import('./serialize.js').Follow} tail
     * @returns {string}
     */
    #markdown(tail) {
        const config = this.config;
        const siblings = /** @type {any[]} */ (this.parent?.children ?? this.nabu.children);
        const at = siblings.indexOf(this);
        const after = (function* () {
            for (let k = at + 1; at >= 0 && k < siblings.length; k++) {
                const next = siblings[k];
                yield next.type === 'region' ? { region: levelOfType(config, regionTypeOf(config, { regionType: next.regionType })) } : String(next.serialize('markdown') ?? '');
            }
        })();
        const follow = followOf(after, tail);
        const close = closingNeeded(config, regionTypeOf(config, { regionType: this.regionType }), follow);
        const body = this.children.map(c => String(c.serialize('markdown', { tail: close ? 'close' : follow }) ?? ''));
        return regionBlockToMarkdown(config, this.exportProps, this.behavior.toMarkdown(), body, { close });
    }

    // ── Capability flags ────────────────────────────────────────────────────
    // No `# ` & co in a title (like the toggle header); marks stay allowed.
    transformsEnabled = false;
    // The title is an isolated field (ADR 018 §3.9): a selection that is not entirely in it never touches its text (core rule,
    // see `Block#isolatesSelection`); the caret enters it at its start going down / right.
    isolatesSelection = true;

    /** @type {RegionsConfig} */
    get config() { return /** @type {typeof RegionBlock} */ (this.constructor).config; }

    component = $derived(this.nabu.components.get("region") || RegionComponent);

    get text() { return this.behavior.text; }
    get delta() { return this.behavior.delta; }

    selection = $derived(this.behavior.selection);

    // The title first, then the body
    positions = $derived(this.behavior.positions + this.children.reduce((sum, child) => sum + (child.positions ?? 0), 0));

    // How many blocks the body holds, roughly (a sub-region counts its own body, any other container its direct children): the estimate
    // of the height of a body that the browser skips while it is off screen (Region.svelte, large documents). Reactive in the structure only.
    /** @type {number} */
    weight = $derived(this.children.reduce((/** @type {number} */ sum, /** @type {any} */ c) => sum + 1 + (c instanceof RegionBlock ? c.weight : (c.children?.length ?? 0)), 0));

    // Words of the BODY only: a title is a label, not prose, so neither this region's title nor the titles of its sub-regions
    // (each sub-region block counts its own body the same way) are counted.
    wordCount = $derived(this.children.reduce((s, c) => s + (c.wordCount ?? 0), 0));

    /**
     * Mixed block (like the toggle): the title comes first, then the body. The caret never gets collapsed away.
     * @param {number} localOffset
     * @returns {{ block: import('../block.svelte.js').Block, offset: number } | null}
     */
    resolveOffset(localOffset) {
        const textPositions = this.behavior.positions; // text.length + 1
        if (localOffset < textPositions || !this.children.length) {
            return { block: this, offset: Math.min(localOffset, this.behavior.text.length) };
        }
        let remaining = localOffset - textPositions;
        for (const child of this.children) {
            const cp = child.positions ?? 0;
            if (remaining < cp) return child.resolveOffset(remaining);
            remaining -= cp;
        }
        return { block: this, offset: this.behavior.text.length };
    }

    /** The id of the region type (`''` while unset). Reactive. @type {string} */
    regionType = $state('');

    /** The stored fields, as plain JSON (LoroText → string), before validation. @type {Record<string, any>} */
    #raw = $state.raw({});

    /**
     * The fields, typed by the declaration of the region type. Reactive.
     *  - `title` is always there: the plain text of the header (`''` when empty);
     *  - a declared field holds its value, or `null` when it is unset OR holds something of the wrong type
     *    (the stored value is kept untouched; `richtext` reads as its plain string, see `richtext(name)`);
     *  - a field the type does NOT declare is returned as-is.
     * @type {Record<string, any>}
     */
    fields = $derived.by(() => {
        const def = this.config.types.get(this.regionType);
        const raw = this.#raw;
        /** @type {Record<string, any>} */
        const out = {};
        for (const [name, value] of Object.entries(raw)) {
            if (name === 'title' || fieldSpec(def, name)) continue; // `title` is the header; declared fields are typed below
            out[name] = value;
        }
        out.title = this.behavior.text;
        for (const [name, spec] of def?.fields ?? []) {
            const v = raw[name];
            if (spec.kind === 'richtext') { out[name] = typeof v === 'string' ? v : null; continue; }
            const checked = validateField(spec, v);
            out[name] = checked.ok && checked.value !== undefined ? checked.value : null;
        }
        return out;
    });

    /** The title: the plain text of the header. Reactive. @type {string} */
    get title() { return this.behavior.text; }

    #read() {
        const data = /** @type {any} */ (this.node.data);
        this.regionType = data.get('regionType') || '';
        const map = data.get('fields');
        this.#raw = isContainer(map) && map.kind() === 'Map' ? map.toJSON() : {};
    }

    /** The fields as stored, richtext as Loro deltas: what a document / clipboard export writes. The title is the header, never a field. @returns {Record<string, any>} */
    get exportFields() {
        const map = /** @type {any} */ (this.node.data).get('fields');
        /** @type {Record<string, any>} */
        const out = {};
        if (!isContainer(map) || map.kind() !== 'Map') return out;
        for (const key of map.keys()) {
            if (key === 'title') continue;
            const v = map.get(key);
            out[key] = isContainer(v) ? (v.kind() === 'Text' ? readDelta(/** @type {any} */ (v)) : v.toJSON()) : v;
        }
        return out;
    }

    /** @returns {{ regionType: string, fields: Record<string, any> }} */
    get exportProps() { return { regionType: this.regionType, fields: this.exportFields }; }

    /** What the clipboard form of a (partially) selected region carries besides its title and children. */
    get clipboardProps() { return this.exportProps; }

    /**
     * The LoroText behind a `richtext` field (to read its delta / marks, or to bind an editor), or null.
     * @param {string} name
     * @returns {LoroText | null}
     */
    richtext(name) {
        const map = /** @type {any} */ (this.node.data).get('fields');
        const v = isContainer(map) && map.kind() === 'Map' ? map.get(name) : null;
        return isContainer(v) && v.kind() === 'Text' ? /** @type {LoroText} */ (/** @type {unknown} */ (v)) : null;
    }

    /** Replaces the header text (plain, one line). No commit; the reactive text is refreshed right away. @param {string} value */
    #setTitle(value) {
        const text = this.container;
        if (text.length) text.delete(0, text.length);
        if (value) text.insert(0, oneLine(value));
        this.behavior.text = text.toString();
        this.behavior.delta = readDelta(text);
    }

    /**
     * Sets (or, with `null` / `undefined`, clears) a field. The `title` is the header text: setting it replaces that text
     * (marks are dropped). A declared field is validated (see `validateField`): an invalid value is refused (returns false,
     * warns, nothing is written). A field the type does not declare is stored as-is. Own undo step like any commit.
     * @param {string} name @param {unknown} value
     * @param {{ commit?: boolean }} [options] `commit: false` leaves the transaction open (the caller commits)
     * @returns {boolean} whether the value was written
     */
    setField(name, value, { commit = true } = {}) {
        if (name === 'title') {
            if (value != null && typeof value !== 'string') {
                this.nabu.warn(`Region title refused a non-string value: ${JSON.stringify(value)}`);
                return false;
            }
            this.#setTitle(value ?? '');
            if (commit) this.commit();
            return true;
        }
        const data = /** @type {any} */ (this.node.data);
        const spec = fieldSpec(this.config.types.get(this.regionType), name);
        if (spec && !validateField(spec, value).ok) {
            this.nabu.warn(`Region field "${name}" (${spec.kind}) refused an invalid value: ${JSON.stringify(value)}`);
            return false;
        }
        const map = fieldsMap(data);
        writeField(map, spec, name, value);
        this.#read();
        if (commit) this.commit();
        return true;
    }

    /**
     * Changes the type of this region (its level follows). The fields are kept: those the new type does not declare
     * remain stored as unknown fields. An unknown type id is refused.
     * @param {string} regionType
     * @param {{ commit?: boolean }} [options]
     * @returns {boolean}
     */
    setRegionType(regionType, { commit = true } = {}) {
        if (!this.config.types.has(regionType)) {
            this.nabu.warn(`Region type "${regionType}" is not declared.`);
            return false;
        }
        /** @type {any} */ (this.node.data).set('regionType', regionType);
        this.#read();
        if (commit) this.commit();
        return true;
    }

    // ── Proxies to TextBehavior ─────────────────────────────────────────────

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

    // ── The title is a locked field (ADR 018 §3.9) ──────────────────────────

    /** The body is free-form: an empty paragraph of the body takes the type of a whole block pasted into it. */
    get adoptsPastedTypes() { return true; }

    /**
     * Enter in the title: it is never split. The caret goes to the start of the body: into its first child when that one is
     * an empty default paragraph, else into a NEW empty paragraph inserted at the top of the body. One undo step.
     */
    #enterBody() {
        const nabu = this.nabu;
        const defaultType = nabu.defaultBlockType && nabu.registry.has(nabu.defaultBlockType) ? nabu.defaultBlockType : 'paragraph';
        const first = /** @type {any} */ (this.children[0]);
        if (first && first.type === defaultType && !first.children?.length && first.behaviors.get('text')?.text === '') {
            nabu.selection.setCursor(first, 0);
            return;
        }
        const created = nabu.insert(defaultType, {}, this.node.id.toString(), 0);
        nabu.commit().then(() => {
            const fresh = nabu.blocks.get(created.id);
            if (fresh) nabu.selection.setCursor(fresh, 0);
        });
    }

    /**
     * Paste with the caret in the TITLE (text only, flat). Several blocks (or a container): the text of every pasted text
     * block, depth first, joined by a single space, goes into the title at the caret, marks kept; nothing goes to the
     * body. One pasted text block is the engine's inline paste (declined). Blocks without text (an image…) are dropped.
     * @param {import('../../utils/extensions.js').PasteBlock[]} blocks
     * @param {{ offset: number }} ctx
     * @returns {{ block: RegionBlock, offset: number } | null}
     */
    acceptPaste(blocks, ctx) {
        if (!blocks?.length || (blocks.length === 1 && !blocks[0].children?.length)) return null;
        /** @type {{ insert: string, attributes?: Record<string, any> }[]} */
        const flat = [];
        let length = 0;
        /** @param {import('../../utils/extensions.js').PasteBlock[]} list */
        const walk = (list) => {
            for (const pb of list) {
                const delta = titleDelta(pb.delta);
                if (delta.length && delta.some((op) => op.insert.trim())) {
                    if (flat.length) { flat.push({ insert: ' ' }); length += 1; }
                    flat.push(...delta);
                    length += delta.reduce((n, op) => n + op.insert.length, 0);
                }
                if (pb.children?.length) walk(pb.children);
            }
        };
        walk(blocks);
        if (flat.length) this.behavior.applyDelta([{ retain: ctx.offset }, ...flat]);
        return { block: this, offset: ctx.offset + length };
    }

    /**
     * @param {InputEvent} event
     * @returns {boolean}
     */
    beforeinput(event) {
        const sel = this.behavior.selection;

        // The selection lies in the BODY (across several of its blocks, the title is outside the range): the container handles it.
        const live = this.nabu.selection;
        if (!sel && live?.anchorBlock && live.anchorBlock !== this && live.focusBlock && live.focusBlock !== this) return super.beforeinput(event);

        // Enter: never splits the title; the caret goes to the body (the selection, if any, is left alone).
        if (event.inputType === 'insertParagraph') {
            this.#enterBody();
            return true;
        }

        // Backspace at the very start / Delete at the very end: nothing merges into or out of a title. (The protected
        // merge with the neighbouring region is a command; any other attempt meets the `onBeforeMerge` veto.)
        if (sel?.isCollapsed) {
            if (event.inputType === 'deleteContentBackward' && sel.from === 0) return true;
            if (event.inputType === 'deleteContentForward' && sel.from === this.behavior.text.length) return true;
        }

        return this.behavior.handleBeforeInput(event);
    }

    // ── Statics ─────────────────────────────────────────────────────────────

    /**
     * Clipboard `text/plain` (several blocks) and static export: the data comment, the title as a heading, the body, and the
     * closing comment when what follows would be swallowed (serialize.js). `after` (the following siblings) and `tail` (what
     * follows the parent) are the neighbour context the engine hands to every serializer.
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse?: (child: import('../../utils/extensions.js').PasteBlock, ctx?: object) => string, recurseAll?: (children: import('../../utils/extensions.js').PasteBlock[], ctx?: object) => string[], after?: import('../../utils/extensions.js').PasteBlock[], tail?: import('./serialize.js').Follow }} [helpers]
     */
    static toMarkdown(pb, { recurse, recurseAll, after = [], tail = 'end' } = {}) {
        const config = this.config;
        const props = pb.props ?? {};
        const next = (function* () {
            for (const sibling of after) {
                yield sibling.type === 'region' ? { region: levelOfType(config, regionTypeOf(config, sibling.props ?? {})) } : (recurse ? recurse(sibling) : '');
            }
        })();
        const follow = followOf(next, tail);
        const close = closingNeeded(config, regionTypeOf(config, props), follow);
        const children = pb.children || [];
        const ctx = { tail: close ? 'close' : follow };
        const body = recurseAll ? recurseAll(children, ctx) : children.map(c => recurse ? recurse(c, ctx) : '');
        return regionBlockToMarkdown(config, props, deltaToMarkdown(pb.delta || []), body, { close });
    }

    /**
     * Clipboard `text/html`: a `<section>` carrying the data, the title as a heading, the body (serialize.js).
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse?: (child: import('../../utils/extensions.js').PasteBlock) => string }} [helpers]
     */
    static toHtml(pb, { recurse } = {}) {
        const body = (pb.children || []).map(c => recurse ? recurse(c) : '');
        return regionBlockToHtml(this.config, pb.props ?? {}, deltaToHtml(pb.delta || []), body);
    }

    /**
     * Markdown rules (paste AND `importMarkdown`): the opening data comment (exact form, see format.js). `detect` is cheap (one
     * line); `consume` computes the extent of the region (`scanRegion`: explicit close, next opening of the same or a higher
     * level, end of the lines), and `fromMarkdown` reads the title and parses the body as a document of its own, exactly like
     * the toggle, so sub-regions nest by recursion. A stray `<!-- /region -->` (nothing to close) is not a rule: literal text.
     */
    static get markdownRules() {
        const config = this.config;
        return [{
            priority: 20,
            interruptsParagraph: true,
            detect: (/** @type {string} */ line) => !!parseRegionComment(config, line),
            consume: (/** @type {string[]} */ lines, /** @type {number} */ i) => (scanRegion(config, lines, i)?.end ?? i) - i,
        }];
    }

    /**
     * The region: type and fields from the comment, the title (inline markdown) from the heading right after it, the body
     * (the lines up to the end of the region, closing comment excluded) parsed as a document of its own.
     * @param {string[]} lines  exactly the lines `consume` took
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[], parseBlocks?: (lines: string[]) => import('../../utils/extensions.js').PasteBlock[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline, parseBlocks }) {
        const region = scanRegion(this.config, lines, 0);
        if (!region) return null;
        const children = parseBlocks ? parseBlocks(lines.slice(region.bodyStart, region.bodyEnd)) : [];
        return {
            type: 'region',
            props: { regionType: region.regionType, fields: region.fields },
            delta: region.title ? parseInline(region.title) : [],
            partial: false,
            ...(children.length ? { children } : {}),
        };
    }

    /**
     * HTML rules (paste): `<section data-nabu-region="type">` with a plausible type id. A `<section>` without it, or with an
     * empty / absurd one, is not matched: it stays a transparent wrapper, as before.
     */
    static get htmlRules() {
        return [{
            selector: 'section[data-nabu-region]',
            priority: 100,
            filter: (/** @type {Element} */ el) => { const id = el.getAttribute('data-nabu-region')?.trim() ?? ''; return id.length > 0 && id.length <= 200; },
        }];
    }

    /**
     * The region of a `<section data-nabu-region>`: type and fields from the attributes (invalid fields = no fields, never
     * markup), the title from the heading (`h1`-`h6`) that is its FIRST element child (inline), the body from the other
     * children, read like the toggle's.
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[], parseChildren?: (el: Element) => import('../../utils/extensions.js').PasteBlock[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseInline, parseChildren }) {
        const parsed = parseRegionHtml(this.config, el);
        if (!parsed) return null;
        const [first, ...rest] = [...el.children];
        const hasTitle = !!first && /^h[1-6]$/i.test(first.tagName);
        const delta = hasTitle ? parseInline(first) : [];
        const bodyEls = hasTitle ? rest : [first, ...rest].filter(Boolean);
        /** @type {import('../../utils/extensions.js').PasteBlock[]} */
        let children = [];
        const ownerDoc = el.ownerDocument;
        if (parseChildren && bodyEls.length && ownerDoc) {
            const wrapper = ownerDoc.createElement('div');
            for (const bodyEl of bodyEls) wrapper.appendChild(bodyEl.cloneNode(true));
            children = parseChildren(wrapper);
        }
        return {
            type: 'region',
            props: { regionType: parsed.regionType, fields: parsed.fields },
            delta,
            partial: false,
            ...(children.length ? { children } : {}),
        };
    }

    /**
     * @param {Nabu} nabu @param {string} type
     * @param {{ regionType?: string, title?: string, text?: string, delta?: import('loro-crdt').Delta<string>[], fields?: Record<string, any> }} [props={}]
     *   `regionType` defaults to the lowest-level declared type. The TITLE (the header text) comes from `delta`, else `text`,
     *   else `title`, else `fields.title`: it is never stored in the `fields` map. Invalid values for declared fields are
     *   dropped (warning); unknown fields are kept as-is.
     * @param {string|null} [parentId=null] @param {number|null} [index=null]
     * @returns {RegionBlock}
     */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const config = this.config;
        const node = nabu.tree.createNode(/** @type {import('loro-crdt').TreeID | undefined} */ (parentId || undefined), index ?? undefined);
        const data = /** @type {any} */ (node.data);
        const regionType = typeof props.regionType === 'string' && props.regionType ? props.regionType : config.defaultType;
        data.set("type", "region");
        data.set("regionType", regionType);
        const map = fieldsMap(data);
        const text = /** @type {LoroText} */ (data.setContainer("text", new LoroText()));
        const def = config.types.get(regionType);
        const { title: fieldsTitle, ...values } = props.fields && typeof props.fields === 'object' ? props.fields : /** @type {Record<string, any>} */ ({});
        for (const [name, value] of Object.entries(values)) {
            if (!writeField(map, fieldSpec(def, name), name, value)) {
                nabu.warn(`Region field "${name}" dropped: invalid value ${JSON.stringify(value)} for its declared type.`);
            }
        }
        const delta = titleDelta(props.delta);
        const plain = [props.text, props.title, fieldsTitle].find((v) => typeof v === 'string' && v);
        if (delta.length) text.applyDelta(delta);
        else if (plain) text.insert(0, oneLine(plain));
        return new this(nabu, /** @type {RegionNode} */ (/** @type {unknown} */ (node)));
    }
}
