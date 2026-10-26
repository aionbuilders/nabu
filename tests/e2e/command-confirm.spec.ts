/**
 * E2E — Command confirmations (ADR 017, lot 2): hold, invite, choose.
 * Uses the dev-only demo commands of the /e2e route (`?commands=demo`, src/routes/e2e/demo-commands.js):
 *   demo:hold      Mod-Shift-Backspace, at the start of a paragraph — hold (700 ms), the block is the target
 *   demo:invite    Mod-Alt-k, in a paragraph — invite
 *   demo:tie-a/b   Mod-Alt-u — two commands on the same chord: the chooser
 *   demo:variants  Mod-Alt-v — a command offering two variants
 * Every run is recorded in window.__demoLog.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, focusEditor, typeText, press } from './helpers/editor.js';
import { goToStart } from './helpers/keyboard.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const log = (page: Page) => page.evaluate(() => (window as any).__demoLog ?? []);
const pending = (page: Page) => page.evaluate(() => {
  const p = (window as any).nabu.pendingCommand;
  return p ? { id: p.id, strategy: p.strategy, progress: p.progress, selectedIndex: p.selectedIndex, options: p.options } : null;
});
const live = (page: Page) => page.locator('[data-nabu-live]');

test.describe('Command confirmations', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await gotoEditor(page, { commands: 'demo' });
    await clearAndReset(page);
    await focusEditor(page);
    await page.evaluate(() => { (window as any).__demoLog = []; (window as any).__demoHold = true; });
  });
  test.afterEach(() => { expect(errors).toEqual([]); });

  test('1 · hold: a real key held ~700 ms runs the command once, the target block shows the progress', async ({ page }) => {
    await typeText(page, 'target');
    await goToStart(page);
    await page.keyboard.down(MOD);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).toMatchObject({ strategy: 'hold', id: 'demo:hold' });
    const block = page.locator('[data-block-type="paragraph"]').first();
    await expect(block).toHaveAttribute('data-command-target', 'hold');
    await expect(live(page)).toContainText('Hold');
    await page.waitForTimeout(300);
    expect(await log(page)).toEqual([]);
    const mid = await block.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--nb-command-progress')));
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
    await page.waitForTimeout(700);
    expect(await log(page)).toEqual(['hold']);
    expect(await pending(page)).toBeNull();
    await expect(block).not.toHaveAttribute('data-command-target', /.*/);
    await expect(live(page)).toContainText('done');
    // still held: nothing else happens (no second run, the text is untouched)
    await page.keyboard.down('Backspace'); // auto-repeat of the key still held
    await page.waitForTimeout(800);
    expect(await log(page)).toEqual(['hold']);
    await page.keyboard.up('Backspace');
    await page.keyboard.up('Shift');
    await page.keyboard.up(MOD);
    expect(await page.evaluate(() => (window as any).nabu.children[0].behaviors.get('text').text)).toBe('target');
  });

  test('2 · hold: releasing early cancels (nothing runs)', async ({ page }) => {
    await typeText(page, 'target');
    await goToStart(page);
    await page.keyboard.down(MOD);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).not.toBeNull();
    await page.waitForTimeout(250);
    await page.keyboard.up('Backspace');
    expect(await pending(page)).toBeNull();
    await page.waitForTimeout(800);
    expect(await log(page)).toEqual([]);
    await expect(live(page)).toContainText('Cancelled');
    await page.keyboard.up('Shift');
    await page.keyboard.up(MOD);
  });

  test('3 · hold: a key held before the context does not start it, and is stopped there', async ({ page }) => {
    await typeText(page, 'target');
    await goToStart(page);
    await page.evaluate(() => { (window as any).__demoHold = false; }); // outside the context
    await page.keyboard.down(MOD);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Backspace'); // fresh, but the command does not apply here
    expect(await pending(page)).toBeNull();
    await page.evaluate(() => { (window as any).__demoHold = true; }); // the key stays down and enters the context
    await page.keyboard.down('Backspace'); // auto-repeat
    await page.keyboard.down('Backspace');
    await page.waitForTimeout(900);
    expect(await pending(page)).toBeNull();
    expect(await log(page)).toEqual([]);
    await page.keyboard.up('Backspace');
    await page.keyboard.down('Backspace'); // release and press again: this one counts
    await expect.poll(() => pending(page)).toMatchObject({ strategy: 'hold' });
    await page.waitForTimeout(900);
    expect(await log(page)).toEqual(['hold']);
    await page.keyboard.up('Backspace');
    await page.keyboard.up('Shift');
    await page.keyboard.up(MOD);
  });

  test('4 · hold: another key cancels and does its normal action', async ({ page }) => {
    await typeText(page, 'target');
    await goToStart(page);
    await page.keyboard.down(MOD);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).not.toBeNull();
    await page.keyboard.press('ArrowRight'); // Mod+Shift+Right: the native "select the next word" happens, and the hold is gone
    expect(await pending(page)).toBeNull();
    await page.keyboard.up('Backspace');
    await page.keyboard.up('Shift');
    await page.keyboard.up(MOD);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('target');
    expect(await log(page)).toEqual([]);
  });

  test('5 · invite: the same chord twice runs; the hint is shown in between', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, `${MOD}+Alt+k`);
    await expect.poll(() => pending(page)).toMatchObject({ strategy: 'invite', id: 'demo:invite' });
    expect(await log(page)).toEqual([]);
    await expect(page.locator('.nabu-command-invite')).toBeVisible();
    await expect(live(page)).toContainText('again to confirm');
    await press(page, `${MOD}+Alt+k`);
    await expect.poll(() => log(page)).toEqual(['invite']);
    expect(await pending(page)).toBeNull();
    await expect(page.locator('.nabu-command-invite')).toHaveCount(0);
  });

  test('6 · invite: Escape, another key and a click cancel', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, `${MOD}+Alt+k`);
    await expect.poll(() => pending(page)).not.toBeNull();
    await press(page, 'Escape');
    expect(await pending(page)).toBeNull();
    await press(page, `${MOD}+Alt+k`);
    await expect.poll(() => pending(page)).not.toBeNull();
    await page.keyboard.type('!');
    expect(await pending(page)).toBeNull();
    expect(await page.evaluate(() => (window as any).nabu.children[0].behaviors.get('text').text)).toBe('hello!');
    await press(page, `${MOD}+Alt+k`);
    await expect.poll(() => pending(page)).not.toBeNull();
    await page.locator('[data-block-type="paragraph"]').first().click();
    await expect.poll(() => pending(page)).toBeNull();
    expect(await log(page)).toEqual([]);
  });

  test('7 · choose (tie): the keyboard moves and Enter runs; the text of the editor is untouched', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, `${MOD}+Alt+u`);
    await expect.poll(() => pending(page)).toMatchObject({ strategy: 'choose', selectedIndex: 0 });
    const chooser = page.getByRole('listbox');
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole('option')).toHaveCount(2);
    await expect(chooser.getByRole('option').nth(0)).toContainText('Tie A');
    await expect(chooser.getByRole('option').nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(chooser.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(live(page)).toContainText('2 of 2: Tie B');
    await page.keyboard.press('Enter');
    await expect.poll(() => log(page)).toEqual(['tie-b']);
    await expect(chooser).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).nabu.children[0].behaviors.get('text').text)).toBe('hello');
  });

  test('8 · choose: a digit runs directly, a click runs, Escape cancels', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, `${MOD}+Alt+u`);
    await expect.poll(() => pending(page)).not.toBeNull();
    await page.keyboard.press('1');
    await expect.poll(() => log(page)).toEqual(['tie-a']);

    await press(page, `${MOD}+Alt+u`);
    await page.getByRole('option', { name: /Tie B/ }).click();
    await expect.poll(() => log(page)).toEqual(['tie-a', 'tie-b']);
    expect(await pending(page)).toBeNull();

    await press(page, `${MOD}+Alt+u`);
    await expect.poll(() => pending(page)).not.toBeNull();
    await press(page, 'Escape');
    expect(await pending(page)).toBeNull();
    expect(await log(page)).toEqual(['tie-a', 'tie-b']);
    expect(await page.evaluate(() => (window as any).nabu.children[0].behaviors.get('text').text)).toBe('hello');
  });

  test('9 · choose (variants): the command receives the chosen option', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, `${MOD}+Alt+v`);
    await expect.poll(() => pending(page)).toMatchObject({ strategy: 'choose', id: 'demo:variants' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => log(page)).toEqual(['variant:y']);
  });
});
