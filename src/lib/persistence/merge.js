import { decodeImportBlobMeta } from 'loro-crdt';

/** @import { LoroDoc } from 'loro-crdt' */

/**
 * @typedef {object} MergeResult
 * @property {boolean} imported the stored record held changes the document did not have, and they were imported
 * @property {boolean} covers the stored record now contains EVERYTHING the document has (writing the document again would add nothing)
 * @property {boolean} merged `false`: the record holds something the document still lacks after the import (a shallow snapshot that
 *   does not follow from the document): it cannot be merged and must not be overwritten without a copy being kept
 */

/**
 * Merge a stored snapshot into the live document (ADR 010, multi-tab, P-94): whatever another tab saved that this document does not
 * have is IMPORTED, so the save that follows (a full export of the document) cannot overwrite it. The version vector of the record
 * is read from its header (no decoding of the whole record) and compared with the document's; the import only happens when the
 * record is ahead of, or concurrent with, the document. Synchronous (it runs inside an IndexedDB request callback, see
 * `saveMerged`). Throws when the bytes are unreadable.
 *
 * @param {LoroDoc} doc
 * @param {Uint8Array} bytes the stored snapshot
 * @param {(bytes: Uint8Array) => unknown} [importBytes] how to import (default `doc.import`; the editor passes `nabu.importRemote`, which
 *   keeps the caret and is never an undo step)
 * @returns {MergeResult}
 */
export function mergeStored(doc, bytes, importBytes = (b) => doc.import(b)) {
	const theirs = decodeImportBlobMeta(bytes, false).partialEndVersionVector;
	const before = doc.version().compare(theirs); // 0 equal, 1 the document is ahead, -1 the record is ahead, undefined concurrent
	let imported = false;
	if (before === -1 || before === undefined) {
		importBytes(bytes);
		imported = true;
	}
	const after = doc.version().compare(theirs);
	return { imported, covers: after === 0, merged: after === 0 || after === 1 };
}
