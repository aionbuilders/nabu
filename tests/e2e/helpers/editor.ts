/**
 * Core E2E helper — must be imported by every spec file.
 *
 * Key constraints (from test plan):
 *  - NEVER use page.fill() on contenteditable
 *  - Only keyboard.type() / keyboard.press()
 *  - window.nabu (set by the /e2e route) accessed via page.evaluate()
 *  - waitForEditor() uses page.waitForFunction()
 */

import { type Page, type Locator, expect } from '@playwright/test';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NabuBlock {
  id: string;
  type: string;
  text?: string;
}

export interface NabuSnapshot {
  blocks: NabuBlock[];
  json: string;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

// ── Boot diagnostics & resilience ──────────────────────────────────────────

/** Internal readiness budget per attempt — shorter than the 20 s test timeout so the diagnostic is produced before it. */
const READY_TIMEOUT = 10000;
/** Boot attempts when the BROWSER's network stack was reset mid-load (see `NETWORK_CHANGED`). */
const MAX_ATTEMPTS = 3;
/**
 * Chromium aborts in-flight requests with `net::ERR_NETWORK_CHANGED` whenever the host's network configuration
 * changes (typical on WSL2 / laptops switching Wi-Fi, VPN, …) — even for localhost. When it hits a JS chunk of the
 * app, the SvelteKit client dies silently (blank page or "500 Internal Error"), `__nabu_ready` is never set and the
 * test would "hang" in beforeEach. That is an environment flake, not a product bug: reload and retry.
 */
const NETWORK_CHANGED = 'ERR_NETWORK_CHANGED';

interface BootTracker {
  console: string[];
  errors: string[];
  pending: Map<unknown, string>;
  failed: string[];
  networkChanged: boolean;
  /** Sticky for the whole page lifetime (not cleared by `reset`). */
  everNetworkChanged: boolean;
  /** Resolves (once per navigation attempt) as soon as a request fails with ERR_NETWORK_CHANGED. */
  onNetworkChanged: Promise<'network-changed'>;
  reset(): void;
}

const trackers = new WeakMap<Page, BootTracker>();

/** Start recording console / page errors / request lifecycle for `page` (idempotent). */
function trackBoot(page: Page): BootTracker {
  const existing = trackers.get(page);
  if (existing) return existing;
  let signal: () => void = () => {};
  const t: BootTracker = {
    console: [],
    errors: [],
    pending: new Map(),
    failed: [],
    networkChanged: false,
    everNetworkChanged: false,
    onNetworkChanged: new Promise<'network-changed'>((r) => { signal = () => r('network-changed'); }),
    reset() {
      this.console = [];
      this.errors = [];
      this.pending.clear();
      this.failed = [];
      this.networkChanged = false;
      this.onNetworkChanged = new Promise<'network-changed'>((r) => { signal = () => r('network-changed'); });
    },
  };
  page.on('console', (m) => t.console.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => t.errors.push(String(e?.stack ?? e)));
  page.on('request', (r) => t.pending.set(r, `${r.method()} ${r.url()}`));
  page.on('requestfinished', (r) => t.pending.delete(r));
  page.on('requestfailed', (r) => {
    t.pending.delete(r);
    const err = r.failure()?.errorText ?? '';
    t.failed.push(`${r.method()} ${r.url()} -> ${err}`);
    if (err.includes(NETWORK_CHANGED)) {
      t.networkChanged = true;
      t.everNetworkChanged = true;
      signal();
    }
  });
  trackers.set(page, t);
  return t;
}

/**
 * True if this page's browser reported `net::ERR_NETWORK_CHANGED` at any point (host network reset — an
 * environment flake). Lets error collectors ignore the resulting "Failed to fetch ..." noise.
 */
export function networkWasReset(page: Page): boolean {
  return trackers.get(page)?.everNetworkChanged ?? false;
}

/** Build a human-readable report of the page's boot state (never throws). */
async function bootReport(page: Page, t: BootTracker, reason: string): Promise<string> {
  let state: unknown;
  try {
    state = await Promise.race([
      page.evaluate(() => ({
        url: location.href,
        readyState: document.readyState,
        hasNabu: !!(window as any).nabu,
        nabuReady: (window as any).__nabu_ready,
        children: (window as any).nabu?.children?.length ?? null,
        blockEls: document.querySelectorAll('[data-block-id]').length,
        body: document.body?.innerText?.slice(0, 200),
      })),
      new Promise((r) => setTimeout(() => r('<page.evaluate hung (>3s)>'), 3000)),
    ]);
  } catch (e) {
    state = `<page.evaluate failed: ${e}>`;
  }
  const lines = [
    `Nabu editor not ready: ${reason}`,
    `page url: ${page.url()}`,
    `state: ${JSON.stringify(state)}`,
    `unfinished requests (${t.pending.size}): ${[...t.pending.values()].join(' | ') || '-'}`,
    `failed requests (${t.failed.length}): ${t.failed.join(' | ') || '-'}`,
    `page errors (${t.errors.length}): ${t.errors.join(' | ') || '-'}`,
    `console (${t.console.length}): ${t.console.slice(-20).join(' | ') || '-'}`,
  ];
  return lines.join('\n  ');
}

/**
 * Run `navigate` then wait for the editor; if the browser reported ERR_NETWORK_CHANGED during the attempt,
 * navigate again (up to MAX_ATTEMPTS). Any other failure throws a diagnostic immediately.
 */
async function bootWithRetry(page: Page, navigate: () => Promise<unknown>, timeout: number, freshStart: boolean) {
  const t = trackBoot(page);
  for (let attempt = 1; ; attempt++) {
    // `freshStart` false: the caller already triggered the navigation, keep what was recorded so far.
    if (freshStart || attempt > 1) t.reset();
    let failure: string | null = null;
    try {
      await navigate();
      // Race readiness against a network reset: the latter means the app can never boot, no need to wait for the timeout.
      const ready = page
        .waitForFunction(
          () => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0,
          null,
          { timeout },
        )
        .then(() => 'ready' as const);
      ready.catch(() => {}); // may be abandoned (and time out later) when the network-changed branch wins
      if ((await Promise.race([ready, t.onNetworkChanged])) === 'ready') {
        t.reset(); // don't let later, unrelated request failures look like a boot failure
        return;
      }
    } catch (e) {
      failure = (e as Error).message.split('\n')[0];
      if (!t.networkChanged) throw new Error(await bootReport(page, t, failure));
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(await bootReport(page, t, `${failure ?? 'network reset'} (gave up after ${attempt} attempts, each hit ${NETWORK_CHANGED})`));
    }
    console.warn(`[e2e] ${NETWORK_CHANGED} while booting the editor (attempt ${attempt}/${MAX_ATTEMPTS}); retrying`);
    await page.waitForTimeout(250 * attempt); // let the network stack settle
  }
}

/**
 * Navigate to the dedicated e2e route and wait for the editor to be ready.
 * Without `persist` the editor is in-memory and starts empty; with
 * `persist: docId` it is backed by IndexedDB under that docId (no seed content).
 * `options` is forwarded (as JSON, via `?options=`) to the editor factory.
 *
 * On failure the error carries a diagnostic (console, page errors, readyState, unfinished requests…).
 */
export async function gotoEditor(
  page: Page,
  opts: { persist?: string; options?: Record<string, unknown>; seed?: 'regions' | 'long'; commands?: 'demo'; layout?: 'scroll'; theme?: 'dark' | 'dark-attr' | 'light'; vars?: string; label?: string } = {},
) {
  const params = new URLSearchParams();
  if (opts.persist) params.set('persist', opts.persist);
  // Dev-only seed document of the /e2e route (`regions`: a small document with region markers, ADR 016).
  if (opts.seed) params.set('seed', opts.seed);
  // Dev-only demo commands of the confirmation strategies (ADR 017 lot 2; src/routes/e2e/demo-commands.js).
  if (opts.commands) params.set('commands', opts.commands);
  // Dev-only layout / theme / custom properties of the /e2e route (see src/routes/e2e/+page.svelte): `layout: 'scroll'` puts the
  // editor in a fixed-height scroll container under a sticky top bar; `theme` makes the host page dark / light; `vars` sets CSS custom properties on the host.
  if (opts.layout) params.set('layout', opts.layout);
  if (opts.theme) params.set('theme', opts.theme);
  if (opts.vars) params.set('vars', opts.vars);
  // Dev-only: the `label` prop of NabuEditor (its accessible name).
  if (opts.label) params.set('label', opts.label);
  // JSON-able Nabu init options (e.g. { placeholders: { show: 'empty' } }), merged into the editor init.
  if (opts.options) params.set('options', JSON.stringify(opts.options));
  const query = params.toString();
  // `domcontentloaded`: readiness is decided by the editor itself, not by the window `load` event
  // (which any slow sub-resource would delay).
  await bootWithRetry(
    page,
    () => page.goto(query ? '/e2e?' + query : '/e2e', { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT }),
    READY_TIMEOUT,
    true,
  );
}

/**
 * Wait until the /e2e route has fully created the engine (window.__nabu_ready)
 * and the editor has at least one block (e.g. after `page.reload()`). A production build boots in well under
 * a second, so the default budget is deliberately short and a failure throws a diagnostic.
 * If the page's boot was broken by a browser network reset it is reloaded (see NETWORK_CHANGED).
 */
export async function waitForEditor(page: Page, timeout = READY_TIMEOUT) {
  let first = true;
  await bootWithRetry(
    page,
    async () => {
      // The caller already triggered the navigation the first time; only reload on a retry.
      if (!first) await page.reload({ waitUntil: 'domcontentloaded', timeout });
      first = false;
    },
    timeout,
    false,
  );
}

/**
 * Clear all blocks and insert a single empty paragraph.
 * Use this at the start of each test for a clean slate.
 */
export async function clearAndReset(page: Page) {
  await page.evaluate(async () => {
    const n = (window as any).nabu;
    // Delete all root children
    const children = [...n.children];
    for (const child of children) {
      n.delete(child);
    }
    n.insert('paragraph', {});
    await n.commit();
    n.undoManager.clear();
  });
  // `n.commit()` is awaited above; wait for the DOM to show exactly one (empty) block before the test starts.
  await page.waitForFunction(() => {
    const c = (window as any).nabu.children;
    return c.length === 1
      && document.querySelectorAll('[data-block-id]').length === 1
      && !!document.querySelector(`[data-block-id="${c[0].id}"]`);
  });
}

/**
 * Wait for the pending render work to flush (two animation frames). Use it before a NEGATIVE assertion
 * ("X must not appear") so that a wrongly scheduled update has had its chance to land — a condition-based
 * replacement for a fixed sleep.
 */
export async function flushRender(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

// ── Editor locators ────────────────────────────────────────────────────────

export function getEditor(page: Page): Locator {
  return page.locator('[contenteditable="true"]');
}

export function getBlock(page: Page, type: string, index = 0): Locator {
  return page.locator(`[data-block-type="${type}"]`).nth(index);
}

export function getBlockById(page: Page, id: string): Locator {
  return page.locator(`[data-block-id="${id}"]`);
}

// ── Focus helpers ──────────────────────────────────────────────────────────

/**
 * Click the editor to focus it before typing.
 */
export async function focusEditor(page: Page) {
  await getEditor(page).click();
}

/**
 * Click the first block of a given type.
 */
export async function clickBlock(page: Page, type: string, index = 0) {
  await getBlock(page, type, index).click();
}

// ── State inspection ───────────────────────────────────────────────────────

/**
 * Returns the current block tree as a flat array of {id, type, text?}.
 */
export async function getBlocks(page: Page): Promise<NabuBlock[]> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    function walk(blocks: any[]): any[] {
      return blocks.flatMap((b: any) => [
        { id: b.id, type: b.type, text: b.behavior?.text ?? b.text ?? undefined },
        ...(b.children ? walk(b.children) : []),
      ]);
    }
    return walk(n.children);
  });
}

