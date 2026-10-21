import { Block } from "../block.svelte.js";
import { Files } from "../../files/files.svelte.js";
import { sanitizeUrl } from "../../utils/html.js";
import { normalizeReason, defaultReason, reasonOf } from "../../files/status.js";

/** @import { FileReason, FileStatus } from "../../files/status.js"; */

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
        const files = Files.get(nabu);
        const data = /** @type {any} */ (node.data);
        this.ref = data.get('ref') || '';
        files.warm(this.ref); // small files: bytes ready for a (synchronous) copy / export
        this.alt = data.get('alt') || '';
        this.status = data.get('status') || 'ready';
        this.#reason = normalizeReason(data.get('reason'));
        this.name = data.get('name') || '';
        data.subscribe(() => {
            this.ref = data.get('ref') || '';
            this.alt = data.get('alt') || '';
            this.status = data.get('status') || 'ready';
            this.#reason = normalizeReason(data.get('reason'));
            this.name = data.get('name') || '';
            files.warm(this.ref);
            // the optimistic preview is only for the time the file is being stored / sent
            if (this.status !== 'pending' && this.previewUrl) {
                if (this.previewUrl.startsWith('blob:')) URL.revokeObjectURL(this.previewUrl);
                this.previewUrl = null;
            }
        });
    }

    /** @type {string} */ ref = $state('');
    /** @type {string} */ alt = $state('');
    /**
     * What the block stores (see `files/status.js`): `ready` | `pending` (bytes being stored / uploaded; `progress` follows the
     * upload) | `error` (upload failed or cancelled; the local copy is kept, `retry()` sends it again) | `missing` (no source has
     * the bytes) | `rejected` (refused, e.g. over `files.maxFileSize`; no ref). A `pending` block that no upload is running for and
     * whose file is neither local nor at the host is SHOWN as missing, see `isMissing`.
     * @type {string}
     */ status = $state('ready');
    /** @type {FileReason | null} */ #reason = $state(null);
    /** @type {string} */ name = $state('');
    /** Transient local objectURL while pending (not persisted). @type {string | null} */ previewUrl = $state(null);

    positions = $derived(1);

    /**
     * Whether the file cannot be shown: flagged `missing` (pasted without its bytes), or a `nabu-asset:` ref that neither the
     * local store nor the document's index can provide (e.g. the document was opened on another device). Reactive.
     * @returns {boolean}
     */
    get isMissing() {
        if (this.status === 'missing') return true;
        if (this.status !== 'ready' && this.status !== 'pending') return false;
        const files = Files.get(this.nabu);
        return files.state(this.ref) === 'missing' && !files.isUploading(this.ref);
    }

    /**
     * The status to SHOW: `missing` when the file cannot be displayed (see `isMissing`: includes a `pending` block whose upload
     * was interrupted and is not available on this device), else the stored `status`. Reactive.
     * @returns {string}
     */
    get displayStatus() { return this.isMissing ? 'missing' : this.status; }

    /**
     * Why the block is `error`, `rejected` or `missing`: `{ code, message }` (a stable code and a readable English sentence), `null`
     * otherwise. A `pending` block shown as missing has the code `interrupted`. Reactive.
     * @returns {FileReason | null}
     */
    get reason() {
        if (this.status === 'pending') return this.isMissing ? reasonOf('interrupted') : null;
        if (this.status === 'ready') return this.isMissing ? reasonOf('unavailable') : null;
        return this.#reason ?? defaultReason(this.status);
    }

    /**
     * Upload progress, `0..1` while the file is being sent to the host (`files.onBeforePersist`), `null` otherwise. Reactive.
     * @returns {number | null}
     */
    get progress() { return Files.get(this.nabu).progress(this.ref); }

    /**
     * Send the file to the host again from its local copy (after `error`, including a cancelled upload). Resolves `true` when
     * the file ended up at the host, `false` when there is nothing to retry (no host, bytes gone, not a local file).
     * @returns {Promise<boolean>}
     */
    retry() { return Files.get(this.nabu).retry(this.ref); }

    /**
     * Abort the running upload (the host's `signal` fires). The block becomes `error` with the reason `cancelled`, the local copy
     * is kept. Uploads are per file: every block showing the same file is affected.
     * @returns {boolean} whether an upload was running
     */
    cancel() { return Files.get(this.nabu).cancel(this.ref); }

    /**
     * For the component's effect: keeps the display URL of this block alive while it is mounted (an unused objectURL is
     * revoked). Returns the release function, so it can be used as `$effect(() => block.holdSource())`.
     * @returns {() => void}
     */
    holdSource() { return Files.get(this.nabu).hold(this.ref); }

    /** @param {number} offset @returns {{node: Node, offset: number} | null} */
    getDOMPoint(offset) { return null; }

    /** @param {InputEvent} event */
    beforeinput(event) { return false; }

    /** Resolved display URL. While pending → local preview; else resolve the ref. @returns {string} */
    get displaySrc() {
        // Render guard: only a media-safe URL (http(s), blob:, nabu-asset:, data:image|video, relative) reaches
        // a `src` / `href` — a document loaded with `javascript:` in `ref` renders as "no media".
        // `resolve` is called first on purpose: it starts loading the stored file, so the switch from the local preview to the
        // stored copy (when the block stops being pending) does not flash an empty image.
        const resolved = Files.get(this.nabu).resolve(this.ref);
        if (this.status === 'pending' && this.previewUrl) return sanitizeUrl(this.previewUrl, { kind: 'media' }) ?? '';
        return sanitizeUrl(resolved, { kind: 'media' }) ?? '';
    }

    /**
     * The props a DOCUMENT export (`serialize('json')` / `'markdown'`) writes: `ref`, `alt`, `name`, and `status` (+ `reason`)
     * when it is not `ready`. A `pending` block whose bytes are still being stored has no durable ref yet: its transient
     * `nabu-pending:` ref (or empty one) is NOT exported as if it were final, the block is exported as `missing` (label
     * kept, no source) so the import shows the "Missing file" state instead of a block stuck pending forever. A `pending`
     * block with a hash ref (being uploaded) exports as a normal file: the export carries its bytes.
     * @returns {{ ref: string, alt: string, name: string, status?: string, reason?: FileReason }}
     */
    get exportProps() {
        const props = { ref: this.ref, alt: this.alt, name: this.name };
        if (this.status === 'pending') {
            if (!this.ref || this.ref.startsWith('nabu-pending:')) return { ...props, ref: '', status: 'missing' };
            return props;
        }
        if (this.status === 'ready') return props;
        const reason = this.#reason;
        return { ...props, status: this.status, ...(reason ? { reason } : {}) };
    }

    /**
     * What a COPY (`application/x-nabu+json`) carries of the file state: nothing, except a `rejected` block (so the refusal and
     * its reason travel with it). Upload state (`pending`, `error`) never travels: the receiver works it out.
     * @returns {{ status?: string, reason?: FileReason }}
     */
    get clipboardState() {
        return this.status === 'rejected' ? { status: 'rejected', reason: this.reason ?? undefined } : {};
    }

    /** @param {string} v */
    setAlt(v) { this.alt = v; /** @type {any} */ (this.node.data).set('alt', v); this.commit(); }

    /**
     * Shared node factory. Subclasses call this from their static create().
     * @param {Nabu} nabu @param {string} type @param {{ref?:string,alt?:string,status?:string,name?:string,reason?:FileReason}} [props] @param {string|null} [parentId] @param {number|null} [index]
     * @returns {any}
     */
    static createNode(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index ?? undefined);
        const d = /** @type {any} */ (node.data);
        d.set('type', type); d.set('ref', props.ref || ''); d.set('alt', props.alt || '');
        d.set('status', props.status || 'ready'); d.set('name', props.name || '');
        const reason = normalizeReason(props.reason);
        if (reason) d.set('reason', reason);
        return node;
    }
}
