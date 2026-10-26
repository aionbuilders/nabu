import { Nabu } from '../blocks/nabu.svelte.js';
import { FullPreset, tabDefaultFor } from '../presets.js';
import { Files } from '../files/files.svelte.js';
import { MemoryAssetStore } from '../files/store.js';
import { loadSnapshot, saveSnapshot, saveMerged, deleteSnapshot, loadRecords, quarantineRecords, listQuarantined, IDBConnection, isSnapshotBytes } from './indexeddb.js';
import { createAutosave, resolveMaxWait } from './autosave.js';
import { resolveLoad, describeRecovery } from './recovery.js';
import { PersistenceState } from './state.svelte.js';
import { readTail, writeTail, clearTail, parkTail, writeRev, readRev, clearRev, revToken } from './tail.js';
import { mergeStored } from './merge.js';
import { startSync } from './sync.js';
import { IndexedDBAssetStore } from './asset-store.js';
import { IndexedDBOutbox } from './outbox.js';
import { parseHistory } from './history.js';
import { runCompaction } from './compact.js';
import { releaseFiles } from './release.js';

export { loadSnapshot, saveSnapshot, deleteSnapshot, loadRecords, listQuarantined, IndexedDBAssetStore, IndexedDBOutbox, PersistenceState };

/**
 * @import { Extension } from '../utils/extensions.js';
 * @import { CompactOptions } from './history.js';
 * @import { CompactResult } from './compact.js';
 * @import { Recovery } from './recovery.js';
 */

/** Persistence problems are shown even when `nabu.debugging` is off (`nabu.warn` is silent then): the host's user may be losing work. @param {string} message */
const warn = (message) => console.warn('[Nabu]', message);

