/**
 * E2E — read-only mode (audit P-122, owner decision): `readonly` option of the engine / prop of NabuEditor.
 *
 * The /e2e route builds the editor from the `options` query param, so `{ readonly: true }` is the engine option; NabuEditor
 * follows `engine.readonly`, which the specs also flip live through `window.nabu`.
 *
 * Synthetic clipboard / drop events carry a real DataTransfer (they stand for the browser's own, which a script cannot send into
 * a non-editable element); typing is real keyboard input.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, flushRender, getJson } from './helpers/editor.js';

const ROOT = '[data-nabu-root]';

async function viewer(page: Page, texts: string[] = ['First paragraph', 'Second paragraph']) {
  await gotoEditor(page, { options: { readonly: true }, label: 'Viewer' });
  // the host's own calls are not restricted by read-only mode: that is how a viewer gets its document
  await page.evaluate(async (list) => {
    const n = (window as any).nabu;
    for (const child of [...n.children]) n.delete(child);
    for (const text of list) n.insert('paragraph', { text });
    await n.commit();
    n.undoManager.clear();
  }, texts);
  await flushRender(page);
}

const texts = async (page: Page) => (await getJson(page)).blocks.map((b: any) => (b.content ?? []).map((r: any) => r.text).join(''));

/** Select the characters [from, to) of the first text of the block holding `needle`. */
async function selectText(page: Page, needle: string, from = 0, to?: number) {
  await page.evaluate(([n, f, t]) => {
    const walker = document.createTreeWalker(document.querySelector('[data-nabu-root]')!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.nodeValue ?? '').includes(n as string)) continue;
      const range = document.createRange();
      range.setStart(node, f as number);
      range.setEnd(node, (t as number | null) ?? node.nodeValue!.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    throw new Error('no text ' + n);
  }, [needle, from, to ?? null] as [string, number, number | null]);
}

test.describe('the root', () => {
  test('is not editable, is a named document, and is a read-only region for assistive technology', async ({ page }) => {
    await viewer(page);
    const root = page.locator(ROOT);
    await expect(root).toHaveAttribute('contenteditable', 'false');
    await expect(root).toHaveAttribute('role', 'document');
    await expect(root).toHaveAttribute('aria-label', 'Viewer');
    await expect(root).toHaveAttribute('data-nabu-readonly', '');
    await expect(root).not.toHaveAttribute('aria-description', /.*/); // no Tab trap to announce
    await expect(page.getByLabel('Viewer')).toBeVisible();
  });

  test('can be switched live, both ways', async ({ page }) => {
    await viewer(page);
    const root = page.locator(ROOT);
    await page.evaluate(() => { (window as any).nabu.readonly = false; });
    await expect(root).toHaveAttribute('contenteditable', 'true');
    await expect(root).not.toHaveAttribute('role', /.*/);
    await page.getByText('Second paragraph').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    expect(await texts(page)).toEqual(['First paragraph', 'Second paragraph!']);
    await page.evaluate(() => { (window as any).nabu.readonly = true; });
    await expect(root).toHaveAttribute('contenteditable', 'false');
    await page.getByText('Second paragraph!').click();
    await page.keyboard.type('?');
    expect(await texts(page)).toEqual(['First paragraph', 'Second paragraph!']);
  });
});

