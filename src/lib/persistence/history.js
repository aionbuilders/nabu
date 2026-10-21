import { LoroDoc, VersionVector } from 'loro-crdt';

/**
 * History helpers of the persisted editor (ADR 014 §3.6, lot 3): parsing of the `history` option and of `retain`, the choice
 * of the version a compaction keeps, and the scan of the files a kept history still references. Pure functions over Loro
 * documents: nothing here knows a block type (the document is only searched for `nabu-asset:sha256-…` strings).
 */

/**
 * What an integrator may pass as `compact({ ... })` / `history: { mode: 'compact', ... }`.
 * @typedef {Object} CompactOptions
 * @property {number | string} retain how much PAST history survives: a duration in ms, or a string `<number><unit>` with unit
 *   `s`, `m`, `h`, `d` or `w` (`'30d'`, `'12h'`), or `0` = keep no past history. Required (there is no default that drops data).
 * @property {(fullSnapshot: Uint8Array) => void | Promise<void>} [onBeforeCompact] awaited with the COMPLETE snapshot (all the
 *   history) before anything is dropped; archive it. If it throws / rejects the compaction is ABORTED and nothing is lost.
 */

/**
 * @typedef {{ mode: 'full' } | { mode: 'compact', retain: number, onBeforeCompact?: CompactOptions['onBeforeCompact'] }} HistoryConfig
 */

const UNITS = /** @type {Record<string, number>} */ ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 });

/**
 * Parse `retain` into milliseconds. Strict: a finite number >= 0, or `<number><s|m|h|d|w>` (e.g. `'30d'`, `'1.5h'`).
 * @param {unknown} value
 * @returns {number}
 * @throws {TypeError}
 */
export function parseRetain(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
	if (typeof value === 'string') {
		const match = /^(\d+(?:\.\d+)?)(s|m|h|d|w)?$/.exec(value.trim());
		if (match && match[2]) return Number(match[1]) * UNITS[match[2]];
		if (match && Number(match[1]) === 0) return 0;
	}
	throw new TypeError(`history: invalid "retain" ${JSON.stringify(value)}: use a number of milliseconds, 0, or a string like '30d' / '12h' (units s, m, h, d, w)`);
}

/**
 * Normalize the `history` option of `createPersistedEditor`: `'full'` (default) or `{ mode: 'compact', retain, onBeforeCompact }`.
 * @param {unknown} history
 * @returns {HistoryConfig}
 * @throws {TypeError} for anything else (a typo must not silently pick a mode)
 */
export function parseHistory(history) {
	if (history === undefined || history === null || history === 'full') return { mode: 'full' };
	const config = /** @type {any} */ (history);
	if (typeof history === 'object' && (config.mode === undefined || config.mode === 'full')) return { mode: 'full' };
	if (typeof history === 'object' && config.mode === 'compact') {
		if (config.onBeforeCompact !== undefined && typeof config.onBeforeCompact !== 'function') throw new TypeError('history: "onBeforeCompact" must be a function');
		return { mode: 'compact', retain: parseRetain(config.retain), onBeforeCompact: config.onBeforeCompact };
	}
	throw new TypeError(`history: expected 'full' or { mode: 'compact', retain, onBeforeCompact }, got ${JSON.stringify(history)}`);
}

/** Loro merges consecutive commits closer than this (seconds) into ONE change, stamped with the first one's time. */
const CHANGE_MERGE_SECONDS = 1000;

/** @typedef {{ peer: `${number}`, counter: number }} OpId */

/**
 * Whether version `a` strictly contains version `b`.
 * @param {LoroDoc} doc @param {OpId[]} a @param {OpId[]} b
 */
function isAfter(doc, a, b) {
	return doc.frontiersToVV(a).compare(doc.frontiersToVV(b)) === 1;
}

/**
 * The version a compaction keeps as the START of the remaining history (the frontiers handed to the shallow snapshot), or
 * `null` when there is nothing to drop.
 *
 *  - `retainMs === 0`: the current version (no past history survives, only the state and what happens next).
 *  - otherwise: the latest version made ONLY of changes older than `now - retainMs`. Changes are walked in causal order
 *    (Loro lamport order), the version is the longest prefix whose changes are all older than the cutoff. A change without a
 *    timestamp (written before timestamps were recorded) counts as old only if a LATER change with a known timestamp is itself
 *    old (it happened before it); an undated history is therefore never windowed away: only `retain: 0` compacts it.
 *    A margin of Loro's change-merge interval keeps a change that may have grown after its timestamp.
 *
 * `base` is the version the document was already compacted to (its shallow start or the last compaction of this session); a result
 * that does not go strictly past it is `null`.
 * @param {LoroDoc} doc
 * @param {number} retainMs
 * @param {number} [nowMs]
 * @param {OpId[]} [base] frontiers of the previous compaction point, if any
 * @returns {OpId[] | null}
 */
