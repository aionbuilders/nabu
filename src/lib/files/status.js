/**
 * Status / reason model of a media block (ADR 014 lot 2). Pure helpers, no document access.
 *
 * `status` is what the block stores (and what a document export writes):
 *  - `ready`    the file is stored (and, with a host, uploaded);
 *  - `pending`  the bytes are being stored / uploaded (`block.progress` tells how far while an upload runs);
 *  - `error`    the upload failed or was cancelled — the local copy is kept, `block.retry()` runs it again;
 *  - `missing`  no source has the bytes (a copy without them, a corrupt embedded file…);
 *  - `rejected` the file was refused (`files.maxFileSize`); no ref, the block only says why.
 * A block saved `pending` that no upload is running for, with neither local bytes nor a host `url` (a document opened on
 * another device before the upload ended), is shown as `missing` with the reason `interrupted` (see `MediaBlock#isMissing`).
 *
 * `reason` explains `error`, `rejected` and `missing`: `{ code, message }` where `code` is stable (one of {@link REASON_CODES})
 * and `message` a readable English sentence an interface can display as is.
 */

/**
 * @typedef {'ready' | 'pending' | 'error' | 'missing' | 'rejected'} FileStatus
 */

/**
 * @typedef {Object} FileReason
 * @property {'too-large' | 'upload-failed' | 'cancelled' | 'interrupted' | 'unavailable' | 'not-embedded' | 'corrupt'} code
 * @property {string} message readable, English
 */

/** The stable codes of {@link FileReason}. */
export const REASON_CODES = Object.freeze({
    'too-large': 'The file is too large.',
    'upload-failed': 'The upload failed.',
    'cancelled': 'The upload was cancelled.',
    'interrupted': 'The upload was interrupted before it finished: the file is not available on this device.',
    'unavailable': 'The file is not available.',
    'not-embedded': 'The file was not included in the copy (too large or not loaded yet).',
    'corrupt': 'The file does not match its fingerprint and was ignored.',
});

/** @param {number} bytes @returns {string} */
export function formatBytes(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    return bytes + ' B';
}

/**
 * @param {FileReason['code']} code @param {string} [message] defaults to the standard sentence of the code
 * @returns {FileReason}
 */
export function reasonOf(code, message) {
    return { code, message: message || REASON_CODES[code] };
}

/** @param {number} size @param {number} limit @returns {FileReason} */
export function tooLarge(size, limit) {
    return reasonOf('too-large', `The file is too large (${formatBytes(size)}); the limit is ${formatBytes(limit)}.`);
}

/**
 * A reason read back from a document (untrusted: a document may come from anywhere): only a known code and a bounded
 * string survive. `null` when `value` is not a reason.
 * @param {unknown} value @returns {FileReason | null}
 */
export function normalizeReason(value) {
    if (!value || typeof value !== 'object') return null;
    const { code, message } = /** @type {any} */ (value);
    if (typeof code !== 'string' || !Object.hasOwn(REASON_CODES, code)) return null;
    return reasonOf(/** @type {FileReason['code']} */ (code), typeof message === 'string' && message ? message.slice(0, 300) : undefined);
}

/** The reason to show for a status that carries none. @param {string} status @returns {FileReason | null} */
export function defaultReason(status) {
    if (status === 'error') return reasonOf('upload-failed');
    if (status === 'rejected') return reasonOf('too-large');
    if (status === 'missing') return reasonOf('unavailable');
    return null;
}

/** Thrown by `Files#ingest` / `Files#persist` for a file the options refuse (`maxFileSize`). */
export class FileRejectedError extends Error {
    /** @param {FileReason} reason */
    constructor(reason) {
        super(reason.message);
        this.name = 'FileRejectedError';
        /** @type {FileReason} */
        this.reason = reason;
    }
}
