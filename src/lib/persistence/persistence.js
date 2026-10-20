import { Nabu } from '../blocks/nabu.svelte.js';
import { FullPreset } from '../presets.js';
import { Files } from '../files/files.svelte.js';
import { loadSnapshot, saveSnapshot, deleteSnapshot } from './indexeddb.js';
import { IndexedDBAssetStore } from './asset-store.js';

export { loadSnapshot, saveSnapshot, deleteSnapshot, IndexedDBAssetStore };

/**
 * @import { Extension } from '../utils/extensions.js';
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
 *
 * The instance gains three extra methods:
 * - `nabu.saveNow()` — force an immediate save (returns a Promise)
 * - `nabu.clearPersistence()` — delete the stored snapshot (returns a Promise)
 * - `nabu.isNew` — `true` if no previous snapshot was found (fresh document)
 *
 * @param {object} options
 * @param {string} options.docId - Unique identifier for this document in IndexedDB
 * @param {Extension[]} [options.preset] - Extension preset (default: FullPreset)
 * @param {Extension[]} [options.extensions] - Additional extensions to append
 * @param {number} [options.debounce] - Auto-save debounce delay in ms (default: 2000)
 * @param {import('../files/files.svelte.js').FilesConfig} [options.files] - File handling; `files.store` replaces the default IndexedDB asset store
 * @param {import('../utils/placeholders.js').PlaceholdersOption} [options.placeholders] - Forwarded to Nabu
 *   (any other Nabu init option, e.g. `files`, is forwarded too; `files.store` replaces the default IndexedDB asset store)
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
	...init
} = {}) {
	const snapshot = await loadSnapshot(docId);
	const store = init.files?.store ?? new IndexedDBAssetStore();

	const nabu = new Nabu({
		...init,
		files: { ...init.files, store },
		extensions: [...preset, ...extensions],
		...(snapshot ? { snapshot } : {})
	});

	/** Save the snapshot, then record which files the document references (the store's `docRefs`, used by the future cleanup). */
	const save = async () => {
		const snap = nabu.doc.export({ mode: 'snapshot' });
		await saveSnapshot(docId, snap);
		const refs = /** @type {any} */ (store).setDocRefs;
		if (typeof refs === 'function') await refs.call(store, docId, Files.get(nabu).indexedHashes());
	};

	// Auto-save: Loro fires doc.subscribe() after every committed change
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let saveTimer;
	nabu.doc.subscribe(() => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(save, debounce);
	});

	/** Whether this instance was created from a fresh document (no prior snapshot). */
	nabu.isNew = !snapshot;

	/** Force an immediate save of the current document state. @returns {Promise<void>} */
	nabu.saveNow = async () => {
		clearTimeout(saveTimer);
		await Files.get(nabu).whenIdle(); // files of a paste / import / migration in progress belong to this save
		await save();
	};

	/** Delete the persisted snapshot for this document (the files stay in the shared store: other documents may use them). @returns {Promise<void>} */
	nabu.clearPersistence = async () => {
		await deleteSnapshot(docId);
		const clear = /** @type {any} */ (store).clearDocRefs;
		if (typeof clear === 'function') await clear.call(store, docId);
	};

	return nabu;
}
