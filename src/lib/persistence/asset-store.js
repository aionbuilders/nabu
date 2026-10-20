import { ASSETS_STORE, DOC_REFS_STORE, withStore } from './indexeddb.js';

/** @import { AssetStore, AssetMeta } from '../files/store.js' */

/**
 * The {@link AssetStore} of a persisted editor (ADR 014 §3.3): database `nabu`, object store `assets` (`{ hash, blob, mime,
 * name, size, savedAt }`), SHARED by every document of the origin — the same image used in two documents is stored once.
 * A second object store, `docRefs` (`{ docId, hashes }`), records which files each document references; the persisted
 * editor refreshes it on every save, and the future cleanup only deletes a file no document references.
 *
 * Bytes are stored as `Blob`s (the browser keeps them on disk, not in memory).
 * @implements {AssetStore}
 */
export class IndexedDBAssetStore {
	/** @param {string} hash @returns {Promise<boolean>} */
	async has(hash) {
		return (await withStore(ASSETS_STORE, 'readonly', (s) => s.count(hash))) > 0;
	}

	/** @param {string} hash @returns {Promise<Blob | null>} */
	async get(hash) {
		const record = await withStore(ASSETS_STORE, 'readonly', (s) => s.get(hash));
		return record?.blob ?? null;
	}

	/** @param {string} hash @param {Blob} blob @param {AssetMeta} meta @returns {Promise<void>} */
	async put(hash, blob, meta) {
		await withStore(ASSETS_STORE, 'readwrite', (s) => s.put({ hash, blob, mime: meta.mime, name: meta.name, size: meta.size, savedAt: Date.now() }));
	}

	/** @param {string} hash @returns {Promise<void>} */
	async delete(hash) {
		await withStore(ASSETS_STORE, 'readwrite', (s) => s.delete(hash));
	}

	/** @returns {AsyncGenerator<string>} */
	async *keys() {
		const all = /** @type {IDBValidKey[]} */ (await withStore(ASSETS_STORE, 'readonly', (s) => s.getAllKeys()));
		for (const key of all) yield String(key);
	}

	/** @param {string} hash @returns {Promise<AssetMeta | null>} */
	async stat(hash) {
		const record = await withStore(ASSETS_STORE, 'readonly', (s) => s.get(hash));
		return record ? { mime: record.mime, name: record.name, size: record.size } : null;
	}

	// TODO(ADR-014 lot 3): cleanup of unreferenced files (delete a file no document lists in `docRefs`; `history: 'compact'`).

	// ── docRefs: which files each document references ─────────────────────────────────────────

	/**
	 * Record the files `docId` references (replaces the previous list).
	 * @param {string} docId @param {Iterable<string>} hashes @returns {Promise<void>}
	 */
	async setDocRefs(docId, hashes) {
		await withStore(DOC_REFS_STORE, 'readwrite', (s) => s.put({ docId, hashes: [...hashes], savedAt: Date.now() }));
	}

	/** @param {string} docId @returns {Promise<Set<string>>} */
	async getDocRefs(docId) {
		const record = await withStore(DOC_REFS_STORE, 'readonly', (s) => s.get(docId));
		return new Set(record?.hashes ?? []);
	}

	/** @param {string} docId @returns {Promise<void>} */
	async clearDocRefs(docId) {
		await withStore(DOC_REFS_STORE, 'readwrite', (s) => s.delete(docId));
	}

	/** Every file referenced by at least one document. @returns {Promise<Set<string>>} */
	async referencedHashes() {
		const records = /** @type {Array<{ hashes: string[] }>} */ (await withStore(DOC_REFS_STORE, 'readonly', (s) => s.getAll()));
		return new Set(records.flatMap((r) => r.hashes));
	}
}
