/**
 * PERFORMANCE measurements on large documents (AUDIT 2026-10, theme 8c). NOT part of the default `bunx playwright test` run: it lives in
 * its own Playwright project, `perf` (see playwright.config.js: the project only exists when asked for).
 *
 *   bunx playwright test --project=perf                       # everything (30-60 min; the destructive Select-all scenarios are capped)
 *   bunx playwright test --project=perf -g "insert loop"      # the insert-loop growth curve only (~1 min)
 *   bunx playwright test --project=perf -g "flat 1000"        # one document size
 *   NABU_PERF_SIZES=1000,5000 bunx playwright test --project=perf
 *
 * Environment knobs
 *   NABU_PERF_SIZES        block counts of the documents (default 1000,5000,10000)
 *   NABU_PERF_CAP_MS       cap of one operation that may never come back (Select-all + Backspace, Undo, paste, import), default 240000.
 *                          An operation that hits it is reported as "> cap" and its page is abandoned (a finding, not a failure).
 *   NABU_PERF_IMPORT_MAX   largest block count of the importJSON growth curve (default: all of 500 / 1000 / 2000 / 4000 / 5000)
 *   NABU_PERF_IMPORT_10K=1 also attempt `importJSON` of 10 000 blocks (capped; skipped by default: the 4 000 / 5 000 curve is enough)
 *   NABU_PERF_PROFILE=1    print the V8 sampling-profiler top functions of the typing / Enter / Backspace runs at the middle of the
 *                          document, and of the Select all + Backspace of the bulk spec (names are minified in the production build: profile an unminified build, see harness.ts)
 *
 * Output: a table on the console and `test-results/perf.json` (rewritten at the end of the run, so `-g` runs overwrite it).
 * Thresholds are FLAGGED, never failed: typing median > 16 ms or p95 > 50 ms, a long task > 200 ms while typing, import + render > 2 s at
 * 1 000 blocks.
 *
 * How a big document is built: `importJSON` was O(N^2) (the tree subscription called `updateRoots()` once per created root: 163 s for
 * 5 000 blocks; fixed 2026-10-26, now ~4 s), and a 5 000 / 10 000-block document is still seeded straight into IndexedDB as a snapshot (harness.ts `seedSnapshot`:
 * the real block factories write into a Loro doc nobody listens to) and OPENED with `?persist=` (the O(N) path of a saved document). The
 * `importJSON` / insert-loop curves are measured separately, at sizes where they come back.
 *
 * What is measured, per size (flat) and per size (regions variant: ~200 nested regions)
 *   load       reload -> engine ready -> all block elements in the DOM -> first paint (page clock, 0 = navigation start), JS heap after GC
 *   typing     keydown -> first DOM mutation (and -> next paint) over 30 real key presses, at the START / MIDDLE / END of the document;
 *              Enter (split) and Backspace at the start of a block (merge), same percentiles
 *   scroll     long tasks and frame intervals while 150 wheel events scroll the page top -> bottom
 *   save       saveNow() and the stored snapshot size, then reload-to-ready of the saved document
 *   copy       Select all + Copy of the whole document, `serialize('json' | 'markdown')`
 *   bulk       Select all + Backspace, then Undo (bulk spec); paste of 500 blocks in the middle (bulk spec)
 *   regions    does typing recompute `nabu.regions.list`? cost of a rebuild, of the word counts
 */

import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gotoEditor, waitForEditor } from '../helpers/editor.js';
import { genDoc, genPasteMarkdown } from './gen-doc.js';
import {
  addBootProbe, heapAfterGc, installPerf, openPersisted, profileTop, readBootProbe, round, seedSnapshot, setTarget, summarize, median, percentile,
  type Lat,
} from './harness.js';

// ── configuration ────────────────────────────────────────────────────────────

const SIZES = (process.env.NABU_PERF_SIZES ?? '1000,5000,10000').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const CAP_MS = Number(process.env.NABU_PERF_CAP_MS ?? 240_000);
const PROFILE = process.env.NABU_PERF_PROFILE === '1';
const TYPED = 'the quick brown fox jumps over'; // 30 characters
const PERMISSIONS = ['clipboard-read', 'clipboard-write'];

const THRESHOLDS = { typingMedian: 16, typingP95: 50, longTask: 200, import1k: 2000 };

// ── results ──────────────────────────────────────────────────────────────────

const R: { meta: Record<string, unknown>; baseline?: any; insertCurve?: any; importCurve?: any; runs: Record<string, any>; flags: string[] } = {
  meta: { startedAt: new Date().toISOString(), sizes: SIZES, capMs: CAP_MS, thresholds: THRESHOLDS },
  runs: {},
  flags: [],
};
const run = (label: string) => (R.runs[label] ??= {});
const flag = (msg: string) => { R.flags.push(msg); console.log(`[perf] FLAG ${msg}`); };
const flagLat = (label: string, what: string, l: Lat) => {
  if (l.median > THRESHOLDS.typingMedian) flag(`${label} ${what}: median ${l.median} ms > ${THRESHOLDS.typingMedian}`);
  if (l.p95 > THRESHOLDS.typingP95) flag(`${label} ${what}: p95 ${l.p95} ms > ${THRESHOLDS.typingP95}`);
  if (l.longMax > THRESHOLDS.longTask) flag(`${label} ${what}: long task ${l.longMax} ms > ${THRESHOLDS.longTask} (${l.longTasks} long tasks)`);
};

