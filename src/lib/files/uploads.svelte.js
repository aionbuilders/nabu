import { SvelteMap } from 'svelte/reactivity';
import { ASSET_PREFIX, isHashId } from './assets.clipboard.js';
import { MemoryOutbox } from './outbox.js';
import { reasonOf } from './status.js';

/** @import { Outbox, OutboxEntry } from './outbox.js' */
/** @import { FileReason } from './status.js' */

/**
 * @typedef {Object} AutoRetryConfig How a persisted editor retries, by itself, the uploads it finds waiting when it is opened (P-97).
 * @property {number} [initialDelay] ms before the second attempt (default 2000); each next one waits twice as long
 * @property {number} [maxDelay] longest wait between two attempts (default 60000)
 * @property {number} [maxAttempts] attempts per file and per session, the one at open included (default 8); the `online` event grants a new series
 */
export const DEFAULT_AUTO_RETRY = Object.freeze({ initialDelay: 2000, maxDelay: 60000, maxAttempts: 8 });

/**
 * The resolved `files.autoRetry` option: `false` disables the automatic retries, an object tunes them, anything else is the default.
 * @param {unknown} option @returns {Required<AutoRetryConfig> | null}
 */
export function resolveAutoRetry(option) {
    if (option === false) return null;
    const o = option && typeof option === 'object' ? /** @type {AutoRetryConfig} */ (option) : {};
    const positive = (/** @type {unknown} */ v, /** @type {number} */ fallback) => (typeof v === 'number' && v >= 0 && Number.isFinite(v) ? v : fallback);
    return {
        initialDelay: positive(o.initialDelay, DEFAULT_AUTO_RETRY.initialDelay),
        maxDelay: positive(o.maxDelay, DEFAULT_AUTO_RETRY.maxDelay),
        maxAttempts: Math.max(1, Math.floor(positive(o.maxAttempts, DEFAULT_AUTO_RETRY.maxAttempts))),
    };
}

/**
 * What the upload queue needs from {@link import('./files.svelte.js').Files} (kept as an interface so this module does not
 * reach into it).
 * @typedef {Object} UploadHost
 * @property {import('../blocks/nabu.svelte.js').Nabu} nabu
 * @property {import('./store.js').AssetStore} store
 * @property {import('loro-crdt').LoroMap} index the document's `assetIndex`
 * @property {() => import('./files.svelte.js').FilesConfig} config
 * @property {(write: () => void) => Promise<void>} silent run Loro writes as a silent commit (not an undo step)
 * @property {(hash: string) => Promise<void>} settled resolves when the bytes of `hash` arriving with a paste are stored
 * @property {() => void} forgetMissing forget the "no source has it" verdicts (the index changed)
 * @property {<T>(promise: Promise<T>) => Promise<T>} track register a background job (see `Files#whenIdle`)
 */

/**
 * @typedef {Object} Job
 * @property {string} hash
 * @property {AbortController} controller
 * @property {'cancel' | 'released' | null} cause why the controller was aborted
 * @property {boolean} referenced a live block has referenced this file since the job started (a job nobody references
 *   yet, e.g. started by `Files#persist`, is not aborted by the "last block deleted" rule)
 * @property {Promise<boolean>} promise resolves `true` when the upload succeeded
 */

