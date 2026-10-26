const DB_NAME = 'nabu';
/** Object store of the document snapshots (keyPath `docId`). */
const STORE = 'snapshots';
/** Object store of the file bytes, shared by every document of the origin (keyPath `hash`) — ADR 014 §3.3. */
export const ASSETS_STORE = 'assets';
/** Object store of the files each document references (keyPath `docId`, `hashes: string[]`) — used by the cleanup (ADR 014 lot 3). */
export const DOC_REFS_STORE = 'docRefs';
/**
 * Object store of the upload outbox (keyPath `[docId, hash]`, index `docId`): the files of a document still to send to the
 * host (`files.onBeforePersist`) — ADR 014 lot 2.
 */
export const OUTBOX_STORE = 'outbox';
/**
 * Object store of the PREVIOUS good snapshot of each document (keyPath `docId`, same record shape as `snapshots`) — ADR 010
 * (2026-10, theme 8): every successful save moves the snapshot it replaces here, so a corrupted latest snapshot can fall back on it.
 */
export const BACKUPS_STORE = 'backups';
/**
 * Object store of the records that could not be read (keyPath `key`, index `docId`): moved aside, never deleted, when a document
 * is recovered from its backup or restarted empty — ADR 010 (2026-10, theme 8).
 */
export const QUARANTINE_STORE = 'quarantine';
/**
 * Schema version. 1: `snapshots`. 2 (ADR 014): + `assets` and `docRefs`. 3 (ADR 014 lot 2): + `outbox`. 4 (ADR 010, 2026-10): +
 * `backups` and `quarantine`. An upgrade only ADDS the missing stores, so the data of an older database (snapshots, files, docRefs,
 * outbox) is untouched and a document without a backup loads exactly as before.
 */
const DB_VERSION = 4;
/** How long a `blocked` upgrade (another tab keeps an old connection open and does not close it) is waited for before giving up. */
const BLOCKED_TIMEOUT_MS = 3000;

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
			if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
				db.createObjectStore(OUTBOX_STORE, { keyPath: ['docId', 'hash'] }).createIndex('docId', 'docId');
			}
			if (!db.objectStoreNames.contains(BACKUPS_STORE)) {
				db.createObjectStore(BACKUPS_STORE, { keyPath: 'docId' });
			}
			if (!db.objectStoreNames.contains(QUARANTINE_STORE)) {
				db.createObjectStore(QUARANTINE_STORE, { keyPath: 'key' }).createIndex('docId', 'docId');
			}
		};

		let gaveUp = false;
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let blockedTimer;
		request.onblocked = () => {
			// An upgrade waits for the other connections to close (they do on `versionchange`). If one never does, do not hang forever.
			blockedTimer = setTimeout(() => { gaveUp = true; reject(new Error('IndexedDB: opening the database is blocked by another tab')); }, BLOCKED_TIMEOUT_MS);
		};
		request.onsuccess = (event) => {
			clearTimeout(blockedTimer);
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
			if (gaveUp) { db.close(); return; }
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onerror = (event) => { clearTimeout(blockedTimer); reject(/** @type {IDBOpenDBRequest} */ (event.target).error); };
	});
}

/**
 * A connection kept open for the lifetime of a persisted editor. Opening a database is asynchronous; a save started from
 * `pagehide` must create its transaction SYNCHRONOUSLY (the page may be gone by the time an `open` request answers), hence one
 * connection opened at boot and reused. It reopens by itself when the browser or another tab closed it (`versionchange`, `close`).
 */
export class IDBConnection {
	/** @type {IDBDatabase | null} */
	#db = null;
	/** @type {Promise<IDBDatabase> | null} */
	#opening = null;
	#closed = false;