const TIMEOUT = Symbol('timeout');
async function capped<T>(p: Promise<T>, ms = CAP_MS): Promise<T | typeof TIMEOUT> {
  p.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}
const abandon = async (page: Page) => { await Promise.race([page.close({ runBeforeUnload: false }).catch(() => {}), new Promise((r) => setTimeout(r, 20_000))]); };
const hang = async <T>(label: string, step: string, p: Promise<T>): Promise<T | undefined> => {
  const r = await capped(p);
  if (r === TIMEOUT) { flag(`${label} ${step}: no answer after ${CAP_MS / 1000} s (aborted; the renderer was busy the whole time)`); return undefined; }
  return r;
};

const ev = <T, A = undefined>(page: Page, fn: (a: A) => T | Promise<T>, arg?: A) => page.evaluate(fn as any, arg) as Promise<T>;
const perf = <T>(page: Page, call: string, ...args: unknown[]) => page.evaluate(([c, a]) => (window as any).__perf[c as string](...(a as unknown[])), [call, args]) as Promise<T>;

test.afterAll(() => {
  const out = path.join(process.cwd(), 'test-results', 'perf.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(R, null, 2));
  printTables();
  console.log(`[perf] results written to ${out}`);
});

// ── booting ───────────────────────────────────────────────────────────────────

async function newCtx(browser: Browser) {
  return browser.newContext({ permissions: PERMISSIONS, viewport: { width: 1280, height: 720 } });
}

/** Seed `json` as a snapshot under `docId` in this context's IndexedDB. Leaves no page open. */
async function seed(ctx: BrowserContext, docId: string, json: string) {
  const p = await ctx.newPage();
  await openPersisted(p, docId);
  const s = await seedSnapshot(p, docId, json);
  await p.close();
  return s;
}

/** A page of the context on the persisted doc, with the boot probe; resolves once the engine is up. Returns the probe timings. */
async function openDoc(ctx: BrowserContext, docId: string, nodes: number, extra: Record<string, unknown> = {}) {
  const page = await ctx.newPage();
  await addBootProbe(page);
  // sessionStorage is per-page: the target must be set before the document boots -> open once to set it, then reload.
  await page.goto('/e2e?persist=' + encodeURIComponent(docId) + '&options=' + encodeURIComponent(JSON.stringify({ debounce: 3_600_000, maxWait: 0, ...extra })), { waitUntil: 'domcontentloaded' });
  await setTarget(page, nodes);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForEditor(page, 300_000);
  const boot = await readBootProbe(page);
  await installPerf(page);
  return { page, boot };
}

// ── scenarios ─────────────────────────────────────────────────────────────────

async function typeAt(page: Page, frac: number, text = TYPED): Promise<Lat & { where?: any }> {
  const where = await perf<any>(page, 'place', frac);
  await perf(page, 'mark');
  const dom: number[] = [], paint: number[] = [];
  for (const ch of text) {
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    const s = await perf<{ dom: number; paint: number | null } | null>(page, 'sample');
    if (s) { dom.push(s.dom); if (s.paint != null) paint.push(s.paint); }
  }
  const longs = await perf<{ dur: number }[]>(page, 'longs');
  return { ...summarize(dom, paint, longs), where };
}

/** Enter (split) at offset 5 of the block holding the caret, 30 times. */
async function enterRuns(page: Page, frac: number, count = 30): Promise<Lat> {
  await perf(page, 'place', frac, 8);
  await perf(page, 'mark');
  const dom: number[] = [], paint: number[] = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Enter');
    const s = await perf<{ dom: number; paint: number | null } | null>(page, 'sample');
    if (s) { dom.push(s.dom); if (s.paint != null) paint.push(s.paint); }
    await perf(page, 'placeInCurrent', 5);
  }
  const longs = await perf<{ dur: number }[]>(page, 'longs');
  return summarize(dom, paint, longs);
}

/** Backspace at the start of a paragraph that follows a paragraph (merge), 30 times in a row from `frac`. */
async function backspaceRuns(page: Page, frac: number, count = 30): Promise<Lat & { merged: number }> {
  const before = (await perf<{ dom: number }>(page, 'counts')).dom;
  const dom: number[] = [], paint: number[] = [];
  let after: string | null = null;
  await perf(page, 'mark');
  for (let i = 0; i < count; i++) {
    const t = await perf<{ survivor: string; victim: string } | null>(page, 'placeMergeTarget', frac, after);
    if (!t) break;
    await page.keyboard.press('Backspace');
    const s = await perf<{ dom: number; paint: number | null } | null>(page, 'sample');
    if (s) { dom.push(s.dom); if (s.paint != null) paint.push(s.paint); }
    after = t.survivor;
  }
  const longs = await perf<{ dur: number }[]>(page, 'longs');
  const now = (await perf<{ dom: number }>(page, 'counts')).dom;
  return { ...summarize(dom, paint, longs), merged: before - now };
}

