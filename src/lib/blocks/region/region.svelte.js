import { LoroMap, LoroText } from "loro-crdt";
import { Block } from "../block.svelte.js";
import RegionComponent from "./Region.svelte";
import { resolveConfig, fieldSpec, validateField } from "./types.js";
import { Regions } from "./regions.svelte.js";
import { regionToMarkdown, regionToHtml, parseRegionMarkdown, parseRegionHtml, sanitizeFieldDelta } from "./format.js";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 * @import { RegionsConfig, FieldSpec } from "./types.js";
 */

/**
 * @typedef {NabuNode<{type: "region", regionType: string, fields: LoroMap}>} RegionNode
 */

/** A Loro container handler (map, text…). @param {unknown} v @returns {v is any} */
const isContainer = (v) => !!v && typeof v === 'object' && typeof (/** @type {any} */ (v)).kind === 'function';

/**
 * Writes `value` into the `fields` map under `name`, following the declared type of the field.
 * Returns false (and writes nothing) when the value is invalid for a declared field.
 * - declared field: validated (see `validateField`); `null` / `undefined` clear it;
 * - the base `title`: a string;
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

/**
 * The marker of a region (ADR 016 §3.1): a VOID block, like the divider. No text; the caret steps over it
 * (one position, `getDOMPoint` null). It stores two things in Loro:
 *  - `regionType`  the id of a declared region type;
 *  - `fields`      a LoroMap holding the base field `title` and the fields the type declares.
 * Its level, label, number and extent are NOT stored: they are derived from the document by the
 * `Regions` registry (`nabu.regions`).
 *
 * The configuration (declared types) is carried by the class (`static config`): `RegionsExtension(options)` builds a
 * subclass bound to its options, as `createDialogueExtension` does for the dash.
 */
// @ts-ignore — static-side variance on create() (same pattern as Divider/Image)
export class RegionBlock extends Block {
    /** @type {RegionsConfig} */
    static config = resolveConfig();

    /** @param {Nabu} nabu @param {RegionNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.#read();
        // Local commits, imports and remote peers all end up here (the `fields` map is a child container of `data`).
        node.data.subscribe(() => this.#read());

        // Document export: exact round trip (`importJSON` reads `props` back, see RegionBlock.create).
        this.serializers.set('json', () => ({ id: this.id, type: 'region', props: this.exportProps }));
        // `echo` (label + heading level, as the registry computes them NOW) is not data: it only lets the static text forms
        // (`toMarkdown` / `toHtml`, which get a PasteBlock and no document) write the readable heading of the copied marker.
        this.serializers.set('application/x-nabu+json', () => ({ type: 'region', props: this.exportProps, partial: false, echo: this.#echo() }));
        // Markdown: the data comment + the readable heading (see format.js).
        this.serializers.set('markdown', () => regionToMarkdown(this.config, this.exportProps, this.#echo()));
    }

    /** @type {RegionsConfig} */
    get config() { return /** @type {typeof RegionBlock} */ (this.constructor).config; }

