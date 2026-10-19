import { LoroMap } from 'loro-crdt';
import { sanitizeUrl } from '../utils/html.js';
import { ASSET_PREFIX, PENDING_PREFIX, assetIdOf, mapAssetBlocks, mapRemoteBlocks, remoteFileName, collectAssetIds, bytesToBase64, base64ToBytes } from './assets.clipboard.js';

/** Origin of the commits that finish a paste in the background (ref swap): not undoable. See Nabu's UndoManager. */
export const SILENT_ORIGIN = 'nabu:silent:files';
/** Largest asset (bytes) turned into a `data:` URL in the `text/html` of a copy. */
export const HTML_INLINE_LIMIT = 1024 * 1024;

/**
 * An asset as carried by `application/x-nabu+json` (`assets: { [id]: EmbeddedAsset }`).
 * @typedef {Object} EmbeddedAsset
 * @property {string} mime
 * @property {string} name
 * @property {number} size byte length
 * @property {string} data base64
 */

/**
 * @typedef {Object} FilesConfig
 * @property {(file: File, ctx: { signal?: AbortSignal, onProgress?: (p: number) => void }) => Promise<{ ref: string } | void>} [onBeforePersist]
 *   Intercept before default persistence. Return `{ ref }` to redirect to your own
 *   storage (the bytes are NOT stored in Loro). Return nothing to fall back to default.
 * @property {(ref: string) => string} [resolve] Turn a stored ref into a display URL.
 * @property {number} [maxInlineSize] Byte threshold above which the default (Loro) mode warns. Default 2MB.
 * @property {boolean} [importRemote] Opt-in, default `false`. When `true`, a remote image / media (an `http(s)` URL) pasted
 *   from the HTML of a web page is fetched and stored through {@link Files#persist} (so `onBeforePersist` sees it) instead of
 *   being hot-linked: the block shows the original URL meanwhile (`pending`) and gets the stored ref when done. A fetch that
 *   fails (network, CORS, HTTP error) keeps the original URL.
 */

/**
 * Document-level file/asset manager. Default mode stores bytes in a Loro `assets`
 * map (source of truth stays in Loro). Lazy: Files.get(nabu).
 */
export class Files {
    /** @type {import('../blocks/nabu.svelte.js').Nabu} */
    #nabu;
    /** @type {Map<string,string>} ref → objectURL cache for nabu-asset: refs */
    #urlCache = new Map();
    /** @type {Map<string,string>} transient `nabu-pending:` ref → local objectURL (bytes being re-created by a paste) */
    #pendingUrls = new Map();
    /** @type {Map<string,string>} id of an asset pasted from ANOTHER document → the ref it got here (temporary until settled) */
    #adopted = new Map();

    /** @param {import('../blocks/nabu.svelte.js').Nabu} nabu */
    constructor(nabu) {
        this.#nabu = nabu;
        this.assets = nabu.doc.getMap('assets');
    }

    /** @param {import('../blocks/nabu.svelte.js').Nabu} nabu @returns {Files} */
    static get(nabu) {
        if (!nabu.systems.has('files')) {
            const f = new Files(nabu);
            nabu.systems.set('files', f);
            return f;
        }
        return /** @type {Files} */ (nabu.systems.get('files'));
    }

