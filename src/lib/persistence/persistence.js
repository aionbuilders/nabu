import { Nabu } from '../blocks/nabu.svelte.js';
import { FullPreset } from '../presets.js';
import { Files } from '../files/files.svelte.js';
import { loadSnapshot, saveSnapshot, deleteSnapshot } from './indexeddb.js';
import { IndexedDBAssetStore } from './asset-store.js';
import { IndexedDBOutbox } from './outbox.js';
import { parseHistory } from './history.js';
import { runCompaction } from './compact.js';
import { releaseFiles } from './release.js';

export { loadSnapshot, saveSnapshot, deleteSnapshot, IndexedDBAssetStore, IndexedDBOutbox };

/**
 * @import { Extension } from '../utils/extensions.js';
 * @import { CompactOptions } from './history.js';
 * @import { CompactResult } from './compact.js';
 */

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
 * The instance gains extra members:
 * - `nabu.saveNow()` — force an immediate save (returns a Promise)
 * - `nabu.compact({ retain, onBeforeCompact })` — explicit compaction (returns a `CompactResult`, never throws for a refusal)
 * - `nabu.clearPersistence()` — delete the stored snapshot and release the document's files (returns a Promise)
 * - `nabu.isNew` — `true` if no previous snapshot was found (fresh document)
 *
 * @param {object} options
 * @param {string} options.docId - Unique identifier for this document in IndexedDB
 * @param {Extension[]} [options.preset] - Extension preset (default: FullPreset)
 * @param {Extension[]} [options.extensions] - Additional extensions to append
 * @param {number} [options.debounce] - Auto-save debounce delay in ms (default: 2000)
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
	history,
	...init
} = {}) {
	const historyConfig = parseHistory(history); // a typo in `history` must fail loudly, before anything is read
	const initialSnapshot = await loadSnapshot(docId);
	const store = init.files?.store ?? new IndexedDBAssetStore();
	const outbox = init.files?.outbox ?? new IndexedDBOutbox(docId);

	/** @param {Uint8Array | null} snapshot */
	const build = (snapshot) => {
		const nabu = new Nabu({
			...init,
			files: { ...init.files, store, outbox },
			extensions: [...preset, ...extensions],
			...(snapshot ? { snapshot } : {})
		});
		// Timestamps make a retention window (`retain: '30d'`) possible. Off by default in Loro; harmless to enable (a few bytes per change).
		nabu.doc.setRecordTimestamp(true);
		return nabu;
	};

	/** The version of a document, to tell whether something changed since the last save. @param {import('loro-crdt').LoroDoc} doc */
	const versionKey = (doc) => JSON.stringify(doc.oplogFrontiers());

	/**
	 * Wire autosave and the extra methods onto `nabu`. Returns `dispose()` (stops this wiring: used for the instance that is
	 * replaced after a compaction at open, which nobody has seen).
	 * @param {Nabu} nabu @param {boolean} loaded whether `nabu` holds exactly what is saved
	 */
	const attach = (nabu, loaded) => {
		/** Version known to be saved (`null`: never saved). */
		let savedKey = loaded ? versionKey(nabu.doc) : null;
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

		const save = () => lock(async () => {
			const key = versionKey(nabu.doc);
			const snap = compactedAt
				? nabu.doc.export({ mode: 'shallow-snapshot', frontiers: compactedAt })
				: nabu.doc.export({ mode: 'snapshot' });
			await saveSnapshot(docId, snap);
			await saveRefs();
			savedKey = key;
		});

		// Auto-save: Loro fires doc.subscribe() after every committed change
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let saveTimer;
		const unsubscribe = nabu.doc.subscribe(() => {
			clearTimeout(saveTimer);
			saveTimer = setTimeout(save, debounce);
		});

		/** @type {import('./compact.js').CompactContext} */
		const ctx = {
			nabu,
			store,
			compacting: false,
			base: () => compactedAt,
			isDirty: () => savedKey === null || versionKey(nabu.doc) !== savedKey,
			flush: async () => { clearTimeout(saveTimer); await save(); },
			lock,
			versionKey,
			candidates: async () => { await loadHeld(); return new Set([...Files.get(nabu).indexedHashes(), ...held]); },
			held: () => new Set(held),
			setHeld: (hashes) => { heldLoaded = true; held.clear(); for (const hash of hashes) held.add(hash); },
			saveRefs,
			commit: async (snapshot, frontiers, key) => {
				await saveSnapshot(docId, snapshot);
				compactedAt = frontiers;
				savedKey = key;
				await saveRefs();
			},
		};

		/** Force an immediate save of the current document state. @returns {Promise<void>} */
		/** @type {any} */ (nabu).saveNow = async () => {
			clearTimeout(saveTimer);
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
		/** @type {any} */ (nabu).compact = /** @param {CompactOptions} options */ (options) => runCompaction(ctx, options);

		/**
		 * Delete the persisted snapshot for this document and release its files: a file is deleted from the shared store only when no
		 * other document references it; with a host, `files.onAssetReleased(url)` is called for each hosted file (Nabu deletes nothing
		 * at the host).
		 * @returns {Promise<void>}
		 */
		/** @type {any} */ (nabu).clearPersistence = async () => {
			clearTimeout(saveTimer);
			const files = Files.get(nabu);
			const reader = /** @type {any} */ (store);
			const mine = new Set(files.indexedHashes());
			if (typeof reader.getDocRefs === 'function') for (const hash of await reader.getDocRefs(docId)) mine.add(hash);
			const urls = files.hostUrls(mine);
			await deleteSnapshot(docId);
			if (typeof reader.clearDocRefs === 'function') await reader.clearDocRefs(docId);
			await outbox.clear?.();
			const { skipped } = await releaseFiles(nabu, store, mine, urls);
			// too recent to delete (grace period): kept in this docId's `docRefs`, reconsidered when a document with this id is next compacted / cleared
			held.clear();
			for (const hash of skipped) held.add(hash);
			heldLoaded = true;
			if (skipped.length && typeof reader.setDocRefs === 'function') await reader.setDocRefs(docId, skipped);
		};

		return { ctx, dispose: () => { clearTimeout(saveTimer); unsubscribe(); } };
	};

	let nabu = build(initialSnapshot);
	let wiring = attach(nabu, Boolean(initialSnapshot));

	// `history: { mode: 'compact' }`: compact when the document is opened (never mid-session), once it is loaded, migrated and its
	// uploads reconciled. A refusal (pending upload, failing archive…) leaves the document exactly as it was.
	if (historyConfig.mode === 'compact' && initialSnapshot) {
		const { retain, onBeforeCompact } = historyConfig;
		const result = await runCompaction(wiring.ctx, { retain, onBeforeCompact }, { flush: true });
		if (result.compacted && result.snapshot) {
			// Replace the instance nobody has seen yet by one built from the compacted snapshot: the history is gone from memory too.
			wiring.dispose();
			nabu = build(result.snapshot);
			wiring = attach(nabu, true);
		} else if (result.reason !== 'nothing-to-compact') {
			nabu.warn(`history: compaction at open skipped (${result.reason}), the document is unchanged`);
		}
	}

	/** Whether this instance was created from a fresh document (no prior snapshot). */
	/** @type {any} */ (nabu).isNew = !initialSnapshot;

	return nabu;
}
