import { LoroMap, LoroText } from "loro-crdt";
import { MegaBlock } from "../megablock.svelte.js";
import { TextBehavior, deltaToHtml, deltaToMarkdown } from "../../behaviors/text";
import RegionComponent from "./Region.svelte";
import { resolveConfig, fieldSpec, validateField } from "./types.js";
import { parseRegionMarkdown, parseRegionHtml, sanitizeFieldDelta } from "./format.js";
import { regionBlockToMarkdown, regionBlockToHtml } from "./serialize.js";
import { createMessages } from "./messages.js";

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
        // Markdown: the data comment + the title as a heading + the body (see serialize.js).
        this.serializers.set('markdown', () => regionBlockToMarkdown(this.config, this.exportProps, this.behavior.toMarkdown(), /** @type {any} */ (this.children.map(c => c.serialize('markdown')))));
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

    // Words of the title + the body
    wordCount = $derived((this.behavior?.wordCount ?? 0) + this.children.reduce((s, c) => s + (c.wordCount ?? 0), 0));

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
            out[key] = isContainer(v) ? (v.kind() === 'Text' ? /** @type {any} */ (v).toDelta() : v.toJSON()) : v;
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
        this.behavior.delta = text.toDelta();
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
        const map = /** @type {LoroMap} */ (data.getOrCreateContainer('fields', new LoroMap()));
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
     * Clipboard `text/plain` (several blocks) and static export: the data comment, the title as a heading, the body (serialize.js).
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse?: (child: import('../../utils/extensions.js').PasteBlock, ctx?: object) => string, recurseAll?: (children: import('../../utils/extensions.js').PasteBlock[], ctx?: object) => string[] }} [helpers]
     */
    static toMarkdown(pb, { recurse, recurseAll } = {}) {
        const children = pb.children || [];
        const body = recurseAll ? recurseAll(children) : children.map(c => recurse ? recurse(c) : '');
        return regionBlockToMarkdown(this.config, pb.props ?? {}, deltaToMarkdown(pb.delta || []), body);
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

    // TODO(ADR-018 lot C): markdown / HTML IMPORT. The rules are disabled (a region is exported, not yet read back: the
    // reading side must build the title and the body, and infer where the region ends). The detection below is the old
    // marker format, kept as the starting point of the rewrite.

    /** Markdown rules (paste AND `importMarkdown`): none for now, see the TODO above. */
    static get markdownRules() {
        return [];
    }

    /**
     * The old marker form: the exact data comment `<!-- region:<type> {json} -->` (+ the heading line after it).
     * Not reachable while `markdownRules` is empty.
     * @param {string[]} lines
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines) {
        const parsed = parseRegionMarkdown(this.config, lines, 0);
        return parsed ? { type: 'region', props: { regionType: parsed.regionType, fields: parsed.fields }, partial: false } : null;
    }

    /** HTML rules (paste): none for now, see the TODO above. */
    static get htmlRules() {
        return [];
    }

    /**
     * The old marker form: an element carrying `data-nabu-region`. Not reachable while `htmlRules` is empty.
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el) {
        const parsed = parseRegionHtml(this.config, el);
        return parsed ? { type: 'region', props: { regionType: parsed.regionType, fields: parsed.fields }, partial: false } : null;
    }

    /**
     * @param {Nabu} nabu @param {string} type
     * @param {{ regionType?: string, title?: string, text?: string, delta?: import('loro-crdt').Delta<string>[], fields?: Record<string, any> }} [props={}]
     *   `regionType` defaults to the lowest-level declared type. The TITLE (the header text) comes from `delta`, else `text`,
     *   else `title`, else `fields.title`: it is never stored in the `fields` map. Invalid values for declared fields are
     *   dropped (warning); unknown fields are kept as-is.
     * @param {string|null} [parentId=null] @param {number|null} [index=null]
     */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const config = this.config;
        const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index ?? undefined);
        const data = /** @type {any} */ (node.data);
        const regionType = typeof props.regionType === 'string' && props.regionType ? props.regionType : config.defaultType;
        data.set("type", "region");
        data.set("regionType", regionType);
        const map = /** @type {LoroMap} */ (data.setContainer("fields", new LoroMap()));
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
