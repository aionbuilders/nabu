/**
 * @typedef {object} Recovery What happened when a stored document could not be read (ADR 010, theme 8). Exposed as
 * `nabu.persistence.recovery` and given to the `onRecover` option, so the host can tell the user.
 * @property {'backup' | 'empty'} kind `'backup'`: the document was restored from the PREVIOUS save (the last edits before the
 *   corrupted save are missing). `'empty'`: nothing readable was left, the editor started empty.
 * @property {Error} error why the latest stored snapshot was refused
 * @property {string | null} quarantinedKey key (in the `quarantine` object store of the `nabu` database) of the unreadable record,
 *   which is never deleted. `null` if there was nothing to move (a missing record)
 * @property {string[]} quarantinedKeys every record moved aside (the backup too, when it was unreadable as well)
 * @property {number} at epoch ms
 */

/** @typedef {{ docId: string, snapshot: unknown, savedAt?: number }} StoredRecord */

/**
 * @template T
 * @typedef {object} LoadDecision
 * @property {'new' | 'ok' | 'backup' | 'empty'} outcome `new`: nothing stored. `ok`: the current snapshot loaded. `backup`: it did not, the
 *   backup did. `empty`: neither did.
 * @property {T | null} value what `load` returned for the record that was used (`null` for `new` and `empty`)
 * @property {StoredRecord | null} used the record that was loaded
 * @property {{ source: 'snapshot' | 'backup', record: StoredRecord, error: Error }[]} failed the records that could not be read
 *   (to be quarantined, in the order they were tried)
 */

/** @param {unknown} error @returns {Error} */
const asError = (error) => (error instanceof Error ? error : new Error(String(error)));

/**
 * Decide how to open a document from what is stored: try the current snapshot, then the backup, else start empty. Pure: `load`
 * does the actual (throwing) import, so this is testable without IndexedDB.
 * A current record that is MISSING while a backup exists counts as a failure (an odd state: a partial deletion).
 *
 * @template T
 * @param {{ current: StoredRecord | null, backup: StoredRecord | null }} records
 * @param {(snapshot: unknown) => T} load throws when the snapshot cannot be used
 * @returns {LoadDecision<T>}
 */
export function resolveLoad(records, load) {
	const { current, backup } = records;
	/** @type {LoadDecision<T>['failed']} */
	const failed = [];
	if (!current && !backup) return { outcome: 'new', value: null, used: null, failed };
	if (current) {
		try {
			return { outcome: 'ok', value: load(current.snapshot), used: current, failed };
		} catch (error) {
			failed.push({ source: 'snapshot', record: current, error: asError(error) });
		}
	}
	if (backup) {
		try {
			return { outcome: 'backup', value: load(backup.snapshot), used: backup, failed };
		} catch (error) {
			failed.push({ source: 'backup', record: backup, error: asError(error) });
		}
	}
	return { outcome: 'empty', value: null, used: null, failed };
}

/**
 * The {@link Recovery} to report for a decision, or `null` when nothing went wrong.
 * @param {LoadDecision<unknown>} decision
 * @param {string[]} quarantinedKeys keys of `decision.failed`, in the same order
 * @param {number} at
 * @returns {Recovery | null}
 */
export function describeRecovery(decision, quarantinedKeys, at) {
	if (decision.outcome !== 'backup' && decision.outcome !== 'empty') return null;
	const first = decision.failed[0];
	const main = decision.failed.findIndex((f) => f.source === 'snapshot');
	return {
		kind: decision.outcome,
		error: first?.error ?? new Error('the stored snapshot is missing'),
		quarantinedKey: main >= 0 ? quarantinedKeys[main] ?? null : null,
		quarantinedKeys: [...quarantinedKeys],
		at,
	};
}