async function scrollRun(page: Page) {
  await ev(page, () => window.scrollTo(0, 0));
  await page.mouse.move(640, 360);
  const dims = await ev(page, () => ({ h: document.documentElement.scrollHeight, vh: window.innerHeight }));
  const steps = 150;
  const delta = Math.max(100, Math.round((dims.h - dims.vh) / steps));
  await perf(page, 'mark');
  await perf(page, 'recordFrames', true);
  const t0 = Date.now();
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const wall = Date.now() - t0;
  const frames = await perf<number[]>(page, 'recordFrames', false);
  const longs = await perf<{ dur: number }[]>(page, 'longs');
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const y = await ev(page, () => ({ y: Math.round(window.scrollY), h: document.documentElement.scrollHeight }));
  return {
    steps, deltaPx: delta, scrolledPx: y.y, docHeightPx: y.h, wallMs: wall,
    longTasks: longs.length, longTaskMax: round(longs.reduce((m, l) => Math.max(m, l.dur), 0)), longTaskTotal: round(longs.reduce((s, l) => s + l.dur, 0)),
    frames: frames.length, frameGapP95: round(percentile(gaps, 95)), frameGapMax: round(Math.max(0, ...gaps)), framesOver50: gaps.filter((g) => g > 50).length,
  };
}