/**
 * The upload side of {@link import('./files.svelte.js').Files} (ADR 014 lot 2): with a host (`files.onBeforePersist`) a file is
 * stored locally first, then sent in the background. The queue is DRIVEN BY THE DOCUMENT, not by calls:
 *
 *  - a block whose status is `pending`, with a `nabu-asset:sha256-…` ref, local bytes, no host `url` and no running upload
 *    → the upload starts (this is also how an upload RESUMES when a document is opened again, and how an undo that brings a
 *    deleted block back restarts it);
 *  - an upload whose file no live block references any more is aborted (`AbortController` → the `signal` given to the host);
 *  - success: `assetIndex[hash].url = <ref returned by the host>` and the blocks become `ready`, in a silent commit; the
 *    block's ref NEVER changes. Failure: the blocks become `error` (local copy kept). {@link Uploads#retry} / {@link Uploads#cancel}
 *    are the explicit controls.
 *
 * The outbox ({@link Outbox}) remembers what is waiting (and how many attempts were made) next to the local store, so it
 * survives a closed tab; it is a record, the document statuses plus the local bytes are what the queue acts on.
 *
 * Retry on open (P-97): the files the outbox lists when the document is opened (an upload interrupted, or one that had failed) are
 * sent again BY THEMSELVES, in the background: a failed `error` file at once, then, whenever an attempt fails, after 2 s, 4 s, 8 s…
 * (at most 60 s), `maxAttempts` times per session; the browser's `online` event starts a fresh series. A cancelled upload (the user's
 * choice) is not retried, nor are the failures of the current session (the block's `retry()` is for those). See {@link AutoRetryConfig}.
 */
export class Uploads {
    /** @type {UploadHost} */
    #host;
    /** @type {Outbox} */
    outbox;
    /** @type {Map<string, Job>} */
    #jobs = new Map();
    /** hash → progress (0–1) of the running upload. @type {SvelteMap<string, number>} */
    #progress = new SvelteMap();
    /** @type {Map<string, OutboxEntry>} */
    #entries = new Map();
    #scheduled = false;
    /** @type {Promise<void> | null} */
    #running = null;
    #again = false;
    #booted = false;
    /** @type {Promise<void>} */
    #boot;
    /** `files.autoRetry`, resolved (`null`: off). */
    #auto;
    /** Files the outbox listed at open: the ones retried by themselves. @type {Set<string>} */
    #autoSet = new Set();
    /** Attempts started this session, per file of {@link Uploads#autoSet}. @type {Map<string, number>} */
    #attempts = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    #timers = new Map();
    /** Files that used their attempts or waited for the network: the next `online` event retries them. @type {Set<string>} */
    #parked = new Set();
    #disposed = false;
    /** @type {(() => void) | null} */
    #onOnline = null;

    /** @param {UploadHost} host */
    constructor(host) {
        this.#host = host;
        this.outbox = /** @type {Outbox} */ (host.config().outbox ?? new MemoryOutbox());
        this.#auto = resolveAutoRetry(/** @type {any} */ (host.config()).autoRetry);
        this.#boot = host.track(this.#start0());
    }

