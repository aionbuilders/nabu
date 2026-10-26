/**
 * @typedef {'saved' | 'pending' | 'saving' | 'error' | 'unavailable'} SaveStatus
 *  - `saved`: everything is stored (also a document just opened, or fresh and untouched)
 *  - `pending`: there are changes that are not stored yet (the autosave is waiting)
 *  - `saving`: a save is running
 *  - `error`: the last save failed (quota…); the changes are still in memory and the next change retries
 *  - `unavailable`: IndexedDB cannot be used (or the stored document could not be moved aside safely): the editor works in memory only
 */

/** @import { Recovery } from './recovery.js' */

/**
 * `nabu.persistence` — what a persisted editor tells the host. The fields are REACTIVE (Svelte 5 `$state`): read them in a
 * template or an `$effect` to show a "saved / saving…" indicator. Outside Svelte they are plain properties.
 */
export class PersistenceState {
	/** Where the document is stored. */
	docId = '';
	/** `false` when IndexedDB could not be used at boot: the editor works in memory only (status `'unavailable'`). */
	available = $state(true);
	/** @type {SaveStatus} */
	status = $state('saved');
	/** Epoch ms of the last successful save of this session (`null`: none yet). @type {number | null} */
	lastSavedAt = $state(null);
	/** The error of the last failed save, or why storage is unavailable (`null` after a successful save). @type {unknown} */
	lastError = $state.raw(null);
	/**
	 * Set at boot when the stored document could not be read and the editor started from the backup or empty (see
	 * {@link Recovery}); `null` otherwise. Not reactive in practice (it is set before the editor is returned). @type {Recovery | null}
	 */
	recovery = $state.raw(null);
	/**
	 * `true` while the live sync with the other tabs of the same document is running (`sync` option, a `BroadcastChannel` is available,
	 * IndexedDB is usable). Saving still merges what other tabs stored when it is `false`.
	 */
	sync = $state(false);

	/** @param {string} docId */
	constructor(docId) { this.docId = docId; }

	/**
	 * Stop the persistence of this editor: cancel the pending autosave, remove the `visibilitychange` / `pagehide` listeners, close the
	 * live-sync channel, stop the automatic upload retries and close the IndexedDB connection. The editor keeps working in memory, nothing is saved any more. Call it when the editor is
	 * destroyed (e.g. in the cleanup of the component that created it). Idempotent. Replaced by `createPersistedEditor`.
	 * @returns {void}
	 */
	dispose() {}
}
