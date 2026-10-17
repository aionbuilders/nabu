import { Block } from "../block.svelte.js";
import { Files } from "../../files/files.svelte.js";

/** @import { Nabu, NabuNode } from "../nabu.svelte.js"; */

/**
 * Base class for void media blocks (image / video / file). Shares void behavior,
 * reactive {ref, alt, status, name} metadata, Files display resolution, and the
 * optimistic preview. Subclasses provide component, serializers, and static rules.
 */
// @ts-ignore — static-side variance on create()
export class MediaBlock extends Block {
    /** @param {Nabu} nabu @param {NabuNode} node */
    constructor(nabu, node) {
        super(nabu, node);
        // Eagerly ensure the Files system exists here (a safe, non-reactive context)
        // so `displaySrc` — read inside a $derived during render — only READS it.
        // Lazily creating it in displaySrc would mutate nabu.systems (a SvelteMap)
        // during a derived → Svelte's state_unsafe_mutation error.
        Files.get(nabu);
        const data = node.data;
        this.ref = data.get('ref') || '';
        this.alt = data.get('alt') || '';
        this.status = data.get('status') || 'ready';
        this.name = data.get('name') || '';
        node.data.subscribe(() => {
            this.ref = node.data.get('ref') || '';
            this.alt = node.data.get('alt') || '';
            this.status = node.data.get('status') || 'ready';
            this.name = node.data.get('name') || '';
        });
    }

    /** @type {string} */ ref = $state('');
    /** @type {string} */ alt = $state('');
    /** @type {string} */ status = $state('ready');
    /** @type {string} */ name = $state('');
    /** Transient local objectURL while pending (not persisted). @type {string | null} */ previewUrl = $state(null);

    positions = $derived(1);

    /** @param {number} offset @returns {{node: Node, offset: number} | null} */
    getDOMPoint(offset) { return null; }

    /** @param {InputEvent} event */
    beforeinput(event) { return false; }

    /** Resolved display URL. While pending → local preview; else resolve the ref. @returns {string} */
    get displaySrc() {
        if (this.status === 'pending' && this.previewUrl) return this.previewUrl;
        return Files.get(this.nabu).resolve(this.ref);
    }

    /** @param {string} v */
    setAlt(v) { this.alt = v; /** @type {any} */ (this.node.data).set('alt', v); this.commit(); }

    /**
     * Shared node factory. Subclasses call this from their static create().
     * @param {Nabu} nabu @param {string} type @param {{ref?:string,alt?:string,status?:string,name?:string}} [props] @param {string|null} [parentId] @param {number|null} [index]
     * @returns {any}
     */
    static createNode(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index ?? undefined);
        const d = /** @type {any} */ (node.data);
        d.set('type', type); d.set('ref', props.ref || ''); d.set('alt', props.alt || '');
        d.set('status', props.status || 'ready'); d.set('name', props.name || '');
        return node;
    }
}
