/**
 * Capture what Nabu's copy / cut handler writes on the ClipboardEvent's `clipboardData` (the system clipboard
 * is unreliable for custom MIME types in Chromium). A bubble-phase `window` listener runs AFTER Nabu's own
 * handler (which sits on the editor element) and records the three payloads of every copy / cut event.
 */

import { type Page, expect } from '@playwright/test';

export type ClipEvent = {
  type: 'copy' | 'cut';
  defaultPrevented: boolean;
  /** raw `application/x-nabu+json` string ('' when not written) */
  nabuRaw: string;
  /** parsed fragment (null when nothing written) */
  nabu: { blocks: any[] } | null;
  html: string;
  text: string;
};

/** Register the recorder (idempotent). Call BEFORE pressing Ctrl+C / Ctrl+X. */
export async function installClipRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__clipEvents = [];
    if (w.__clipInstalled) return;
    w.__clipInstalled = true;
    const rec = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      const raw = cd?.getData('application/x-nabu+json') ?? '';
      w.__clipEvents.push({
        type: e.type,
        defaultPrevented: e.defaultPrevented,
        nabuRaw: raw,
        nabu: raw ? JSON.parse(raw) : null,
        html: cd?.getData('text/html') ?? '',
        text: cd?.getData('text/plain') ?? '',
      });
    };
    window.addEventListener('copy', rec);
    window.addEventListener('cut', rec);
  });
}

/** Press a clipboard key (`Control+c` / `Control+x`) and return the single event recorded for it. */
export async function pressClip(page: Page, key: 'Control+c' | 'Control+x'): Promise<ClipEvent> {
  await installClipRecorder(page);
  await page.evaluate(() => { (window as any).__clipEvents = []; });
  await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => (window as any).__clipEvents.length), { message: 'clipboard event recorded' }).toBeGreaterThan(0);
  return page.evaluate(() => (window as any).__clipEvents.at(-1));
}

export const copy = (page: Page) => pressClip(page, 'Control+c');
export const cut = (page: Page) => pressClip(page, 'Control+x');

/** Compact one-line form of a nabu fragment block: `type[partial]{props}"text"` (+ children). */
export function fragStr(b: any): string {
  const text = (b.delta ?? []).map((op: any) => {
    const a = op.attributes ? '<' + Object.keys(op.attributes).join(',') + '>' : '';
    return a + op.insert;
  }).join('');
  const props = b.props && Object.keys(b.props).length ? JSON.stringify(b.props) : '';
  const kids = b.children?.length ? '[' + b.children.map(fragStr).join(' ; ') + ']' : '';
  return `${b.type}${b.partial !== undefined ? '(' + b.partial + ')' : ''}${props}${b.delta ? JSON.stringify(text) : ''}${kids}`;
}

/** Plain texts (concatenated deltas) of every block of a fragment, depth-first. */
export function fragTexts(blocks: any[]): string[] {
  const out: string[] = [];
  const walk = (b: any) => {
    if (b.delta) out.push(b.delta.map((op: any) => op.insert).join(''));
    (b.children ?? []).forEach(walk);
  };
  blocks.forEach(walk);
  return out;
}
