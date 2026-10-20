const DB_NAME = 'nabu';
/** Object store of the document snapshots (keyPath `docId`). */
const STORE = 'snapshots';
/** Object store of the file bytes, shared by every document of the origin (keyPath `hash`) — ADR 014 §3.3. */
export const ASSETS_STORE = 'assets';
/** Object store of the files each document references (keyPath `docId`, `hashes: string[]`) — used by the future cleanup. */
export const DOC_REFS_STORE = 'docRefs';
/**
 * Schema version. 1: `snapshots`. 2 (ADR 014): + `assets` and `docRefs`. The upgrade only ADDS the missing stores, so the
 * snapshots of a version 1 database are untouched.
 */
const DB_VERSION = 2;

/**
 * Open (and upgrade if needed) the `nabu` database. The connection closes itself when another context (a newer
 * version of the code in another tab) asks to upgrade, so an upgrade is never blocked by an idle connection.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'docId' });
			}
			if (!db.objectStoreNames.contains(ASSETS_STORE)) {
				db.createObjectStore(ASSETS_STORE, { keyPath: 'hash' });
			}
			if (!db.objectStoreNames.contains(DOC_REFS_STORE)) {
				db.createObjectStore(DOC_REFS_STORE, { keyPath: 'docId' });
			}
		};

		request.onsuccess = (event) => {
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onerror = (event) => reject(/** @type {IDBOpenDBRequest} */ (event.target).error);
	});
}

/**
 * Run one request of an object store in its own transaction and close the connection afterwards.
 * @template T
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} run
 * @returns {Promise<T>}
 */
export async function withStore(storeName, mode, run) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, mode);
		const request = run(tx.objectStore(storeName));
		/** @type {any} */
		let result;
		request.onsuccess = () => { result = request.result; };
		tx.oncomplete = () => { db.close(); resolve(result); };
		tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? request.error); };
	});
}

/**
 * Load a snapshot from IndexedDB.
 * @param {string} docId
 * @returns {Promise<Uint8Array | null>}
 */
export async function loadSnapshot(docId) {
	const record = await withStore(STORE, 'readonly', (s) => s.get(docId));
	return record ? record.snapshot : null;
}

/**
 * Save a snapshot to IndexedDB.
 * @param {string} docId
 * @param {Uint8Array} snapshot
 * @returns {Promise<void>}
 */
export async function saveSnapshot(docId, snapshot) {
	await withStore(STORE, 'readwrite', (s) => s.put({ docId, snapshot, savedAt: Date.now() }));
}

/**
 * Delete a snapshot from IndexedDB.
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteSnapshot(docId) {
	await withStore(STORE, 'readwrite', (s) => s.delete(docId));
}