async function storedBytes(page: Page, docId: string) {
  return ev(page, (id: string) => new Promise<number | null>((resolve, reject) => {
    const open = indexedDB.open('nabu');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(id);
      get.onsuccess = () => { db.close(); resolve(get.result ? get.result.snapshot.length : null); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }), docId);
}

// ── tables ────────────────────────────────────────────────────────────────────

function printTables() {
  const labels = Object.keys(R.runs);
  const g = (o: any, p: string) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const cell = (v: any) => (v === undefined || v === null ? '-' : typeof v === 'number' ? String(v) : String(v));
  const lat = (o: any) => (o ? `${o.median} / ${o.p95} (max ${o.max}, lt ${o.longMax})` : '-');
  const rows: [string, (r: any) => any][] = [
    ['blocks (nodes)', (r) => r.doc?.nodes],
    ['words', (r) => r.doc?.words],
    ['snapshot seeded (KB)', (r) => (r.seed ? round(r.seed.bytes / 1024, 0) : undefined)],
    ['engine ready (ms, page clock)', (r) => r.load?.readyMs],
    ['all blocks in DOM (ms)', (r) => r.load?.domMs],
    ['first paint after (ms)', (r) => r.load?.paintMs],
    ['  - empty page baseline (ms)', (r) => R.baseline?.paintMs],
    ['JS heap after GC (MB)', (r) => r.load?.heapMB],
    ['DOM nodes / listeners', (r) => (r.load ? `${r.load.domNodes} / ${r.load.listeners}` : undefined)],
    ['typing START med/p95 (ms)', (r) => lat(r.typing?.start)],
    ['typing MIDDLE med/p95 (ms)', (r) => lat(r.typing?.middle)],
    ['typing END med/p95 (ms)', (r) => lat(r.typing?.end)],
    ['  paint latency MIDDLE med/p95', (r) => (r.typing?.middle ? `${r.typing.middle.paintMedian} / ${r.typing.middle.paintP95}` : undefined)],
    ['Enter (split) MIDDLE med/p95', (r) => lat(r.enter)],
    ['Backspace (merge) MIDDLE med/p95', (r) => lat(r.backspace)],
    ['scroll: long tasks (n / max ms / total ms)', (r) => (r.scroll ? `${r.scroll.longTasks} / ${r.scroll.longTaskMax} / ${r.scroll.longTaskTotal}` : undefined)],
    ['scroll: frames >50 ms / gap p95 / max', (r) => (r.scroll ? `${r.scroll.framesOver50} / ${r.scroll.frameGapP95} / ${r.scroll.frameGapMax}` : undefined)],
    ['commit: hook "paragraph" idle (ms, per keystroke)', (r) => r.commit?.hooksIdleMs?.paragraph],
    ['commit: hooks with a structural op pending (ms)', (r) => (r.commit ? Object.entries(r.commit.hooksStructuralMs).filter(([, v]) => (v as number) > 0.05).map(([k, v]) => `${k} ${v}`).join(', ') : undefined)],
    ['commit: updateRoots() / tree.roots() (ms)', (r) => (r.commit ? `${r.commit.updateRootsMs} / ${r.commit.treeRootsMs}` : undefined)],
    ['saveNow (ms)', (r) => r.save?.saveNowMs],
    ['saved snapshot (KB)', (r) => (r.save ? round(r.save.snapshotBytes / 1024, 0) : undefined)],
    ['reload: ready / DOM / paint (ms)', (r) => (r.reload ? `${r.reload.readyMs} / ${r.reload.domMs} / ${r.reload.paintMs}` : undefined)],
    ['serialize json / markdown (ms)', (r) => (r.serialize ? `${r.serialize.jsonMs} / ${r.serialize.markdownMs}` : undefined)],
    ['Select all (ms to selection)', (r) => r.copy?.selectAllMs],
    ['Copy whole doc (ms)', (r) => r.copy?.copyMs],
    ['Select all + Backspace (ms)', (r) => (r.bulk?.delete ? (r.bulk.delete.capped ? `> ${CAP_MS / 1000} s` : `${r.bulk.delete.ms} (paint ${r.bulk.delete.paint})`) : undefined)],
    ['Undo of it (ms)', (r) => (r.bulk?.undo ? (r.bulk.undo.capped ? `> ${CAP_MS / 1000} s` : `${r.bulk.undo.ms} (paint ${r.bulk.undo.paint}, exact: ${r.bulk.undo.exact})`) : undefined)],
    ['Paste 500 blocks in the middle (ms)', (r) => (r.bulk?.paste ? (r.bulk.paste.capped ? `> ${CAP_MS / 1000} s` : `${r.bulk.paste.ms} (paint ${r.bulk.paste.paint}, +${r.bulk.paste.added} blocks)`) : undefined)],
    ['regions: count', (r) => r.regions?.count],
    ['regions: list recomputed by typing in body / title', (r) => (r.regions ? `${r.regions.recomputedByBody} / ${r.regions.recomputedByTitle}` : undefined)],
    ['regions: rebuild of the registry (ms, median)', (r) => r.regions?.rebuildMs],
    ['regions: word counts cold / warm (ms)', (r) => (r.regions ? `${r.regions.wordCountColdMs} / ${r.regions.wordCountWarmMs}` : undefined)],
    ['regions: typing in a TITLE med/p95', (r) => lat(r.regions?.titleTyping)],
  ];
  const w0 = Math.max(...rows.map(([n]) => n.length)) + 1;
  const cols = labels.map((l) => Math.max(l.length, ...rows.map(([, f]) => cell(f(R.runs[l])).length)) + 1);
  const line = (a: string, bs: string[]) => a.padEnd(w0) + '| ' + bs.map((b, i) => b.padEnd(cols[i])).join('| ');
  console.log('\n' + line('metric', labels));
  console.log('-'.repeat(w0) + '+-' + cols.map((c) => '-'.repeat(c)).join('+-'));
  for (const [name, f] of rows) console.log(line(name, labels.map((l) => cell(f(R.runs[l])))));
  if (R.insertCurve) {
    console.log('\ninsert loop (nabu.insert x N, in-memory editor, one commit per insert) -> ms/block');
    for (const p of R.insertCurve.points) console.log(`  N=${String(p.n).padStart(4)}: ${String(p.loopMs).padStart(6)} ms  (${p.perBlockMs} ms/block)  +final commit ${p.finalCommitMs} ms  | importFragment of the same ${p.n} blocks: ${p.importMs} ms`);
    console.log(`  growth exponent (log-log slope): insert loop ${R.insertCurve.exponentLoop}, importFragment ${R.insertCurve.exponentImport}`);
  }
  if (R.importCurve) {
    console.log('\nimportJSON (model + commit + Svelte tick) / until all blocks are in the DOM and painted');
    for (const p of R.importCurve.points) console.log(`  N=${String(p.n).padStart(5)}: ${p.capped ? `> ${CAP_MS / 1000} s (aborted)` : `${p.importMs} ms, DOM+paint +${p.renderMs} ms`}`);
    console.log(`  growth exponent: ${R.importCurve.exponent}`);
  }
  if (R.flags.length) console.log('\nFLAGS\n  ' + R.flags.join('\n  '));
}

const fit = (pts: { n: number; ms: number }[]) => {
  const a = pts[0], b = pts[pts.length - 1];
  return round(Math.log(b.ms / a.ms) / Math.log(b.n / a.n), 2);
};

// ═════════════════════════════════════════════════════════════════════════════
// 0. baseline + insert loop growth curve
// ═════════════════════════════════════════════════════════════════════════════

test.describe('perf', () => {
  test('baseline: empty editor boot', async ({ browser }) => {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage();
    await addBootProbe(page);
    await page.goto('/e2e?persist=perf-baseline-' + Date.now(), { waitUntil: 'domcontentloaded' });
    await setTarget(page, 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEditor(page, 60_000);
    const b = await readBootProbe(page);
    R.baseline = { readyMs: round(b.ready, 0), domMs: round(b.dom, 0), paintMs: round(b.paint, 0), ...(await heapAfterGc(page)) };
    console.log('[perf] baseline', JSON.stringify(R.baseline));
    await ctx.close();
  });

  test('insert loop growth curve (100 / 200 / 400 / 800)', async ({ browser }) => {
    test.setTimeout(900_000);
    const ctx = await newCtx(browser);
    const points: any[] = [];
    const text = 'the quick brown fox jumps over the lazy dog. '.repeat(3);
    for (const n of [100, 200, 400, 800]) {
      const page = await ctx.newPage();
      await gotoEditor(page, {});
      const r = await page.evaluate(async ([n, text]) => {
        const nb = (window as any).nabu;
        const dom = () => document.querySelectorAll('[data-block-id]').length;
        // B. n blocks through ONE importFragment (one commit) into the empty editor
        const blocks = Array.from({ length: n }, (_, i) => ({ type: 'paragraph', delta: [{ insert: `Q${i} ${text}` }], partial: false }));
        const t4 = performance.now();
        await nb.importFragment({ blocks });
        const t5 = performance.now();
        // A. nabu.insert in a loop (each insert commits), then the final commit and the render
        for (const c of [...nb.children]) nb.delete(c);
        await nb.commit();
        await new Promise((r) => setTimeout(r, 50));
        const t0 = performance.now();
        for (let i = 0; i < n; i++) nb.insert('paragraph', { text: `P${i} ${text}` }, null, i);
        const t1 = performance.now();
        await nb.commit();
        const t2 = performance.now();
        while (dom() < n) await new Promise((r) => requestAnimationFrame(r));
        const t3 = performance.now();
        return { loopMs: Math.round(t1 - t0), finalCommitMs: Math.round(t2 - t1), renderMs: Math.round(t3 - t2), importMs: Math.round(t5 - t4) };
      }, [n, text] as [number, string]);
      points.push({ n, ...r, perBlockMs: round(r.loopMs / n, 2) });
      console.log(`[perf] insert loop N=${n}: ${r.loopMs} ms (${round(r.loopMs / n, 2)} ms/block), final commit ${r.finalCommitMs} ms, render ${r.renderMs} ms; importFragment ${r.importMs} ms`);
      await page.close();
    }
    // persisted editor with the default autosave (what the persistence audit measured), 800 blocks
    const page = await ctx.newPage();
    await gotoEditor(page, { persist: 'perf-insert-' + Date.now() });
    const persisted = await page.evaluate(async ([n, text]) => {
      const nb = (window as any).nabu;
      for (const c of [...nb.children]) nb.delete(c);
      await nb.commit();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) nb.insert('paragraph', { text: `P${i} ${text}` }, null, i);
      const t1 = performance.now();
      await nb.commit();
      return Math.round(t1 - t0);
    }, [800, text] as [number, string]);
    R.insertCurve = {
      points,
      persistedLoop800Ms: persisted,
      exponentLoop: fit(points.map((p) => ({ n: p.n, ms: p.loopMs }))),
      exponentImport: fit(points.map((p) => ({ n: p.n, ms: p.importMs }))),
    };
    console.log('[perf] insert loop, persisted editor, 800 blocks:', persisted, 'ms');
    if (PROFILE) {
      const p2 = await ctx.newPage();
      await gotoEditor(p2, {});
      console.log('[perf] PROFILE insert loop 800:\n' + await profileTop(p2, () => p2.evaluate(async ([n, text]) => {
        const nb = (window as any).nabu;
        for (const c of [...nb.children]) nb.delete(c);
        for (let i = 0; i < n; i++) nb.insert('paragraph', { text: `P${i} ${text}` }, null, i);
        await nb.commit();
      }, [800, text] as [number, string]), 30));
    }
    await ctx.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. importJSON curve
  // ═══════════════════════════════════════════════════════════════════════════

  test('importJSON growth curve (500 / 1000 / 2000 / 4000 / 5000)', async ({ browser }) => {
    test.setTimeout(1_800_000);
    const importMax = Number(process.env.NABU_PERF_IMPORT_MAX ?? Infinity); // e.g. 2000: skip the bigger (slow, O(N^2)) sizes
    const sizes = [500, 1000, 2000, 4000, 5000, ...(process.env.NABU_PERF_IMPORT_10K === '1' ? [10000] : [])].filter((n) => n <= importMax);
    const points: any[] = [];
    for (const n of sizes) {
      const g = genDoc({ blocks: n });
      const json = JSON.stringify(g.doc);
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      await gotoEditor(page, {});
      const res = await capped(page.evaluate(async (json) => {
        const nb = (window as any).nabu;
        const t0 = performance.now();
        await nb.importJSON(json);
        const t1 = performance.now();
        const count = (bs: any[]): number => bs.reduce((s, b) => s + 1 + (b.children ? count(b.children) : 0), 0);
        const modelNodes = count(nb.children);
        const w0 = performance.now();
        while (document.querySelectorAll('[data-block-id]').length < modelNodes && performance.now() - w0 < 60_000) await new Promise((r) => setTimeout(r, 5));
        await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        const t2 = performance.now();
        return { importMs: Math.round(t1 - t0), renderMs: Math.round(t2 - t1), modelNodes, domNodes: document.querySelectorAll('[data-block-id]').length };
      }, json));
      if (res === TIMEOUT) {
        points.push({ n, nodes: g.nodes, capped: true });
        flag(`importJSON ${n} blocks: no answer after ${CAP_MS / 1000} s (aborted)`);
      } else {
        points.push({ n, nodes: g.nodes, ...res });
        if (n === 1000 && res.importMs + res.renderMs > THRESHOLDS.import1k) flag(`importJSON 1000 blocks: import+render ${res.importMs + res.renderMs} ms > ${THRESHOLDS.import1k}`);
      }
      console.log('[perf] importJSON', JSON.stringify(points[points.length - 1]));
      await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 30_000))]);
      if (res === TIMEOUT) break; // bigger sizes can only be worse
    }
    const ok = points.filter((p) => !p.capped);
    R.importCurve = { points, exponent: ok.length >= 2 ? fit(ok.map((p) => ({ n: p.n, ms: p.importMs }))) : null };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. per size: load / typing / Enter / Backspace / scroll / save / copy (+ regions metrics)
  // ═══════════════════════════════════════════════════════════════════════════

  for (const size of SIZES) {
    for (const variant of ['flat', 'regions'] as const) {
      test(`${variant} ${size}: load, typing, scroll, save, copy`, async ({ browser }) => {
        test.setTimeout(2_400_000);
        const label = `${variant}-${size}`;
        const out = run(label);
        const g = genDoc({ blocks: size, regions: variant === 'regions' });
        out.doc = { nodes: g.nodes, words: g.words, chars: g.chars, regions: g.regions };
        const json = JSON.stringify(g.doc);
        const docId = `perf-${label}-${Date.now()}`;
        const ctx = await newCtx(browser);

        out.seed = await seed(ctx, docId, json);
        console.log(`[perf] ${label}: ${g.nodes} nodes, ${g.words} words, seeded in ${out.seed.buildMs} ms, ${out.seed.bytes} bytes`);

        // ── load ──
        let { page, boot } = await openDoc(ctx, docId, g.nodes);
        const counts = await perf<{ roots: number; dom: number; blocks: number }>(page, 'counts');
        out.load = {
          readyMs: round(boot.ready, 0), domMs: round(boot.dom, 0), paintMs: round(boot.paint, 0), ...(await heapAfterGc(page)),
          roots: counts.roots, domBlocks: counts.dom,
        };
        out.load.domNodes = out.load.nodes; delete out.load.nodes;
        console.log(`[perf] ${label} load`, JSON.stringify(out.load));
        if (counts.dom < g.nodes) flag(`${label}: only ${counts.dom} block elements in the DOM for ${g.nodes} blocks`);

        // ── typing at START / MIDDLE / END (+ 5 warm-up keys) ──
        await typeAt(page, 0, 'abcde');
        out.typing = {};
        for (const [name, frac] of [['start', 0], ['middle', 0.5], ['end', 1]] as const) {
          out.typing[name] = await typeAt(page, frac);
          flagLat(label, `typing ${name}`, out.typing[name]);
          console.log(`[perf] ${label} typing ${name}`, JSON.stringify(out.typing[name]));
        }
        if (PROFILE && variant === 'flat' && size === Math.max(...SIZES)) {
          console.log(`[perf] PROFILE ${label} typing MIDDLE:\n` + await profileTop(page, () => typeAt(page, 0.5)));
        }

        // ── Enter (split) / Backspace (merge) at the middle ──
        out.enter = await enterRuns(page, 0.5);
        flagLat(label, 'Enter', out.enter);
        console.log(`[perf] ${label} Enter`, JSON.stringify(out.enter));
        if (PROFILE && variant === 'flat' && size === Math.max(...SIZES)) {
          console.log(`[perf] PROFILE ${label} Enter MIDDLE:\n` + await profileTop(page, () => enterRuns(page, 0.5, 15)));
        }
        out.backspace = await backspaceRuns(page, 0.5);
        flagLat(label, 'Backspace (merge)', out.backspace);
        console.log(`[perf] ${label} Backspace`, JSON.stringify(out.backspace));
        if (PROFILE && variant === 'flat' && size === Math.max(...SIZES)) {
          console.log(`[perf] PROFILE ${label} Backspace MIDDLE:\n` + await profileTop(page, () => backspaceRuns(page, 0.5, 15)));
        }

        // ── regions registry (regions variant) ──
        if (variant === 'regions') out.regions = await regionsMetrics(page, label);

        // ── scroll (flat only: the layout cost is the same) ──
        if (variant === 'flat') {
          out.scroll = await scrollRun(page);
          if (out.scroll.longTaskMax > THRESHOLDS.longTask) flag(`${label} scroll: long task ${out.scroll.longTaskMax} ms`);
          console.log(`[perf] ${label} scroll`, JSON.stringify(out.scroll));
        }

        // ── save (the doc was edited above) and reload of the saved document ──
        {
          const saveNowMs = await ev(page, async () => { const t = performance.now(); await (window as any).nabu.saveNow(); return Math.round(performance.now() - t); });
          const snapshotBytes = await storedBytes(page, docId);
          out.save = { saveNowMs, snapshotBytes };
          console.log(`[perf] ${label} save`, JSON.stringify(out.save));
          const total = (await perf<{ dom: number }>(page, 'counts')).dom;
          await page.close();
          const re = await openDoc(ctx, docId, total);
          const heap2 = await heapAfterGc(re.page);
          out.reload = { readyMs: round(re.boot.ready, 0), domMs: round(re.boot.dom, 0), paintMs: round(re.boot.paint, 0), heapMB: heap2.heapMB, domNodes: heap2.nodes };
          console.log(`[perf] ${label} reload`, JSON.stringify(out.reload));
          page = re.page;
        }

        // ── serialize + copy of the whole document ──
        if (variant === 'flat') {
          out.serialize = await ev(page, () => {
            const nb = (window as any).nabu;
            const time = (f: () => unknown) => { f(); const t = performance.now(); const r = f(); return { ms: Math.round(performance.now() - t), len: JSON.stringify(r).length }; };
            const j = time(() => nb.serialize('json'));
            const m = time(() => nb.serialize('markdown'));
            return { jsonMs: j.ms, jsonChars: j.len, markdownMs: m.ms, markdownChars: m.len };
          });
          console.log(`[perf] ${label} serialize`, JSON.stringify(out.serialize));
          out.copy = await copyRun2(page, label);
          console.log(`[perf] ${label} copy`, JSON.stringify(out.copy));
        }

        // ── what one commit costs by itself: the onBeforeTransaction hooks (idle, then with a pending structural op), updateRoots(), tree.roots() ──
        // (last: it leaves a net-zero structural change behind, and the first saveNow() after it is slower)
        out.commit = await commitProbe(page);
        console.log(`[perf] ${label} commit probe`, JSON.stringify(out.commit));

        await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 30_000))]);
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. bulk operations (flat): Select all + Backspace, Undo, paste of 500 blocks
    // ═════════════════════════════════════════════════════════════════════════

    test(`flat ${size}: Select all + Backspace, Undo, paste 500`, async ({ browser }) => {
      test.setTimeout(2_400_000);
      const label = `flat-${size}`;
      const out = run(label);
      out.bulk = {};
      const g = genDoc({ blocks: size });
      const docId = `perf-bulk-${size}-${Date.now()}`;
      const ctx = await newCtx(browser);
      await seed(ctx, docId, JSON.stringify(g.doc));

      // Select all + Backspace, then Undo (one page: Undo needs the deletion in its history)
      {
        const { page } = await openDoc(ctx, docId, g.nodes);
        const sig0 = await perf<string>(page, 'docSig');
        const content0 = await perf<any>(page, 'contentSig');
        const c0 = await perf<{ roots: number; dom: number }>(page, 'counts');
        await perf(page, 'place', 0.5);
        await perf(page, 'mark');
        const t0 = Date.now();
        await page.keyboard.press('Control+a');
        const sel = await hang(label, 'Select all', page.evaluate(async () => {
          const p = (window as any).__perf;
          return p.until(() => !window.getSelection()!.isCollapsed, 60_000);
        }));
        out.bulk.selectAll = sel ? { ms: round(sel.ms), paint: round(sel.paint) } : { capped: true };
        console.log(`[perf] ${label} Select all`, JSON.stringify(out.bulk.selectAll), 'wall', Date.now() - t0);

        const t1 = Date.now();
        const deleteAll = () => hang(label, 'Select all + Backspace', (async () => {
          await page.keyboard.press('Backspace');
          return page.evaluate(async (cap) => (window as any).__perf.until(() => document.querySelectorAll('[data-block-id]').length <= 3, cap), CAP_MS);
        })());
        let del: Awaited<ReturnType<typeof deleteAll>>;
        if (PROFILE) {
          const prof = await profileTop(page, async () => { del = await deleteAll(); }, 22);
          console.log(`[perf] PROFILE ${label} Select all + Backspace:\n${prof}`);
        } else del = await deleteAll();
        if (!del || del.ms < 0) {
          out.bulk.delete = { capped: true, wallMs: Date.now() - t1 };
          out.bulk.undo = { capped: true, skipped: 'the deletion did not finish' };
          await abandon(page);
        } else {
          const after = await perf<{ roots: number; dom: number }>(page, 'counts');
          const longs = await perf<{ dur: number }[]>(page, 'longs');
          out.bulk.delete = { ms: round(del.ms, 0), paint: round(del.paint, 0), wallMs: Date.now() - t1, rootsAfter: after.roots, domAfter: after.dom, longTasks: longs.length, longMax: round(Math.max(0, ...longs.map((l) => l.dur))) };
          console.log(`[perf] ${label} Select all + Backspace`, JSON.stringify(out.bulk.delete));
          const t2 = Date.now();
          const und = await hang(label, 'Undo', (async () => {
            await page.keyboard.press('Control+z');
            return page.evaluate(async ([cap, dom]) => (window as any).__perf.until(() => document.querySelectorAll('[data-block-id]').length >= (dom as number), cap as number), [CAP_MS, c0.dom] as [number, number]);
          })());
          if (!und || und.ms < 0) {
            out.bulk.undo = { capped: true, wallMs: Date.now() - t2 };
            await abandon(page);
          } else {
            const sig1 = await perf<string>(page, 'docSig');
            const content1 = await perf<any>(page, 'contentSig');
            const c1 = await perf<{ roots: number; dom: number }>(page, 'counts');
            // exact: same JSON export (ids included); sameContent: same block types + texts in tree order (ids ignored)
            out.bulk.undo = {
              ms: round(und.ms, 0), paint: round(und.paint, 0), wallMs: Date.now() - t2, exact: sig1 === sig0,
              sameContent: content1.hash === content0.hash && content1.chars === content0.chars, sameIds: content1.idHash === content0.idHash, blocksBefore: content0.blocks, blocksAfter: content1.blocks,
              rootsBefore: c0.roots, rootsAfter: c1.roots, domBefore: c0.dom, domAfter: c1.dom, emptyBefore: content0.empties, emptyAfter: content1.empties,
            };
            console.log(`[perf] ${label} Undo`, JSON.stringify(out.bulk.undo));
            await page.close();
          }
        }
      }

      // paste of 500 blocks in the middle (fresh page)
      {
        const { page } = await openDoc(ctx, docId, g.nodes);
        const md = genPasteMarkdown(500);
        await perf(page, 'place', 0.5, 5);
        const before = (await perf<{ dom: number }>(page, 'counts')).dom;
        const res = await hang(label, 'paste 500', page.evaluate(async ([md, before, cap]) => {
          const root = document.querySelector('[data-nabu-root]') as HTMLElement;
          const dt = new DataTransfer();
          dt.setData('text/plain', md as string);
          const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          const t0 = performance.now();
          root.dispatchEvent(ev);
          const dispatchMs = performance.now() - t0;
          while (document.querySelectorAll('[data-block-id]').length < (before as number) + 450) {
            if (performance.now() - t0 > (cap as number)) return { ms: -1 };
            await new Promise((r) => setTimeout(r, 2));
          }
          const ms = performance.now() - t0;
          await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
          return { ms, paint: performance.now() - t0, dispatchMs, added: document.querySelectorAll('[data-block-id]').length - (before as number), prevented: ev.defaultPrevented };
        }, [md, before, CAP_MS] as [string, number, number]));
        if (!res || res.ms < 0) {
          out.bulk.paste = { capped: true };
          await abandon(page);
        } else {
          out.bulk.paste = { ms: round(res.ms, 0), paint: round(res.paint!, 0), dispatchMs: round(res.dispatchMs!, 0), added: res.added, prevented: res.prevented };
          console.log(`[perf] ${label} paste 500`, JSON.stringify(out.bulk.paste));
          await page.close();
        }
      }
      await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 30_000))]);
    });
  }
});

