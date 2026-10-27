import { ASSETS_STORE, DOC_REFS_STORE, withStore, openDB } from './indexeddb.js';

/**
 * @typedef {import('../files/store.js').AssetStore} AssetStore
 * @typedef {import('../files/store.js').AssetMeta} AssetMeta
 */

/**
 * The {@link AssetStore} of a persisted editor (ADR 014 §3.3): database `nabu`, object store `assets` (`{ hash, blob, mime,
 * name, size, savedAt }`), SHARED by every document of the origin — the same image used in two documents is stored once.
 * A second object store, `docRefs` (`{ docId, hashes }`), records which files each document references; the persisted
 * editor refreshes it on every save, and the cleanup (compaction, `clearPersistence()`) only deletes a file no document references.
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

	/**
	 * When the file was last stored or re-added (`touch`), `null` if unknown (no record, or a record without `savedAt`).
	 * @param {string} hash @returns {Promise<number | null>}
	 */
	async savedAt(hash) {
		const record = await withStore(ASSETS_STORE, 'readonly', (s) => s.get(hash));
		return typeof record?.savedAt === 'number' ? record.savedAt : null;
	}

	/**
	 * A file that is already stored is added again (deduplication): refresh its `savedAt`, so that a release in another tab keeps
	 * it during the grace period even though that tab does not see the new reference yet. One transaction.
	 * @param {string} hash @returns {Promise<void>}
	 */
	async touch(hash) {
		const db = await openDB();
		await new Promise((resolve, reject) => {
			const tx = db.transaction(ASSETS_STORE, 'readwrite');
			const store = tx.objectStore(ASSETS_STORE);
			const get = store.get(hash);
			get.onsuccess = () => { if (get.result) store.put({ ...get.result, savedAt: Date.now() }); };
			tx.oncomplete = () => { db.close(); resolve(undefined); };
			tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
		});
	}

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
