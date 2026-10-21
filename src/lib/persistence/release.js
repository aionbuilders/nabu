/**
 * Default `files.releaseGraceMs`: a file whose store record is newer than this is never deleted by a release, whoever released it
 * (10 minutes). Another tab may have just added it (or just re-added a file that was already stored) without having saved its
 * `docRefs` yet; the file is skipped this time and reconsidered by the next compaction / `clearPersistence()` of the document.
 */
export const DEFAULT_RELEASE_GRACE_MS = 10 * 60 * 1000;

/** @import { Nabu } from '../blocks/nabu.svelte.js' */
/** @import { AssetStore } from '../files/store.js' */

/**
 * Let go of files THIS document no longer keeps (ADR 014 §3.6 point 6), after the document that referenced them was
 * compacted or deleted:
 *
 *  - the document's `docRefs` must already be updated by the caller;
 *  - bytes: a file is deleted from the (shared) store only when NO document's `docRefs` lists it. A store without the `docRefs`
 *    API (a custom `files.store`) cannot tell, so nothing is deleted from it;
 *  - grace: a file whose store record is newer than `files.releaseGraceMs` (default {@link DEFAULT_RELEASE_GRACE_MS}), or has no
 *    `savedAt` (legacy / a store that cannot say), is SKIPPED, not deleted (multi-tab safety). `releaseGraceMs: 0` disables it;
 *  - host mode: Nabu never deletes anything at the host. `files.onAssetReleased(url)` is called, awaited, for each released file
 *    that has a host `url`; an error is swallowed and reported with `nabu.warn`.
 *
 * Never throws.
 * @param {Nabu} nabu
 * @param {AssetStore} store
 * @param {Iterable<string>} hashes the released files
 * @param {Map<string, string>} urls host location of the released files that have one (read from the index BEFORE its entries were removed)
 * @returns {Promise<{ deleted: string[], skipped: string[] }>} the files whose bytes were deleted from the store, and the ones
 *   nobody references but that were kept for now (grace period): the caller keeps them in the document's `docRefs` to reconsider them later
 */
export async function releaseFiles(nabu, store, hashes, urls) {
	/** @type {string[]} */
	const deleted = [];
	/** @type {string[]} */
	const skipped = [];
	const configured = nabu.fileConfig?.releaseGraceMs;
	const grace = typeof configured === 'number' && configured >= 0 ? configured : DEFAULT_RELEASE_GRACE_MS;
	const released = [...hashes];
	if (released.length && typeof store.referencedHashes === 'function') {
		try {
			const stillUsed = await store.referencedHashes();
			for (const hash of released) {
				if (stillUsed.has(hash)) continue;
				if (grace > 0) {
					const savedAt = typeof store.savedAt === 'function' ? await store.savedAt(hash) : null;
					if (typeof savedAt !== 'number' || Date.now() - savedAt < grace) { if (await store.has(hash)) skipped.push(hash); continue; }
				}
				await store.delete(hash);
				deleted.push(hash);
			}
		} catch (error) {
			nabu.warn(`history: could not clean the file store: ${error}`);
		}
	}
	const onReleased = nabu.fileConfig?.onAssetReleased;
	if (typeof onReleased === 'function') {
		for (const hash of released) {
			const url = urls.get(hash);
			if (!url) continue;
			try { await onReleased(url); } catch (error) { nabu.warn(`files: onAssetReleased failed for ${url}: ${error}`); }
		}
	}
	return { deleted, skipped };
}
