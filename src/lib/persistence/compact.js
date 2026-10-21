import { Files } from '../files/files.svelte.js';
import { parseRetain, retentionFrontiers, referencedHashes, snapshotMatches } from './history.js';
import { releaseFiles } from './release.js';

/** @import { Nabu } from '../blocks/nabu.svelte.js' */
/** @import { AssetStore } from '../files/store.js' */
/** @import { CompactOptions } from './history.js' */

/**
 * @typedef {'busy' | 'detached' | 'pending-uploads' | 'unsaved-changes' | 'nothing-to-compact' | 'archive-failed' | 'verification-failed' | 'save-failed' | 'failed'} CompactRefusal
 */

/**
 * What `nabu.compact()` resolves with. It never throws for a refusal: `compacted: false` + `reason`, and NOTHING was dropped.
 * @typedef {Object} CompactResult
 * @property {boolean} compacted
 * @property {CompactRefusal} [reason] why nothing was compacted
 * @property {unknown} [error] the error behind `archive-failed` / `save-failed` / `failed`
 * @property {number} [bytesBefore] size of the complete snapshot (what `onBeforeCompact` received)
 * @property {number} [bytesAfter] size of the compacted snapshot that was saved
 * @property {string[]} [released] files (`sha256-…`) no kept version references any more (removed from this document's index)
 * @property {string[]} [deleted] the released files whose bytes were deleted from the store (no other document used them)
 * @property {string[]} [skipped] released files nobody references but whose bytes were kept for now (`files.releaseGraceMs`): they stay in
 *   this document's `docRefs` and are reconsidered by its next compaction / `clearPersistence()`
 * @property {Uint8Array} [snapshot] the compacted (shallow) snapshot that was saved
 */

/**
 * The persisted editor's side of a compaction (see {@link runCompaction}).
 * @typedef {Object} CompactContext
 * @property {Nabu} nabu
 * @property {AssetStore} store
 * @property {boolean} compacting a compaction is running
 * @property {() => { peer: `${number}`, counter: number }[] | undefined} base frontiers of the previous compaction made by this session, if any
 * @property {() => boolean} isDirty whether the document has changes that were not saved yet
 * @property {() => Promise<void>} flush save now
 * @property {<T>(fn: () => Promise<T>) => Promise<T>} lock run `fn` with the saves held back (they queue behind it)
 * @property {(snapshot: Uint8Array, frontiers: { peer: `${number}`, counter: number }[], key: string) => Promise<void>} commit
 *   write the compacted snapshot, refresh `docRefs`, and from now on save shallow at `frontiers` (`key` = version that snapshot contains)
 * @property {(doc: import('loro-crdt').LoroDoc) => string} versionKey
 * @property {() => Promise<Set<string>>} candidates the files this document lists: its index plus the ones a previous release skipped
 * @property {() => Set<string>} held files kept by a previous release (grace period): still listed in `docRefs`, reconsidered now
 * @property {(hashes: Iterable<string>) => void} setHeld replace that set
 * @property {() => Promise<void>} saveRefs write `docRefs` (index + held)
 */

/**
 * Compact the history of a persisted document (ADR 014 §3.6). Every safeguard is here:
 *
 *  1. only when called (the caller decides: explicit `nabu.compact()` or `history: { mode: 'compact' }` at open);
 *  2. REFUSES (`{ compacted: false, reason }`, no throw, nothing dropped) when a file upload is pending / running
 *     (`pending-uploads`: the local copy is the only copy), when the document has unsaved or uncommitted changes
 *     (`unsaved-changes`), when it is checked out to an old version (`detached`), or when another compaction runs (`busy`);
 *  3. the kept version is chosen by {@link retentionFrontiers} (timestamps of the changes); nothing to drop = `nothing-to-compact`;
 *  4. `onBeforeCompact(fullSnapshot)` is awaited BEFORE anything is changed or written; a throw / rejection ABORTS (`archive-failed`).
 *     The kept version is fixed at the same instant as that snapshot, so everything dropped is in the archive;
 *  5. the compacted snapshot is a Loro SHALLOW snapshot at the kept version; it is checked (imported in a scratch document and
 *     compared with the live state) before being written, then saved; only then are files released;
 *  6. files no kept version references are removed from the document's index and released ({@link releaseFiles}); bytes recently
 *     added (grace period, multi-tab safety) are skipped and reconsidered next time;
 *  7. the undo stack is cleared (its steps could point at history that is gone / files that were released).
 *
 * The live in-memory document is NOT swapped (Loro cannot trim a document in place): it keeps its full history until the editor
 * is opened again; from now on every save of this editor is a shallow snapshot at the kept version (see `persistence.js`).
 * @param {CompactContext} ctx
 * @param {CompactOptions} options
 * @param {{ flush?: boolean }} [internal] `flush`: save pending changes first (used when opening, never an unsaved-changes refusal then)
 * @returns {Promise<CompactResult>}
 * @throws {TypeError} when `options` is invalid (`retain` is required)
 */
