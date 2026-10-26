/**
 * E2E — AUDIT 2026-10, theme 8a (PERSISTENCE): `createPersistedEditor` (ADR 010 snapshot + debounce, ADR 014 asset store /
 * outbox / history modes). Findings P-91, P-92, P-93, P-95, P-96 are fixed (ADR 010, "Implementation notes — 2026-10 (theme 8)"); only 4b
 * (two tabs, P-94) is still `fixme`.
 *
 * These tests describe the EXPECTED behaviour. A scenario that fails today is marked `test.fixme('… — FINDING: …')` (body kept, so it
 * can be re-enabled once the product is fixed). Scenarios named "characterization" pin the CURRENT behaviour of something that is a
 * product decision (documented limitation), so a change shows up in the suite.
 *
 * Sections
 *   1. what survives a reload (marks, links, structure, regions, image)
 *   2. unsaved edits at reload time (debounce / flush on pagehide), starvation of the debounce
 *   3. isNew / saveNow / clearPersistence
 *   4. two tabs on the same docId
 *   5. undo after a reload
 *   6. IndexedDB unavailable / failing
 *   7. corrupted stored snapshot (backup rotation, quarantine, recovery info), 7bis. page-hide listeners
 *   8. history modes (full / compact + archive hook)
 *   9. asset outbox (failing host, retried after a reload)
 *  10. a ~500-block document (timings are printed, no thresholds)
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, waitForEditor, getJson, focusEditor, typeText, exec, press } from './helpers/editor.js';
import { bold, italic, undo, selectForward } from './helpers/keyboard.js';
import { buildTree, type TreeSpec } from './helpers/blocks.js';
import { focusEmpty, collectErrors } from './helpers/model.js';

const docId = () => `e2e-pa-${test.info().testId}-${Date.now()}`;

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const HASH_REF = /^nabu-asset:sha256-[0-9a-f]{64}$/;

// ── helpers ────────────────────────────────────────────────────────────────

const boot = (page: Page, id: string, options?: Record<string, unknown>) => gotoEditor(page, { persist: id, ...(options ? { options } : {}) });

async function reload(page: Page) {
  await page.reload();
  await waitForEditor(page, 15000);
}

const saveNow = (page: Page) => page.evaluate(() => (window as any).nabu.saveNow());

/** All the text of the live document (model, tree order). */
const texts = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const out: string[] = [];
  const walk = (node: any) => { const t = node.data.get('text'); if (t) out.push(t.toString()); for (const c of node.children() ?? []) walk(c); };
  for (const r of n.tree.roots()) walk(r);
  return out;
});

/** Append a paragraph at the end of the root and commit (a programmatic edit, one undo step). */
const addParagraph = (page: Page, text: string) => page.evaluate(async (t) => {
  const n = (window as any).nabu;
  n.insert('paragraph', { text: t });
  await n.commit();
}, text);

/** The stored record of a document: `savedAt`, size, and a copy of the bytes (null if none / no DB). */
const stored = (page: Page, id: string) => page.evaluate((docId) => new Promise<{ savedAt: number; bytes: number[]; size: number } | null>((resolve, reject) => {
  const open = indexedDB.open('nabu');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('snapshots')) { db.close(); return resolve(null); }
    const get = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(docId);
    get.onsuccess = () => {
      db.close();
      const r = get.result;
      resolve(r ? { savedAt: r.savedAt, bytes: Array.from(r.snapshot ?? []), size: r.snapshot?.length ?? 0 } : null);
    };
    get.onerror = () => { db.close(); reject(get.error); };
  };
}), id);

/** Overwrite the stored record of a document with arbitrary content (same DB / store names as src/lib/persistence/indexeddb.js). */
const putRaw = (page: Page, id: string, snapshot: number[] | string) => page.evaluate(([docId, snap]) => new Promise<void>((resolve, reject) => {
  const open = indexedDB.open('nabu');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put({ docId, snapshot: typeof snap === 'string' ? snap : Uint8Array.from(snap as number[]), savedAt: Date.now() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  };
}), [id, snapshot] as [string, number[] | string]);

/** The records moved aside for a document (the `quarantine` object store): source, bytes (or the raw value). */
const quarantined = (page: Page, id: string) => page.evaluate((docId) => new Promise<{ key: string; source: string; value: any }[]>((resolve, reject) => {
  const open = indexedDB.open('nabu');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('quarantine')) { db.close(); return resolve([]); }
    const get = db.transaction('quarantine', 'readonly').objectStore('quarantine').index('docId').getAll(docId);
    get.onsuccess = () => { db.close(); resolve(get.result.map((r: any) => ({ key: r.key, source: r.source, value: r.snapshot instanceof Uint8Array ? Array.from(r.snapshot) : r.snapshot }))); };
    get.onerror = () => { db.close(); reject(get.error); };
  };
}), id);

/** The previous good snapshot of a document (the `backups` object store), as bytes. */
const backupOf = (page: Page, id: string) => page.evaluate((docId) => new Promise<number[] | null>((resolve, reject) => {
  const open = indexedDB.open('nabu');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const get = db.transaction('backups', 'readonly').objectStore('backups').get(docId);
    get.onsuccess = () => { db.close(); resolve(get.result ? Array.from(get.result.snapshot) : null); };
    get.onerror = () => { db.close(); reject(get.error); };
  };
}), id);