    /** @returns {FilesConfig} */
    get config() { return this.#nabu.fileConfig || {}; }

    get maxInlineSize() { return this.config.maxInlineSize ?? 2 * 1024 * 1024; }

    /**
     * Persist a File → durable ref. Uses onBeforePersist if configured, else stores
     * the bytes in the Loro `assets` map.
     * @param {File} file
     * @param {{ signal?: AbortSignal, onProgress?: (p:number)=>void }} [ctx]
     * @param {{ silent?: boolean }} [options]  `silent`: the default-mode write is not an undo step (a background completion)
     * @returns {Promise<string>}
     */
    async persist(file, ctx = {}, { silent = false } = {}) {
        const hook = this.config.onBeforePersist;
        if (hook) {
            const result = await hook(file, ctx);
            if (result && result.ref) return result.ref;
            // fell through → default
        }
        if (file.size > this.maxInlineSize) {
            console.warn(`[Nabu] File "${file.name}" is ${(file.size / 1048576).toFixed(1)}MB — stored inline in the Loro document (default mode). For large media, configure files.onBeforePersist to upload to your own storage.`);
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
        const sub = this.assets.setContainer(id, new LoroMap());
        sub.set('data', buf);
        sub.set('type', file.type || 'application/octet-stream');
        sub.set('name', file.name || '');
        this.#nabu.doc.commit(silent ? { origin: SILENT_ORIGIN } : undefined);
        return 'nabu-asset:' + id;
    }

    /**
     * Resolve a ref to a displayable URL. nabu-asset: refs → objectURL from Loro
     * bytes (cached); external URLs → config.resolve or identity.
     * @param {string} ref @returns {string}
     */
    resolve(ref) {
        if (!ref) return '';
        if (ref.startsWith(PENDING_PREFIX)) return this.#pendingUrls.get(ref) ?? '';
        if (ref.startsWith('nabu-asset:')) {
            const cached = this.#urlCache.get(ref);
            if (cached) return cached;
            const id = ref.slice('nabu-asset:'.length);
            const sub = /** @type {any} */ (this.assets.get(id));
            if (!sub || typeof sub.get !== 'function') return '';
            const data = sub.get('data');
            const type = sub.get('type') || 'application/octet-stream';
            if (!data) return '';
            const url = URL.createObjectURL(new Blob([data], { type }));
            this.#urlCache.set(ref, url);
            return url;
        }
        if (this.config.resolve) return this.config.resolve(ref);
        return ref;
    }

    // ── Clipboard (P-51): media travelling between documents ─────────────────────────────────

    /**
     * The stored asset behind a `nabu-asset:` ref (or bare id), or `null` (not an asset ref, or not in THIS document).
     * @param {string} ref @returns {{ id: string, data: Uint8Array, type: string, name: string } | null}
     */
    getAsset(ref) {
        const id = assetIdOf(ref.startsWith(ASSET_PREFIX) ? ref : ASSET_PREFIX + ref);
        if (id === null) return null;
        const sub = /** @type {any} */ (this.assets.get(id));
        if (!sub || typeof sub.get !== 'function') return null;
        const data = sub.get('data');
        if (!data || typeof data.length !== 'number') return null;
        return { id, data, type: sub.get('type') || 'application/octet-stream', name: sub.get('name') || '' };
    }

    /**
     * COPY: the bytes of every `nabu-asset:` media of `blocks`, for the `assets` map of the fragment. Nothing is
     * embedded (and `nabu.warn` says so) when the total exceeds `maxInlineSize`; the blocks keep their ref either way.
     * @param {any[]} blocks PasteBlocks about to be copied
     * @returns {Record<string, EmbeddedAsset> | undefined} `undefined` when there is nothing to embed
     */
    embedAssets(blocks) {
        const found = /** @type {NonNullable<ReturnType<Files['getAsset']>>[]} */ (collectAssetIds(blocks).map((id) => this.getAsset(id)).filter((a) => a !== null));
        if (!found.length) return undefined;
        const total = found.reduce((n, a) => n + a.data.length, 0);
        if (total > this.maxInlineSize) {
            this.#nabu.warn(`copy: ${found.length} embedded file(s) total ${(total / 1048576).toFixed(1)}MB > maxInlineSize (${(this.maxInlineSize / 1048576).toFixed(1)}MB): the bytes are not put on the clipboard, pasting in another document will show them as missing`);
            return undefined;
        }
        /** @type {Record<string, EmbeddedAsset>} */
        const assets = {};
        for (const a of found) assets[a.id] = { mime: a.type, name: a.name, size: a.data.length, data: bytesToBase64(a.data) };
        return assets;
    }

    /**
     * COPY, `text/html` and `text/plain`: a copy of `blocks` where no `nabu-asset:` ref is left (it means nothing outside
     * Nabu). With `inline` (HTML), a media of at most {@link HTML_INLINE_LIMIT} bytes whose type `sanitizeUrl(kind:'media')`
     * accepts (image / video) becomes a `data:` URL; any other asset gets an empty ref, which the block serializers render
     * as a label (alt / file name) rather than a broken `src`.
     * @param {any[]} blocks @param {{ inline?: boolean }} [options]
     * @returns {any[]}
     */
    externalize(blocks, { inline = false } = {}) {
        return mapAssetBlocks(blocks, (_pb, id) => {
            const asset = inline ? this.getAsset(id) : null;
            if (asset && asset.data.length <= HTML_INLINE_LIMIT) {
                const url = 'data:' + asset.type + ';base64,' + bytesToBase64(asset.data);
                if (sanitizeUrl(url, { kind: 'media' }) !== null) return { ref: url };
            }
            return { ref: '' };
        });
    }

    /**
     * PASTE / import: make every `nabu-asset:` media of `blocks` valid in THIS document.
     *  - the asset already exists here (same document, or pasted before): the ref is reused;
     *  - the fragment carries its bytes: with no `onBeforePersist` host hook they are stored under the same id (synchronous,
     *    part of the paste's own undo step); with a hook they are sent through {@link persist} (the host uploads them) and the
     *    block shows a local preview (`status: 'pending'`) until the final ref replaces it;
     *  - no bytes: the block is kept with `status: 'missing'` (media components render a "missing file" state).
     * No commit; the caller commits. Never throws.
     * @param {any[]} blocks PasteBlocks (already sanitized)
     * @param {Record<string, EmbeddedAsset> | null | undefined} embedded the `assets` map of the fragment
     * @returns {any[]}
     */
    adoptAssets(blocks, embedded) {
        return mapAssetBlocks(blocks, (_pb, id) => {
            if (this.assets.get(id)) return null; // already here: reuse
            const known = this.#adopted.get(id);
            if (known) return known.startsWith(PENDING_PREFIX) ? { ref: known, status: 'pending' } : { ref: known };
            const e = embedded && typeof embedded === 'object' ? /** @type {any} */ (embedded)[id] : null;
            const bytes = e && typeof e === 'object' && typeof e.data === 'string' ? base64ToBytes(e.data) : null;
            if (!e || !bytes) return { status: 'missing' };
            const type = typeof e.mime === 'string' && e.mime ? e.mime : 'application/octet-stream';
            const name = typeof e.name === 'string' ? e.name : '';
            if (!this.config.onBeforePersist) {
                const sub = this.assets.setContainer(id, new LoroMap());
                sub.set('data', bytes); sub.set('type', type); sub.set('name', name);
                return null;
            }
            const tempRef = PENDING_PREFIX + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
            this.#pendingUrls.set(tempRef, URL.createObjectURL(new Blob([/** @type {BlobPart} */ (bytes)], { type })));
            this.#adopted.set(id, tempRef);
            this.persist(new File([/** @type {BlobPart} */ (bytes)], name, { type })).then(
                (ref) => this.#settle(id, tempRef, ref),
                () => this.#settle(id, tempRef, null),
            );
            return { ref: tempRef, status: 'pending' };
        });
    }

    // ── Clipboard: files pasted from outside ──────────────────────────────────────────────────

    /**
     * PASTE FILES: read a pasted File and prepare it for {@link Files#adoptAssets}: a new `nabu-asset:` ref and the bytes
     * as an embedded asset, so that the file goes through the same path as media pasted between documents (stored in the
     * document in the default mode, in the paste's own undo step; sent to `onBeforePersist` with a `pending` block when the
     * host configured one).
     * @param {File} file
     * @returns {Promise<{ id: string, ref: string, asset: EmbeddedAsset }>}
     */
    async stage(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!this.config.onBeforePersist && bytes.length > this.maxInlineSize) {
            this.#nabu.warn(`paste: "${file.name}" is ${(bytes.length / 1048576).toFixed(1)}MB, stored inline in the document (default mode). For large media, configure files.onBeforePersist to upload to your own storage.`);
        }
        const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2);
        return {
            id,
            ref: ASSET_PREFIX + id,
            asset: { mime: file.type || 'application/octet-stream', name: file.name || '', size: bytes.length, data: bytesToBase64(bytes) },
        };
    }