export async function runCompaction(ctx, options, { flush = false } = {}) {
	const retainMs = parseRetain(options?.retain);
	const archive = options.onBeforeCompact;
	if (archive !== undefined && typeof archive !== 'function') throw new TypeError('compact: "onBeforeCompact" must be a function');
	const { nabu, store } = ctx;
	const doc = nabu.doc;
	/** @param {CompactRefusal} reason @param {unknown} [error] @returns {CompactResult} */
	const refuse = (reason, error) => ({ compacted: false, reason, ...(error === undefined ? {} : { error }) });

	if (ctx.compacting) return refuse('busy');
	ctx.compacting = true;
	try {
		const files = Files.get(nabu);
		await files.whenIdle(); // pastes / imports / migration in progress belong to what is compacted
		if (await files.pendingUploads()) return refuse('pending-uploads'); // before the flush: a refusal writes nothing
		if (flush) await ctx.flush();
		if (await files.pendingUploads()) return refuse('pending-uploads');

		// ── no await from here to the archive export: the kept version and the archived snapshot are the same instant ──
		if (doc.isDetached()) return refuse('detached');
		if (doc.getPendingTxnLength() > 0 || ctx.isDirty()) return refuse('unsaved-changes');
		const frontiers = retentionFrontiers(doc, retainMs, Date.now(), ctx.base());
		if (!frontiers) return refuse('nothing-to-compact');
		const full = doc.export({ mode: 'snapshot' });

		if (archive) {
			try {
				await archive(full);
			} catch (error) {
				nabu.warn(`history: compaction aborted, onBeforeCompact failed (nothing was dropped): ${error}`);
				return refuse('archive-failed', error);
			}
		}

		return await ctx.lock(async () => {
			// the document may have moved on while the archive was awaited: what happened after `frontiers` is kept as it is
			if (doc.isDetached()) return refuse('detached');
			if (await files.pendingUploads()) return refuse('pending-uploads');
			try {
				const used = referencedHashes(doc, frontiers);
				const released = [...(await ctx.candidates())].filter((hash) => !used.has(hash));
				const urls = files.hostUrls(released);
				await files.releaseIndex(released);
				const key = ctx.versionKey(doc);
				const snapshot = doc.export({ mode: 'shallow-snapshot', frontiers });
				if (!snapshotMatches(doc, snapshot)) {
					nabu.warn('history: compaction aborted, the compacted snapshot does not restore the document (nothing was dropped)');
					return refuse('verification-failed');
				}
				const previouslyHeld = ctx.held();
				ctx.setHeld([]); // the release below must not find the document's own docRefs protecting these files
				try {
					await ctx.commit(snapshot, frontiers, key);
				} catch (error) {
					ctx.setHeld(previouslyHeld);
					nabu.warn(`history: compaction aborted, the compacted snapshot could not be saved: ${error}`);
					return refuse('save-failed', error);
				}
				nabu.undoManager.clear();
				const { deleted, skipped } = await releaseFiles(nabu, store, released, urls);
				if (skipped.length) { ctx.setHeld(skipped); await ctx.saveRefs().catch((error) => nabu.warn(`history: could not record the files kept for later: ${error}`)); }
				return { compacted: true, bytesBefore: full.length, bytesAfter: snapshot.length, released, deleted, skipped, snapshot };
			} catch (error) {
				nabu.warn(`history: compaction failed (nothing was dropped): ${error}`);
				return refuse('failed', error);
			}
		});
	} finally {
		ctx.compacting = false;
	}
}