export function retentionFrontiers(doc, retainMs, nowMs = Date.now(), base) {
	const latest = doc.oplogFrontiers();
	if (!latest.length) return null;
	/** @type {OpId[] | null} */
	let target = null;
	if (retainMs === 0) {
		target = latest;
	} else {
		const cutoff = Math.floor((nowMs - retainMs) / 1000) - CHANGE_MERGE_SECONDS;
		const changes = [...doc.getAllChanges().values()].flat();
		changes.sort((a, b) => a.lamport - b.lamport || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
		// effective time of each change: its own, or the next known one (it happened before it)
		const effective = new Array(changes.length);
		let next = Infinity;
		for (let i = changes.length - 1; i >= 0; i--) {
			if (changes[i].timestamp > 0) next = changes[i].timestamp;
			effective[i] = next;
		}
		let count = 0;
		while (count < changes.length && effective[count] <= cutoff) count++;
		if (count === 0) return null;
		/** @type {Map<`${number}`, number>} */
		const end = new Map();
		for (const [peer, counter] of doc.shallowSinceVV().toJSON()) end.set(peer, counter); // never go before the shallow start
		for (let i = 0; i < count; i++) {
			const c = changes[i];
			end.set(c.peer, Math.max(end.get(c.peer) ?? 0, c.counter + c.length));
		}
		target = doc.vvToFrontiers(new VersionVector(end));
	}
	if (!target?.length) return null;
	const floor = base?.length ? base : doc.isShallow() ? doc.shallowSinceFrontiers() : null;
	if (floor && !isAfter(doc, target, floor)) return null;
	return target;
}

/** Hash ids referenced as `nabu-asset:sha256-<64 hex>` anywhere in `text`. @param {string} text @param {Set<string>} into */
function collectRefs(text, into) {
	for (const match of text.matchAll(/nabu-asset:(sha256-[0-9a-f]{64})/g)) into.add(match[1]);
}

/**
 * Canonical JSON (sorted keys, bytes as hex) used to compare two document states.
 * @param {any} value @returns {string}
 */
function canonical(value) {
	return JSON.stringify(value, (_key, v) => {
		if (ArrayBuffer.isView(v)) return 'bytes:' + [...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)].join(',');
		if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
		return v;
	});
}

/**
 * The files (`sha256-…` ids) a compaction to `frontiers` still needs: referenced by the CURRENT state, by the state AT `frontiers`
 * (the oldest version still reachable) or by any operation after it. Anything else is referenced by no version that survives.
 * Works on a scratch copy of `doc` (the live document is not touched; no `forkAt`, which Loro does not support on shallow
 * documents). Generic: it only looks for `nabu-asset:sha256-…` strings.
 * @param {LoroDoc} doc @param {OpId[]} frontiers
 * @returns {Set<string>}
 */
export function referencedHashes(doc, frontiers) {
	const scratch = new LoroDoc();
	scratch.import(doc.export({ mode: 'snapshot' }));
	/** @type {Set<string>} */
	const found = new Set();
	collectRefs(JSON.stringify(scratch.toJSON()), found); // current state
	collectRefs(JSON.stringify(scratch.exportJsonUpdates(scratch.frontiersToVV(frontiers))), found); // every op after the kept version
	scratch.checkout(frontiers);
	collectRefs(JSON.stringify(scratch.toJSON()), found); // state at the kept version
	return found;
}

/**
 * Check that `snapshot` (a shallow snapshot) restores exactly the current state of `doc`: it is imported into a scratch document
 * and compared. A compaction that fails this check is aborted before anything is written.
 * @param {LoroDoc} doc @param {Uint8Array} snapshot
 * @returns {boolean}
 */
export function snapshotMatches(doc, snapshot) {
	try {
		const scratch = new LoroDoc();
		scratch.import(snapshot);
		return canonical(scratch.toJSON()) === canonical(doc.toJSON());
	} catch {
		return false;
	}
}
