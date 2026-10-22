/**
 * UI-component helpers (DragHandle, FloatingToolbar, SlashMenu, CommandInvite/Chooser, region seams): viewport geometry,
 * real-input scrolling and drags, and WCAG contrast computed from the browser's own computed colours.
 */

import { type Page, expect } from '@playwright/test';
import { flushRender } from './editor.js';

/** A 200x80 solid PNG (data URL) for image blocks (`props.ref`). */
export const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABQCAIAAADTD63nAAAA6UlEQVR4nO3SQQkAIADAQNPayU6GsoRDkIMLsMfGXBuuG88L+JKxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi8QBG1AWEfQAilYAAAAASUVORK5CYII=';

export type Box = { x: number; y: number; width: number; height: number; left: number; top: number; right: number; bottom: number; cx: number; cy: number };

const toBox = (r: { left: number; top: number; width: number; height: number }): Box => ({
  x: r.left, y: r.top, left: r.left, top: r.top, width: r.width, height: r.height,
  right: r.left + r.width, bottom: r.top + r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2,
});

/** Viewport rect of the `nth` element matching `selector` (null when absent). */
export async function rect(page: Page, selector: string, nth = 0): Promise<Box | null> {
  const r = await page.evaluate(([sel, i]) => {
    const el = document.querySelectorAll(sel as string)[i as number];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  }, [selector, nth] as [string, number]);
  return r ? toBox(r) : null;
}

/** Same as `rect` but throws when absent. */
export async function mustRect(page: Page, selector: string, nth = 0): Promise<Box> {
  const r = await rect(page, selector, nth);
  if (!r) throw new Error(`no element matches "${selector}" (#${nth})`);
  return r;
}