/**
 * Returns the text of all leaf blocks concatenated with newlines.
 */
export async function getEditorText(page: Page): Promise<string> {
  const blocks = await getBlocks(page);
  return blocks
    .filter(b => b.text !== undefined)
    .map(b => b.text ?? '')
    .join('\n');
}

/**
 * Returns the current markdown serialization of the document.
 */
export async function getMarkdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    return n.serialize('markdown') ?? '';
  });
}

/**
 * Returns the current JSON serialization of the document.
 */
export async function getJson(page: Page): Promise<any> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    return n.serialize('json');
  });
}

/**
 * Returns the number of root-level blocks.
 */
export async function getRootBlockCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).nabu.children.length);
}

/**
 * Returns the id of the currently focused block (via nabu.selection).
 */
export async function getFocusedBlockId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    return n.selection?.focusBlock?.id ?? null;
  });
}

// ── Typing helpers ─────────────────────────────────────────────────────────

/**
 * Type text using keyboard.type() — the only safe way to type in contenteditable.
 */
export async function typeText(page: Page, text: string) {
  await page.keyboard.type(text);
}

export async function getSelection(page: Page) {
  return page.evaluate(() => {
    const nabu = (window as any).nabu;
    const sel = nabu.selection;
    if (!sel) return null;
    return {
      anchorBlockId: sel.anchorBlock?.id ?? null,
      anchorOffset: sel.anchorOffset,
      focusBlockId: sel.focusBlock?.id ?? null,
      focusOffset: sel.focusOffset,
    };
  });
}


