/**
 * Keyboard helper — shortcut aliases for common editor keyboard actions.
 */

import { type Page } from '@playwright/test';
import { press } from './editor.js';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

export const Keys = {
  bold: `${mod}+b`,
  italic: `${mod}+i`,
  underline: `${mod}+u`,
  code: `${mod}+e`,
  undo: `${mod}+z`,
  redo: isMac ? `${mod}+Shift+z` : `${mod}+y`,
  selectAll: `${mod}+a`,
  copy: `${mod}+c`,
  cut: `${mod}+x`,
  paste: `${mod}+v`,
  indent: 'Tab',
  unindent: 'Shift+Tab',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  arrowUp: 'ArrowUp',
  arrowDown: 'ArrowDown',
  arrowLeft: 'ArrowLeft',
  arrowRight: 'ArrowRight',
};

export async function bold(page: Page) { await press(page, Keys.bold); }
export async function italic(page: Page) { await press(page, Keys.italic); }
export async function underline(page: Page) { await press(page, Keys.underline); }
export async function code(page: Page) { await press(page, Keys.code); }
export async function undo(page: Page) { await press(page, Keys.undo); }
export async function redo(page: Page) { await press(page, Keys.redo); }
export async function selectAll(page: Page) { await press(page, Keys.selectAll); }
export async function indent(page: Page) { await press(page, Keys.indent); }
export async function unindent(page: Page) { await press(page, Keys.unindent); }

/**
 * Select text from the current cursor position forward by `n` characters
 * using Shift+ArrowRight.
 */
export async function selectForward(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Shift+ArrowRight');
  }
  await page.waitForTimeout(50);
}

/**
 * Select all text in the current block using Shift+End from Home.
 */
export async function selectLine(page: Page) {
  await press(page, 'Home');
  await press(page, 'Shift+End');
}

/**
 * Place cursor at end of current line.
 */
export async function goToEnd(page: Page) {
  await press(page, 'End');
}

/**
 * Place cursor at start of current line.
 */
export async function goToStart(page: Page) {
  await press(page, 'Home');
}
