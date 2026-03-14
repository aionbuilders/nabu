import { Nabu } from '../blocks/nabu.svelte.js';
import { FullPreset } from '../presets.js';
import { loadSnapshot, saveSnapshot, deleteSnapshot } from './indexeddb.js';

export { loadSnapshot, saveSnapshot, deleteSnapshot };

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
	debounce = 2000
} = {}) {
	const snapshot = await loadSnapshot(docId);

	const nabu = new Nabu({
		extensions: [...preset, ...extensions],
		...(snapshot ? { snapshot } : {})
	});

	// Auto-save: Loro fires doc.subscribe() after every committed change
	let saveTimer;
	nabu.doc.subscribe(() => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			const snap = nabu.doc.export({ mode: 'snapshot' });
			await saveSnapshot(docId, snap);
		}, debounce);
	});

	/** Whether this instance was created from a fresh document (no prior snapshot). */
	nabu.isNew = !snapshot;

	/** Force an immediate save of the current document state. @returns {Promise<void>} */
	nabu.saveNow = async () => {
		const snap = nabu.doc.export({ mode: 'snapshot' });
		await saveSnapshot(docId, snap);
	};

	/** Delete the persisted snapshot for this document. @returns {Promise<void>} */
	nabu.clearPersistence = () => deleteSnapshot(docId);

	return nabu;
}