    /** The computed label and level of this marker, for the readable echo of the text forms. @returns {{ label: string, level: number } | {}} */
    #echo() {
        const region = Regions.get(this.nabu).of(this);
        return region ? { label: region.label, level: region.level } : {};
    }

    component = $derived(this.nabu.components.get("region") || RegionComponent);

    // One caret position, before the block (the caret never lands IN a marker; it steps over it)
    positions = $derived(1);

    /** The id of the region type (`''` while unset). Reactive. @type {string} */
    regionType = $state('');

    /** The stored fields, as plain JSON (LoroText → string), before validation. @type {Record<string, any>} */
    #raw = $state.raw({});

    /**
     * The fields, typed by the declaration of the region type. Reactive.
     *  - `title` is always there (`''` when unset);
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
            if (fieldSpec(def, name)) continue; // typed below
            out[name] = value;
        }
        out.title = typeof raw.title === 'string' ? raw.title : '';
        for (const [name, spec] of def?.fields ?? []) {
            const v = raw[name];
            if (spec.kind === 'richtext') { out[name] = typeof v === 'string' ? v : null; continue; }
            const checked = validateField(spec, v);
            out[name] = checked.ok && checked.value !== undefined ? checked.value : null;
        }
        return out;
    });

    /** The title (base field). Reactive. @type {string} */
    get title() { return this.fields.title; }

    #read() {
        const data = /** @type {any} */ (this.node.data);
        this.regionType = data.get('regionType') || '';
        const map = data.get('fields');
        this.#raw = isContainer(map) && map.kind() === 'Map' ? map.toJSON() : {};
    }

    /** The fields as stored, richtext as Loro deltas: what a document / clipboard export writes. @returns {Record<string, any>} */
    get exportFields() {
        const map = /** @type {any} */ (this.node.data).get('fields');
        /** @type {Record<string, any>} */
        const out = {};
        if (!isContainer(map) || map.kind() !== 'Map') return out;
        for (const key of map.keys()) {
            const v = map.get(key);
            out[key] = isContainer(v) ? (v.kind() === 'Text' ? /** @type {any} */ (v).toDelta() : v.toJSON()) : v;
        }
        return out;
    }

    /** @returns {{ regionType: string, fields: Record<string, any> }} */
    get exportProps() { return { regionType: this.regionType, fields: this.exportFields }; }

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

    /**
     * Sets (or, with `null` / `undefined`, clears) a field. A declared field is validated (see `validateField`): an
     * invalid value is refused (returns false, warns, nothing is written). A field the type does not declare is stored as-is.
     * Own undo step like any commit.
     * @param {string} name @param {unknown} value
     * @param {{ commit?: boolean }} [options] `commit: false` leaves the transaction open (the caller commits)
     * @returns {boolean} whether the value was written
     */
    setField(name, value, { commit = true } = {}) {
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
     * Changes the type of this marker (its level follows). The fields are kept: those the new type does not declare
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

    /**
     * Dragging a seam moves its WHOLE region: the marker, its own content and its sub-regions (the same blocks as
     * `region:move-up` / `-down`, see `moveRegion`). A marker the registry does not know (not yet in the document) moves alone.
     * @returns {Block[]}
     */
    dragRange() {
        const region = Regions.get(this.nabu).of(this);
        return region ? this.nabu.children.slice(region.start, region.end) : [this];
    }

    /** @param {number} offset @returns {{node: Node, offset: number} | null} */
    getDOMPoint(offset) { return null; }

    /** @param {InputEvent} event */
    beforeinput(event) { return false; }

    /**
     * Clipboard `text/plain` (several blocks) and static export: the data comment + the readable heading (format.js). The
     * heading text is `pb.echo.label` (written by the live block on copy), else derived from the type's template.
     * @param {import('../../utils/extensions.js').PasteBlock & { echo?: { label?: string, level?: number } }} pb
     */
    static toMarkdown(pb) { return regionToMarkdown(this.config, pb.props ?? {}, pb.echo ?? {}); }

    /** Clipboard `text/html`: a heading element carrying the data (format.js). @param {import('../../utils/extensions.js').PasteBlock & { echo?: { label?: string, level?: number } }} pb */
    static toHtml(pb) { return regionToHtml(this.config, pb.props ?? {}, pb.echo ?? {}); }

    /**
     * Markdown (paste AND `importMarkdown`): ONLY the exact data comment `<!-- region:<type> {json} -->` (+ the heading line
     * right after it, consumed as its readable echo). Invalid JSON, any other comment, a heading alone: not ours (format.js).
     * A getter, because the detection needs the declared types of THIS class.
     */
    static get markdownRules() {
        const config = this.config;
        return [{
            priority: 20,
            interruptsParagraph: true,
            detect: (/** @type {string} */ line, /** @type {string[]} */ lines, /** @type {number} */ i) => parseRegionMarkdown(config, lines, i) !== null,
            consume: (/** @type {string[]} */ lines, /** @type {number} */ i) => parseRegionMarkdown(config, lines, i)?.length ?? 1,
        }];
    }

    /**
     * @param {string[]} lines
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines) {
        const parsed = parseRegionMarkdown(this.config, lines, 0);
        return parsed ? { type: 'region', props: { regionType: parsed.regionType, fields: parsed.fields }, partial: false } : null;
    }

    /** HTML paste: ONLY an element Nabu itself wrote (`data-nabu-region`); a plain `<h2>` is a heading as before. */
    static get htmlRules() {
        return [{ selector: '[data-nabu-region]', priority: 100, filter: (/** @type {Element} */ el) => !!el.getAttribute('data-nabu-region')?.trim() }];
    }

    /**
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el) {
        const parsed = parseRegionHtml(this.config, el);
        return parsed ? { type: 'region', props: { regionType: parsed.regionType, fields: parsed.fields }, partial: false } : null;
    }

    /**
     * @param {Nabu} nabu @param {string} type
     * @param {{ regionType?: string, title?: string, fields?: Record<string, any> }} [props={}]
     *   `regionType` defaults to the lowest-level declared type; `title` is a shorthand for `fields.title`. Invalid values
     *   for declared fields are dropped (warning); unknown fields are kept as-is.
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
        const def = config.types.get(regionType);
        const values = { ...(props.fields && typeof props.fields === 'object' ? props.fields : {}), ...(props.title !== undefined ? { title: props.title } : {}) };
        for (const [name, value] of Object.entries(values)) {
            if (!writeField(map, fieldSpec(def, name), name, value)) {
                nabu.warn(`Region field "${name}" dropped: invalid value ${JSON.stringify(value)} for its declared type.`);
            }
        }
        return new this(nabu, /** @type {RegionNode} */ (/** @type {unknown} */ (node)));
    }
}