/** `nabu.persistence` in a serialisable form. */
const persistenceOf = (page: Page) => page.evaluate(() => {
  const p = (window as any).nabu.persistence;
  const r = p.recovery;
  return {
    status: p.status as string, available: p.available as boolean, lastSavedAt: p.lastSavedAt as number | null, lastError: p.lastError ? String(p.lastError.message ?? p.lastError) : null,
    recovery: r ? { kind: r.kind as string, quarantinedKey: r.quarantinedKey as string | null, at: r.at as number, error: String(r.error?.message ?? r.error) } : null,
  };
});

/** Pretend the page is going away (hidden tab). */
const hidePage = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

/** Select `len` characters of the focused block starting at `start`. */
async function selectRange(page: Page, start: number, len: number) {
  await press(page, 'Home');
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowRight');
  await selectForward(page, len);
}

const blockEls = (page: Page) => page.locator('[data-block-id]').count();

/** Boot `/e2e?persist=` WITHOUT the retrying helper and report whether the editor became ready within `ms`. */
async function bootsWithin(page: Page, id: string, ms = 6000, query = '') {
  await page.goto('/e2e?persist=' + encodeURIComponent(id) + query, { waitUntil: 'domcontentloaded' });
  return page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: ms }).then(() => true, () => false);
}

/** Paste a 1x1 PNG into the focused empty block. */
const pastePng = (page: Page) => page.evaluate((png) => {
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'pixel.png', { type: 'image/png' }));
  (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, PNG_B64);