/**
 * Create a Nabu editor instance with automatic IndexedDB persistence.
 *
 * Async counterpart of `createEditor()` — same `{ preset, extensions }` signature,
 * extended with a required `docId` for storage.
 *
 * On first call, the document is empty (only the default paragraph from ParagraphExtension).
 * On subsequent calls, the document state is restored from the last saved snapshot.
 *
 * The bytes of the files (images, videos…) are NOT saved in the snapshot (ADR 014): they go to an `IndexedDBAssetStore`
 * (base `nabu`, object store `assets`, shared by every document of the origin), unless `files.store` provides another one.
 * The document only keeps references and a small metadata index; the store also records which files each document references.
 * With a host (`files.onBeforePersist`) the uploads still to do are listed in an `IndexedDBOutbox` (object store `outbox`, unless
 * `files.outbox` provides another one): an upload interrupted by a closed tab RESUMES when the document is opened again.
 *
 * History (ADR 014 §3.6): the default `history: 'full'` NEVER compacts or trims anything (the whole evolution of the document
 * is kept and saved, whatever the number of sessions). `history: { mode: 'compact', retain, onBeforeCompact }` opts in to a
 * compaction when the document is OPENED (after loading, migration and upload reconciliation; never mid-session): history older
 * than `retain` is dropped and the files only that history referenced are released. See {@link CompactOptions} and `nabu.compact()`.
 *
 * Timestamps of the changes are recorded (`doc.setRecordTimestamp(true)`) so a retention window can be honoured.
 *
 * Robustness (ADR 010, theme 8): the autosave also happens at most every `maxWait` ms during a continuous burst, and immediately when
 * the page is hidden (`visibilitychange` → `hidden`, `pagehide`). Every save keeps the snapshot it replaces as a BACKUP. A stored
 * snapshot that cannot be read is moved aside (never deleted: the `quarantine` object store), the backup is tried, else the editor
 * starts empty — it always boots, and `nabu.persistence.recovery` / `onRecover` tell the host what happened. When IndexedDB is not
 * usable the editor boots IN MEMORY (`nabu.persistence.available === false`, status `'unavailable'`): `createPersistedEditor` does not reject.
 *
 * Several tabs (ADR 010, P-94): two tabs on the same `docId` never overwrite each other. EVERY save first merges what is stored (read and
 * written in one IndexedDB transaction: the changes another tab saved are imported into the live document, not as undo steps, the caret
 * stays on its character), and, with `sync` (default), the tabs also exchange their changes LIVE through a `BroadcastChannel`
 * (`nabu:<docId>`): an edit made in one tab appears in the others at once.
 *
 * The instance gains extra members:
 * - `nabu.persistence` — reactive state: `status` (`'saved' | 'pending' | 'saving' | 'error' | 'unavailable'`), `lastSavedAt`,
 *   `lastError`, `available`, `recovery`, `sync`, and `dispose()` (stop autosave, remove the page listeners, close the sync channel and
 *   the connection)
 * - `nabu.saveNow()` — force an immediate save (returns a Promise; rejects if the save fails)
 * - `nabu.compact({ retain, onBeforeCompact })` — explicit compaction (returns a `CompactResult`, never throws for a refusal)
 * - `nabu.clearPersistence()` — delete the stored snapshot and release the document's files (returns a Promise)
 * - `nabu.isNew` — `true` if no previous snapshot was found (fresh document, or nothing readable was left: `persistence.recovery.kind === 'empty'`)
 *
 * @param {object} options
 * @param {string} options.docId - Unique identifier for this document in IndexedDB
 * @param {Extension[]} [options.preset] - Extension preset (default: FullPreset)
 * @param {Extension[]} [options.extensions] - Additional extensions to append
 * @param {number} [options.debounce] - Auto-save debounce delay in ms (default: 2000)
 * @param {number} [options.maxWait] - Longest time (ms) a continuous burst of edits goes without a save (default: 3000, never shorter than
 *   `debounce`; `0` / `Infinity`: no maximum, the autosave only happens after a pause)
 * @param {(error: unknown) => void} [options.onSaveError] - Called when an AUTOMATIC save fails (quota…); `nabu.persistence.status` is `'error'` and the
 *   next change retries. `saveNow()` rejects for its awaiter instead (the hook is not called for it)
 * @param {(recovery: Recovery) => void} [options.onRecover] - Called at boot when the stored document could not be read (see `nabu.persistence.recovery`)
 * @param {boolean} [options.sync] - Live sync between the tabs that edit the same `docId` through a `BroadcastChannel` (default `true`; `false`
 *   disables it; a browser without `BroadcastChannel` skips it silently). The merge on save does not depend on it. `nabu.persistence.sync` tells whether it runs.
 * @param {import('../files/files.svelte.js').FilesConfig} [options.files] - File handling; `files.store` replaces the default IndexedDB asset store
 * @param {'full' | { mode: 'full' } | { mode: 'compact', retain: number | string, onBeforeCompact?: CompactOptions['onBeforeCompact'] }} [options.history] - `'full'` (default): nothing is ever compacted.
 *   `{ mode: 'compact', retain, onBeforeCompact }`: compact at open (`retain`: ms, `'30d'`, `'12h'`, or `0` = keep no past history).
 * @param {import('../utils/placeholders.js').PlaceholdersOption} [options.placeholders] - Forwarded to Nabu
 *   (any other Nabu init option, e.g. `files`, is forwarded too; `files.store` replaces the default IndexedDB asset store)
 * @param {boolean} [options.spellcheck] - Forwarded to Nabu (default `true`)
 * @param {string} [options.lang] - Forwarded to Nabu (BCP 47 tag of the content)
 * @returns {Promise<Nabu>}
 *
 * @example
 * // Fresh or restored editor, full preset
 * const engine = await createPersistedEditor({ docId: 'my-note' });
 *
 * @example
 * // Document preset with custom extension
 * const engine = await createPersistedEditor({
 *   docId: 'article-42',
 *   preset: DocumentPreset,
 *   extensions: [MyCustomExtension],
 * });
 */
