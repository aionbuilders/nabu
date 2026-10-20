import { SvelteMap } from 'svelte/reactivity';
import { sanitizeUrl } from '../utils/html.js';
import { ASSET_PREFIX, PENDING_PREFIX, assetIdOf, isHashId, sha256Id, mapAssetBlocks, mapRemoteBlocks, remoteFileName, collectAssetIds, bytesToBase64, base64ToBytes } from './assets.clipboard.js';
import { MemoryAssetStore } from './store.js';

/** @import { AssetStore, AssetMeta } from './store.js' */

/** Origin of the commits that finish a paste in the background (ref swap): not undoable. See Nabu's UndoManager. */
export const SILENT_ORIGIN = 'nabu:silent:files';
/** Largest asset (bytes) turned into a `data:` URL in the `text/html` of a copy. */
export const HTML_INLINE_LIMIT = 1024 * 1024;
/** Upper bound (bytes) of the in-memory copy of the bytes kept to answer a (synchronous) copy / export. */
const EMBED_CACHE_BUDGET = 32 * 1024 * 1024;

/**
 * An asset as carried by `application/x-nabu+json` (`assets: { [id]: EmbeddedAsset }`), `id` being the part of the ref
 * after `nabu-asset:` (`sha256-<hex>`, or a beta `<uuid>`).
 * @typedef {Object} EmbeddedAsset
 * @property {string} mime
 * @property {string} name
 * @property {number} size byte length
 * @property {string} data base64
 */

/**
 * @typedef {Object} FilesConfig
 * @property {AssetStore} [store] Where the BYTES of the files live (ADR 014). Default: a `MemoryAssetStore`
 *   (`createPersistedEditor`: an `IndexedDBAssetStore` shared by all the documents of the origin). The document itself only
 *   holds `nabu-asset:sha256-<hex>` references and a metadata index (`assetIndex`).
 * @property {(file: File, ctx: { signal?: AbortSignal, onProgress?: (p: number) => void }) => Promise<{ ref: string } | void>} [onBeforePersist]
 *   Host storage. The file is always written to the local store first; return `{ ref }` to ALSO put it at your own
 *   location (the returned ref replaces the local one in the block). Return nothing to keep the local reference.
 * @property {(ref: string) => string} [resolve] Turn a stored ref into a display URL.
 * @property {number} [maxInlineSize] Byte threshold for embedding files in a COPY / export (`application/x-nabu+json`,
 *   `serialize('json')`): above it (total, or for one file) the bytes are not embedded. Default 2MB.
 * @property {boolean} [importRemote] Opt-in, default `false`. When `true`, a remote image / media (an `http(s)` URL) pasted
 *   from the HTML of a web page is fetched and stored through {@link Files#persist} (so `onBeforePersist` sees it) instead of
 *   being hot-linked: the block shows the original URL meanwhile (`pending`) and gets the stored ref when done. A fetch that
 *   fails (network, CORS, HTTP error) keeps the original URL.
 */

/**
 * @typedef {Object} EmbeddedBytes
 * @property {Uint8Array} bytes @property {string} type @property {string} name
 */

/**
 * Document-level file/asset manager (ADR 014). The bytes of a file live in an {@link AssetStore}, the document only holds
 * `nabu-asset:sha256-<hex>` references and a small `assetIndex` Loro map (`hash → { mime, name, size, url? }`).
 * Lazy: Files.get(nabu).
 */
export class Files {
    /** @type {import('../blocks/nabu.svelte.js').Nabu} */
    #nabu;
    /** @type {SvelteMap<string, string | null>} asset id → objectURL (or host URL) once loaded; `null` = no source has it (missing) */
    #urls = new SvelteMap();
    /** @type {Set<string>} ids being loaded from the store */
    #loading = new Set();
    /** @type {Map<string, number>} asset id → number of mounted blocks displaying it (see {@link Files#hold}) */
    #holds = new Map();
    /** @type {Map<string, { data: Uint8Array, type: string, name: string }>} id → bytes of the small files, for the synchronous copy / export */
    #embed = new Map();
    #embedBytes = 0;
    /** @type {Set<string>} ids whose bytes are being read into the embed cache */
    #warming = new Set();
    /** @type {Map<string,string>} transient `nabu-pending:` ref → local objectURL (bytes being re-created by a paste) */
    #pendingUrls = new Map();
    /** @type {Map<string,string>} id of an asset pasted from ANOTHER document → the ref it got here (temporary until settled) */
    #adopted = new Map();
    /** @type {Map<string, Promise<void>>} hash → the background storage of bytes that arrived with a paste / import */
    #inflight = new Map();
    /** Background jobs (see {@link Files#whenIdle}). @type {Set<Promise<any>>} */
    #jobs = new Set();
    /** @type {Map<string, string>} beta uuid → hash id, for the assets migrated by THIS session */
    #legacy = new Map();
    /** @type {Map<string, string>} ref → objectURL of a beta asset whose bytes are still in the Loro `assets` map (migration pending) */
    #legacyUrls = new Map();