test.describe('nothing the user does changes the document', () => {
  test('typing, Backspace, Enter, a markdown shortcut and the editing keys do nothing', async ({ page }) => {
    await viewer(page);
    const before = await getJson(page);
    await page.getByText('First paragraph').click();
    await page.keyboard.press('End');
    await page.keyboard.type('abc');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# ');
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+ArrowDown'); // move block
    expect(await getJson(page)).toEqual(before);
    expect(await texts(page)).toEqual(['First paragraph', 'Second paragraph']);
  });

  test('paste does nothing (the event is cancelled)', async ({ page }) => {
    await viewer(page);
    await selectText(page, 'First paragraph', 5, 5);
    const prevented = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'PASTED');
      dt.setData('text/html', '<h1>PASTED</h1>');
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('[data-nabu-root]')!.dispatchEvent(event);
      return event.defaultPrevented;
    });
    await flushRender(page);
    expect(prevented).toBe(true);
    expect(await texts(page)).toEqual(['First paragraph', 'Second paragraph']);
  });

  test('cut copies the text and removes nothing', async ({ page }) => {
    await viewer(page);
    await selectText(page, 'First paragraph', 0, 5);
    const copied = await page.evaluate(() => {
      const dt = new DataTransfer();
      document.querySelector('[data-nabu-root]')!.dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain');
    });
    await flushRender(page);
    expect(copied).toBe('First');
    expect(await texts(page)).toEqual(['First paragraph', 'Second paragraph']);
  });

  test('drop of text and of a file does nothing', async ({ page }) => {
    await viewer(page);
    const target = page.getByText('Second paragraph');
    await target.scrollIntoViewIfNeeded();
    const result = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-block-type="paragraph"]')].find((e) => e.textContent?.includes('Second'))!;
      const r = el.getBoundingClientRect();
      const mk = (type: string, dt: DataTransfer) => new DragEvent(type, { dataTransfer: dt, clientX: r.left + 10, clientY: r.top + 5, bubbles: true, cancelable: true });
      const dt = new DataTransfer();
      dt.setData('text/plain', 'DROPPED');
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' }));
      const over = mk('dragover', dt);
      el.dispatchEvent(over);
      const drop = mk('drop', dt);
      el.dispatchEvent(drop);
      return { overAccepted: over.defaultPrevented };
    });
    await flushRender(page);
    expect(result.overAccepted).toBe(false); // dragover is not cancelled: nothing can be dropped here
    expect(await texts(page)).toEqual(['First paragraph', 'Second paragraph']);
    await expect(page.locator('img')).toHaveCount(0);
  });
});