// ── helpers that need the page-side `until` with a closure ─────────────────────

/** Select all, then Copy: ms from the keydown to the selection / to the end of the editor's copy handler. */
async function copyRun2(page: Page, label: string) {
  await perf(page, 'place', 0.5);
  await perf(page, 'mark');
  await page.keyboard.press('Control+a');
  const sel = await hang(label, 'Select all', page.evaluate(() => (window as any).__perf.until(() => !window.getSelection()!.isCollapsed, 60_000)));
  await perf(page, 'mark');
  await page.keyboard.press('Control+c');
  const copy = await hang(label, 'Copy', page.evaluate(() => (window as any).__perf.until(() => !!(window as any).__perf.copyProbe(), 120_000)));
  const probe = await perf<{ at: number; types: string[]; sizes: Record<string, number> } | null>(page, 'copyProbe');
  const longs = await perf<{ dur: number }[]>(page, 'longs');
  return {
    selectAllMs: sel ? round(sel.ms, 0) : null, selectAllPaint: sel ? round(sel.paint, 0) : null,
    copyMs: probe ? round(probe.at, 0) : null, copyPaintMs: copy ? round(copy.paint, 0) : null,
    types: probe?.types, sizes: probe?.sizes, longMax: round(Math.max(0, ...longs.map((l) => l.dur))),
  };
}