    /** Milliseconds an unused objectURL is kept before being revoked (a block that moves unmounts and remounts at once). */
    revokeGraceMs = 1000;

    /** @param {import('../blocks/nabu.svelte.js').Nabu} nabu */
    constructor(nabu) {
        this.#nabu = nabu;
        /** The local store of the bytes. @type {AssetStore} */
        this.store = this.config.store ?? new MemoryAssetStore();
        /** Beta format: bytes inside the document. Read-only legacy, emptied by the migration. */
        this.assets = nabu.doc.getMap('assets');
        /** ADR 014 §3.2: `hash → { mime, name, size, url? }`, metadata only (never bytes). */
        this.index = nabu.doc.getMap('assetIndex');
        if (this.assets.size > 0) this.#track(this.#migrate());
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

    // ── Background work ──────────────────────────────────────────────────────────────────────────

    /**
     * @template T
     * @param {Promise<T>} promise @returns {Promise<T>}
     */
    #track(promise) {
        const tracked = promise.finally(() => { this.#jobs.delete(tracked); });
        this.#jobs.add(tracked);
        return tracked;
    }

    /**
     * Resolves when the background storage work started by a paste / import / migration is done (bytes verified and written
     * to the store, index completed, missing files flagged). Uploads to a host (`onBeforePersist`) are NOT waited for.
     * @returns {Promise<void>}
     */
    async whenIdle() {
        while (this.#jobs.size) await Promise.allSettled([...this.#jobs]);
    }

    /**
     * Run Loro writes as a silent commit (not an undo step). Whatever is pending in the open transaction is committed
     * normally first, so that it does not end up swallowed by the silent origin.
     * @param {() => void} write
     */
    async #silent(write) {
        const nabu = this.#nabu;
        for (let i = 0; i < 3 && nabu.doc.getUncommittedOpsAsJson(); i++) await nabu.commit();
        write();
        await nabu.commit({ origin: SILENT_ORIGIN });
    }

    // ── Storing ──────────────────────────────────────────────────────────────────────────────────

    /** Ids (`sha256-<hex>`) of every file the document knows (its `assetIndex`): what a persisted document references. @returns {string[]} */
    indexedHashes() { return Object.keys(this.index.toJSON()); }

    /** @param {string} id @param {AssetMeta} meta @returns {void} */
    #setIndex(id, meta) {
        if (!this.index.get(id)) this.index.set(id, { mime: meta.mime, name: meta.name, size: meta.size });
    }

    /** Remember the bytes of a small file for the synchronous copy / export (bounded; oldest forgotten first). @param {string} id @param {Uint8Array} bytes @param {AssetMeta} meta */
    #remember(id, bytes, meta) {
        if (bytes.length > this.maxInlineSize) return;
        const previous = this.#embed.get(id);
        if (previous) { this.#embedBytes -= previous.data.length; this.#embed.delete(id); }
        this.#embed.set(id, { data: bytes, type: meta.mime, name: meta.name });
        this.#embedBytes += bytes.length;
        for (const [key, entry] of this.#embed) {
            if (this.#embedBytes <= EMBED_CACHE_BUDGET || key === id) break;
            this.#embed.delete(key);
            this.#embedBytes -= entry.data.length;
        }
    }

    /**
     * Write bytes (already verified) to the store, remember them and complete the index (silent commit).
     * @param {string} id @param {Uint8Array} bytes @param {AssetMeta} meta
     */
    async #storeBytes(id, bytes, meta) {
        await this.store.put(id, new Blob([/** @type {BlobPart} */ (bytes)], { type: meta.mime }), meta);
        this.#remember(id, bytes, meta);
        if (this.#urls.get(id) === null) this.#urls.delete(id); // it was reported missing a moment ago
        await this.#silent(() => this.#setIndex(id, meta));
    }

    /**
     * Hash a File and write it to the local store (deduplicated: the same bytes give the same id and one entry), then
     * make sure the document's `assetIndex` knows it. This is step 1 of the lifecycle (ADR 014 §3.4).
     * @param {File} file
     * @returns {Promise<{ id: string, ref: string, meta: AssetMeta }>}
     */
    async ingest(file) {
        // TODO(ADR-014 lot 2): `files.maxFileSize` check here (a too big file is rejected with a readable reason).
        const bytes = new Uint8Array(await file.arrayBuffer());
        const id = await sha256Id(bytes);
        const meta = { mime: file.type || 'application/octet-stream', name: file.name || '', size: bytes.length };
        if (await this.store.has(id)) {
            this.#remember(id, bytes, meta);
            if (!this.index.get(id)) await this.#silent(() => this.#setIndex(id, meta));
        } else {
            await this.#storeBytes(id, bytes, meta);
        }
        return { id, ref: ASSET_PREFIX + id, meta };
    }

    /**
     * Persist a File → durable ref. The bytes always go to the local store first (and the document index), whatever the
     * mode; with `onBeforePersist` the host then gets the file and its returned ref replaces the local one.
     * @param {File} file
     * @param {{ signal?: AbortSignal, onProgress?: (p:number)=>void }} [ctx]
     * @returns {Promise<string>}
     */
    async persist(file, ctx = {}) {
        const { ref } = await this.ingest(file);
        const hook = this.config.onBeforePersist;
        if (hook) {
            // TODO(ADR-014 lot 2): the upload becomes a background outbox job (persisted, resumable, cancelable) and the block
            // keeps its hash ref, with `assetIndex[hash].url` set on success. Until then the host ref replaces the local one.
            const result = await hook(file, ctx);
            if (result && result.ref) return result.ref;
        }
        return ref;
    }

    // ── Display ──────────────────────────────────────────────────────────────────────────────────

    /** The id a ref designates for the store: a hash id, or the hash a beta uuid was migrated to. @param {string} raw @returns {string} */
    #canonical(raw) { return isHashId(raw) ? raw : (this.#legacy.get(raw) ?? raw); }

    /**
     * Resolve a ref to a displayable URL. `nabu-asset:` refs → objectURL made from the local store (loaded in the
     * background: `''` until it is there, reactive), else the `url` of the document index (through `config.resolve`);
     * external URLs → config.resolve or identity.
     * @param {string} ref @returns {string}
     */
    resolve(ref) {
        if (!ref) return '';
        if (ref.startsWith(PENDING_PREFIX)) return this.#pendingUrls.get(ref) ?? '';
        const raw = assetIdOf(ref);
        if (raw !== null) {
            const id = this.#canonical(raw);
            return isHashId(id) ? (this.#entry(id) ?? '') : this.#legacyUrl(ref, raw);
        }
        if (this.config.resolve) return this.config.resolve(ref);
        return ref;
    }

    /**
     * What displaying `ref` would give right now: `loading` (being read from the store), `missing` (neither the local store
     * nor the document index has it) or `ready`. Reactive. Refs that are not `nabu-asset:` are always `ready`.
     * @param {string} ref @returns {'ready' | 'loading' | 'missing'}
     */
    state(ref) {
        const raw = ref ? assetIdOf(ref) : null;
        if (raw === null) return 'ready';
        const id = this.#canonical(raw);
        if (!isHashId(id)) return this.#legacyUrl(ref, raw) ? 'ready' : 'missing';
        const entry = this.#entry(id);
        return entry === undefined ? 'loading' : entry === null ? 'missing' : 'ready';
    }

    /** @param {string} id @returns {string | null | undefined} */
    #entry(id) {
        const entry = this.#urls.get(id);
        if (entry === undefined) this.#load(id);
        return entry;
    }

    /** @param {string} id */
    #load(id) {
        if (this.#loading.has(id)) return;
        this.#loading.add(id);
        (async () => {
            try {
                await this.#inflight.get(id)?.catch(() => {}); // bytes arriving with a paste: wait for them rather than report them missing
                /** @type {Blob | null} */
                let blob = null;
                try { blob = await this.store.get(id); } catch (error) { this.#nabu.warn(`asset ${id}: the store failed: ${error}`); }
                /** @type {string | null} */
                let url = null;
                if (blob) {
                    url = URL.createObjectURL(blob);
                    this.#warmFrom(id, blob).catch(() => {});
                } else {
                    const hosted = /** @type {any} */ (this.index.get(id))?.url;
                    if (typeof hosted === 'string' && hosted) url = this.config.resolve ? this.config.resolve(hosted) : hosted;
                }
                this.#urls.set(id, url);
                this.#scheduleSweep(id);
            } finally {
                this.#loading.delete(id);
            }
        })();
    }

    /**
     * A block displaying `ref` is mounted: its objectURL stays alive until the returned function is called (the media
     * components call this from an effect). An objectURL no mounted block uses any more is revoked after a short grace period.
     * @param {string} ref @returns {() => void}
     */
    hold(ref) {
        const raw = ref ? assetIdOf(ref) : null;
        if (raw === null) return () => {};
        const id = this.#canonical(raw);
        this.#holds.set(id, (this.#holds.get(id) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const left = (this.#holds.get(id) ?? 1) - 1;
            if (left > 0) { this.#holds.set(id, left); return; }
            this.#holds.delete(id);
            this.#scheduleSweep(id);
        };
    }

    /** @param {string} id */
    #scheduleSweep(id) {
        setTimeout(() => {
            if (this.#holds.has(id)) return;
            const url = this.#urls.get(id);
            if (typeof url !== 'string') return;
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
            this.#urls.delete(id); // a later display loads it again
        }, this.revokeGraceMs);
    }

    /** A beta asset still inside the document (migration pending): shown from its Loro bytes, like before. @param {string} ref @param {string} raw @returns {string} */
    #legacyUrl(ref, raw) {
        const cached = this.#legacyUrls.get(ref);
        if (cached) return cached;
        const sub = /** @type {any} */ (this.assets.get(raw));
        const data = sub && typeof sub.get === 'function' ? sub.get('data') : null;
        if (!data) return '';
        const url = URL.createObjectURL(new Blob([data], { type: sub.get('type') || 'application/octet-stream' }));
        this.#legacyUrls.set(ref, url);
        return url;
    }

    /**
     * Read the bytes of a stored file into the embed cache, so that a later copy / export (synchronous) can carry them.
     * Cheap no-op for big files, which are never embedded.
     * @param {string} ref
     */
    warm(ref) {
        const raw = ref ? assetIdOf(ref) : null;
        if (raw === null) return;
        const id = this.#canonical(raw);
        if (!isHashId(id) || this.#embed.has(id) || this.#warming.has(id)) return;
        const size = /** @type {any} */ (this.index.get(id))?.size;
        if (typeof size === 'number' && size > this.maxInlineSize) return;
        this.#warming.add(id);
        this.#track((async () => {
            try {
                await this.#inflight.get(id)?.catch(() => {});
                const blob = await this.store.get(id);
                if (blob) await this.#warmFrom(id, blob);
            } catch { /* not embeddable: nothing to do */ } finally { this.#warming.delete(id); }
        })());
    }

    /** @param {string} id @param {Blob} blob */
    async #warmFrom(id, blob) {
        if (this.#embed.has(id) || blob.size > this.maxInlineSize) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const entry = /** @type {any} */ (this.index.get(id));
        const stat = entry ? null : await this.store.stat?.(id);
        this.#remember(id, bytes, { mime: entry?.mime ?? stat?.mime ?? (blob.type || 'application/octet-stream'), name: entry?.name ?? stat?.name ?? '', size: bytes.length });
    }

    // ── Clipboard (P-51): media travelling between documents ─────────────────────────────────

    /**
     * The bytes behind a `nabu-asset:` ref (or bare id), when they are at hand SYNCHRONOUSLY (a copy / export cannot wait):
     * the files of at most `maxInlineSize` that were added or displayed in this session. `null` otherwise.
     * @param {string} ref @returns {{ id: string, data: Uint8Array, type: string, name: string } | null}
     */
    getAsset(ref) {
        const raw = assetIdOf(ref.startsWith(ASSET_PREFIX) ? ref : ASSET_PREFIX + ref);
        if (raw === null) return null;
        const id = this.#canonical(raw);
        const hit = this.#embed.get(id);
        if (hit) return { id, data: hit.data, type: hit.type, name: hit.name };
        if (isHashId(id)) return null;
        // a beta asset whose migration has not run yet
        const sub = /** @type {any} */ (this.assets.get(raw));
        if (!sub || typeof sub.get !== 'function') return null;
        const data = sub.get('data');
        if (!data || typeof data.length !== 'number') return null;
        return { id: raw, data, type: sub.get('type') || 'application/octet-stream', name: sub.get('name') || '' };
    }

    /**
     * COPY: the bytes of every `nabu-asset:` media of `blocks`, for the `assets` map of the fragment (keyed by hash id, ADR 014
     * §3.8). Nothing is embedded (and `nabu.warn` says so) when the total exceeds `maxInlineSize`; the blocks keep their ref either way.
     * @param {any[]} blocks PasteBlocks about to be copied
     * @returns {Record<string, EmbeddedAsset> | undefined} `undefined` when there is nothing to embed
     */
    embedAssets(blocks) {
        const ids = collectAssetIds(blocks);
        /** @type {Array<{ key: string } & NonNullable<ReturnType<Files['getAsset']>>>} */
        const found = [];
        for (const key of ids) {
            const asset = this.getAsset(key);
            if (asset) found.push({ key, ...asset });
            else if (isHashId(key) && this.index.get(key)) this.#nabu.warn(`copy: file ${key} is not embedded (larger than maxInlineSize, or its bytes are not loaded yet): pasting in another document will show it as missing unless that document's store has it`);
        }
        if (!found.length) return undefined;
        const total = found.reduce((n, a) => n + a.data.length, 0);
        if (total > this.maxInlineSize) {
            this.#nabu.warn(`copy: ${found.length} embedded file(s) total ${(total / 1048576).toFixed(1)}MB > maxInlineSize (${(this.maxInlineSize / 1048576).toFixed(1)}MB): the bytes are not put on the clipboard, pasting in another document will show them as missing`);
            return undefined;
        }
        /** @type {Record<string, EmbeddedAsset>} */
        const assets = {};
        for (const a of found) assets[a.key] = { mime: a.type, name: a.name, size: a.data.length, data: bytesToBase64(a.data) };
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
     * PASTE / import: make every `nabu-asset:` media of `blocks` valid in THIS document (ADR 014 §3.4, §3.8). Synchronous:
     * the refs are content hashes, so a block keeps its ref and the storage happens in the background (see {@link Files#whenIdle}).
     *  - a hash ref whose bytes the fragment carries: they are verified (the hash must match, else the file is treated as
     *    missing and `nabu.warn` says so) and written to the store, unless it already has them;
     *  - a hash ref the document already indexes: reused as is;
     *  - a hash ref with no bytes and no index entry: kept, then flagged `status: 'missing'` unless the local store has the file;
     *  - a beta `nabu-asset:<uuid>` ref (older exports / clipboards) with its bytes: re-created through {@link Files#persist}
     *    and given its hash ref when done (the block is `pending` with a local preview meanwhile); without bytes: `missing`;
     *  - with a host hook, a file the document does not know yet is sent through {@link Files#persist} (the host uploads it)
     *    and the block is `pending` until the host ref replaces the local one.
     * No commit; the caller commits. Never throws.
     * @param {any[]} blocks PasteBlocks (already sanitized)
     * @param {Record<string, EmbeddedAsset> | null | undefined} embedded the `assets` map of the fragment
     * @returns {any[]}
     */
    adoptAssets(blocks, embedded) {
        /** @type {Map<string, EmbeddedBytes | null>} */
        const decoded = new Map();
        /** @param {string} id @returns {EmbeddedBytes | null} */
        const embeddedOf = (id) => {
            if (decoded.has(id)) return decoded.get(id) ?? null;
            const e = embedded && typeof embedded === 'object' ? /** @type {any} */ (embedded)[id] : null;
            const bytes = e && typeof e === 'object' && typeof e.data === 'string' ? base64ToBytes(e.data) : null;
            const value = bytes ? {
                bytes,
                type: typeof e.mime === 'string' && e.mime ? e.mime : 'application/octet-stream',
                name: typeof e.name === 'string' ? e.name : '',
            } : null;
            decoded.set(id, value);
            return value;
        };
        return mapAssetBlocks(blocks, (_pb, id) => isHashId(id) ? this.#adoptHash(id, embeddedOf(id)) : this.#adoptLegacy(id, embeddedOf(id)));
    }

    /** @param {string} id @param {EmbeddedBytes | null} emb @returns {Record<string, any> | null} */
    #adoptHash(id, emb) {
        const hosted = this.config.onBeforePersist;
        if (hosted) {
            const memo = this.#adopted.get(id);
            if (memo) return memo.startsWith(PENDING_PREFIX) ? { ref: memo, status: 'pending' } : { ref: memo };
        }
        const known = Boolean(this.index.get(id));
        // TODO(ADR-014 lot 2): with a host the block keeps its hash ref and the upload is an outbox job; today the host ref replaces it.
        if (hosted && emb && !known) return this.#adoptPending(id, emb);
        if (emb || !known) this.#ensure(id, emb);
        return null;
    }

    /** @param {string} id @param {EmbeddedBytes | null} emb @returns {Record<string, any> | null} */
    #adoptLegacy(id, emb) {
        const migrated = this.#legacy.get(id);
        if (migrated) return { ref: ASSET_PREFIX + migrated };
        if (this.assets.get(id)) return null; // still inside this document: the migration will rewrite the refs
        const memo = this.#adopted.get(id);
        if (memo) return memo.startsWith(PENDING_PREFIX) ? { ref: memo, status: 'pending' } : { ref: memo };
        if (!emb) return { status: 'missing' };
        return this.#adoptPending(id, emb);
    }

    /**
     * The bytes are re-created in the background through {@link Files#persist} (local store, then the host if any); the block
     * shows a local preview as `pending` and gets the final ref in a silent commit.
     * @param {string} id @param {EmbeddedBytes} emb @returns {Record<string, any>}
     */
    #adoptPending(id, emb) {
        const tempRef = PENDING_PREFIX + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
        this.#pendingUrls.set(tempRef, URL.createObjectURL(new Blob([/** @type {BlobPart} */ (emb.bytes)], { type: emb.type })));
        this.#adopted.set(id, tempRef);
        const upload = this.persist(new File([/** @type {BlobPart} */ (emb.bytes)], emb.name, { type: emb.type })).then(
            (ref) => this.#settle(id, tempRef, ref),
            () => this.#settle(id, tempRef, null),
        );
        if (!this.config.onBeforePersist) this.#track(upload); // local only: quick, the import can wait for it (a host upload is not waited for)
        return { ref: tempRef, status: 'pending' };
    }

    /**
     * Make sure the store (and the index) has the file `id`, in the background. With bytes (from a paste / import) they
     * are verified against the hash first. Without bytes and without any other source, the blocks showing it are flagged
     * `missing`.
     * @param {string} id @param {EmbeddedBytes | null} emb
     */
    #ensure(id, emb) {
        if (this.#inflight.has(id)) return;
        const job = this.#ensureStored(id, emb).catch((error) => { this.#nabu.warn(`asset ${id}: could not be stored: ${error}`); });
        this.#inflight.set(id, job);
        this.#track(job).finally(() => { if (this.#inflight.get(id) === job) this.#inflight.delete(id); });
    }

    /** @param {string} id @param {EmbeddedBytes | null} emb */
    async #ensureStored(id, emb) {
        if (await this.store.has(id).catch(() => false)) {
            if (!this.index.get(id)) {
                const stat = emb ? null : await this.store.stat?.(id);
                const blob = emb || stat ? null : await this.store.get(id);
                /** @type {AssetMeta} */
                const meta = emb ? { mime: emb.type, name: emb.name, size: emb.bytes.length } : stat ?? { mime: blob?.type || 'application/octet-stream', name: '', size: blob?.size ?? 0 };
                await this.#silent(() => this.#setIndex(id, meta));
            }
            return;
        }
        if (emb) {
            const actual = await sha256Id(/** @type {BufferSource} */ (emb.bytes));
            if (actual !== id) {
                this.#nabu.warn(`asset ${id}: the embedded bytes hash to ${actual}: ignored, the file is treated as missing`);
                await this.#markMissing(id);
                return;
            }
            await this.#storeBytes(id, emb.bytes, { mime: emb.type, name: emb.name, size: emb.bytes.length });
            return;
        }
        const hosted = /** @type {any} */ (this.index.get(id))?.url;
        if (!hosted) await this.#markMissing(id);
    }

    /** Flag as `missing` every live block that shows file `id` (silent commit). @param {string} id */
    async #markMissing(id) {
        const ref = ASSET_PREFIX + id;
        /** @type {any[]} */
        const targets = [];
        for (const block of this.#nabu.blocks.values()) {
            const node = /** @type {any} */ (block.node);
            if (node.isDeleted?.() || node.data.get('ref') !== ref || node.data.get('status') === 'missing') continue;
            targets.push(node);
        }
        if (!targets.length) return;
        this.#urls.set(id, null);
        await this.#silent(() => { for (const node of targets) node.data.set('status', 'missing'); });
    }

    // ── Beta documents (ADR 014 §3.7) ────────────────────────────────────────────────────────────

    /**
     * A document saved by the beta keeps the bytes of its files in the Loro `assets` map. Each entry is hashed and written to
     * the store, `assetIndex` gets its metadata, the blocks that referenced `nabu-asset:<uuid>` get `nabu-asset:sha256-…`, and
     * the legacy entries are removed — all in ONE silent commit (not an undo step). An entry that cannot be stored stays as it
     * was. (The old bytes remain in the document's history: only an explicit compaction frees them.)
     */
    async #migrate() {
        const legacy = /** @type {Record<string, any>} */ (this.assets.toJSON());
        /** @type {Array<{ uuid: string, id: string, meta: AssetMeta }>} */
        const done = [];
        for (const [uuid, value] of Object.entries(legacy)) {
            const data = value?.data;
            if (!data || !ArrayBuffer.isView(data)) continue;
            const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            /** @type {AssetMeta} */
            const meta = { mime: typeof value.type === 'string' && value.type ? value.type : 'application/octet-stream', name: typeof value.name === 'string' ? value.name : '', size: bytes.length };
            try {
                const id = await sha256Id(/** @type {BufferSource} */ (bytes));
                if (!(await this.store.has(id))) await this.store.put(id, new Blob([/** @type {BlobPart} */ (bytes)], { type: meta.mime }), meta);
                this.#remember(id, bytes, meta);
                done.push({ uuid, id, meta });
            } catch (error) {
                this.#nabu.warn(`asset ${uuid}: migration to the store failed, kept in the document: ${error}`);
            }
        }
        if (!done.length) return;
        for (const d of done) this.#legacy.set(d.uuid, d.id);
        await this.#silent(() => {
            for (const d of done) { this.#setIndex(d.id, d.meta); this.assets.delete(d.uuid); }
            for (const block of this.#nabu.blocks.values()) {
                const node = /** @type {any} */ (block.node);
                if (node.isDeleted?.()) continue;
                const ref = node.data.get('ref');
                const migrated = typeof ref === 'string' && ref.startsWith(ASSET_PREFIX) ? this.#legacy.get(ref.slice(ASSET_PREFIX.length)) : null;
                if (migrated) node.data.set('ref', ASSET_PREFIX + migrated);
            }
        });
        for (const url of this.#legacyUrls.values()) URL.revokeObjectURL(url);
        this.#legacyUrls.clear();
    }

    // ── Clipboard: files pasted from outside ──────────────────────────────────────────────────

    /**
     * PASTE FILES: read a pasted File and prepare it for {@link Files#adoptAssets}. Without a host hook the file is hashed
     * and written to the local store right here (no base64 round trip): the fragment only carries its hash ref, as one
     * undo step with the blocks. With `onBeforePersist` the bytes travel as an embedded asset, so that the paste goes through
     * the host (`pending` block, local preview, upload).
     * @param {File} file
     * @returns {Promise<{ id: string, ref: string, asset: EmbeddedAsset | null }>}
     */
    async stage(file) {
        if (!this.config.onBeforePersist) {
            const { id, ref } = await this.ingest(file);
            return { id, ref, asset: null };
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const id = await sha256Id(bytes);
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
            finalRef = await this.persist(new File([blob], remoteFileName(url, blob.type), { type: blob.type }));
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
