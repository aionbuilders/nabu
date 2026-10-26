/**
 * E2E — Commands & keymap (ADR 017, lot 1)
 * The migrated shortcuts (marks, undo) go through the command registry; the `keymap` option rebinds them;
 * `nabu.commands.list()` gives formatted shortcuts.
 */

import { test, expect } from './helpers/test.js';
import { gotoEditor, clearAndReset, focusEditor, typeText, press, getMarkdown, getJson } from './helpers/editor.js';
import { bold, italic, undo, selectForward, goToStart } from './helpers/keyboard.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function selectHello(page: any) {
  await typeText(page, 'hello world');
  await goToStart(page);
  await selectForward(page, 5);
}

test.describe('Commands — defaults', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  test('1 · the default shortcuts still work through the registry (Ctrl+B, undo)', async ({ page }) => {
    await selectHello(page);
    await bold(page);
    expect(await getMarkdown(page)).toContain('**hello**');
    await undo(page);
    expect(await getMarkdown(page)).not.toContain('**');
  });

  test('2 · list() exposes the commands with shortcuts formatted for the platform', async ({ page }) => {
    const rows = await page.evaluate(() => (window as any).nabu.commands.list());
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    const mac = process.platform === 'darwin';
    expect(byId['mark:bold']).toMatchObject({ label: 'Bold', keys: ['Mod-b'], extension: 'rich-text', display: [mac ? '⌘B' : 'Ctrl+B'] });
    expect(byId['mark:strikethrough'].display).toEqual([mac ? '⇧⌘X' : 'Ctrl+Shift+X']);
    expect(byId['undo']).toMatchObject({ extension: 'core', display: [mac ? '⌘Z' : 'Ctrl+Z'] });
    expect(byId['redo'].display).toHaveLength(2);
    expect(byId['todo:toggle']).toMatchObject({ scope: 'list-item', display: [mac ? '⌘↩' : 'Ctrl+Enter'] });
    for (const row of rows) expect(row.keys.length).toBe(row.display.length);
  });

  test('3 · a command is also an action: nabu.exec("mark:bold") bolds the selection', async ({ page }) => {
    await selectHello(page);
    await page.evaluate(() => (window as any).nabu.exec('mark:bold'));
    await expect.poll(() => getMarkdown(page)).toContain('**hello**');
  });
});

test.describe('Commands — todo toggle', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  test('3b · Mod-Enter toggles a to-do item (real key, command with scope + when)', async ({ page }) => {
    await typeText(page, '[] task');
    const checked = async () => (await getJson(page)).blocks[0].children?.[0]?.props?.checked;
    expect(await checked()).toBe(false);
    await press(page, `${MOD}+Enter`);
    await expect.poll(checked).toBe(true);
    await press(page, `${MOD}+Enter`);
    await expect.poll(checked).toBe(false);
  });
});

test.describe('Commands — keymap option', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, { options: { keymap: { 'mark:bold': ['Mod-Alt-b'], 'mark:italic': [] } } });
    await clearAndReset(page);
    await focusEditor(page);
  });

  test('4 · bold moves to Mod-Alt-b: the new chord works, the default no longer does', async ({ page }) => {
    await selectHello(page);
    await bold(page); // Ctrl+B: unbound now, and the browser's own bold is not let through either
    expect(await getMarkdown(page)).not.toContain('**');
    await press(page, `${MOD}+Alt+b`);
    await expect.poll(() => getMarkdown(page)).toContain('**hello**');
  });

  test('5 · [] disables a shortcut (italic does nothing), the command still runs through exec', async ({ page }) => {
    await selectHello(page);
    await italic(page);
    expect(await getMarkdown(page)).not.toContain('*hello*');
    await page.evaluate(() => (window as any).nabu.exec('mark:italic'));
    await expect.poll(() => getMarkdown(page)).toContain('*hello*');
  });

  test('6 · list() reflects the keymap', async ({ page }) => {
    const rows = await page.evaluate(() => (window as any).nabu.commands.list());
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    expect(byId['mark:bold'].keys).toEqual(['Mod-Alt-b']);
    expect(byId['mark:italic']).toMatchObject({ keys: [], display: [] });
    expect(byId['mark:underline'].keys).toEqual(['Mod-u']);
  });
});
