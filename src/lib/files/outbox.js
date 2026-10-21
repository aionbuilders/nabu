/**
 * The upload outbox (ADR 014 §3.4): the list of files still to send to the host (`onBeforePersist`), kept NEXT TO the
 * asset store — never inside the Loro document. The local copy of the bytes is the payload, the outbox only says what is
 * waiting, so an upload interrupted by a closed tab resumes when the document is opened again.
 *
 * An outbox is scoped to ONE document. `createPersistedEditor` plugs an `IndexedDBOutbox`
 * (`persistence/outbox.js`); a non-persisted editor uses the in-memory one below. An integrator can pass any object with
 * this interface as `files.outbox`.
 */

/**
 * @typedef {Object} OutboxEntry
 * @property {string} hash `sha256-<hex>` id of the file
 * @property {number} attempts how many times its upload was started
 * @property {'pending' | 'error'} state `pending`: to send (or interrupted); `error`: the last attempt failed (retried on demand only)
 * @property {number} updatedAt epoch ms
 */

/**
 * @typedef {Object} Outbox
 * @property {() => Promise<OutboxEntry[]>} list
 * @property {(entry: OutboxEntry) => Promise<void>} put insert or replace the entry of `entry.hash`
 * @property {(hash: string) => Promise<void>} delete
 * @property {() => Promise<void>} [clear] optional: forget every entry of the document
 */

/**
 * In-memory {@link Outbox} (lost with the page, like a non-persisted document).
 * @implements {Outbox}
 */
export class MemoryOutbox {
    /** @type {Map<string, OutboxEntry>} */
    #entries = new Map();

    /** @returns {Promise<OutboxEntry[]>} */
    async list() { return [...this.#entries.values()].map((e) => ({ ...e })); }

    /** @param {OutboxEntry} entry */
    async put(entry) { this.#entries.set(entry.hash, { ...entry }); }

    /** @param {string} hash */
    async delete(hash) { this.#entries.delete(hash); }

    async clear() { this.#entries.clear(); }

    /** Number of entries (handy in tests / diagnostics). */
    get size() { return this.#entries.size; }
}
