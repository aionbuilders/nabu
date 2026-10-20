/**
 * Asset storage (ADR 014 §3.3): where the BYTES of the files live, outside the Loro document. The document only holds
 * references (`nabu-asset:sha256-<hex>`) and a small metadata index (`assetIndex`).
 *
 * `MemoryAssetStore` is the default of a non-persisted editor (lost with the page, like its document). The persisted
 * editor uses `IndexedDBAssetStore` (`persistence/asset-store.js`); an integrator can pass any object with this
 * interface as `files.store`.
 */

/**
 * What a store keeps next to the bytes.
 * @typedef {Object} AssetMeta
 * @property {string} mime
 * @property {string} name
 * @property {number} size byte length
 */

/**
 * @typedef {Object} AssetStore
 * @property {(hash: string) => Promise<boolean>} has
 * @property {(hash: string) => Promise<Blob | null>} get
 * @property {(hash: string, blob: Blob, meta: AssetMeta) => Promise<void>} put
 * @property {(hash: string) => Promise<void>} delete
 * @property {() => AsyncIterable<string>} keys
 * @property {(hash: string) => Promise<AssetMeta | null>} [stat] optional: the metadata stored with `put`
 */

/**
 * In-memory {@link AssetStore}. Keys are `sha256-<hex>` hashes.
 * @implements {AssetStore}
 */
export class MemoryAssetStore {
    /** @type {Map<string, { blob: Blob, meta: AssetMeta }>} */
    #entries = new Map();

    /** @param {string} hash */
    async has(hash) { return this.#entries.has(hash); }

    /** @param {string} hash @returns {Promise<Blob | null>} */
    async get(hash) { return this.#entries.get(hash)?.blob ?? null; }

    /** @param {string} hash @param {Blob} blob @param {AssetMeta} meta */
    async put(hash, blob, meta) { this.#entries.set(hash, { blob, meta: { ...meta } }); }

    /** @param {string} hash */
    async delete(hash) { this.#entries.delete(hash); }

    /** @returns {AsyncGenerator<string>} */
    async *keys() { for (const key of [...this.#entries.keys()]) yield key; }

    /** @param {string} hash @returns {Promise<AssetMeta | null>} */
    async stat(hash) { const e = this.#entries.get(hash); return e ? { ...e.meta } : null; }

    /** Number of files stored (handy in tests / diagnostics). */
    get size() { return this.#entries.size; }
}