export async function createPersistedEditor({
	docId,
	preset = FullPreset,
	extensions = [],
	debounce = 2000,
	maxWait,
	sync = true,
	onSaveError,
	onRecover,
	history,
	...init
} = {}) {
	const historyConfig = parseHistory(history); // a typo in `history` must fail loudly, before anything is read
	const maxWaitMs = resolveMaxWait(maxWait, debounce);
	const conn = new IDBConnection();

	// ── 1. read what is stored. IndexedDB missing / refusing / blocked: boot in memory, never reject ──
	/** @type {{ current: any, backup: any } | null} */
	let records = null;
	/** @type {unknown} */
	let unavailableError = null;
	try {
		records = await loadRecords(docId, conn);
	} catch (error) {
		unavailableError = error ?? new Error('IndexedDB is not available');
	}
	let available = !unavailableError;
	const store = init.files?.store ?? (available ? new IndexedDBAssetStore() : new MemoryAssetStore());
	const outbox = init.files?.outbox ?? (available ? new IndexedDBOutbox(docId) : undefined);

	/** @param {Uint8Array | null} snapshot */
	const build = (snapshot) => {
		const nabu = new Nabu({
			tabDefault: tabDefaultFor(preset),
			...init,
			files: { ...init.files, store, ...(outbox ? { outbox } : {}) },
			extensions: [...preset, ...extensions],
			...(snapshot ? { snapshot } : {})
		});
		// Timestamps make a retention window (`retain: '30d'`) possible. Off by default in Loro; harmless to enable (a few bytes per change).
		nabu.doc.setRecordTimestamp(true);
		return nabu;
	};

	// ── 2. open the document: the current snapshot, else the backup, else empty. A record that cannot be read is moved aside, never deleted ──
	const decision = available
		? resolveLoad(/** @type {NonNullable<typeof records>} */ (records), (snapshot) => {
			if (!isSnapshotBytes(snapshot)) throw new TypeError('the stored snapshot is not a non-empty byte array');
			return build(snapshot);
		})
		: /** @type {any} */ ({ outcome: 'new', value: null, used: null, failed: [] });
	/** @type {Recovery | null} */
	let recovery = null;
	/** @type {unknown} */
	let quarantineError = null;
	if (decision.outcome === 'backup' || decision.outcome === 'empty') {
		const at = Date.now();
		try {
			const keys = await quarantineRecords(docId, decision.failed, decision.outcome === 'backup' ? decision.used : null, at, conn);
			recovery = describeRecovery(decision, keys, at);
		} catch (error) {
			// The unreadable record could not be copied aside: touching the stored data is not safe, so nothing will be written (memory only).
			quarantineError = error;
			recovery = describeRecovery(decision, [], at);
			available = false;
		}
	}
	const initialSnapshot = decision.used ? /** @type {Uint8Array} */ (decision.used.snapshot) : null;

	/** The reactive state exposed as `nabu.persistence`. */
	const state = new PersistenceState(docId);
	state.available = available;
	state.recovery = recovery;
	if (!available) { state.status = 'unavailable'; state.lastError = quarantineError ?? unavailableError; }

	/** The version of a document, to tell whether something changed since the last save. @param {import('loro-crdt').LoroDoc} doc */
	const versionKey = (doc) => JSON.stringify(doc.oplogFrontiers());

	/**
	 * Wire autosave and the extra methods onto `nabu`. Returns `dispose()` (stops this wiring: used for the instance that is
	 * replaced after a compaction at open, which nobody has seen).
	 * @param {Nabu} nabu @param {{ snapshot: Uint8Array, savedAt: number } | null} stored the record `nabu` was loaded from and that is
	 *   stored now (`null`: a document with nothing stored)
	 * @param {import('loro-crdt').VersionVector | undefined} storedVersion what that record contains (`undefined`: nothing, or unknown)
	 * @param {boolean} [unsaved] `nabu` holds changes that are not in the stored record (a tail was merged): a save is due
	 */
	const attach = (nabu, stored, storedVersion, unsaved = false) => {
		const loaded = stored !== null && !unsaved;
		/** What the stored record contains, to export the tail from. @type {import('loro-crdt').VersionVector | undefined} */
		let savedVersion = storedVersion;
		/** Version known to be saved (`null`: never saved). */
		let savedKey = loaded ? versionKey(nabu.doc) : null;
		/**
		 * What this editor last wrote or loaded (the record stored now, unless another tab wrote since), kept to become the backup
		 * of the next save WITHOUT reading it back first (a save from `pagehide` must issue its requests synchronously).
		 * @type {{ snapshot: Uint8Array, savedAt: number } | null}
		 */
		let lastStored = stored;
		/** Version of the last save that was STARTED (a second flush must not repeat a save that is already running). @type {string | null} */
		let requestedKey = savedKey;
		/**
		 * Where the last compaction of THIS session cut the history. The live document still holds the older history (Loro cannot
		 * trim it in place), so from then on every save is a shallow snapshot at that version: the saved document stays compacted.
		 * @type {{ peer: `${number}`, counter: number }[] | undefined}
		 */
		let compactedAt;
		/** Saves and the critical part of a compaction never overlap. */
		let chain = Promise.resolve();
		/** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
		const lock = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => {}, () => {}); return run; };

		/**
		 * Files a release kept because they were too recent to delete (`files.releaseGraceMs`). They stay in this document's `docRefs`
		 * (so they are tracked, and nobody deletes them meanwhile) and are reconsidered by the next compaction / `clearPersistence()`.
		 * Loaded from the stored `docRefs` the first time (what the index does not list is what an earlier session held back).
		 * @type {Set<string>}
		 */
		const held = new Set();
		let heldLoaded = false;
		const loadHeld = async () => {
			if (heldLoaded) return;
			heldLoaded = true;
			const reader = /** @type {any} */ (store);
			if (typeof reader.getDocRefs !== 'function') return;
			const indexed = new Set(Files.get(nabu).indexedHashes());
			for (const hash of await reader.getDocRefs(docId)) if (!indexed.has(hash)) held.add(hash);
		};

		/** Record which files the document references (the store's `docRefs`, used by the cleanup): its index, plus the files held back. */
		const saveRefs = async () => {
			const refs = /** @type {any} */ (store).setDocRefs;
			if (typeof refs !== 'function') return;
			await loadHeld();
			await refs.call(store, docId, new Set([...Files.get(nabu).indexedHashes(), ...held]));
		};

		let disposed = false;
		/** True while a save imports the stored record into the document (see the `doc.subscribe` below). */
		let mergingStored = false;

		/** Whether there is anything not stored yet (a save scheduled, a change since the last save, a failed save to retry). */
		const isUnsaved = () => autosave.pending()
			|| state.status === 'error'
			|| nabu.doc.getPendingTxnLength() > 0
			|| (requestedKey !== null && versionKey(nabu.doc) !== requestedKey);

		/** Never throws away the status of a change that came while a save was running. */
		const settle = () => { state.status = isUnsaved() ? 'pending' : 'saved'; };

		/** Whether a record is the one this editor wrote or loaded last (so nobody else wrote since: nothing to merge). @param {{ snapshot: Uint8Array, savedAt?: number }} record */
		const isMine = (record) => lastStored !== null && record.savedAt === lastStored.savedAt && record.snapshot.length === lastStored.snapshot.length;

		/**
		 * Save the document. By default the save MERGES what is stored first (P-94): in one read-write transaction the stored record is read,
		 * whatever it holds that this document lacks is imported, and the result is exported and written (nothing at all when the stored
		 * record already holds everything). `blind` (a page that is going away, nobody else wrote since) skips the read, so that every request
		 * is issued synchronously.
		 * @param {{ blind?: boolean }} [options]
		 */
		const save = ({ blind = false } = {}) => lock(async () => {
			if (!available) throw new Error('persistence is unavailable: IndexedDB cannot be used, the document is only in memory');
			if (disposed) throw new Error('persistence was disposed');
			requestedKey = versionKey(nabu.doc);
			state.status = 'saving';
			try {
				/** @type {{ snapshot: Uint8Array, savedAt: number }} */
				let record;
				/** The version / key of the document at the moment it was exported (a merge may have moved them). */
				let version = nabu.doc.version();
				let key = versionKey(nabu.doc);
				const exportDoc = () => (compactedAt
					? nabu.doc.export({ mode: 'shallow-snapshot', frontiers: compactedAt })
					: nabu.doc.export({ mode: 'snapshot' }));
				if (blind) {
					const snap = exportDoc();
					version = nabu.doc.version(); // (the export above committed any pending change: this is what `snap` contains)
					key = versionKey(nabu.doc);
					record = /** @type {{ snapshot: Uint8Array, savedAt: number }} */ (await saveSnapshot(docId, snap, { conn, previous: lastStored }));
				} else {
					const { stored, written, quarantinedKey } = await saveMerged(docId, (found) => {
						/** @type {unknown} */
						let unmerged;
						let covers = false;
						if (found && !isSnapshotBytes(found.snapshot)) {
							unmerged = new TypeError('the stored snapshot is not a non-empty byte array');
						} else if (found && !isMine(/** @type {any} */ (found))) {
							mergingStored = true; // (Loro may deliver the events of the import before this callback returns)
							try {
								const merge = mergeStored(nabu.doc, /** @type {Uint8Array} */ (found.snapshot), (bytes) => nabu.importRemote(bytes));
								covers = merge.covers;
								if (!merge.merged) unmerged = new Error('the stored document holds changes this one cannot merge (a compacted copy saved by another tab)');
							} catch (error) {
								unmerged = error ?? new Error('the stored document could not be merged');
							} finally {
								mergingStored = false;
							}
						}
						const snapshot = covers && !compactedAt && unmerged === undefined ? null : exportDoc();
						version = nabu.doc.version();
						key = requestedKey = versionKey(nabu.doc);
						return unmerged === undefined ? { snapshot } : { snapshot, unmerged };
					}, { conn });
					if (quarantinedKey) warn(`persistence: the stored copy of "${docId}" could not be merged with this tab and is kept in the "quarantine" store (${quarantinedKey}); it was replaced by this tab's document`);
					const kept = written ?? stored;
					if (!kept || !isSnapshotBytes(kept.snapshot)) throw new Error('nothing was saved');
					record = { snapshot: kept.snapshot, savedAt: kept.savedAt ?? Date.now() };
				}
				lastStored = { snapshot: record.snapshot, savedAt: record.savedAt };
				savedVersion = version;
				writeRev(docId, lastStored);
				clearTail(docId); // the stored snapshot holds everything the tail had
				await saveRefs();
				savedKey = key;
				requestedKey = key;
				state.lastSavedAt = Date.now();
				state.lastError = null;
				settle();
			} catch (error) {
				requestedKey = savedKey; // the failed version is unsaved again
				state.lastError = error;
				state.status = 'error';
				throw error;
			}
		});

		/** An automatic save (timer, page hide): nobody awaits it, so a failure is reported, not thrown. */
		const autosaveRun = async (/** @type {{ blind?: boolean }} */ options = {}) => {
			try {
				await save(options);
			} catch (error) {
				warn(`persistence: could not save "${docId}" (the changes stay in memory; the next change retries): ${error}`);
				try { onSaveError?.(error); } catch (hookError) { warn(`persistence: onSaveError threw: ${hookError}`); }
			}
		};

		const autosave = createAutosave({ debounce, maxWait: maxWaitMs, run: () => { void autosaveRun(); } });

		// Auto-save: Loro fires doc.subscribe() after every committed change
		const unsubscribe = available
			? nabu.doc.subscribe((event) => {
				// What a save just imported from the stored record is in that record: it makes nothing unsaved (the event comes after the save)
				if (event.by === 'import' && (mergingStored || versionKey(nabu.doc) === savedKey || versionKey(nabu.doc) === requestedKey)) return;
				if (state.status !== 'saving') state.status = 'pending'; // a change that comes while saving is picked up by `settle()`
				autosave.touch();
			})
			: () => {};

		/** Write the changes since the last save to `localStorage`, synchronously (see tail.js). Never throws. */
		const writeTailNow = () => {
			try { writeTail(docId, nabu.doc.export(savedVersion ? { mode: 'update', from: savedVersion } : { mode: 'update' })); } catch { /* best effort */ }
		};

		/**
		 * Save RIGHT NOW (no debounce) if something is not stored: the page is going away (tab hidden, closed, navigated, reloaded).
		 * CAVEAT: IndexedDB is asynchronous, and a browser may finish unloading before the write commits (Chromium drops the transaction
		 * of a RELOAD, and often of a close). So the IndexedDB save is started at once from the connection kept open since boot (its
		 * requests are issued synchronously and committed explicitly, which is what lets it complete on a navigation or a tab switch), AND
		 * the changes since the last save are written synchronously to `localStorage` (the "tail", see tail.js), merged at the next boot.
		 * Still best effort: a crash, a killed process, or a mobile browser that never sends these events loses the last seconds.
		 */
		const flushOnHide = () => {
			if (disposed || !available || !isUnsaved()) return;
			writeTailNow();
			autosave.cancel();
			// BLIND (every request issued at once, which a page that is leaving needs) only while no other tab wrote the record since this one
			// read or wrote it; otherwise the save merges first (it completes when the tab merely goes to the background; for a page that
			// is really leaving, the tail above is what keeps the changes).
			const rev = readRev(docId);
			void autosaveRun({ blind: rev === null || rev === revToken(lastStored) });
		};
		const onVisibility = () => { if (document.visibilityState === 'hidden') flushOnHide(); };
		const listening = available && typeof document !== 'undefined' && typeof window !== 'undefined';
		if (listening) {
			document.addEventListener('visibilitychange', onVisibility);
			window.addEventListener('pagehide', flushOnHide);
		}

		// Live sync with the other tabs of this document (P-94): the channel is closed with the editor
		const syncHandle = available && sync ? startSync({
			nabu, docId,
			onError: (error) => warn(`persistence: could not apply a change from another tab of "${docId}": ${error}`),
		}) : null;
		state.sync = syncHandle !== null;

		const stop = () => {
			autosave.cancel();
			unsubscribe();
			syncHandle?.close();
			if (syncHandle) state.sync = false;
			Files.get(nabu).dispose();
			if (listening) {
				document.removeEventListener('visibilitychange', onVisibility);
				window.removeEventListener('pagehide', flushOnHide);
			}
		};

		/** @type {import('./compact.js').CompactContext} */
		const ctx = {
			nabu,
			store,
			compacting: false,
			base: () => compactedAt,
			isDirty: () => savedKey === null || versionKey(nabu.doc) !== savedKey,
			flush: async () => { autosave.cancel(); await save(); },
			lock,
			versionKey,
			candidates: async () => { await loadHeld(); return new Set([...Files.get(nabu).indexedHashes(), ...held]); },
			held: () => new Set(held),
			setHeld: (hashes) => { heldLoaded = true; held.clear(); for (const hash of hashes) held.add(hash); },
			saveRefs,
			commit: async (snapshot, frontiers, key) => {
				// the compacted snapshot replaces the history: the backup (the complete history) must not outlive it
				await saveSnapshot(docId, snapshot, { conn, rotate: false, dropBackup: true });
				lastStored = { snapshot, savedAt: Date.now() };
				savedVersion = undefined; // (unknown which changes came in meanwhile: the next tail is exported in full, or not at all)
				compactedAt = frontiers;
				savedKey = key;
				requestedKey = key;
				await saveRefs();
			},
		};

		/** Force an immediate save of the current document state. @returns {Promise<void>} */
		/** @type {any} */ (nabu).saveNow = async () => {
			autosave.cancel();
			await Files.get(nabu).whenIdle(); // files of a paste / import / migration in progress belong to this save
			await save();
		};

		/**
		 * Explicit compaction (ADR 014 §3.6): drop the history older than `retain`, keep everything newer, release the files no
		 * kept version references. Never automatic. Save first (`await nabu.saveNow()`): unsaved changes make it refuse. Resolves with a
		 * {@link CompactResult} and never throws for a refusal (pending upload, unsaved changes, `onBeforeCompact` failing…): then
		 * NOTHING was dropped. See `runCompaction` for the safeguards, the undo stack is cleared on success, and the in-memory document
		 * keeps its history until the editor is opened again (the SAVED document is compacted at once).
		 * @param {CompactOptions} options
		 * @returns {Promise<CompactResult>}
		 */
		/** @type {any} */ (nabu).compact = /** @param {CompactOptions} options */ (options) => {
			if (available) return runCompaction(ctx, options);
			parseHistory({ mode: 'compact', retain: options?.retain }); // an invalid configuration still throws
			return Promise.resolve({ compacted: false, reason: /** @type {const} */ ('failed'), error: new Error('persistence is unavailable') });
		};

		/**
		 * Delete the persisted snapshot for this document (and its backup, and the records that were moved aside) and release its files:
		 * a file is deleted from the shared store only when no other document references it; with a host, `files.onAssetReleased(url)`
		 * is called for each hosted file (Nabu deletes nothing at the host).
		 * @returns {Promise<void>}
		 */
		/** @type {any} */ (nabu).clearPersistence = async () => {
			autosave.cancel();
			if (!available) return; // nothing was ever read or written
			const files = Files.get(nabu);
			const reader = /** @type {any} */ (store);
			const mine = new Set(files.indexedHashes());
			if (typeof reader.getDocRefs === 'function') for (const hash of await reader.getDocRefs(docId)) mine.add(hash);
			const urls = files.hostUrls(mine);
			await deleteSnapshot(docId);
			if (typeof reader.clearDocRefs === 'function') await reader.clearDocRefs(docId);
			await outbox?.clear?.();
			const { skipped } = await releaseFiles(nabu, store, mine, urls);
			// too recent to delete (grace period): kept in this docId's `docRefs`, reconsidered when a document with this id is next compacted / cleared
			held.clear();
			for (const hash of skipped) held.add(hash);
			heldLoaded = true;
			if (skipped.length && typeof reader.setDocRefs === 'function') await reader.setDocRefs(docId, skipped);
			lastStored = null; // the backup was deleted with the rest
			savedVersion = undefined;
			clearTail(docId);
			clearRev(docId);
			requestedKey = versionKey(nabu.doc); // what is in memory now is deliberately NOT stored: a page hide must not bring it back
			if (state.status === 'pending') state.status = 'saved'; // the pending autosave was cancelled above: nothing is waiting
		};

		state.dispose = () => {
			if (disposed) return;
			disposed = true;
			stop();
			conn.close();
		};

		syncHandle?.hello(); // the peers send what this tab lacks (their unsaved changes)

		return { ctx, dispose: stop, touch: () => { state.status = 'pending'; autosave.touch(); } };
	};

	let nabu = decision.value ?? build(null);

	// ── 3. the tail left by a page that went away before IndexedDB could be written (see tail.js) ──
	/** What the stored record contains, to export the next tail from. @type {import('loro-crdt').VersionVector | undefined} */
	let storedVersion = initialSnapshot ? nabu.doc.version() : undefined;
	let restoredFromTail = false;
	let tailApplied = false;
	const tail = available ? readTail(docId) : null;
	if (tail) {
		if (decision.outcome === 'new') {
			// nothing stored (the first session never reached IndexedDB): the tail IS the document, history included
			try { nabu = build(tail); restoredFromTail = tailApplied = true; } catch { parkTail(docId); }
		} else {
			try {
				const before = versionKey(nabu.doc);
				const status = nabu.doc.import(tail);
				if (status.pending && status.pending.size > 0) parkTail(docId); // it does not follow from what is stored: keep it aside
				else tailApplied = versionKey(nabu.doc) !== before;
				if (!tailApplied && !(status.pending && status.pending.size > 0)) clearTail(docId); // already in the snapshot
			} catch { parkTail(docId); }
		}
	}

	let wiring = attach(nabu, available && initialSnapshot ? { snapshot: initialSnapshot, savedAt: decision.used?.savedAt ?? Date.now() } : null, storedVersion, tailApplied);
	/** @type {any} */ (nabu).persistence = state;

	if (tailApplied && available) wiring.touch(); // the merged tail is not in IndexedDB yet

	if (!available) {
		warn(unavailableError
			? `persistence: IndexedDB is not available (${unavailableError}); "${docId}" works in memory only and will not be saved`
			: `persistence: "${docId}" could not be moved aside safely (${quarantineError}); it works in memory only and will not be saved`);
	}
	if (recovery) {
		warn(recovery.kind === 'backup'
			? `persistence: the saved document "${docId}" could not be read (${recovery.error.message}); restored from the previous save, the unreadable record is kept in the "quarantine" store (${recovery.quarantinedKey})`
			: `persistence: the saved document "${docId}" could not be read (${recovery.error.message}) and no backup was usable; starting empty, the unreadable record is kept in the "quarantine" store (${recovery.quarantinedKey})`);
		try { onRecover?.(recovery); } catch (error) { warn(`persistence: onRecover threw: ${error}`); }
	}

	// `history: { mode: 'compact' }`: compact when the document is opened (never mid-session), once it is loaded, migrated and its
	// uploads reconciled. A refusal (pending upload, failing archive…) leaves the document exactly as it was.
	if (historyConfig.mode === 'compact' && initialSnapshot && available) {
		const { retain, onBeforeCompact } = historyConfig;
		const result = await runCompaction(wiring.ctx, { retain, onBeforeCompact }, { flush: true });
		if (result.compacted && result.snapshot) {
			// Replace the instance nobody has seen yet by one built from the compacted snapshot: the history is gone from memory too.
			wiring.dispose();
			nabu = build(result.snapshot);
			wiring = attach(nabu, { snapshot: result.snapshot, savedAt: Date.now() }, nabu.doc.version());
			/** @type {any} */ (nabu).persistence = state;
		} else if (result.reason !== 'nothing-to-compact') {
			nabu.warn(`history: compaction at open skipped (${result.reason}), the document is unchanged`);
		}
	}

	/** Whether this instance was created from a fresh document (no readable snapshot, no tail). */
	/** @type {any} */ (nabu).isNew = !initialSnapshot && !restoredFromTail;

	return nabu;
}