    /**
     * PASTE (HTML from outside): with `config.importRemote`, every block of `blocks` whose `ref` is a remote `http(s)` URL is
     * fetched and stored through {@link Files#persist}. The block shows the original URL at once, as `pending`, and gets the
     * final ref in the background (a silent commit, not an undo step); when the fetch or the storage fails it keeps the
     * original URL. Without the option, `blocks` come back untouched. No commit; never throws.
     * @param {any[]} blocks PasteBlocks (already sanitized)
     * @returns {any[]}
     */
    importRemote(blocks) {
        if (!this.config.importRemote || typeof globalThis.fetch !== 'function') return blocks;
        /** @type {Map<string, string>} */
        const seen = new Map();
        return mapRemoteBlocks(blocks, (_pb, url) => {
            let tempRef = seen.get(url);
            if (!tempRef) {
                tempRef = PENDING_PREFIX + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
                this.#pendingUrls.set(tempRef, url); // shown from where it comes from while it is fetched and stored
                seen.set(url, tempRef);
                this.#fetchRemote(url, tempRef);
            }
            return { ref: tempRef, status: 'pending' };
        });
    }

    /** @param {string} url @param {string} tempRef */
    async #fetchRemote(url, tempRef) {
        /** @type {string | null} */
        let finalRef = null;
        try {
            const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const blob = await response.blob();
            if (/^(text\/|application\/(xhtml|json))/i.test(blob.type)) throw new Error('not a media file: ' + blob.type);
            finalRef = await this.persist(new File([blob], remoteFileName(url, blob.type), { type: blob.type }), {}, { silent: true });
        } catch {
            finalRef = null; // kept as a link to the original
        }
        await this.#settle(null, tempRef, finalRef, url);
    }

    /**
     * End of a background re-creation: every block still holding `tempRef` gets the final ref (or the `error` status
     * when the upload failed). Committed with a silent origin: not an undo step of its own, the paste stays ONE step.
     * @param {string | null} id asset id of a media pasted from another document (`null`: a remote URL, see importRemote)
     * @param {string} tempRef @param {string | null} finalRef
     * @param {string | null} [fallbackRef] the ref to keep when there is no final one (the original URL of a remote media)
     */
    async #settle(id, tempRef, finalRef, fallbackRef = null) {
        if (id !== null) { if (finalRef) this.#adopted.set(id, finalRef); else this.#adopted.delete(id); }
        const nabu = this.#nabu;
        let touched = false;
        for (const block of nabu.blocks.values()) {
            const node = /** @type {any} */ (block.node);
            if (node.isDeleted?.() || node.data.get('ref') !== tempRef) continue;
            node.data.set('ref', finalRef ?? fallbackRef ?? '');
            node.data.set('status', finalRef || fallbackRef ? 'ready' : 'error');
            touched = true;
        }
        try {
            if (touched) await nabu.commit({ origin: SILENT_ORIGIN });
        } finally {
            const url = this.#pendingUrls.get(tempRef);
            this.#pendingUrls.delete(tempRef);
            if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
        }
    }
}