let errors: ReturnType<typeof collectErrors>;
let expectErrors = false; // a test that deliberately provokes page errors sets it
test.beforeEach(({ page }) => { errors = collectErrors(page); expectErrors = false; });
test.afterEach(() => { if (!expectErrors) expect(errors.list()).toEqual([]); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. What survives a reload
// ═══════════════════════════════════════════════════════════════════════════

test.describe('1 · reload keeps the document', () => {
  test('1a · text with bold / italic marks and a link', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEditor(page);
    await typeText(page, 'plain strong slanted visit example end');
    await selectRange(page, 6, 6); // "strong"
    await bold(page);
    await selectRange(page, 13, 7); // "slanted"
    await italic(page);
    await selectRange(page, 27, 7); // "example"
    await exec(page, 'link:set', { href: 'https://example.com' });
    const before = await getJson(page);
    const runs = before.blocks[0].content;
    expect(runs.some((r: any) => r.bold && r.text === 'strong')).toBe(true);
    expect(runs.some((r: any) => r.italic && r.text === 'slanted')).toBe(true);
    expect(runs.some((r: any) => r.link === 'https://example.com' && r.text === 'example')).toBe(true);
    await saveNow(page);

    await reload(page);
    expect(await getJson(page)).toEqual(before);
    await expect(page.locator('.nabu-editor a[href="https://example.com"]')).toHaveText('example');
    const weight = await page.locator('.nabu-editor').getByText('strong', { exact: true }).first().evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
    expect(weight).toBeGreaterThanOrEqual(600);
  });

  test('1b · structure: nested lists, toggle (collapsed + open), callout, code language, dialogue, divider, heading, quote', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    const list = (listType: string, items: TreeSpec[], props: Record<string, any> = {}): TreeSpec => ({ type: 'list', props: { listType, ...props }, children: items });
    const item = (text: string, children: TreeSpec[] = [], props: Record<string, any> = {}): TreeSpec => ({ type: 'list-item', text, props, children });
    await buildTree(page, [
      { type: 'heading', text: 'Title', props: { level: 2 } },
      list('bullet', [
        item('one', [list('ordered', [item('one.a'), item('one.b', [list('todo', [item('deep todo', [], { checked: true }), item('open todo', [], { checked: false })])])], { start: 3 })]),
        item('two'),
      ]),
      { type: 'toggle', text: 'collapsed toggle', props: { collapsed: true }, children: [{ type: 'paragraph', text: 'hidden child' }] },
      { type: 'toggle', text: 'open toggle', props: { collapsed: false }, children: [{ type: 'paragraph', text: 'visible child' }] },
      { type: 'callout', text: 'be careful', props: { variant: 'warning' } },
      { type: 'code', text: 'const x = 1;\nreturn x;', props: { language: 'js' } },
      { type: 'dialogue', text: 'Hello said the fox' },
      { type: 'blockquote', text: 'quoted' },
      { type: 'divider' },
    ]);
    const before = await getJson(page);
    const count = await blockEls(page);
    await saveNow(page);

    await reload(page);
    expect(await getJson(page)).toEqual(before);
    await expect.poll(() => blockEls(page)).toBe(count);
    await expect(page.getByText('hidden child')).toHaveCount(0); // still collapsed
    await expect(page.getByText('visible child')).toHaveCount(1);
    await expect(page.locator('[data-block-type="code"]')).toContainText('return x;');
  });

  test('1c · regions: sub-regions, titles, fields', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    const region = (regionType: string, title: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'region', props: { regionType, title }, children });
    await buildTree(page, [
      { type: 'paragraph', text: 'Preamble' },
      region('section-1', 'The ferryman',
        { type: 'paragraph', text: 'Opening' },
        region('section-2', 'The bank', { type: 'paragraph', text: 'Text of the bank' }),
        region('section-2', 'The water', region('section-3', 'Ripples', { type: 'paragraph', text: 'deep' }))),
      region('section-1', 'The return', { type: 'paragraph', text: 'Closing' }),
    ]);
    await page.evaluate(async () => {
      const r = (window as any).nabu.regions.list;
      r[0].setField('pov', 'first person');
      r[1].setField('weight', 3);
      r[1].setField('draft', true);
    });
    const labels = () => page.evaluate(() => (window as any).nabu.regions.list.map((r: any) => r.label));
    const beforeLabels = await labels();
    expect(beforeLabels).toHaveLength(5);
    const before = await getJson(page);
    expect(JSON.stringify(before)).toContain('first person');
    await saveNow(page);

    await reload(page);
    expect(await getJson(page)).toEqual(before);
    expect(await labels()).toEqual(beforeLabels);
    await expect(page.locator('.nabu-region')).toHaveCount(5);
    await expect(page.locator('.nabu-region-title').nth(2)).toHaveText('The water');
  });

  test('1d · an image: bytes come back from the asset store and the image is displayed', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEmpty(page);
    await pastePng(page);
    const images = () => page.evaluate(() => [...(window as any).nabu.blocks.values()].filter((b: any) => b.type === 'image' && !b.node.isDeleted?.()).map((b: any) => ({ ref: b.ref, status: b.status })));
    await expect.poll(() => images().then((l) => l[0]?.status)).toBe('ready');
    await expect.poll(() => images().then((l) => l[0]?.ref)).toMatch(HASH_REF);
    const before = await images();
    await saveNow(page);

    await reload(page);
    expect(await images()).toEqual(before);
    await expect.poll(() => page.locator('[data-block-type="image"] img').evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth))).toEqual([1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Unsaved edits at reload time
// ═══════════════════════════════════════════════════════════════════════════

test.describe('2 · autosave timing', () => {
  test('2a · control: typing then waiting for the debounce, then reloading, keeps the typed text', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEditor(page);
    const t0 = Date.now();
    await typeText(page, 'typed by keyboard');
    // KEEP (time-based by design): the debounce is 2 s; poll for a snapshot saved after the typing.
    await expect.poll(async () => (await stored(page, id))?.savedAt ?? 0, { timeout: 8000 }).toBeGreaterThanOrEqual(t0);
    await reload(page);
    expect((await texts(page)).join('|')).toContain('typed by keyboard');
  });

  // P-91 (fixed, ADR 010 theme 8): the persisted editor saves at once on `visibilitychange` -> hidden and on `pagehide` (bypassing the debounce).
  test('2b · typing then reloading IMMEDIATELY (before the 2 s debounce) loses nothing — flush on pagehide', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEditor(page);
    await typeText(page, 'baseline');
    await saveNow(page);
    await typeText(page, ' and the last words');
    await page.reload(); // right away: the debounce timer is still pending
    await waitForEditor(page, 15000);
    expect((await texts(page)).join('|')).toContain('baseline and the last words');
  });

  // The IndexedDB write started at pagehide does not survive a RELOAD in Chromium, so the changes since the last save are also written
  // synchronously to localStorage (the "tail", src/lib/persistence/tail.js) and merged at the next boot. Here nothing was ever saved.
  test('2b″ · a document that was never saved: typing then reloading at once restores it from the tail, and the next save removes the tail', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEditor(page);
    await typeText(page, 'never saved before the reload');
    expect(await stored(page, id)).toBeNull();
    await page.reload();
    await waitForEditor(page, 15000);
    expect((await texts(page)).join('|')).toContain('never saved before the reload');
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(false);
    expect((await texts(page)).filter((t) => t === '').length).toBeLessThanOrEqual(0); // no leftover empty paragraph from the merge
    await saveNow(page);
    expect(await page.evaluate((docId) => localStorage.getItem('nabu:tail:' + docId), id)).toBeNull();
    await reload(page);
    expect((await texts(page)).join('|')).toContain('never saved before the reload');
  });

  test('2b′ · the tab being hidden saves at once (visibilitychange), without waiting for the debounce', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEditor(page);
    await typeText(page, 'typed just before hiding');
    expect(await stored(page, id)).toBeNull(); // the debounce (2 s) has not elapsed
    await hidePage(page);
    await expect.poll(async () => (await stored(page, id))?.size ?? 0).toBeGreaterThan(0);
    await expect.poll(() => persistenceOf(page).then((p) => p.status)).toBe('saved');
  });

  // P-96 (fixed): the debounce has a maximum wait (`maxWait`, default 3000 ms): during a continuous burst a save happens at least that often.
  test('2c · a continuous burst of edits is saved while it goes on (maxWait)', async ({ page }) => {
    const id = docId();
    await boot(page, id, { debounce: 400, maxWait: 1000 });
    await focusEditor(page);
    const t0 = Date.now();
    // 2.7 s of typing with 150 ms between keystrokes (always < debounce)
    for (let i = 0; i < 18; i++) { await page.keyboard.type('x'); await page.waitForTimeout(150); }
    const rec = await stored(page, id);
    expect(rec?.savedAt ?? 0).toBeGreaterThanOrEqual(t0); // still typing, yet something was saved
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. isNew / saveNow / clearPersistence
// ═══════════════════════════════════════════════════════════════════════════

test.describe('3 · isNew, saveNow, clearPersistence', () => {
  test('3a · isNew is true for a fresh docId, false once saved and reopened; another docId is still new', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(true);
    await addParagraph(page, 'x');
    await saveNow(page);
    await reload(page);
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(false);
    await boot(page, id + '-other');
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(true);
  });

  test('3b · saveNow() writes the snapshot before it resolves (no wait for the debounce) and can be called repeatedly / concurrently', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    expect(await stored(page, id)).toBeNull(); // a fresh document is not written until something changes or saveNow is called
    await addParagraph(page, 'first');
    const t0 = Date.now();
    await saveNow(page);
    const rec = await stored(page, id);
    expect(rec).not.toBeNull();
    expect(rec!.savedAt).toBeGreaterThanOrEqual(t0);
    await addParagraph(page, 'second');
    await page.evaluate(async () => { const n = (window as any).nabu; await Promise.all([n.saveNow(), n.saveNow(), n.saveNow()]); });
    await reload(page);
    expect((await texts(page)).join('|')).toContain('second');
  });

  test('3c · clearPersistence() then reload: a fresh empty document, isNew, no stored record — and a pending autosave does not resurrect it', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await addParagraph(page, 'will be cleared');
    await saveNow(page);
    await addParagraph(page, 'unsaved at clear time'); // debounce timer pending
    await page.evaluate(() => (window as any).nabu.clearPersistence());
    expect(await stored(page, id)).toBeNull();
    // KEEP (time-based by design): wait past the 2 s debounce to prove the cancelled timer does not write the record back.
    await page.waitForTimeout(2600);
    expect(await stored(page, id)).toBeNull();

    await reload(page);
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(true);
    expect((await texts(page)).join('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Two tabs, same docId
// ═══════════════════════════════════════════════════════════════════════════

test.describe('4 · two tabs on the same docId', () => {
  async function twoTabs(context: any, id: string) {
    const a: Page = await context.newPage();
    const b: Page = await context.newPage();
    await boot(a, id);
    await addParagraph(a, 'base');
    await saveNow(a);
    await boot(b, id);
    expect((await texts(b)).join('|')).toContain('base');
    return { a, b };
  }

  test('4a · characterization: no live sync between tabs; the last tab to save wins (ADR 010 "pas de multi-onglets")', async ({ context }) => {
    const id = docId();
    const { a, b } = await twoTabs(context, id);
    await addParagraph(a, 'edit from A');
    await saveNow(a);
    // B does not see A's edit live
    await b.waitForTimeout(300); // KEEP (negative check): give a would-be sync a chance
    expect((await texts(b)).join('|')).not.toContain('edit from A');
    await addParagraph(b, 'edit from B');
    await saveNow(b); // B's document never saw A's edit: its snapshot replaces A's
    await reload(a);
    await reload(b);
    const final = (await texts(a)).join('|');
    console.log(`[8a·4a] after both reloads the document holds: ${final}`);
    expect(final).toContain('edit from B');
    expect(final).not.toContain('edit from A'); // A's saved edit was silently overwritten
    expect(await texts(b)).toEqual(await texts(a));
  });

  // FINDING (P1 data loss, KNOWN LIMITATION of ADR 010): each tab keeps its own in-memory doc and writes a full snapshot over the shared record.
  // A's saved edit is lost, silently, with no warning in either tab. Loro could merge: the save should import the stored snapshot first (or a
  // BroadcastChannel / storage `versionchange` should sync the tabs).
  test.fixme('4b · edits made in two tabs are both kept after both reload (Loro merge) — FINDING: last writer wins, the other tab\'s saved edit is silently lost [persistence.js save(): export snapshot without importing the stored one]', async ({ context }) => {
    const id = docId();
    const { a, b } = await twoTabs(context, id);
    await addParagraph(a, 'edit from A');
    await saveNow(a);
    await addParagraph(b, 'edit from B');
    await saveNow(b);
    await reload(a);
    await reload(b);
    const all = (await texts(a)).join('|');
    expect(all).toContain('edit from A');
    expect(all).toContain('edit from B');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Undo after a reload
// ═══════════════════════════════════════════════════════════════════════════

test.describe('5 · undo after a reload', () => {
  // The Loro UndoManager is in memory only: the undo stack does not survive a reload (product decision to confirm; the snapshot keeps the CRDT
  // history but not the stack). What must hold: Ctrl+Z after a reload never damages the document, and undoes the post-reload edits normally.
  test('5 · characterization: Ctrl+Z does not undo pre-reload edits, never wipes the document; a post-reload edit undoes normally', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEditor(page);
    await typeText(page, 'written before the reload');
    await press(page, 'Enter');
    await typeText(page, 'second line before');
    await saveNow(page);
    const before = await texts(page);

    await reload(page);
    await focusEditor(page);
    await undo(page);
    await undo(page);
    const afterUndo = await texts(page);
    console.log(`[8a·5] text before reload=${JSON.stringify(before)}; after reload + 2×Ctrl+Z=${JSON.stringify(afterUndo)}`);
    expect(afterUndo).toEqual(before); // nothing undone, nothing damaged

    await page.keyboard.press('End');
    await typeText(page, ' PLUS');
    expect((await texts(page)).join('|')).toContain('second line before PLUS');
    await undo(page);
    const afterOwn = (await texts(page)).join('|');
    expect(afterOwn).toContain('second line before');
    expect(afterOwn).not.toContain('PLUS');
    expect(afterOwn).toContain('written before the reload');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. IndexedDB unavailable / failing
// ═══════════════════════════════════════════════════════════════════════════

test.describe('6 · IndexedDB unavailable or failing', () => {
  // P-93 (fixed): when IndexedDB is missing / blocked (locked-down WebViews, enterprise policy, some private modes) the editor boots IN MEMORY:
  // `nabu.persistence.available === false`, status `'unavailable'`, a warning; `createPersistedEditor` does not reject.
  test('6a · `indexedDB` undefined: the editor still boots in memory and is usable, with a warning', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    const ready = await bootsWithin(page, docId());
    expect(ready, 'the editor must boot without IndexedDB').toBe(true);
    await focusEditor(page);
    await typeText(page, 'still usable');
    expect((await texts(page)).join('|')).toContain('still usable');
    expect(warnings.join('\n')).toMatch(/indexeddb|persist|storage/i);
    const p = await persistenceOf(page);
    expect(p).toMatchObject({ available: false, status: 'unavailable', recovery: null });
    expect(p.lastError).toBeTruthy();
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(true);
    expect(await page.evaluate(() => (window as any).nabu.saveNow().then(() => 'resolved', (e: Error) => e.message))).toMatch(/unavailable/);
  });

  test('6b · `indexedDB.open()` fails (SecurityError): the editor still boots in memory and is usable', async ({ page }) => {
    await page.addInitScript(() => {
      (IDBFactory.prototype as any).open = function () {
        const req: any = {};
        setTimeout(() => { req.error = new DOMException('denied', 'SecurityError'); req.onerror?.({ target: req }); }, 0);
        return req;
      };
    });
    const ready = await bootsWithin(page, docId());
    expect(ready, 'the editor must boot when IndexedDB.open fails').toBe(true);
    await focusEditor(page);
    await typeText(page, 'still usable');
    expect((await texts(page)).join('|')).toContain('still usable');
    expect(await persistenceOf(page)).toMatchObject({ available: false, status: 'unavailable' });
  });

  // P-95 (fixed): a write that fails after boot (quota exceeded, DB closed by the browser) sets `persistence.status = 'error'`, warns, calls
  // `onSaveError`; no uncaught error, the editor keeps working, and the next change retries.
  test('6c · a save that fails after boot (quota) is reported (status, warn) and does not throw uncaught; the next change retries', async ({ page }) => {
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: any[]) {
        if ((window as any).__failPut) throw new DOMException('quota', 'QuotaExceededError');
        return (put as any).apply(this, args);
      };
    });
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    const uncaught: string[] = [];
    page.on('pageerror', (e) => uncaught.push(e.message));
    await boot(page, docId(), { debounce: 200 });
    await page.evaluate(() => { (window as any).__failPut = true; });
    await focusEditor(page);
    await typeText(page, 'cannot be saved');
    await expect.poll(() => persistenceOf(page).then((p) => p.status), { timeout: 4000 }).toBe('error');
    expect((await persistenceOf(page)).lastError).toMatch(/quota/i);
    expect(warnings.join('\n')).toMatch(/save|persist|quota/i); // the failure must be reported somewhere
    expect(uncaught, 'no uncaught error').toEqual([]);
    await typeText(page, ' and more');
    expect((await texts(page)).join('|')).toContain('and more');
    // the quota is back: the next change retries and the status recovers
    await page.evaluate(() => { (window as any).__failPut = false; });
    await typeText(page, ' retry');
    await expect.poll(() => persistenceOf(page).then((p) => p.status), { timeout: 4000 }).toBe('saved');
    expect((await persistenceOf(page)).lastError).toBeNull();
    await reload(page);
    expect((await texts(page)).join('|')).toContain('cannot be saved and more retry');
  });

  test('6d · the `onSaveError` hook is called for an autosave failure, not for saveNow (which rejects for its awaiter)', async ({ page }) => {
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: any[]) {
        if ((window as any).__failPut) throw new DOMException('quota', 'QuotaExceededError');
        return (put as any).apply(this, args);
      };
    });
    await boot(page, docId(), { debounce: 200 }); // the e2e route installs onSaveError / onRecover and records them in window.__saveErrors / __recoveries
    await page.evaluate(() => { (window as any).__failPut = true; });
    await focusEditor(page);
    await typeText(page, 'x');
    await expect.poll(() => page.evaluate(() => (window as any).__saveErrors)).toEqual(['QuotaExceededError']);
    expect(await page.evaluate(() => (window as any).nabu.saveNow().then(() => 'resolved', (e: Error) => e.name))).toBe('QuotaExceededError');
    expect(await page.evaluate(() => (window as any).__saveErrors)).toEqual(['QuotaExceededError']);
  });

  test('6e · the save status is reactive: a component sees saved -> pending -> saving -> saved', async ({ page }) => {
    const id = docId();
    await boot(page, id, { debounce: 300, maxWait: 0 });
    await focusEditor(page);
    await typeText(page, 'status');
    await expect.poll(() => persistenceOf(page).then((p) => p.status), { timeout: 4000 }).toBe('saved');
    expect((await persistenceOf(page)).lastSavedAt).toBeGreaterThan(0);
    const log = await page.evaluate(() => (window as any).__statusLog as string[]);
    expect(log[0]).toBe('saved');
    expect(log).toContain('pending');
    expect(log).toContain('saving');
    expect(log.at(-1)).toBe('saved');
    expect(log.indexOf('pending')).toBeLessThan(log.indexOf('saving'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Corrupted stored snapshot
// ═══════════════════════════════════════════════════════════════════════════

test.describe('7 · corrupted stored snapshot', () => {
  /** Create the DB schema and a real snapshot for `id` (returns its bytes), via a normal persisted session. */
  async function seedValid(page: Page, id: string) {
    await boot(page, id);
    await addParagraph(page, 'precious words that must be recoverable');
    await saveNow(page);
    return (await stored(page, id))!.bytes;
  }

  // P-92 (fixed): a snapshot that Loro cannot import no longer makes the document unopenable. The unreadable record is moved to the
  // `quarantine` object store (never deleted), the previous save (backup) is tried, else the editor starts empty; the host is told.
  test('7a · garbage bytes in the store (no backup): the editor boots empty with a warning, and the bad record is kept in quarantine', async ({ page }) => {
    const id = docId();
    await seedValid(page, id);
    const garbage = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256);
    await putRaw(page, id, garbage);
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    const ready = await bootsWithin(page, id);
    expect(ready, 'the editor must boot with a corrupted snapshot').toBe(true);
    const p = await persistenceOf(page);
    expect(p.recovery).toMatchObject({ kind: 'empty' });
    expect(p.recovery!.quarantinedKey).toMatch(new RegExp('^' + id));
    expect(warnings.join('\n')).toMatch(/could not be read/);
    await focusEditor(page);
    await typeText(page, 'fresh start');
    expect((await texts(page)).join('|')).toContain('fresh start');
    const kept = await quarantined(page, id);
    expect(kept.map((q) => q.value), 'corrupted record must not be destroyed').toEqual([garbage]);
    expect(kept[0].key).toBe(p.recovery!.quarantinedKey);
  });

  test('7b · a TRUNCATED valid snapshot: the editor boots and the unreadable record is not destroyed', async ({ page }) => {
    const id = docId();
    const good = await seedValid(page, id);
    const truncated = good.slice(0, Math.floor(good.length * 0.7));
    await putRaw(page, id, truncated);
    const ready = await bootsWithin(page, id);
    expect(ready, 'the editor must boot with a truncated snapshot').toBe(true);
    expect((await persistenceOf(page)).recovery).toMatchObject({ kind: 'empty' });
    expect((await quarantined(page, id)).map((q) => q.value), 'truncated record kept as is').toEqual([truncated]);
  });

  test('7c · a record whose `snapshot` is not bytes (string): the editor boots', async ({ page }) => {
    const id = docId();
    await seedValid(page, id);
    await putRaw(page, id, 'not a snapshot');
    expect(await bootsWithin(page, id)).toBe(true);
    expect((await persistenceOf(page)).recovery).toMatchObject({ kind: 'empty' });
    expect((await quarantined(page, id)).map((q) => q.value)).toEqual(['not a snapshot']);
  });

  test('7d · backup rotation: two saves, the latest corrupted -> the PREVIOUS content comes back, with recovery info', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await addParagraph(page, 'first version');
    await saveNow(page);
    expect(await backupOf(page, id)).toBeNull(); // the first save replaced nothing
    const first = (await stored(page, id))!.bytes;
    await addParagraph(page, 'second version');
    await saveNow(page);
    expect(await backupOf(page, id)).toEqual(first); // the previous snapshot became the backup
    const garbage = Array.from({ length: 48 }, (_, i) => (i * 13 + 5) % 256);
    await putRaw(page, id, garbage);

    const ready = await bootsWithin(page, id);
    expect(ready).toBe(true);
    const joined = (await texts(page)).join('|');
    expect(joined).toContain('first version');
    expect(joined).not.toContain('second version');
    const p = await persistenceOf(page);
    expect(p.recovery).toMatchObject({ kind: 'backup' });
    expect(p.recovery!.error).toBeTruthy();
    expect(p.recovery!.at).toBeGreaterThan(Date.now() - 60_000);
    expect(await page.evaluate(() => (window as any).__recoveries)).toEqual(['backup']); // the onRecover hook
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(false);
    // the unreadable record is kept, and the document is clean again: the next load has nothing to recover
    expect((await quarantined(page, id)).map((q) => q.value)).toEqual([garbage]);
    expect((await stored(page, id))!.bytes).toEqual(first);
    await reload(page);
    expect((await persistenceOf(page)).recovery).toBeNull();
    expect((await texts(page)).join('|')).toContain('first version');
  });

  test('7e · both the latest snapshot and the backup unreadable: starts empty, both kept in quarantine', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await addParagraph(page, 'one');
    await saveNow(page);
    await addParagraph(page, 'two');
    await saveNow(page);
    await putRaw(page, id, [1, 2, 3, 4]);
    await page.evaluate((docId) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('nabu');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('backups', 'readwrite');
        tx.objectStore('backups').put({ docId, snapshot: new Uint8Array([9, 9]), savedAt: 1 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), id);
    expect(await bootsWithin(page, id)).toBe(true);
    expect((await persistenceOf(page)).recovery).toMatchObject({ kind: 'empty' });
    const kept = await quarantined(page, id);
    expect(kept.map((q) => q.source).sort()).toEqual(['backup', 'snapshot']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7bis. Page listeners
// ═══════════════════════════════════════════════════════════════════════════

test.describe('7bis · page-hide listeners', () => {
  test('the listeners are added by the persisted editor and removed by persistence.dispose()', async ({ page }) => {
    // track the live listeners for the two events
    await page.addInitScript(() => {
      const live = new Set<string>();
      const track = (target: EventTarget, name: string) => {
        const add = target.addEventListener.bind(target);
        const remove = target.removeEventListener.bind(target);
        const ids = new Map<any, string>();
        let n = 0;
        (target as any).addEventListener = (type: string, fn: any, opts: any) => {
          if (type === 'visibilitychange' || type === 'pagehide') { const key = `${name}:${type}:${ids.get(fn) ?? (ids.set(fn, String(n++)), ids.get(fn))}`; live.add(key); }
          return add(type, fn, opts);
        };
        (target as any).removeEventListener = (type: string, fn: any, opts: any) => {
          if (ids.has(fn)) live.delete(`${name}:${type}:${ids.get(fn)}`);
          return remove(type, fn, opts);
        };
      };
      track(document, 'document');
      track(window, 'window');
      (window as any).__liveListeners = () => [...live].map((k) => k.split(':').slice(0, 2).join(':')).sort();
    });
    const id = docId();
    await boot(page, id);
    const before: string[] = await page.evaluate(() => (window as any).__liveListeners()); // (the framework has listeners of its own)
    expect(before).toContain('document:visibilitychange');
    expect(before).toContain('window:pagehide');
    await focusEditor(page);
    await typeText(page, 'will not be flushed');
    await page.evaluate(() => (window as any).nabu.persistence.dispose());
    const after: string[] = await page.evaluate(() => (window as any).__liveListeners());
    const without = (list: string[], name: string) => { const i = list.indexOf(name); return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)]; };
    expect(after).toEqual(without(without(before, 'document:visibilitychange'), 'window:pagehide')); // exactly the two of the editor are gone
    await hidePage(page);
    // KEEP (negative check): nothing may be written after the editor was released; give a hidden-tab flush ample time to (wrongly) happen.
    await page.waitForTimeout(600);
    expect(await stored(page, id)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. History modes
// ═══════════════════════════════════════════════════════════════════════════

test.describe('8 · history modes (ADR 014 §3.6)', () => {
  const compactQuery = '&options=' + encodeURIComponent(JSON.stringify({ history: { mode: 'compact', retain: 0 }, files: { releaseGraceMs: 0 } })) + '&archive=1';

  test('8a · compact: reload after many edits keeps the content, the archive hook receives the full snapshot once, the saved snapshot shrinks, later sessions keep working', async ({ page }) => {
    const id = docId();
    await boot(page, id); // session 1: default history 'full'
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (let i = 0; i < 60; i++) {
        const b = n.insert('paragraph', { text: `draft ${i} ` + 'lorem ipsum dolor sit amet '.repeat(5) });
        await n.commit();
        n.tree.delete(b.node.id);
        await n.commit();
      }
      n.insert('paragraph', { text: 'the essential sentence' });
      await n.commit();
      await n.saveNow();
    });
    const full = await stored(page, id);

    await page.goto('/e2e?persist=' + encodeURIComponent(id) + compactQuery);
    await waitForEditor(page, 15000);
    expect(await page.evaluate(() => (window as any).__archived)).toEqual([full!.size]);
    const compacted = await stored(page, id);
    expect(compacted!.size).toBeLessThan(full!.size / 2);
    expect(await page.evaluate(() => (window as any).nabu.doc.isShallow())).toBe(true);
    expect((await texts(page)).join('|')).toContain('the essential sentence');

    await addParagraph(page, 'written after compaction');
    await saveNow(page);
    await reload(page); // same compact URL: nothing older than "now" left to compact, content intact
    const t = (await texts(page)).join('|');
    expect(t).toContain('the essential sentence');
    expect(t).toContain('written after compaction');
    expect(await page.evaluate(() => (window as any).nabu.doc.isShallow())).toBe(true);
  });

  test('8b · compact with a retention window (30d): recent history is not touched, the archive hook is not called, nothing changes', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await addParagraph(page, 'recent edit');
    await saveNow(page);
    const before = await stored(page, id);
    await page.goto('/e2e?persist=' + encodeURIComponent(id) + '&options=' + encodeURIComponent(JSON.stringify({ history: { mode: 'compact', retain: '30d' } })) + '&archive=1');
    await waitForEditor(page, 15000);
    expect(await page.evaluate(() => (window as any).__archived)).toEqual([]);
    expect(await page.evaluate(() => (window as any).nabu.doc.isShallow())).toBe(false);
    expect((await texts(page)).join('|')).toContain('recent edit');
    expect((await stored(page, id))!.size).toBe(before!.size);
  });

  test('8c · a typo in the `history` option fails loudly (createPersistedEditor rejects before anything is read)', async ({ page }) => {
    expectErrors = true;
    test.info().annotations.push({ type: 'skip-dom-invariant', description: 'no editor on purpose' });
    const rejections: string[] = [];
    page.on('pageerror', (e) => rejections.push(e.message));
    const ready = await bootsWithin(page, docId(), 3000, '&options=' + encodeURIComponent(JSON.stringify({ history: { mode: 'compcat' } })));
    expect(ready).toBe(false);
    await expect.poll(() => rejections.join('\n')).toMatch(/history|compcat/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Asset outbox
// ═══════════════════════════════════════════════════════════════════════════

test.describe('9 · asset outbox', () => {
  const imagesOf = (page: Page) => page.evaluate(() => [...(window as any).nabu.blocks.values()].filter((b: any) => b.type === 'image' && !b.node.isDeleted?.())
    .map((b: any) => ({ ref: b.ref, status: b.status, reason: b.reason?.code ?? null })));
  const outbox = (page: Page, id: string) => page.evaluate((docId) => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('nabu');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('outbox', 'readonly').objectStore('outbox').index('docId').getAll(docId);
      req.onsuccess = () => { db.close(); resolve(req.result.map((e: any) => ({ hash: e.hash, state: e.state, attempts: e.attempts }))); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), id);

  test('9 · an image whose host upload failed is still there after a reload (local copy + outbox entry kept); with a working host, it is sent (by itself or by retry())', async ({ page }) => {
    const id = docId();
    expect(await bootsWithin(page, id, 15000, '&hostFiles=fail')).toBe(true);
    await focusEmpty(page);
    await pastePng(page);
    await expect.poll(() => imagesOf(page).then((l) => l[0]?.status)).toBe('error');
    await saveNow(page);
    const [failed] = await imagesOf(page);
    expect(await outbox(page, id)).toHaveLength(1);

    // reopen with a host that works
    expect(await bootsWithin(page, id, 15000, '&hostFiles=1')).toBe(true);
    await expect.poll(async () => (await imagesOf(page))[0]?.ref).toBe(failed.ref);
    // wait for the resume pass to settle: either it retried by itself (ready) or it waits for an explicit retry() (error)
    await expect.poll(async () => (await imagesOf(page))[0].status, { timeout: 5000 }).toMatch(/^(ready|error)$/);
    const afterReopen = (await imagesOf(page))[0];
    const uploadsOnOpen = await page.evaluate(() => (window as any).__hostUploads.length);
    console.log(`[8a·9] reopened with a working host: status=${afterReopen.status} reason=${afterReopen.reason} uploadsOnOpen=${uploadsOnOpen}`);
    if (afterReopen.status === 'error') {
      expect(await page.evaluate(() => [...(window as any).nabu.blocks.values()].find((b: any) => b.type === 'image').retry())).toBe(true);
    }
    await expect.poll(async () => (await imagesOf(page))[0].status).toBe('ready');
    expect(await page.evaluate(() => (window as any).__hostUploads.length)).toBe(1);
    await expect.poll(() => outbox(page, id)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. A larger document
// ═══════════════════════════════════════════════════════════════════════════

test.describe('10 · large document', () => {
  test('10 · ~500 blocks persist and reload intact (timings printed)', async ({ page }) => {
    test.setTimeout(90000);
    const id = docId();
    await boot(page, id);
    const specs: TreeSpec[] = [];
    for (let i = 0; i < 500; i++) {
      if (i % 25 === 0) specs.push({ type: 'heading', text: `Chapter ${i / 25}`, props: { level: 2 } });
      else if (i % 10 === 0) specs.push({ type: 'list', props: { listType: 'bullet' }, children: [0, 1, 2].map((k) => ({ type: 'list-item', text: `item ${i}.${k}` })) });
      else specs.push({ type: 'paragraph', text: `Paragraph number ${i}: ` + 'the quick brown fox jumps over the lazy dog. '.repeat(3) });
    }
    // build the model in one go (timed apart from the rendering)
    const modelMs = await page.evaluate(async (list) => {
      const t = performance.now();
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      const add = (sp: any, parentId: string | null, index: number) => {
        const b = n.insert(sp.type, { ...(sp.props ?? {}), ...(sp.text !== undefined ? { text: sp.text } : {}) }, parentId, index);
        (sp.children ?? []).forEach((c: any, i: number) => add(c, b.id, i));
      };
      list.forEach((sp: any, i: number) => add(sp, null, i));
      await n.commit();
      return Math.round(performance.now() - t);
    }, specs);
    const tRender = Date.now();
    const nodeCount = await page.evaluate(() => { const c = (ns: any[]): number => ns.reduce((s, x) => s + 1 + c(x.children() ?? []), 0); return c((window as any).nabu.tree.roots()); });
    await expect.poll(() => blockEls(page), { timeout: 60000 }).toBe(nodeCount);
    const renderMs = Date.now() - tRender;
    const before = await getJson(page);
    const total = await page.evaluate(() => (window as any).nabu.blocks.size);
    expect(total).toBeGreaterThanOrEqual(500);
    const domBlocks = nodeCount;

    const saveMs = await page.evaluate(async () => { const t = performance.now(); await (window as any).nabu.saveNow(); return Math.round(performance.now() - t); });
    const size = (await stored(page, id))!.size;

    const t0 = Date.now();
    await page.reload();
    await waitForEditor(page, 30000);
    const readyMs = Date.now() - t0;
    await expect.poll(() => blockEls(page), { timeout: 30000 }).toBe(domBlocks);
    const loadMs = Date.now() - t0;
    const readyAt = await page.evaluate(() => Math.round(performance.now()));
    console.log(`[8a·10] ${total} blocks: model build+commit ${modelMs} ms, DOM render ${renderMs} ms, saveNow ${saveMs} ms, snapshot ${size} bytes, reload→engine ready ${readyMs} ms, →all blocks in DOM ${loadMs} ms (page clock at ready: ${readyAt} ms)`);

    expect(await getJson(page)).toEqual(before);
  });
});
