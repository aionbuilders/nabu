/** Default `maxWait` of `createPersistedEditor` (ms): during a continuous burst of edits, a save happens at least this often. */
export const DEFAULT_MAX_WAIT = 3000;

/**
 * Normalise the `maxWait` option: a positive number of ms, never shorter than `debounce` (like lodash: the maximum wait cannot be
 * shorter than the wait). `0` / `Infinity` / a non-number other than `undefined` disable it (the old, trailing-only behaviour);
 * `undefined` gives {@link DEFAULT_MAX_WAIT}.
 * @param {unknown} maxWait
 * @param {number} debounce
 * @returns {number} ms, or `Infinity` (no maximum)
 */
export function resolveMaxWait(maxWait, debounce) {
	if (maxWait === undefined) return Math.max(DEFAULT_MAX_WAIT, debounce);
	if (typeof maxWait !== 'number' || !(maxWait > 0) || !Number.isFinite(maxWait)) return Infinity;
	return Math.max(maxWait, debounce);
}

/**
 * @typedef {object} Autosave
 * @property {() => void} touch a change happened: (re)arm the timer
 * @property {() => void} cancel drop the pending save (nothing is saved by this scheduler)
 * @property {() => boolean} pending whether a save is scheduled and has not started yet
 */

/**
 * Debounce with a maximum wait: `touch()` re-arms a timer of `debounce` ms, but never later than `maxWait` ms after the FIRST
 * `touch()` of the current burst, so a long uninterrupted burst of changes is still saved every `maxWait` ms. Once `run` is
 * called, the next `touch()` starts a new burst. Pure (injectable clock and timers) so it can be unit tested.
 *
 * @param {object} options
 * @param {number} options.debounce ms of quiet before a save
 * @param {number} [options.maxWait] ms; `Infinity` / omitted: no maximum
 * @param {() => void} options.run the save (must not throw: report its own errors)
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 * @returns {Autosave}
 */
export function createAutosave({ debounce, maxWait = Infinity, run, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
	/** @type {any} */
	let timer = null;
	/** When the current burst started (first `touch` since the last save). @type {number | null} */
	let burstStart = null;

	const fire = () => { timer = null; burstStart = null; run(); };

	return {
		touch() {
			const t = now();
			if (burstStart === null) burstStart = t;
			if (timer !== null) clearTimer(timer);
			const remaining = burstStart + maxWait - t;
			timer = setTimer(fire, Math.max(0, Math.min(debounce, remaining)));
		},
		cancel() {
			if (timer !== null) clearTimer(timer);
			timer = null;
			burstStart = null;
		},
		pending: () => timer !== null,
	};
}
