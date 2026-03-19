/**
 * Core E2E helper — must be imported by every spec file.
 *
 * Key constraints (from test plan):
 *  - NEVER use page.fill() on contenteditable
 *  - Only keyboard.type() / keyboard.press()
 *  - window.nabu accessed via page.evaluate() after window.__nabu_debug?.()
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

/**
 * Navigate to the app and wait for the editor to be ready.
 * Enables debug mode so window.nabu is available.
 */
export async function gotoEditor(page: Page) {
  console.log('Navigating to editor page...');
  await page.goto('/');
  console.log('Waiting for editor to initialize...');
  await waitForEditor(page);
}

/**
 * Wait until window.nabu is defined and the editor has at least one block.
 */
export async function waitForEditor(page: Page, timeout = 8000) {
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__nabu_debug?.());
  await page.waitForFunction(
    () => !!(window as any).nabu && (window as any).nabu.children?.length >= 0,
    { timeout },
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
  // Let Svelte tick propagate
  await page.waitForTimeout(50);
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
  await page.evaluate((offset) => {
    const n = (window as any).nabu;
    n.focus({ offset });
  }, offset);
}

/**
 * Press a key or key combo, e.g. 'Enter', 'Backspace', 'Control+b'.
 */
export async function press(page: Page, key: string) {
  await page.keyboard.press(key, { delay: 50 });
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
  await page.waitForTimeout(50);
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
