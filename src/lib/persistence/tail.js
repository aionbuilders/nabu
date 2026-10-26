/**
 * The "tail" of a document (ADR 010, theme 8, P-91): the changes made since the last save, written SYNCHRONOUSLY to `localStorage` when
 * the page is going away. An IndexedDB write started from `pagehide` is asynchronous and browsers drop it when the page is reloaded
 * (observed in Chromium: the transaction is created and never completes); `localStorage.setItem` is synchronous and survives. The next
 * boot merges the tail into the document (Loro imports are idempotent: if the IndexedDB write did make it, nothing changes) and the
 * first successful save removes it. Best effort: no storage, a full quota, or a tail above {@link MAX_TAIL_BYTES} just means no tail.
 */

/** Largest tail written (bytes of the Loro update, before base64). A long offline session is saved by IndexedDB, not by this. */
export const MAX_TAIL_BYTES = 256 * 1024;

/** @param {string} docId */
export const tailKey = (docId) => `nabu:tail:${docId}`;
/** Where a tail that could not be merged is kept (never deleted). @param {string} docId */
export const unappliedTailKey = (docId) => `nabu:tail:${docId}:unapplied`;

/** @returns {Storage | null} */
function storage() {
	try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** @param {Uint8Array} bytes @returns {string} */
export function toBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** @param {string} text @returns {Uint8Array} */
export function fromBase64(text) {
	const binary = atob(text);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Store the tail of a document. Never throws.
 * @param {string} docId
 * @param {Uint8Array} update a Loro update (changes since the last save)
 * @returns {boolean} whether it was written
 */
export function writeTail(docId, update) {
	const ls = storage();
	if (!ls || update.length === 0 || update.length > MAX_TAIL_BYTES) return false;
	try { ls.setItem(tailKey(docId), JSON.stringify({ v: 1, at: Date.now(), update: toBase64(update) })); return true; } catch { return false; }
}

/** The stored tail of a document, or `null` (none, or unreadable). Never throws. @param {string} docId @returns {Uint8Array | null} */
export function readTail(docId) {
	const ls = storage();
	if (!ls) return null;
	try {
		const raw = ls.getItem(tailKey(docId));
		if (!raw) return null;
		const record = JSON.parse(raw);
		return record?.v === 1 && typeof record.update === 'string' ? fromBase64(record.update) : null;
	} catch { return null; }
}

/** Forget the tail of a document. Never throws. @param {string} docId */
export function clearTail(docId) {
	try { storage()?.removeItem(tailKey(docId)); } catch { /* nothing to do */ }
}

/** Keep a tail that could not be merged under another key (and forget the live one). Never throws. @param {string} docId */
export function parkTail(docId) {
	const ls = storage();
	if (!ls) return;
	try {
		const raw = ls.getItem(tailKey(docId));
		if (raw) ls.setItem(unappliedTailKey(docId), raw);
	} catch { /* quota: the tail is dropped, it was already a best effort */ }
	clearTail(docId);
}
