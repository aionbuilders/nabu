/**
 * Typing latency, measured ONE way everywhere on the site (the X-ray on the home page, the Performance lab, any proof).
 *
 * MEASUREMENTS, 2026-10-28, headless Chromium under Playwright (software rendering, no GPU), production build (`build:e2e`),
 * 60 characters typed in the middle of the document at 90 ms per key (tests/e2e/perf/lab-numbers.perf.ts), on a machine shared with
 * other jobs (load average 4 on 24 cores), BEFORE and AFTER the fix in the same session. These numbers are NOT printed on the site.
 *
 *                          before the fix                after the fix                engine work p50
 *                          key to next paint p50 / p95   key to next paint p50 / p95
 *   lab,  1,000 blocks        18.1 ms / 24.3 ms             9.3-9.7 ms / 13.5-20.1 ms      2.8 ms
 *   lab, 10,000 blocks        92.0 ms / 112 ms              13.5 ms / 18.3-19.4 ms         2.9 ms   (4 runs: p50 13.5 every time)
 *   home editor (7 blocks)     8.7 ms / 14.8 ms              8.6-9.0 ms / 14.4-15.1 ms     3.5 ms   (unchanged: the floor of this setup)
 *   (the same day, quiet machine, first measure: 10,000 blocks 80 / 99 ms before, 10.3 / 13.2 ms after)
 *
 *   Reading: the engine's own work stays ~3 ms at any size and a keystroke creates no DOM node. What took 80-100 ms at 10,000 blocks
 *   was the browser: after the text changed it laid out, painted and synced the selection of the WHOLE contenteditable (a Chrome
 *   trace: `Editor::SyncSelection` 70 ms per key, `Layout` 15-30 ms for 9 dirty objects out of 27,000). The fix lets it skip what is off
 *   screen (`content-visibility: auto` on chunks of ~64 blocks and on region bodies, see src/lib/blocks/chunks.js). The small document
 *   sits at ~9 ms, which is mostly the wait for the next frame tick (a uniform 0-16.7 ms, ~8 ms on average): it is the floor.
 *   Loading 10,000 blocks takes 7-10 s in the lab (not changed by the fix), 1,000 blocks 1-1.4 s.
 *
 * KEY TO NEXT PAINT (the number we call "latency"; INP-like)
 *   start  the keyboard event's OWN `event.timeStamp` (keydown, or beforeinput when there is no keydown: virtual keyboards, dictation).
 *          It is the moment the browser received the key, so the time the event spent queued behind other work counts.
 *   end    the first frame painted after the DOM text was updated: `requestAnimationFrame(() => port.postMessage())`, the message
 *          handler reads `performance.now()`. The rAF callback runs right before the frame's style / layout / paint; a message posted
 *          from it is a LATER task, so it runs once that frame has been produced. (`setTimeout(0)` would not do: it can fire before
 *          the frame. A double rAF would end at the start of the NEXT frame, a frame late.) This is the same proxy the web-vitals
 *          library uses for "next paint".
 *   unit   milliseconds. A frame at 60 Hz is 16.7 ms: that is the budget the lab draws.
 *
 * ENGINE WORK (secondary, a detail shown in the lab only)
 *   from the same start to the moment the DOM text of the edited block has been updated (a MutationObserver on the editor root: its
 *   callback runs in a microtask after the DOM write). It leaves out style / layout / paint, which depend on the browser and the page.
 *
 * Everything depends on the machine and the browser. The pure functions (percentile, summarize, isEditKey, sparkline, formatting)
 * are unit tested (tests/unit/measure.test.js); `createKeyMeter` / `nextPaint` need a browser and are covered by the e2e specs.
 */

/** One frame at 60 Hz, in ms. */
export const FRAME_MS = 1000 / 60;

/** A keystroke that never reaches the DOM (no edit) is dropped after this long (ms). */
const STALE_MS = 2000;

// ── pure helpers ────────────────────────────────────────────────────────────

/** The `p`-th percentile (nearest rank) of `xs`, 0..100; NaN for an empty list. @param {number[]} xs @param {number} p */
export function percentile(xs, p) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** @param {number[]} xs @returns {{ n: number, p50: number, p95: number, max: number }} (NaN when empty) */
export function summarize(xs) {
  return { n: xs.length, p50: percentile(xs, 50), p95: percentile(xs, 95), max: xs.length ? Math.max(...xs) : NaN };
}

/** Append to a list that keeps its last `max` entries (returns a new array). @template T @param {T[]} list @param {T} value @param {number} max */
export function pushBounded(list, value, max) {
  const next = list.length >= max ? list.slice(list.length - max + 1) : list.slice();
  next.push(value);
  return next;
}

/** `4.2` / `16.7` / `118` (no unit); `<0.1` below a tenth; `—` for NaN. @param {number} ms */
export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 0.1) return '<0.1';
  return ms < 100 ? ms.toFixed(1) : String(Math.round(ms));
}

/**
 * Does this keyboard event start a measured edit? Printable characters, Backspace, Delete, Enter. Not a shortcut (Ctrl / Meta / Alt
 * combos), not an IME composition, not navigation.
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, isComposing?: boolean }} e
 */
export function isEditKey(e) {
  if (e.isComposing || e.key === 'Process' || e.key === 'Dead') return false;
  if (e.ctrlKey || e.metaKey) return false;
  if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') return true;
  return e.key.length === 1 && !e.altKey;
}