    /** Stop the automatic retries (timers, `online` listener). The queue itself keeps working. */
    dispose() {
        this.#disposed = true;
        for (const timer of this.#timers.values()) clearTimeout(timer);
        this.#timers.clear();
        this.#parked.clear();
        if (this.#onOnline) globalThis.removeEventListener?.('online', this.#onOnline);
        this.#onOnline = null;
    }

    /** Resolves once the outbox was read and the first pass (resume) ran. @returns {Promise<void>} */
    ready() { return this.#boot; }

    /** @returns {((file: File, ctx: { signal?: AbortSignal, onProgress?: (p: number) => void }) => Promise<{ ref: string } | void>) | undefined} */
    get #hook() { return this.#host.config().onBeforePersist; }

    // ── Reactive state ───────────────────────────────────────────────────────────────────────────

    /** Progress (0–1) of the running upload of `hash`, `null` when none runs. Reactive. @param {string} hash @returns {number | null} */
    progress(hash) { return this.#progress.get(hash) ?? null; }

    /** Whether any upload is running (not reactive). @returns {boolean} */
    busy() { return this.#jobs.size > 0; }

    /** Whether an upload of `hash` is running. Reactive. @param {string} hash @returns {boolean} */
    isUploading(hash) { return this.#progress.has(hash); }

    /** @param {string} hash @returns {string | null} the host location recorded in the index */
    hostedUrl(hash) {
        const url = /** @type {any} */ (this.#host.index.get(hash))?.url;
        return typeof url === 'string' && url ? url : null;
    }

    /** Whether a file with this hash still has to be sent to the host. @param {string} hash @returns {boolean} */
    needsUpload(hash) { return Boolean(this.#hook) && !this.hostedUrl(hash); }

    // ── Document watching ────────────────────────────────────────────────────────────────────────

    /**
     * Called for every committed change of the document. Only what can concern an upload triggers a pass: a media ref /
     * status written, or (while an upload runs) a node deleted. Typing never does.
     * @param {any} event a Loro event batch
     */
    onDocEvent(event) {
        let relevant = false;
        for (const e of event?.events ?? []) {
            const diff = e.diff;
            if (e.path?.[0] === 'assetIndex') this.#host.forgetMissing();
            // Changes IMPORTED from another tab (multi-tab sync) are that tab's uploads: they never start one here (two tabs would send
            // the same file twice). They arrive with their final status; if that tab goes away first, the next open resumes the upload.
            if (event?.by === 'import') continue;
            if (diff?.type === 'map') {
                const updated = diff.updated;
                if (updated && ('ref' in updated || 'status' in updated)) relevant = true;
            } else if (diff?.type === 'tree' && this.#jobs.size > 0) {
                relevant = true;
            }
        }
        if (relevant) this.schedule();
    }

    /** Run a pass soon (coalesced). */
    schedule() {
        if (this.#scheduled) return;
        this.#scheduled = true;
        queueMicrotask(() => {
            this.#scheduled = false;
            this.#host.track(this.reconcile());
        });
    }

    /**
     * Look at the document and act: abort the uploads nobody references, start those that are due. Passes never overlap.
     * @returns {Promise<void>}
     */
    reconcile() {
        if (!this.#booted) { this.#again = true; return this.#boot; } // the first pass (resume) runs first
        if (this.#running) { this.#again = true; return this.#running; }
        const run = (async () => {
            try {
                do {
                    this.#again = false;
                    try { await this.#pass(false); } catch (error) { this.#host.nabu.warn(`files: upload pass failed: ${error}`); }
                } while (this.#again);
            } finally {
                this.#running = null;
            }
        })();
        this.#running = run;
        return run;
    }

    async #start0() {
        try {
            for (const entry of await this.outbox.list()) this.#entries.set(entry.hash, entry);
        } catch (error) {
            this.#host.nabu.warn(`files: could not read the upload outbox: ${error}`);
        }
        try {
            await this.#pass(true);
        } catch (error) {
            this.#host.nabu.warn(`files: could not resume the uploads: ${error}`);
        }
        this.#booted = true;
        if (this.#again) await this.reconcile();
        this.#startAutoRetry();
    }

    // ── Retry on open (P-97) ─────────────────────────────────────────────────────────────────────

    /** After the first pass: the files still waiting in the outbox are the ones to retry by themselves. */
    #startAutoRetry() {
        if (!this.#auto || !this.#hook || this.#disposed) return;
        for (const [hash, entry] of this.#entries) {
            this.#autoSet.add(hash);
            if (entry.state === 'error' && !this.#jobs.has(hash)) this.#arm(hash);
        }
        if (this.#autoSet.size === 0 || this.#onOnline || typeof globalThis.addEventListener !== 'function') return;
        this.#onOnline = () => this.#networkBack();
        globalThis.addEventListener('online', this.#onOnline);
    }

    /** The network is back: every file that gave up or waited gets a fresh series, at once. */
    #networkBack() {
        if (this.#disposed) return;
        for (const hash of [...this.#autoSet]) {
            if (!this.#parked.has(hash) && !this.#timers.has(hash)) continue;
            clearTimeout(this.#timers.get(hash));
            this.#timers.delete(hash);
            this.#parked.delete(hash);
            this.#attempts.set(hash, 0);
            this.#arm(hash);
        }
    }

    /** Whether some live block of `hash` failed for a reason a retry can cure (not a cancellation, which is the user's choice). @param {string} hash */
    #retriable(hash) {
        return this.#nodesOf(hash).some((n) => n.data.get('status') === 'error' && n.data.get('reason')?.code !== 'cancelled');
    }

    /** Schedule the next automatic attempt of `hash` (backoff), unless it is not one to retry, or used its attempts. @param {string} hash */
    #arm(hash) {
        const auto = this.#auto;
        if (!auto || this.#disposed || !this.#autoSet.has(hash) || this.#timers.has(hash) || this.#jobs.has(hash) || !this.#hook) return;
        if (this.hostedUrl(hash) || !this.#retriable(hash)) return;
        const done = this.#attempts.get(hash) ?? 0;
        if (done >= auto.maxAttempts) { this.#parked.add(hash); return; }
        const delay = done === 0 ? 0 : Math.min(auto.maxDelay, auto.initialDelay * 2 ** (done - 1));
        this.#timers.set(hash, setTimeout(() => { this.#timers.delete(hash); void this.#attempt(hash); }, delay));
    }

    /** @param {string} hash */
    async #attempt(hash) {
        if (this.#disposed || this.#jobs.has(hash)) return;
        if (globalThis.navigator?.onLine === false) { this.#parked.add(hash); return; } // offline: wait for the `online` event, no attempt used
        if (this.hostedUrl(hash) || !this.#retriable(hash)) return;
        const ok = await this.retry(hash);
        if (!ok) this.#arm(hash); // (a failed job armed it already; this covers a retry that could not start)
    }

    /**
     * Every live media block that references a stored file by hash: hash → its tree nodes (`nodes`) and the ones that are `pending`.
     * @returns {Map<string, { nodes: any[], pending: any[] }>}
     */
    #scan() {
        /** @type {Map<string, { nodes: any[], pending: any[] }>} */
        const groups = new Map();
        for (const node of /** @type {any[]} */ (this.#host.nabu.tree.getNodes())) {
            if (node.isDeleted?.()) continue;
            const ref = node.data.get('ref');
            if (typeof ref !== 'string' || !ref.startsWith(ASSET_PREFIX)) continue;
            const hash = ref.slice(ASSET_PREFIX.length);
            if (!isHashId(hash)) continue;
            let group = groups.get(hash);
            if (!group) groups.set(hash, group = { nodes: [], pending: [] });
            group.nodes.push(node);
            if (node.data.get('status') === 'pending') group.pending.push(node);
        }
        return groups;
    }

    /** @param {boolean} boot the first pass after the document was opened */
    async #pass(boot) {
        let groups = this.#scan();
        if (boot && (await this.#adoptOutbox(groups))) groups = this.#scan();

        // The last block that shows a file in flight is gone (deleted): stop sending it. An undo brings it back and restarts it.
        for (const [hash, job] of this.#jobs) {
            if (groups.has(hash)) job.referenced = true;
            else if (job.referenced && !job.cause) { job.cause = 'released'; job.controller.abort(); }
        }

        for (const [hash, group] of groups) {
            if (!group.pending.length || this.#jobs.has(hash)) continue;
            await this.#host.settled(hash); // bytes arriving with a paste are being stored: do not conclude too early
            if (this.#jobs.has(hash)) continue;
            if (this.hostedUrl(hash)) { await this.#mark(hash, 'ready', null, ['pending']); continue; } // already at the host
            if (!(await this.#host.store.has(hash).catch(() => false))) continue; // nothing to send, nothing to show: see MediaBlock#isMissing
            if (this.#hook) this.#startJob(hash, true);
            else await this.#mark(hash, 'ready', null, ['pending']); // no host configured: the local copy is the file
        }
    }

    /**
     * First pass after opening: reconcile the outbox with the document. An entry whose file is not referenced by the document any
     * more, already hosted, or whose local copy is gone, is stale and dropped; a still-pending entry referenced by a block
     * that is not `pending` (the status was not saved before the tab closed) puts it back to `pending` so it resumes.
     * @param {Map<string, { nodes: any[], pending: any[] }>} groups
     * @returns {Promise<boolean>} whether the document was changed
     */
    async #adoptOutbox(groups) {
        let changed = false;
        for (const [hash, entry] of [...this.#entries]) {
            const group = groups.get(hash);
            if (!group || this.hostedUrl(hash) || !(await this.#host.store.has(hash).catch(() => false))) {
                await this.#forget(hash);
                continue;
            }
            if (entry.state === 'pending' && this.#hook && group.nodes.some((n) => n.data.get('status') === 'ready')) {
                changed = (await this.#mark(hash, 'pending', null, ['ready'])) || changed;
            }
        }
        return changed;
    }

    // ── Document writes ──────────────────────────────────────────────────────────────────────────

    /** @param {string} hash @returns {any[]} live tree nodes whose ref is `hash` */
    #nodesOf(hash) {
        const ref = ASSET_PREFIX + hash;
        return /** @type {any[]} */ (this.#host.nabu.tree.getNodes()).filter((n) => !n.isDeleted?.() && n.data.get('ref') === ref);
    }

    /**
     * Set the status (and reason) of the live blocks of a file, silently. `from` restricts it to blocks currently in one of those statuses.
     * @param {string} hash @param {string} status @param {FileReason | null} reason @param {string[]} [from]
     * @param {(() => void)} [extra] more writes for the same commit
     * @returns {Promise<boolean>} whether a block was changed
     */
    async #mark(hash, status, reason, from, extra) {
        const targets = this.#nodesOf(hash).filter((n) => !from || from.includes(n.data.get('status')));
        if (!targets.length && !extra) return false;
        await this.#host.silent(() => {
            extra?.();
            for (const node of targets) {
                node.data.set('status', status);
                if (reason) node.data.set('reason', reason);
                else if (node.data.get('reason') !== undefined) node.data.delete('reason');
            }
        });
        return targets.length > 0;
    }

    /** @param {string} hash @param {'pending' | 'error'} state @param {number} attempts */
    async #remember(hash, state, attempts) {
        const entry = { hash, attempts, state, updatedAt: Date.now() };
        this.#entries.set(hash, entry);
        try { await this.outbox.put(entry); } catch (error) { this.#host.nabu.warn(`files: outbox write failed: ${error}`); }
    }

    /** @param {string} hash */
    async #forget(hash) {
        this.#entries.delete(hash);
        try { await this.outbox.delete(hash); } catch (error) { this.#host.nabu.warn(`files: outbox write failed: ${error}`); }
    }

    // ── Jobs ─────────────────────────────────────────────────────────────────────────────────────

    /**
     * Start (or join) the upload of a file already in the local store. Returns at once; the job promise resolves `true` on success.
     * @param {string} hash @param {boolean} referenced whether a live block references the file
     * @returns {Job}
     */
    #startJob(hash, referenced) {
        const existing = this.#jobs.get(hash);
        if (existing) return existing;
        /** @type {Job} */
        const job = { hash, controller: new AbortController(), cause: null, referenced, promise: /** @type {any} */ (null) };
        this.#jobs.set(hash, job);
        this.#progress.set(hash, 0);
        job.promise = this.#run(job);
        return job;
    }

    /**
     * Send a file that is already in the local store to the host, now (`Files#persist`). No-op without a host or when it is
     * already hosted. @param {string} hash @returns {Promise<boolean>}
     */
    upload(hash) {
        if (!this.#hook || this.hostedUrl(hash)) return Promise.resolve(Boolean(this.hostedUrl(hash)));
        return this.#startJob(hash, false).promise;
    }

    /** @param {Job} job @returns {Promise<boolean>} */
    async #run(job) {
        const { hash, controller } = job;
        const { signal } = controller;
        const attempts = (this.#entries.get(hash)?.attempts ?? 0) + 1;
        let rearm = false;
        if (this.#autoSet.has(hash)) this.#attempts.set(hash, (this.#attempts.get(hash) ?? 0) + 1);
        try {
            await this.#remember(hash, 'pending', attempts);
            const blob = await this.#host.store.get(hash);
            if (!blob) throw new Error('the local copy of the file is gone');
            const meta = /** @type {any} */ (this.#host.index.get(hash)) ?? (await this.#host.store.stat?.(hash)) ?? {};
            const file = new File([blob], meta.name || '', { type: meta.mime || blob.type || 'application/octet-stream' });
            /** @type {{ ref: string } | void} */
            let result = undefined;
            const hook = this.#hook;
            if (!hook) throw new Error('no host configured');
            if (!signal.aborted) {
                result = await hook(file, {
                    signal,
                    onProgress: (p) => {
                        if (this.#jobs.get(hash) !== job || typeof p !== 'number' || !Number.isFinite(p)) return;
                        this.#progress.set(hash, Math.min(1, Math.max(0, p)));
                    },
                });
            }
            // 'released': the block is gone but the host has the file: keep that knowledge (an undo shows it ready at once)
            if (signal.aborted && job.cause !== 'released') throw new DOMException('aborted', 'AbortError');
            if (signal.aborted && !result) throw new DOMException('aborted', 'AbortError');
            const ref = result && typeof result.ref === 'string' && result.ref ? result.ref : null;
            await this.#host.silent(() => {
                if (ref) this.#host.index.set(hash, { ...meta, mime: meta.mime ?? file.type, name: meta.name ?? '', size: meta.size ?? blob.size, url: ref });
                for (const node of this.#nodesOf(hash)) {
                    if (node.data.get('status') !== 'pending' && node.data.get('status') !== 'error') continue;
                    node.data.set('status', 'ready');
                    if (node.data.get('reason') !== undefined) node.data.delete('reason');
                }
            });
            this.#host.forgetMissing();
            await this.#forget(hash);
            this.#autoSet.delete(hash);
            this.#attempts.delete(hash);
            this.#parked.delete(hash);
            return true;
        } catch (error) {
            if (signal.aborted) {
                if (job.cause === 'cancel') {
                    await this.#mark(hash, 'error', reasonOf('cancelled'), ['pending']);
                    await this.#remember(hash, 'error', attempts);
                }
                // 'released': nothing changes; the outbox keeps the entry, an undo restarts the upload
                return false;
            }
            const detail = error instanceof Error && error.message ? error.message : String(error);
            this.#host.nabu.warn(`files: upload of ${hash} failed: ${detail}`);
            await this.#mark(hash, 'error', reasonOf('upload-failed', `The upload failed: ${detail}`.slice(0, 300)), ['pending']);
            await this.#remember(hash, 'error', attempts);
            rearm = true;
            return false;
        } finally {
            if (this.#jobs.get(hash) === job) this.#jobs.delete(hash);
            this.#progress.delete(hash);
            this.schedule();
            if (rearm) this.#arm(hash); // (after the job left the table: a failed upload of a file retried on open is tried again, later)
        }
    }

    // ── Controls ─────────────────────────────────────────────────────────────────────────────────

    /**
     * Run the upload of a file again from its local copy (the blocks that were `error` become `pending`).
     * @param {string} hash @returns {Promise<boolean>} `true` when the file ended up at the host
     */
    async retry(hash) {
        const running = this.#jobs.get(hash);
        if (running) return running.promise;
        if (!this.#hook) return false;
        if (this.hostedUrl(hash)) { await this.#mark(hash, 'ready', null, ['pending', 'error']); return true; }
        if (!(await this.#host.store.has(hash).catch(() => false))) return false;
        await this.#mark(hash, 'pending', null, ['error']);
        return this.#startJob(hash, this.#nodesOf(hash).length > 0).promise;
    }

    /**
     * Abort the running upload of a file (its `signal` fires). The blocks become `error` with the reason `cancelled`; the
     * local copy stays, {@link Uploads#retry} sends it again.
     * @param {string} hash @returns {boolean} whether an upload was running
     */
    cancel(hash) {
        const job = this.#jobs.get(hash);
        if (!job || job.controller.signal.aborted) return false;
        job.cause = 'cancel';
        job.controller.abort();
        return true;
    }
}
