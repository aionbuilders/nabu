import { LoroMap } from 'loro-crdt';

/**
 * @typedef {Object} FilesConfig
 * @property {(file: File, ctx: { signal?: AbortSignal, onProgress?: (p: number) => void }) => Promise<{ ref: string } | void>} [onBeforePersist]
 *   Intercept before default persistence. Return `{ ref }` to redirect to your own
 *   storage (the bytes are NOT stored in Loro). Return nothing to fall back to default.
 * @property {(ref: string) => string} [resolve] Turn a stored ref into a display URL.
 * @property {number} [maxInlineSize] Byte threshold above which the default (Loro) mode warns. Default 2MB.
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
     * @returns {Promise<string>}
     */
    async persist(file, ctx = {}) {
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
        this.#nabu.doc.commit();
        return 'nabu-asset:' + id;
    }

    /**
     * Resolve a ref to a displayable URL. nabu-asset: refs → objectURL from Loro
     * bytes (cached); external URLs → config.resolve or identity.
     * @param {string} ref @returns {string}
     */
    resolve(ref) {
        if (!ref) return '';
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
}