/**
 * Microbenchmarks of the per-commit work, called directly in the page (no profiler overhead): every `onBeforeTransaction` hook (by
 * owner extension) while nothing is pending (= every keystroke) and while a structural op is pending (= Enter / Backspace / paste…),
 * `nabu.updateRoots()` (the tree subscription calls it once per root-level create / move / delete) and `tree.roots()`.
 */
async function commitProbe(page: Page) {
  return ev(page, async () => {
    const nb = (window as any).nabu;
    const hooks: Function[] = nb.hooks.get('onBeforeTransaction') ?? [];
    const time = (n: number, f: () => unknown) => { f(); const t = performance.now(); for (let i = 0; i < n; i++) f(); return Math.round(((performance.now() - t) / n) * 100) / 100; };
    const hookCosts = () => Object.fromEntries(hooks.map((h) => [nb.hookOwners.get(h) ?? h.name ?? 'hook', time(3, () => h(nb))]));
    const idle = hookCosts();
    const roots = time(5, () => nb.tree.roots());
    const updateRoots = time(5, () => nb.updateRoots());
    // a pending structural op: a node created in the transaction (not committed yet), as a split / paste would leave it
    const node = nb.tree.createNode(undefined, nb.tree.roots().length);
    node.data.set('type', 'paragraph');
    const structural = hookCosts();
    nb.tree.delete(node.id);
    await nb.commit(); // flush the (net-zero) pending ops now, so that they are not charged to the next measurement
    return { hooksIdleMs: idle, hooksStructuralMs: structural, treeRootsMs: roots, updateRootsMs: updateRoots, rootBlocks: nb.children.length };
  });
}

