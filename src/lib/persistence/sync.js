import { VersionVector } from 'loro-crdt';

/**
 * Live synchronisation of the tabs that edit the same persisted document (ADR 010, multi-tab, P-94): one `BroadcastChannel`
 * (`nabu:<docId>`) per editor. Loro makes it small: updates are idempotent and commutative, so no leader, no lock, no ordering.
 *
 * Protocol (every message is a plain object; `from` is the sender's random id, `to` addresses one peer, absent = everybody):
 *  - `{ t: 'update', from, to?, bytes }` — a Loro update. Broadcast after each LOCAL commit (what changed since the last broadcast),
 *    or sent to one peer as the answer to a `hello`. The receiver imports it (`nabu.importRemote`: never an undo step, caret kept).
 *  - `{ t: 'hello', from, to?, vv, reply? }` — "this is my version (`vv`, an encoded version vector): send me what I lack". Sent when
 *    the editor opens, and again when an update arrives with a gap (its dependencies are missing). The receiver answers with an
 *    `update` of what the sender lacks and, unless this already is a `reply`, with its own `hello` (`reply: true`) when the sender has
 *    something the receiver lacks, so two tabs that diverged while one of them was frozen / offline converge in both directions.
 *
 * Echo safety: the changes imported from a peer are never rebroadcast (`sent` is moved to the document's version after each import,
 * and the doc subscription ignores `by: 'import'`). An update that arrives while an IME composition is running is held until it ends.
 * Best effort by nature (a closed or frozen tab misses messages): the merge on save (`mergeStored`) and the `hello` catch up.
 */

/** @param {string} docId */
export const channelName = (docId) => 'nabu:' + docId;

/** How long (ms) an update is held back while an IME composition is running before trying again. */
const COMPOSING_RETRY_MS = 120;

/**
 * @typedef {object} SyncHandle
 * @property {string} id this editor's id on the channel
 * @property {() => void} hello ask the peers for what this editor lacks
 * @property {() => void} close stop listening and close the channel (idempotent)
 */

/**
 * Start the live sync of an editor. Returns `null` when no `BroadcastChannel` is available (nothing to do, no error).
 * @param {object} options
 * @param {import('../blocks/nabu.svelte.js').Nabu} options.nabu
 * @param {string} options.docId
 * @param {typeof BroadcastChannel} [options.BroadcastChannelImpl] default: the global one (injectable for tests)
 * @param {(error: unknown) => void} [options.onError] a message that could not be imported (the sync goes on)
 * @returns {SyncHandle | null}
 */
export function startSync({ nabu, docId, BroadcastChannelImpl = globalThis.BroadcastChannel, onError }) {
	if (typeof BroadcastChannelImpl !== 'function') return null;
	/** @type {BroadcastChannel} */
	let channel;
	try { channel = new BroadcastChannelImpl(channelName(docId)); } catch { return null; }

	const doc = nabu.doc;
	const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
	let closed = false;
	/** What has been broadcast (or came from a peer): the next update is exported from here. */
	let sent = doc.version();
	/** @type {ReturnType<typeof setTimeout> | null} */
	let held = null;
	/** @type {Uint8Array[]} */
	const heldUpdates = [];

	/** @param {Record<string, unknown>} message */
	const post = (message) => { if (!closed) try { channel.postMessage({ ...message, from: id }); } catch { /* a closed channel */ } };

	/** Send the local changes made since the last broadcast. */
	const broadcastLocal = () => {
		if (closed) return;
		try {
			const now = doc.version();
			if (now.compare(sent) === 0) return;
			const bytes = doc.export({ mode: 'update', from: sent });
			sent = doc.version(); // (the export committed any pending change: this is what `bytes` holds)
			if (bytes.length) post({ t: 'update', bytes });
		} catch (error) { onError?.(error); }
	};

	const unsubscribe = doc.subscribe((event) => { if (event.by !== 'import') broadcastLocal(); });

	/** Ask the peers for what we lack. */
	const hello = () => post({ t: 'hello', vv: doc.version().encode() });

	/** @param {Uint8Array} bytes */
	const apply = (bytes) => {
		try {
			broadcastLocal(); // anything local goes out first: `sent` is about to jump over the imported changes
			const status = nabu.importRemote(bytes);
			sent = doc.version();
			if (status?.pending && status.pending.size > 0) hello(); // a gap (we missed an update): ask for the missing part
		} catch (error) { onError?.(error); }
	};

	const flushHeld = () => {
		held = null;
		if (closed) return;
		if (nabu.composing) { held = setTimeout(flushHeld, COMPOSING_RETRY_MS); return; }
		for (const bytes of heldUpdates.splice(0)) apply(bytes);
	};

	/** @param {Uint8Array} bytes */
	const receive = (bytes) => {
		if (nabu.composing || held) {
			heldUpdates.push(bytes);
			held ??= setTimeout(flushHeld, COMPOSING_RETRY_MS);
		} else apply(bytes);
	};

	/** @param {any} message */
	const onMessage = (message) => {
		if (closed || !message || typeof message !== 'object' || message.from === id) return;
		if (message.to !== undefined && message.to !== id) return;
		if (message.t === 'update' && message.bytes instanceof Uint8Array) {
			receive(message.bytes);
		} else if (message.t === 'hello' && message.vv instanceof Uint8Array) {
			try {
				broadcastLocal();
				const theirs = VersionVector.decode(message.vv);
				const ours = doc.version();
				const cmp = ours.compare(theirs); // 1: ahead of them (they lack something), 0: same, -1 or undefined: they have something we lack
				if (cmp === 1 || cmp === undefined) {
					const bytes = doc.export({ mode: 'update', from: theirs });
					if (bytes.length) post({ t: 'update', to: message.from, bytes });
				}
				if (!message.reply && (cmp === -1 || cmp === undefined)) post({ t: 'hello', to: message.from, reply: true, vv: ours.encode() });
			} catch (error) { onError?.(error); }
		}
	};
	channel.onmessage = (event) => onMessage(event.data);

	return {
		id,
		hello,
		close() {
			if (closed) return;
			closed = true;
			unsubscribe();
			if (held) clearTimeout(held);
			held = null;
			heldUpdates.length = 0;
			try { channel.onmessage = null; channel.close(); } catch { /* already closed */ }
		},
	};
}
