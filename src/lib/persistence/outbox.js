import { OUTBOX_STORE, withStore } from './indexeddb.js';

/**
 * @typedef {import('../files/outbox.js').Outbox} Outbox
 * @typedef {import('../files/outbox.js').OutboxEntry} OutboxEntry
 */

/**
 * The {@link Outbox} of a persisted editor (ADR 014 lot 2): database `nabu`, object store `outbox`
 * (`{ docId, hash, attempts, state, updatedAt }`, key `[docId, hash]`), next to the asset store and outside the Loro document.
 * One instance per document.
 * @implements {Outbox}
 */
export class IndexedDBOutbox {
	/** @param {string} docId */
	constructor(docId) {
		this.docId = docId;
	}

	/** @returns {Promise<OutboxEntry[]>} */
	async list() {
		const records = /** @type {any[]} */ (await withStore(OUTBOX_STORE, 'readonly', (s) => s.index('docId').getAll(this.docId)));
		return records.map(({ hash, attempts, state, updatedAt }) => ({ hash, attempts, state, updatedAt }));
	}

	/** @param {OutboxEntry} entry @returns {Promise<void>} */
	async put(entry) {
		await withStore(OUTBOX_STORE, 'readwrite', (s) => s.put({ docId: this.docId, hash: entry.hash, attempts: entry.attempts, state: entry.state, updatedAt: entry.updatedAt }));
	}

	/** @param {string} hash @returns {Promise<void>} */
	async delete(hash) {
		await withStore(OUTBOX_STORE, 'readwrite', (s) => s.delete([this.docId, hash]));
	}

	/** Forget every entry of this document. @returns {Promise<void>} */
	async clear() {
		for (const { hash } of await this.list()) await this.delete(hash);
	}
}