/** Regions registry behaviour on a document with ~200 regions (ADR 018 §3.4). */
async function regionsMetrics(page: Page, label: string) {
  const count = await ev(page, () => (window as any).nabu.regions.count);
  // 1. does typing in a BODY block recompute the registry? (identity of `list`)
  await ev(page, () => { (window as any).__listBefore = (window as any).nabu.regions.list; });
  const body = await typeAt(page, 0.5, 'abcdefghij');
  const recomputedByBody = await ev(page, () => (window as any).nabu.regions.list !== (window as any).__listBefore);
  // 2. typing in a region TITLE
  await ev(page, () => { (window as any).__listBefore = (window as any).nabu.regions.list; });
  const where = await perf<{ id: string }>(page, 'placeInRegionTitle', 0.5, 1);
  await perf(page, 'mark');
  const dom: number[] = [], paint: number[] = [];
  for (const ch of 'abcdefghij') {
    await page.keyboard.press(ch);
    const s = await perf<{ dom: number; paint: number | null } | null>(page, 'sample');
    if (s) { dom.push(s.dom); if (s.paint != null) paint.push(s.paint); }
  }
  const longs = await perf<{ dur: number }[]>(page, 'longs');
  const titleTyping = summarize(dom, paint, longs);
  const recomputedByTitle = await ev(page, () => (window as any).nabu.regions.list !== (window as any).__listBefore);
  // 3. rebuild of the registry: invalidate its dependency (the root list) and read it, 7 times
  const rebuild = await ev(page, () => {
    const nb = (window as any).nabu;
    const ts: number[] = [];
    for (let i = 0; i < 7; i++) {
      nb.children = [...nb.children]; // new array: `#structure` depends on it
      const t = performance.now();
      const l = nb.regions.list;
      ts.push(performance.now() - t);
      void l.length;
    }
    ts.sort((a, b) => a - b);
    return ts[3];
  });
  // 4. word counts: cold (right after a keystroke invalidated the chain) vs warm
  await typeAt(page, 0.5, 'k');
  const wc = await ev(page, () => {
    const nb = (window as any).nabu;
    const sum = () => nb.regions.list.reduce((s: number, r: any) => s + r.wordCount, 0) + nb.regions.preamble.wordCount;
    const t0 = performance.now();
    const a = sum();
    const cold = performance.now() - t0;
    const t1 = performance.now();
    const b = sum();
    return { cold, warm: performance.now() - t1, total: a, same: a === b };
  });
  const res = {
    count, recomputedByBody, recomputedByTitle, rebuildMs: round(rebuild, 3), wordCountColdMs: round(wc.cold, 2), wordCountWarmMs: round(wc.warm, 2), wordCountTotal: wc.total,
    bodyTyping: body, titleTyping, titleId: where.id,
  };
  flagLat(label, 'regions title typing', titleTyping);
  console.log(`[perf] ${label} regions`, JSON.stringify(res));
  return res;
}
