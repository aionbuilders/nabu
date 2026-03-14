const DB_NAME = 'nabu';
const STORE = 'snapshots';
const DB_VERSION = 1;

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'docId' });
			}
		};

		request.onsuccess = (event) => resolve(/** @type {IDBOpenDBRequest} */ (event.target).result);
		request.onerror = (event) => reject(/** @type {IDBOpenDBRequest} */ (event.target).error);
	});
}

/**
 * Load a snapshot from IndexedDB.
 * @param {string} docId
 * @returns {Promise<Uint8Array | null>}
 */
export async function loadSnapshot(docId) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const request = tx.objectStore(STORE).get(docId);
		request.onsuccess = (event) => {
			const record = /** @type {IDBRequest} */ (event.target).result;
			resolve(record ? record.snapshot : null);
		};
		request.onerror = (event) => reject(/** @type {IDBRequest} */ (event.target).error);
	});
}

/**
 * Save a snapshot to IndexedDB.
 * @param {string} docId
 * @param {Uint8Array} snapshot
 * @returns {Promise<void>}
 */
export async function saveSnapshot(docId, snapshot) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const request = tx.objectStore(STORE).put({ docId, snapshot, savedAt: Date.now() });
		request.onsuccess = () => resolve();
		request.onerror = (event) => reject(/** @type {IDBRequest} */ (event.target).error);
	});
}

/**
 * Delete a snapshot from IndexedDB.
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteSnapshot(docId) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const request = tx.objectStore(STORE).delete(docId);
		request.onsuccess = () => resolve();
		request.onerror = (event) => reject(/** @type {IDBRequest} */ (event.target).error);
	});
}