/**
 * SVG polyline points (`"x,y x,y …"`) for a sparkline of `values` in a `width` x `height` box, y = 0 at the bottom of the box, drawn in
 * SVG coordinates (y down). The scale is `0..max` (the caller picks it so that the frame budget line is always at the same place).
 * One point: a flat line across the box. Empty: `''`.
 * @param {number[]} values @param {{ width: number, height: number, max: number, pad?: number }} box
 */
export function sparklinePoints(values, { width, height, max, pad = 2 }) {
  if (!values.length) return '';
  const top = Math.max(max, 1e-6);
  const y = (/** @type {number} */ v) => +(height - pad - (Math.min(v, top) / top) * (height - 2 * pad)).toFixed(2);
  if (values.length === 1) return `0,${y(values[0])} ${width},${y(values[0])}`;
  const step = width / (values.length - 1);
  return values.map((v, i) => `${+(i * step).toFixed(2)},${y(v)}`).join(' ');
}

// ── browser parts ───────────────────────────────────────────────────────────

/**
 * Resolves with `performance.now()` once the first frame painted AFTER this call is out (rAF, then a task posted from it: see the
 * header). Never resolves while the tab is hidden (no frames): callers must not wait on it for anything essential.
 * @returns {Promise<number>}
 */
export function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { channel.port1.close(); resolve(performance.now()); };
      channel.port2.postMessage(null);
    });
  });
}

/**
 * @typedef {Object} KeySample
 * @property {number} paint   ms, key to next paint
 * @property {number} engine  ms, key to the DOM text update ("engine work")
 * @property {number} at      `performance.now()` when the sample was completed
 */

/**
 * Watch the editor under `root`: for every edit key typed in it, report one {@link KeySample}. Listens on the document (capture, ahead of
 * the editor's own handlers) so that nothing the editor does can delay the start. A keystroke whose DOM never changes (nothing to
 * delete, a blocked key) produces no sample. Several keys typed before one frame share that frame, each keeps its own start.
 * @param {Element} root the editor element (`[data-nabu-root]`)
 * @param {(sample: KeySample) => void} onSample
 * @returns {{ dispose(): void }}
 */
export function createKeyMeter(root, onSample) {
  /** @type {Array<{ t0: number, mut: number | null, awaiting: boolean }>} `awaiting`: from a keydown whose beforeinput has not come yet */
  let pending = [];
  let alive = true;
  let scheduled = false;

  /** @param {Event} e */
  const inEditor = (e) => {
    const t = e.target;
    const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
    return !!el && root.contains(el);
  };
  /** @param {number} now */
  const prune = (now) => { pending = pending.filter((p) => p.mut !== null || now - p.t0 < STALE_MS); };
  /** @param {KeyboardEvent} e */
  const onKeydown = (e) => {
    if (!inEditor(e) || !isEditKey(e)) return;
    // The beforeinput of a key follows its keydown with no other keydown in between: an older `awaiting` one will never get it (the app
    // handled that key itself and prevented the default).
    pending = pending.filter((p) => !p.awaiting && (p.mut !== null || e.timeStamp - p.t0 < STALE_MS));
    pending.push({ t0: e.timeStamp, mut: null, awaiting: true });
  };
  /**
   * Virtual keyboards / dictation have no usable keydown (`Process`, 229): the beforeinput starts the sample. A key that had a keydown
   * is paired with its beforeinput in ORDER (not by time: under load the two timestamps can be far apart), so it counts once.
   * @param {InputEvent} e
   */
  const onBeforeinput = (e) => {
    if (!inEditor(e) || e.isComposing) return;
    if (!/^(insertText|insertReplacementText|deleteContent|deleteWordBackward|deleteWordForward|insertParagraph|insertLineBreak)/.test(e.inputType)) return;
    prune(e.timeStamp);
    const own = pending.find((p) => p.awaiting);
    if (own) own.awaiting = false;
    else pending.push({ t0: e.timeStamp, mut: null, awaiting: false });
  };

  /** One frame wait for every keystroke whose DOM update has been seen so far; the ones that come later get the next. */
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const upTo = performance.now();
    nextPaint().then((paintedAt) => {
      scheduled = false;
      if (!alive) return;
      const done = pending.filter((p) => p.mut !== null && p.mut <= upTo);
      pending = pending.filter((p) => !done.includes(p) && paintedAt - p.t0 < STALE_MS);
      for (const p of done) onSample({ paint: paintedAt - p.t0, engine: /** @type {number} */ (p.mut) - p.t0, at: paintedAt });
      if (pending.some((p) => p.mut !== null)) schedule();
    });
  };

  const observer = new MutationObserver(() => {
    const now = performance.now();
    prune(now); // a key that changed nothing must not claim a later mutation
    let any = false;
    for (const p of pending) if (p.mut === null && !p.awaiting) { p.mut = now; any = true; }
    if (any) schedule();
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });

  const opts = { capture: true };
  document.addEventListener('keydown', onKeydown, opts);
  document.addEventListener('beforeinput', onBeforeinput, opts);

  return {
    dispose() {
      alive = false;
      observer.disconnect();
      document.removeEventListener('keydown', onKeydown, opts);
      document.removeEventListener('beforeinput', onBeforeinput, opts);
      pending = [];
    },
  };
}