test.describe('the floating UI hides itself', () => {
  test('no toolbar over a selection, no drag handle on hover, no slash menu', async ({ page }) => {
    await viewer(page);
    await selectText(page, 'First paragraph', 0, 5);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    await expect(page.locator('.nabu-toolbar')).toHaveCount(0);

    const box = (await page.getByText('Second paragraph').boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.waitForTimeout(150);
    await expect(page.locator('.nabu-drag-handle')).toHaveCount(0);

    await page.getByText('Second paragraph').click();
    await page.keyboard.type('/');
    await expect(page.locator('.nabu-slash')).toHaveCount(0);
  });

  test('they come back when the editor is editable again', async ({ page }) => {
    await viewer(page);
    await page.evaluate(() => { (window as any).nabu.readonly = false; });
    const box = (await page.getByText('Second paragraph').boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await expect(page.locator('.nabu-drag-handle')).toHaveCount(1);
  });
});

test.describe('reading still works', () => {
  test('text is selectable and the selection is copied', async ({ page }) => {
    await viewer(page);
    // The paragraph is a full-width block: dblclick on its centre lands on the blank past the end of the text, where no browser
    // selects a word (editable or not). A reader double-clicks a word, so aim at one.
    await page.getByText('First paragraph').dblclick({ position: { x: 10, y: 5 } }); // selects a word
    const selected = await page.evaluate(() => window.getSelection()!.toString().trim());
    expect(selected).toBe('First');
    const copied = await page.evaluate(() => {
      const dt = new DataTransfer();
      const event = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('[data-nabu-root]')!.dispatchEvent(event);
      return dt.getData('text/plain');
    });
    expect(copied).toBe(selected);
  });

  test('text is selectable by dragging the mouse', async ({ page }) => {
    await viewer(page);
    const box = (await page.getByText('First paragraph').boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection()!.toString());
    expect(selected.length).toBeGreaterThan(0);
    expect('First paragraph'.startsWith(selected)).toBe(true);
    await page.getByText('First paragraph').click({ clickCount: 3 }); // triple click: the whole block
    expect(await page.evaluate(() => window.getSelection()!.toString().trim())).toBe('First paragraph');
  });

  test('a link opens as a normal link: a link to this site in place, a link to another site in a new tab', async ({ page }) => {
    await viewer(page, []);
    const origin = new URL(page.url()).origin;
    await page.evaluate(async (href) => {
      const n = (window as any).nabu;
      n.insert('paragraph', { delta: [{ insert: 'see ' }, { insert: 'the same-site link', attributes: { link: href } }, { insert: ' and ' }, { insert: 'the other-site link', attributes: { link: 'https://example.com/guide' } }] });
      await n.commit();
    }, `${origin}/e2e/multi`);
    await flushRender(page);

    // another site: a new tab, with no access to this one
    const other = page.locator('a.nabu-link[href="https://example.com/guide"]');
    await expect(other).toHaveAttribute('target', '_blank');
    await expect(other).toHaveAttribute('rel', 'noopener noreferrer');

    // this site: no target, the click navigates the tab itself
    const same = page.locator(`a.nabu-link[href="${origin}/e2e/multi"]`);
    await expect(same).not.toHaveAttribute('target', /.+/);
    await expect(same).not.toHaveAttribute('rel', /.+/);
    const popups: unknown[] = [];
    page.on('popup', (p) => popups.push(p));
    await same.click();
    await expect(page).toHaveURL(`${origin}/e2e/multi`);
    expect(popups).toEqual([]);
  });

  test('a toggle opens to be read, but the document is not touched (view state)', async ({ page }) => {
    await viewer(page, []);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const toggle = n.insert('toggle', { text: 'More', collapsed: true });
      n.insert('paragraph', { text: 'Hidden body' }, toggle.id, 0);
      await n.commit();
      n.undoManager.clear();
    });
    await flushRender(page);
    await expect(page.getByText('Hidden body')).toHaveCount(0);

    const version = await page.evaluate(() => JSON.stringify((window as any).nabu.doc.frontiers()));
    await page.locator('.nabu-toggle-arrow').click();
    await expect(page.getByText('Hidden body')).toBeVisible();
    await expect(page.locator('.nabu-toggle-arrow')).toHaveAttribute('aria-expanded', 'true');
    const after = await page.evaluate(() => ({
      version: JSON.stringify((window as any).nabu.doc.frontiers()),
      canUndo: (window as any).nabu.undoManager.canUndo(),
      // JSON shape: { version, blocks: [{ type, props: { collapsed }, ... }] }; the viewer keeps an empty paragraph before the toggle,
      // so look the toggle up by type instead of by index
      collapsed: (window as any).nabu.serialize('json').blocks.find((b: any) => b.type === 'toggle').props.collapsed,
    }));
    expect(after.version).toBe(version); // no Loro change at all
    expect(after.canUndo).toBe(false);
    expect(after.collapsed).toBe(true); // the document still says collapsed

    // it closes again, and editable again it shows the document's own state
    await page.locator('.nabu-toggle-arrow').click();
    await expect(page.getByText('Hidden body')).toHaveCount(0);
    await page.locator('.nabu-toggle-arrow').click();
    await expect(page.getByText('Hidden body')).toBeVisible();
    await page.evaluate(() => { (window as any).nabu.readonly = false; });
    await expect(page.getByText('Hidden body')).toHaveCount(0);
  });

  test('the to-do box and the callout icon do nothing', async ({ page }) => {
    await viewer(page, []);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      await n.importMarkdown('- [ ] task\n\n> [!NOTE]\n> a note');
    });
    await flushRender(page);
    const before = await getJson(page);
    // Playwright refuses to click an aria-disabled button: force it, the point is that a click changes nothing
    await page.locator('.nabu-todo-check').click({ force: true });
    await page.locator('.nabu-callout-icon').click({ force: true });
    expect(await getJson(page)).toEqual(before);
    await expect(page.locator('.nabu-todo-check')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.nabu-callout-icon')).toHaveAttribute('aria-disabled', 'true');
  });
});

test('the host\'s own calls still write into a read-only editor', async ({ page }) => {
  await viewer(page);
  await page.evaluate(async () => { await (window as any).nabu.importMarkdown('# Replaced\n\nbody'); });
  await flushRender(page);
  await expect(page.getByRole('heading', { name: 'Replaced' })).toBeVisible();
});