	/** The open database (opens it if needed). Rejects when IndexedDB is unavailable. @returns {Promise<IDBDatabase>} */
	get() {
		if (this.#db) return Promise.resolve(this.#db);
		if (!this.#opening) {
			this.#opening = openDB().then((db) => {
				this.#opening = null;
				if (this.#closed) { db.close(); throw new Error('IndexedDB connection closed'); }
				this.#db = db;
				const forget = () => { if (this.#db === db) this.#db = null; };
				db.addEventListener('close', forget);
				db.addEventListener('versionchange', forget);
				return db;
			}, (error) => { this.#opening = null; throw error; });
		}
		return this.#opening;
	}

	/** Close the connection for good (the editor is released). */
	close() {
		this.#closed = true;
		this.#db?.close();
		this.#db = null;
	}
}

/**
 * Run `work` in ONE transaction over `storeNames`; resolves when the transaction completes, rejects when it aborts. An exception
 * thrown by `work` (or reported with `fail`, from a request callback: an exception in an event handler would be reported as
 * uncaught) aborts the transaction and rejects with it: nothing is half written.
 * @param {IDBConnection | null | undefined} conn a shared connection (kept open), or none (a connection opened for this call only)
 * @param {string[]} storeNames
 * @param {IDBTransactionMode} mode
 * @param {(stores: IDBObjectStore[], fail: (error: unknown) => void) => void | boolean} work returns `true` when it issued all its requests synchronously
 * @returns {Promise<void>}
 */
async function transact(conn, storeNames, mode, work) {
	const db = conn ? await conn.get() : await openDB();
	return new Promise((resolve, reject) => {
		/** @type {unknown} */
		let failure;
		/** @type {IDBTransaction} */
		let tx;
		try {
			tx = db.transaction(storeNames, mode);
		} catch (error) {
			if (!conn) db.close();
			reject(error);
			return;
		}
		/** @param {unknown} error */
		const fail = (error) => { failure = error; try { tx.abort(); } catch { /* already finished */ } };
		tx.oncomplete = () => { if (!conn) db.close(); resolve(); };
		tx.onabort = tx.onerror = () => { if (!conn) db.close(); reject(failure ?? tx.error ?? new Error('IndexedDB transaction aborted')); };
		try {
			// `true`: every request was issued, commit now instead of at the end of the task (a page that is going away may not get that far)
			if (work(storeNames.map((name) => tx.objectStore(name)), fail) === true) tx.commit?.();
		} catch (error) {
			fail(error);
		}
	});
}

/** Whether `value` is something Loro could import (non-empty bytes). @param {unknown} value @returns {value is Uint8Array} */
export const isSnapshotBytes = (value) => value instanceof Uint8Array && value.length > 0;

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
 * @typedef {object} SnapshotRecord
 * @property {string} docId
 * @property {unknown} snapshot normally a `Uint8Array`; whatever is stored when the record is corrupted
 * @property {number} [savedAt]
 */

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
 * The raw stored records of a document: the current one and the backup (the snapshot the last save replaced). Not validated:
 * a `snapshot` that is not bytes is returned as is, so the caller can quarantine it.
 * @param {string} docId
 * @param {IDBConnection} [conn]
 * @returns {Promise<{ current: SnapshotRecord | null, backup: SnapshotRecord | null }>}
 */
export async function loadRecords(docId, conn) {
	let current = null;
	let backup = null;
	await transact(conn, [STORE, BACKUPS_STORE], 'readonly', ([snapshots, backups]) => {
		const a = snapshots.get(docId);
		const b = backups.get(docId);
		a.onsuccess = () => { current = a.result ?? null; };
		b.onsuccess = () => { backup = b.result ?? null; };
	});
	return { current, backup };
}

/**
 * Save a snapshot to IndexedDB, in ONE transaction: the snapshot it replaces becomes the document's backup.
 *
 * With `previous` (the bytes the caller wrote or loaded last) every request is issued SYNCHRONOUSLY, which a save started from
 * `pagehide` needs: a request issued from a callback (after reading the old record) comes too late, the page is gone. Without it the
 * stored record is read first, in the same transaction (an unreadable one never replaces a good backup).
 * @param {string} docId
 * @param {Uint8Array} snapshot
 * @param {object} [options]
 * @param {IDBConnection} [options.conn] a connection kept open (a save started from `pagehide` needs one)
 * @param {{ snapshot: Uint8Array, savedAt?: number } | null} [options.previous] what is stored right now, to keep as the backup (`null`: nothing to keep)
 * @param {boolean} [options.rotate] default `true`. `false`: do not keep the replaced record as the backup
 * @param {boolean} [options.dropBackup] delete the backup (a compaction: the history it dropped must not survive in a backup)
 * @returns {Promise<SnapshotRecord>} the record that was written
 */
export async function saveSnapshot(docId, snapshot, { conn, previous, rotate = true, dropBackup = false } = {}) {
	const record = { docId, snapshot, savedAt: Date.now() };
	await transact(conn, [STORE, BACKUPS_STORE], 'readwrite', ([snapshots, backups], fail) => {
		if (dropBackup) backups.delete(docId);
		if (!rotate) { snapshots.put(record); return; }
		if (previous !== undefined) {
			if (previous && isSnapshotBytes(previous.snapshot)) backups.put({ docId, snapshot: previous.snapshot, savedAt: previous.savedAt });
			snapshots.put(record);
			return;
		}
		const get = snapshots.get(docId);
		get.onsuccess = () => {
			try {
				const stored = get.result;
				// An unreadable previous record never replaces a good backup
				if (stored && isSnapshotBytes(stored.snapshot)) backups.put({ docId, snapshot: stored.snapshot, savedAt: stored.savedAt });
				snapshots.put(record);
			} catch (error) {
				fail(error);
			}
		};
	});
	return record;
}

/**
 * @typedef {object} MergePlan What {@link saveMerged}'s `prepare` decides, from the record stored RIGHT NOW.
 * @property {Uint8Array | null} snapshot the bytes to write, or `null`: the stored record already holds everything (nothing is written)
 * @property {unknown} [unmerged] the stored record could not be merged into the document (unreadable bytes, or a shallow snapshot
 *   that does not follow from this document): it is copied to the `quarantine` store before being replaced, never lost
 */

/**
 * Save a snapshot while MERGING what another tab stored (ADR 010, multi-tab, P-94), atomically: ONE read-write transaction reads the
 * stored record, hands it to `prepare` (SYNCHRONOUS: it imports whatever the document lacks, then exports), and writes the result.
 * IndexedDB serialises read-write transactions on a store across tabs, so two tabs saving at the same time cannot overwrite each
 * other: the second one reads what the first wrote. The record it replaces becomes the backup, as in {@link saveSnapshot}.
 *
 * Not for a page that is going away (the write is issued from a request callback: see `previous` in {@link saveSnapshot}).
 * @param {string} docId
 * @param {(stored: SnapshotRecord | null) => MergePlan} prepare
 * @param {object} [options]
 * @param {IDBConnection} [options.conn]
 * @returns {Promise<{ stored: SnapshotRecord | null, written: SnapshotRecord | null, quarantinedKey: string | null }>}
 */
export async function saveMerged(docId, prepare, { conn } = {}) {
	/** @type {SnapshotRecord | null} */
	let stored = null;
	/** @type {SnapshotRecord | null} */
	let written = null;
	/** @type {string | null} */
	let quarantinedKey = null;
	await transact(conn, [STORE, BACKUPS_STORE, QUARANTINE_STORE], 'readwrite', ([snapshots, backups, quarantined], fail) => {
		const get = snapshots.get(docId);
		get.onsuccess = () => {
			try {
				stored = get.result ?? null;
				const plan = prepare(stored);
				if (stored && plan.unmerged !== undefined) {
					const at = Date.now();
					quarantinedKey = `${docId}@${at}-unmerged`;
					quarantined.put(/** @type {QuarantinedRecord} */ ({
						key: quarantinedKey, docId, source: 'snapshot', snapshot: stored.snapshot, savedAt: stored.savedAt, quarantinedAt: at,
						error: plan.unmerged instanceof Error ? `${plan.unmerged.name}: ${plan.unmerged.message}` : String(plan.unmerged),
					}));
				}
				if (!plan.snapshot) return;
				// An unreadable previous record never replaces a good backup
				if (stored && isSnapshotBytes(stored.snapshot)) backups.put({ docId, snapshot: stored.snapshot, savedAt: stored.savedAt });
				written = { docId, snapshot: plan.snapshot, savedAt: Date.now() };
				snapshots.put(written);
			} catch (error) {
				fail(error);
			}
		};
	});
	return { stored, written, quarantinedKey };
}

/**
 * @typedef {object} QuarantinedRecord
 * @property {string} key `<docId>@<timestamp>[-backup]`
 * @property {string} docId
 * @property {'snapshot' | 'backup'} source which record it was
 * @property {unknown} snapshot the unreadable value, untouched
 * @property {number | undefined} savedAt when it had been saved
 * @property {number} quarantinedAt
 * @property {string} error why it was refused
 */

/**
 * Move unreadable records aside and fix the live records, in ONE transaction (nothing is ever deleted without a copy being kept):
 * each entry of `quarantine` is copied into the `quarantine` store; then the current snapshot is replaced by `restore` (the good
 * backup) or removed (`restore: null`, the document restarts empty), and the backup is removed when it was itself unreadable.
 * @param {string} docId
 * @param {{ source: 'snapshot' | 'backup', record: SnapshotRecord, error: unknown }[]} quarantine
 * @param {SnapshotRecord | null} restore the readable backup to put back as the current snapshot, or `null`
 * @param {number} at
 * @param {IDBConnection} [conn]
 * @returns {Promise<string[]>} the keys of the quarantined copies, in the order of `quarantine`
 */
export async function quarantineRecords(docId, quarantine, restore, at, conn) {
	const keys = quarantine.map(({ source }) => `${docId}@${at}${source === 'backup' ? '-backup' : ''}`);
	await transact(conn, [STORE, BACKUPS_STORE, QUARANTINE_STORE], 'readwrite', ([snapshots, backups, quarantined]) => {
		quarantine.forEach(({ source, record, error }, i) => {
			quarantined.put(/** @type {QuarantinedRecord} */ ({
				key: keys[i], docId, source, snapshot: record.snapshot, savedAt: record.savedAt, quarantinedAt: at,
				error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
			}));
			if (source === 'backup') backups.delete(docId);
		});
		if (restore) snapshots.put({ docId, snapshot: restore.snapshot, savedAt: restore.savedAt });
		else if (quarantine.some(({ source }) => source === 'snapshot')) snapshots.delete(docId);
	});
	return keys;
}

/**
 * The records moved aside for a document (newest first).
 * @param {string} docId
 * @param {IDBConnection} [conn]
 * @returns {Promise<QuarantinedRecord[]>}
 */
export async function listQuarantined(docId, conn) {
	/** @type {QuarantinedRecord[]} */
	let out = [];
	await transact(conn, [QUARANTINE_STORE], 'readonly', ([store]) => {
		const get = store.index('docId').getAll(docId);
		get.onsuccess = () => { out = get.result; };
	});
	return out.sort((a, b) => b.quarantinedAt - a.quarantinedAt);
}

/**
 * Delete a document from IndexedDB: its snapshot, its backup AND the records that were moved aside.
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteSnapshot(docId) {
	await transact(null, [STORE, BACKUPS_STORE, QUARANTINE_STORE], 'readwrite', ([snapshots, backups, quarantined]) => {
		snapshots.delete(docId);
		backups.delete(docId);
		const keys = quarantined.index('docId').getAllKeys(docId);
		keys.onsuccess = () => { for (const key of keys.result) quarantined.delete(key); };
	});
}
