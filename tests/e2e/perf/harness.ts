/**
 * Shared harness of the large-document measurements (large-docs.perf.ts) and of the cheap regression guards in the default
 * suite (../large-docs.spec.ts):
 *
 *  - `seedSnapshot`  builds a big document FAST: `importJSON` / `importFragment` is O(N^2) today (see the audit, theme 8c), so a
 *                    5 000 / 10 000-block document is written straight into a throw-away Loro doc by the real block factories
 *                    (`createPasteBlock` bound to a doc nobody subscribes to), exported as a snapshot and stored in IndexedDB under
 *                    a docId. Reloading the page with `?persist=docId` is then the O(N) "open a saved document" path.
 *  - `installPerf`   (`window.__perf`) key->DOM latency probes, long tasks, frame recorder, clipboard probe.
 *  - `heapAfterGc`, `stats`, `fmt`, small helpers.
 */

import type { Page, BrowserContext } from '@playwright/test';
import { gotoEditor, waitForEditor } from '../helpers/editor.js';

/** Options that keep the persisted editor quiet while measuring: no autosave (a save would run on the main thread mid-measure). */
export const QUIET = { debounce: 3_600_000, maxWait: 0 };

// ── statistics ───────────────────────────────────────────────────────────

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}
export const median = (xs: number[]) => percentile(xs, 50);
export const round = (x: number, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
export interface Lat { n: number; median: number; p95: number; max: number; paintMedian: number; paintP95: number; longTasks: number; longMax: number }
export function summarize(dom: number[], paint: number[], longs: { dur: number }[]): Lat {
  return {
    n: dom.length, median: round(median(dom)), p95: round(percentile(dom, 95)), max: round(Math.max(...dom)),
    paintMedian: round(median(paint)), paintP95: round(percentile(paint, 95)),
    longTasks: longs.length, longMax: round(longs.reduce((m, l) => Math.max(m, l.dur), 0)),
  };
}

// ── page boot with timing probes ───────────────────────────────────────────

/**
 * Init script (runs before every navigation of the page): records, on the PAGE clock (0 = navigation start), when the engine is ready
 * (`ready`), when the DOM holds `sessionStorage.__perfTarget` block elements (`dom`) and the first paint after (`paint`).
 */
export async function addBootProbe(page: Page) {
  await page.addInitScript(() => {
    const t: Record<string, number> = ((window as any).__perfT = {});
    const poll = () => {
      if (!t.ready && (window as any).__nabu_ready === true) t.ready = performance.now();
      let target = 0;
      try { target = +(sessionStorage.getItem('__perfTarget') || 0); } catch { /* */ }
      if (t.ready && target && !t.dom && document.querySelectorAll('[data-block-id]').length >= target) {
        t.dom = performance.now();
        requestAnimationFrame(() => setTimeout(() => { t.paint = performance.now(); }, 0));
      }
      if (!t.paint) requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

export async function setTarget(page: Page, nodes: number) {
  await page.evaluate((n) => sessionStorage.setItem('__perfTarget', String(n)), nodes);
}

/** Wait for the boot probe to be complete (or give up) and return its timings. */
export async function readBootProbe(page: Page, timeout = 300_000) {
  await page.waitForFunction(() => !!(window as any).__perfT?.paint, null, { timeout, polling: 100 });
  return page.evaluate(() => ({ ...(window as any).__perfT }) as { ready: number; dom: number; paint: number });
}

/** Open the editor persisted under `docId` (no autosave); resolves once the engine is ready. */
export async function openPersisted(page: Page, docId: string, extra: Record<string, unknown> = {}) {
  await gotoEditor(page, { persist: docId, options: { ...QUIET, ...extra } });
}

// ── seeding ──────────────────────────────────────────────────────────────

/**
 * Write a document (the `serialize('json')` format, as a string) into IndexedDB under `docId` as a snapshot, WITHOUT going through the
 * engine's commit pipeline. The page must be an editor opened with `openPersisted(page, docId)`; its autosave is stopped first. The
 * caller reloads the page afterwards. Returns the build time and the snapshot size.
 */
export async function seedSnapshot(page: Page, docId: string, json: string) {
  return page.evaluate(
    async ({ docId, json }) => {
      const n = (window as any).nabu;
      n.persistence?.dispose();
      const B = new n.doc.constructor(); // a LoroDoc nobody subscribes to: no tree event, no updateRoots
      for (const ext of n.extensions ?? []) if (ext.loroTextStyles && Object.keys(ext.loroTextStyles).length) B.configTextStyle(ext.loroTextStyles);
      const tmp = Object.create(n);
      tmp.doc = B;
      tmp.tree = B.getTree('blocks');
      tmp.content = B.getMap('content');
      const conv = (bs: any[]): any[] =>
        bs.map((b) => {
          const { id: _id, type, props, content, children, ...extra } = b;
          const pb: any = { type, partial: false };
          const merged = { ...extra, ...(props ?? {}) };
          if (Object.keys(merged).length) pb.props = merged;
          if (typeof content === 'string') { if (content) pb.delta = [{ insert: content }]; }
          else if (Array.isArray(content)) pb.delta = content.map((r: any) => { const { text, ...marks } = r; return Object.keys(marks).length ? { insert: text, attributes: marks } : { insert: text }; });
          if (children) pb.children = conv(children);
          return pb;
        });
      const doc = JSON.parse(json);
      const t0 = performance.now();
      const create = Object.getPrototypeOf(n).createPasteBlock;
      let step = 'create';
      try {
        for (const pb of conv(doc.blocks)) create.call(tmp, pb, null);
        step = 'commit';
        B.commit();
        step = 'export';
      } catch (e) { throw new Error(`seed failed at ${step}: ${String(e)} ${(e as Error)?.stack ?? ""}`); }
      const bytes: Uint8Array = B.export({ mode: 'snapshot' });
      const buildMs = performance.now() - t0;
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('nabu');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('snapshots', 'readwrite');
          tx.objectStore('snapshots').put({ docId, snapshot: bytes, savedAt: Date.now() });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      });
      return { buildMs: Math.round(buildMs), bytes: bytes.length };
    },
    { docId, json },
  );
}

/**
 * Create a document of the given JSON in a fresh persisted slot and reopen it: returns once the page shows it. For the guards of the
 * default suite (the full measurement flow lives in large-docs.perf.ts).
 */
export async function openSeeded(page: Page, docId: string, json: string, nodes: number) {
  await openPersisted(page, docId);
  const seeded = await seedSnapshot(page, docId, json);
  await setTarget(page, nodes);
  await page.reload();
  await waitForEditor(page, 60_000);
  return seeded;
}

// ── in-page probes ───────────────────────────────────────────────────────

/**
 * Installs `window.__perf` (idempotent):
 *  - keydown timestamp (event.timeStamp: includes the time the event waited for a busy main thread) and a MutationObserver on the
 *    editor: `sample()` returns { dom, paint } = ms from the last keydown to the FIRST DOM mutation after it, and to the first frame
 *    painted after that mutation (rAF + a macrotask);
 *  - `longs`: `longtask` entries since `mark()`;
 *  - `frames`: rAF timestamps while recording (scroll test);
 *  - `copy`: time (since the keydown) at which the document-level `copy` listener ran, i.e. after the editor's copy handler, and what
 *    the handler put on the clipboard;
 *  - `place(where, kind)`, `docSig()`, `paragraphs()` helpers.
 */
export async function installPerf(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__perf) return;
    const root = document.querySelector('[data-nabu-root]')!;
    const st: any = { keyTs: 0, mutTs: 0, paintTs: 0, longs: [] as any[], frames: [] as number[], recording: false, copy: null as any };
    document.addEventListener('keydown', (e) => { st.keyTs = e.timeStamp; st.mutTs = 0; st.paintTs = 0; st.copy = null; }, true);
    new MutationObserver(() => {
      if (!st.keyTs || st.mutTs) return;
      st.mutTs = performance.now();
      requestAnimationFrame(() => setTimeout(() => { st.paintTs = performance.now(); }, 0));
    }).observe(root, { subtree: true, childList: true, characterData: true });
    const lo = new PerformanceObserver((list) => { for (const e of list.getEntries()) st.longs.push({ start: e.startTime, dur: e.duration }); });
    try { lo.observe({ type: 'longtask' }); } catch { /* unsupported */ }
    document.addEventListener('copy', (e) => {
      const dt = e.clipboardData;
      st.copy = { at: performance.now() - st.keyTs, types: dt ? [...dt.types] : [], sizes: dt ? Object.fromEntries([...dt.types].map((t) => [t, dt.getData(t).length])) : {} };
    });
    const frameLoop = () => { if (st.recording) { st.frames.push(performance.now()); requestAnimationFrame(frameLoop); } };

    const nabu = () => w.nabu;
    /** Text blocks of type `paragraph`, in document order (containers entered, collapsed or not). */
    const paragraphs = () => {
      const out: any[] = [];
      const walk = (bs: any[]) => { for (const b of bs) { if (b.type === 'paragraph') out.push(b); if (b.children?.length) walk(b.children); } };
      walk(nabu().children);
      return out;
    };
    const textOf = (b: any) => b.behaviors?.get('text')?.text ?? '';
    const sibs = (b: any) => (b.parent ? b.parent.children : nabu().children);

    w.__perf = {
      st,
      mark() { lo.takeRecords().forEach((e) => st.longs.push({ start: e.startTime, dur: e.duration })); st.longs = []; },
      longs() { lo.takeRecords().forEach((e) => st.longs.push({ start: e.startTime, dur: e.duration })); return st.longs.slice(); },
      /** ms from the last keydown to the first DOM mutation / to the next paint (null on timeout). */
      async sample(timeout = 3000) {
        const t0 = performance.now();
        while ((!st.mutTs || !st.paintTs) && performance.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 1));
        return st.mutTs ? { dom: st.mutTs - st.keyTs, paint: st.paintTs ? st.paintTs - st.keyTs : null } : null;
      },
      /** Wait until `cond()` is true; resolves with the ms since the last keydown (then +paint), or -1 on timeout. */
      async until(cond: () => boolean, timeout: number) {
        const t0 = performance.now();
        while (!cond()) { if (performance.now() - t0 > timeout) return { ms: -1, paint: -1 }; await new Promise((r) => setTimeout(r, 2)); }
        const ms = performance.now() - st.keyTs;
        await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        return { ms, paint: performance.now() - st.keyTs };
      },
      recordFrames(on: boolean) { st.recording = on; if (on) { st.frames = []; requestAnimationFrame(frameLoop); } return st.frames.slice(); },
      copyProbe() { return st.copy; },
      counts() { return { roots: nabu().children.length, dom: document.querySelectorAll('[data-block-id]').length, blocks: nabu().blocks.size }; },
      /** Signature of the document content: JSON export length + a cheap checksum. */
      docSig() { const s = JSON.stringify(nabu().serialize('json')); let h = 0; for (let i = 0; i < s.length; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0; return `${s.length}:${h}`; },
      /** Text of every block, tree order, ids ignored, and the type sequence: what Undo must give back. */
      contentSig() {
        const parts: string[] = [];
        const ids: string[] = [];
        const walk = (bs: any[]) => { for (const b of bs) { parts.push(b.type + ':' + textOf(b)); ids.push(b.id); if (b.children?.length) walk(b.children); } };
        walk(nabu().children);
        let idh = 0; for (const id of ids) for (let i = 0; i < id.length; i++) idh = (idh * 31 + id.charCodeAt(i)) | 0;
        let h = 0; const str = parts.join('\n');
        for (let i = 0; i < str.length; i += 5) h = (h * 31 + str.charCodeAt(i)) | 0;
        return { blocks: parts.length, chars: str.length, hash: h, idHash: idh, empties: parts.filter((x) => x.endsWith(':')).length };
      },
      /** Put a collapsed caret in the paragraph at fraction `frac` of the document (scrolled to the middle of the viewport). */
      async place(frac: number, offset = 12) {
        const ps = paragraphs().filter((b) => textOf(b).length > 30);
        const i = Math.min(ps.length - 1, Math.floor(frac * (ps.length - 6)) + 2);
        const b = ps[i];
        b.element?.scrollIntoView({ block: 'center' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await nabu().focus({ from: { block: b, offset }, to: { block: b, offset } });
        return { id: b.id, index: i, of: ps.length, active: document.activeElement === root };
      },
      /** Caret in the block that holds it now, at `offset` (the remainder of a split). */
      async placeInCurrent(offset: number) {
        const b = nabu().selection.anchorBlock;
        if (!b) return false;
        await nabu().focus({ from: { block: b, offset: Math.min(offset, textOf(b).length) }, to: { block: b, offset: Math.min(offset, textOf(b).length) } });
        return true;
      },
      /** Caret at offset 0 of a paragraph whose previous sibling is a paragraph, searching from fraction `frac` (or after block `afterId`). */
      async placeMergeTarget(frac: number, afterId: string | null) {
        const ps = paragraphs();
        let from = Math.floor(frac * (ps.length - 40)) + 2;
        if (afterId) { const k = ps.findIndex((b) => b.id === afterId); if (k >= 0) from = k + 1; }
        for (let i = Math.max(1, from); i < ps.length; i++) {
          const b = ps[i];
          const sb = sibs(b);
          const prev = sb[b.index - 1];
          if (prev && prev.type === 'paragraph' && b.parent === prev.parent) {
            b.element?.scrollIntoView({ block: 'center' });
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            await nabu().focus({ from: { block: b, offset: 0 }, to: { block: b, offset: 0 } });
            return { survivor: prev.id, victim: b.id };
          }
        }
        return null;
      },
      /** Caret at `offset` of a REGION header (title) at fraction `frac` of the region list. */
      async placeInRegionTitle(frac: number, offset = 1) {
        const rs = nabu().regions.list;
        const r = rs[Math.floor(frac * (rs.length - 1))];
        r.block.element?.scrollIntoView({ block: 'center' });
        await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
        await nabu().focus({ from: { block: r.block, offset }, to: { block: r.block, offset } });
        return { id: r.block.id, title: r.title };
      },
    };
  });
}

// ── heap ──────────────────────────────────────────────────────────────────

/** JS heap in MB after two forced GCs (CDP), plus the DOM node / listener counters. */
export async function heapAfterGc(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap: any = await cdp.send('Runtime.getHeapUsage');
    const dom: any = await cdp.send('Memory.getDOMCounters');
    return { heapMB: round(heap.usedSize / 1048576), nodes: dom.nodes as number, listeners: dom.jsEventListeners as number };
  } finally {
    await cdp.detach();
  }
}

// ── CDP sampling profiler (optional: NABU_PERF_PROFILE=1) ────────────────────

/**
 * Run `run()` under the V8 sampling profiler and return the top functions by SELF time and by INCLUSIVE time as text. The default
 * production build is minified (names are single letters): profile an unminified build (`build.minify: false` in vite.config.js of
 * a scratch copy) to get readable names.
 */
export async function profileTop(page: Page, run: () => Promise<unknown>, top = 14) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await run();
  const { profile } = (await cdp.send('Profiler.stop')) as any;
  await cdp.detach();
  const nodes = new Map<number, any>();
  for (const n of profile.nodes) nodes.set(n.id, n);
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const key = (n: any) => `${n.callFrame.functionName || '(anon)'} ${String(n.callFrame.url).split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  const selfBy = new Map<string, number>();
  const inclBy = new Map<string, number>();
  const dts: number[] = profile.timeDeltas;
  profile.samples.forEach((id: number, i: number) => {
    const t = dts[i] ?? 0;
    selfBy.set(key(nodes.get(id)), (selfBy.get(key(nodes.get(id))) ?? 0) + t);
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const k = key(nodes.get(cur));
      if (seen.has(k)) continue;
      seen.add(k);
      inclBy.set(k, (inclBy.get(k) ?? 0) + t);
    }
  });
  const fmtMap = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms  ${k}`).join('\n');
  return `-- self\n${fmtMap(selfBy)}\n-- inclusive\n${fmtMap(inclBy)}`;
}

export type { Page, BrowserContext };