/** Bounding rect of the DOM selection's first range (the same rect the toolbar / menus anchor to). */
export async function selectionRect(page: Page): Promise<Box> {
  const r = await page.evaluate(() => {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const b = s.getRangeAt(0).getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  if (!r) throw new Error('no DOM selection');
  return toBox(r);
}

/** Rect of the caret (collapsed range); falls back to the rect of the block holding it when the range reports nothing. */
export async function caretRect(page: Page): Promise<Box> {
  const r = await page.evaluate(() => {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    let b = s.getRangeAt(0).getBoundingClientRect();
    if (!b.width && !b.height) {
      const el = (s.anchorNode?.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode?.parentElement)?.closest('[data-block-id]');
      if (el) b = el.getBoundingClientRect();
    }
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  if (!r) throw new Error('no DOM selection');
  return toBox(r);
}

/** Centre (viewport px) of the first occurrence of `needle` in the editor's text, optionally scrolled into the middle of the viewport first. */
export async function pointOfText(page: Page, needle: string, opts: { scroll?: boolean; word?: string } = {}): Promise<{ x: number; y: number; box: Box }> {
  const r = await page.evaluate(([text, scroll, word]) => {
    const root = document.querySelector('.nabu-editor')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.nodeValue ?? '').indexOf(text as string);
      if (i < 0) continue;
      if (scroll) (n.parentElement as HTMLElement).scrollIntoView({ block: 'center' });
      const range = document.createRange();
      const from = i + (word ? (text as string).indexOf(word as string) : 0);
      range.setStart(n, from);
      range.setEnd(n, from + (word ? (word as string).length : (text as string).length));
      const b = range.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    }
    return null;
  }, [needle, !!opts.scroll, opts.word ?? ''] as [string, boolean, string]);
  if (!r) throw new Error(`text "${needle}" not found in the editor`);
  const box = toBox(r);
  return { x: box.cx, y: box.cy, box };
}

/** Double-click `word` (found inside the unique `context` string) with the real mouse: selects it. Returns the word's box. */
export async function dblclickWord(page: Page, context: string, word: string, opts: { scroll?: boolean } = {}): Promise<Box> {
  const p = await pointOfText(page, context, { ...opts, word });
  await page.mouse.dblclick(p.x, p.y);
  await flushRender(page);
  return p.box;
}

/**
 * Scroll with the real mouse wheel over `at`, and wait until the scroll position (window, or `scroller`'s scrollTop) has
 * settled — plus a short grace period for any synthetic mouse move / scroll handlers that follow.
 */
export async function wheelScroll(page: Page, at: { x: number; y: number }, dy: number, scroller?: string): Promise<number> {
  const read = () => page.evaluate((sel) => (sel ? document.querySelector(sel)!.scrollTop : window.scrollY), scroller ?? null);
  await page.mouse.move(at.x, at.y);
  const before = await read();
  await page.mouse.wheel(0, dy);
  await expect.poll(read, { message: 'the wheel scrolled' }).not.toBe(before);
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    const cur = await read();
    if (cur === prev) break;
    prev = cur;
    await page.waitForTimeout(60);
  }
  await flushRender(page);
  await page.waitForTimeout(200);
  return (await read()) - before;
}

/**
 * Grab a block's drag handle and drag it: hover `from` (a point on the block), move onto the handle, press, move to `to` in
 * steps, run `during` while the button is down, release (unless `release: false`).
 */
export async function dragWithHandle(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { during?: () => Promise<void>; release?: boolean } = {},
) {
  await page.mouse.move(from.x, from.y, { steps: 4 });
  const handle = page.locator('.nabu-drag-handle');
  await expect(handle, 'the drag handle shows when hovering the block').toBeVisible();
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (opts.during) await opts.during();
  if (opts.release !== false) await page.mouse.up();
}

export type Contrast = { fg: string; bg: string; ratio: number; size: string };

/**
 * WCAG contrast of the text of the `nth` element matching `selector` (or of its pseudo-element `pseudo`, e.g. `::after`):
 * the computed text colour composited over the EFFECTIVE background (every translucent ancestor background stacked
 * over the page, white canvas at the bottom), so translucent "glass" surfaces are measured as they are painted.
 */
export async function contrast(page: Page, selector: string, opts: { nth?: number; pseudo?: string } = {}): Promise<Contrast> {
  return page.evaluate(([sel, nth, pseudo]) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const parse = (css: string): RGBA => {
      let m = css.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
      const alpha = (a?: string) => (a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a));
      if (m) return [+m[1], +m[2], +m[3], alpha(m[4])];
      m = css.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
      if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, alpha(m[4])];
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (f: RGBA, b: RGBA): RGBA => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1];
    const lum = (c: RGBA) => {
      const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const el = document.querySelectorAll(sel as string)[nth as number] as HTMLElement | undefined;
    if (!el) throw new Error('contrast: no element ' + sel);
    const chain: HTMLElement[] = [];
    for (let e: HTMLElement | null = el; e; e = e.parentElement) chain.push(e);
    let bg: RGBA = [255, 255, 255, 1];
    for (const e of chain.reverse()) bg = over(parse(getComputedStyle(e).backgroundColor), bg);
    const cs = getComputedStyle(el, (pseudo as string) || null);
    const fg = over(parse(cs.color), bg);
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const css = (c: RGBA) => 'rgb(' + c.slice(0, 3).map((v) => Math.round(v)).join(',') + ')';
    return { fg: css(fg), bg: css(bg), ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100, size: cs.fontSize };
  }, [selector, opts.nth ?? 0, opts.pseudo ?? ''] as [string, number, string]);
}

/** Viewport rect of the block of `type` whose OWN first text is exactly `text` (a list item's nested items don't count). */
export async function blockBox(page: Page, type: string, text: string): Promise<Box> {
  const r = await page.evaluate(([t, txt]) => {
    const firstText = (el: Element) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      return w.nextNode()?.nodeValue?.trim() ?? '';
    };
    const el = [...document.querySelectorAll(`.nabu-editor [data-block-type="${t}"]`)].find((e) => firstText(e) === txt);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  }, [type, text] as [string, string]);
  if (!r) throw new Error(`no ${type} block with text "${text}"`);
  return toBox(r);
}

/** A hover point on a block: 30px in from its left edge, 5px down (the first line), clamped for small blocks. */
export const hoverPoint = (b: Box) => ({ x: b.left + Math.min(30, b.width / 2), y: b.top + Math.min(5, b.height / 2) });
/** A point in the upper (`before`) or lower (`after`) half of a block, for a drop. */
export const dropPoint = (b: Box, where: 'before' | 'after') => ({ x: b.left + Math.min(30, b.width / 2), y: where === 'after' ? b.bottom - Math.min(3, b.height / 4) : b.top + Math.min(3, b.height / 4) });