export async function focus(page: Page, offset = 0) {
  await page.evaluate(async (offset) => {
    const n = (window as any).nabu;
    await n.focus({ offset }); // resolves once the model selection is set
  }, offset);
}

/**
 * Press a key or key combo, e.g. 'Enter', 'Backspace', 'Control+b'.
 */
export async function press(page: Page, key: string) {
  await page.keyboard.press(key);
}

// ── Exec (action bus) ──────────────────────────────────────────────────────

/**
 * Trigger a nabu.exec() action programmatically.
 */
export async function exec(page: Page, topic: string, data?: any) {
  await page.evaluate(
    ([t, d]) => (window as any).nabu.exec(t, d),
    [topic, data] as [string, any],
  );
  await flushRender(page);
}

// ── Insert helpers (programmatic, not keyboard) ────────────────────────────

/**
 * Insert a block via the nabu API and commit. Returns the block id.
 */
export async function insertBlock(
  page: Page,
  type: string,
  props: Record<string, any> = {},
  parentId?: string,
  index?: number,
): Promise<string> {
  return page.evaluate(
    async ([type, props, parentId, index]) => {
      const n = (window as any).nabu;
      const block = n.insert(type, props, parentId ?? null, index ?? null);
      await n.commit();
      return block.id;
    },
    [type, props, parentId, index] as [string, Record<string, any>, string | undefined, number | undefined],
  );
}

// ── Wait helpers ───────────────────────────────────────────────────────────

/**
 * Wait until the block count equals the expected count.
 */
export async function waitForBlockCount(page: Page, count: number, timeout = 3000) {
  await page.waitForFunction(
    (c) => (window as any).nabu?.children?.length === c,
    count,
    { timeout },
  );
}

/**
 * Wait until a block of the given type exists.
 */
export async function waitForBlockType(page: Page, type: string, timeout = 3000) {
  await page.waitForFunction(
    (t) => {
      const n = (window as any).nabu;
      function walk(blocks: any[]): boolean {
        return blocks.some((b: any) => b.type === t || (b.children && walk(b.children)));
      }
      return walk(n?.children ?? []);
    },
    type,
    { timeout },
  );
}

// ── Assertion helpers ──────────────────────────────────────────────────────

export async function expectBlockExists(page: Page, type: string) {
  await expect(getBlock(page, type)).toBeVisible();
}

export async function expectText(page: Page, text: string) {
  await expect(getEditor(page)).toContainText(text);
}
