/**
 * Clipboard helpers for E2E tests.
 *
 * Clipboard access in Playwright requires the 'clipboard-read' and
 * 'clipboard-write' permissions granted in playwright.config.js.
 */

import { type Page } from '@playwright/test';

/**
 * Read the current clipboard text content.
 */
export async function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Write text to the clipboard programmatically.
 */
export async function writeClipboardText(page: Page, text: string) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

/**
 * Write HTML to the clipboard using ClipboardItem.
 */
export async function writeClipboardHtml(page: Page, html: string, plain = '') {
  await page.evaluate(
    ([h, p]) => {
      const item = new ClipboardItem({
        'text/html': new Blob([h], { type: 'text/html' }),
        'text/plain': new Blob([p], { type: 'text/plain' }),
      });
      return navigator.clipboard.write([item]);
    },
    [html, plain] as [string, string],
  );
}

/**
 * Simulate a paste event by writing content to the clipboard and
 * pressing Ctrl/Cmd+V.
 */
export async function pasteText(page: Page, text: string) {
  await writeClipboardText(page, text);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+v`);
  await page.waitForTimeout(50);
}

/**
 * Simulate pasting HTML content.
 */
export async function pasteHtml(page: Page, html: string, plain = '') {
  await writeClipboardHtml(page, html, plain);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+v`);
  await page.waitForTimeout(50);
}
