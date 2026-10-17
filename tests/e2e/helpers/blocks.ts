/**
 * Fixture helpers for non-list text blocks (heading / blockquote / callout / dialogue / paragraph):
 * build a flat root document from a tiny spec, and a props-aware outline of the MODEL tree.
 */

import { type Page } from '@playwright/test';

export type TextSpec = { type: string; text: string; props?: Record<string, any> };

/** `B('heading', 'Title', { level: 2 })` -> a root block spec. */
export const B = (type: string, text = '', props: Record<string, any> = {}): TextSpec => ({ type, text, props });
export const Para = (text = '') => B('paragraph', text);
export const H = (text: string, level = 1) => B('heading', text, { level });
export const Q = (text: string) => B('blockquote', text);
export const C = (text: string, variant = 'note') => B('callout', text, { variant });
export const D = (text: string) => B('dialogue', text);

/** Replace the whole document with the given root text blocks (programmatic fixture, undo history cleared). */
export async function buildBlocks(page: Page, specs: TextSpec[]) {
  await page.evaluate(async (list) => {
    const n = (window as any).nabu;
    for (const c of [...n.children]) n.delete(c);
    list.forEach((s: any, i: number) => n.insert(s.type, { ...(s.props ?? {}), text: s.text }, null, i));
    await n.commit();
    n.undoManager.clear();
  }, specs);
  await page.waitForFunction(() => {
    const n = (window as any).nabu;
    return document.querySelectorAll('[data-block-id]').length === n.tree.roots().length && n.tree.roots().length > 0;
  });
}

/**
 * One-line outline of the model tree for flat text documents, with the type-specific prop:
 * `h2(Title) ; p(∅) ; q(x) ; callout:tip(x) ; dialogue(x)`.
 */
export async function flat(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    return n.tree.roots().map((node: any) => {
      const type = node.data.get('type');
      const t = node.data.get('text');
      const s = t ? t.toString() : '';
      const text = s === '' ? '∅' : s.replace(/\n/g, '\\n');
      if (type === 'heading') return `h${node.data.get('level') || 1}(${text})`;
      if (type === 'paragraph') return `p(${text})`;
      if (type === 'blockquote') return `q(${text})`;
      if (type === 'callout') return `callout:${node.data.get('variant') || 'note'}(${text})`;
      return `${type}(${text})`;
    }).join(' ; ');
  });
}

// ── Nested trees (code / toggle / divider fixtures) ─────────────────────────

export type TreeSpec = { type: string; text?: string; props?: Record<string, any>; children?: TreeSpec[] };

/** `Code('x = 1', 'js')` -> a code block. */
export const Code = (text = '', language: string | null = null): TreeSpec => ({ type: 'code', text, props: language ? { language } : {} });
/** `Tog('Header', [Para('child')], true)` -> a toggle with body children (3rd arg: collapsed). */
export const Tog = (text: string, children: TreeSpec[] = [], collapsed = false): TreeSpec => ({ type: 'toggle', text, props: { collapsed }, children });
/** `Hr()` -> a divider. */
export const Hr = (): TreeSpec => ({ type: 'divider' });
/** `T(Para('x'))`-style adapter: a paragraph as TreeSpec. */
export const Pp = (text = ''): TreeSpec => ({ type: 'paragraph', text });

/** Replace the whole document with the given (possibly nested) blocks (programmatic fixture, undo history cleared). */
export async function buildTree(page: Page, specs: TreeSpec[]) {
  await page.evaluate(async (list) => {
    const n = (window as any).nabu;
    for (const c of [...n.children]) n.delete(c);
    const add = (s: any, parentId: string | null, index: number | null) => {
      const props: any = { ...(s.props ?? {}) };
      if (s.text !== undefined) props.text = s.text;
      const b = n.insert(s.type, props, parentId, index);
      (s.children ?? []).forEach((c: any, i: number) => add(c, b.id, i));
    };
    list.forEach((s: any, i: number) => add(s, null, i));
    await n.commit();
    n.undoManager.clear();
  }, specs);
  await page.waitForFunction(() => {
    const n = (window as any).nabu;
    const count = (nodes: any[], visible: boolean): number => nodes.reduce((s, x) => {
      const hide = x.data.get('type') === 'toggle' && x.data.get('collapsed');
      return s + 1 + (hide ? 0 : count(x.children() ?? [], true));
    }, 0);
    return n.tree.roots().length > 0 && document.querySelectorAll('[data-block-id]').length === count(n.tree.roots(), true);
  });
}

/**
 * One-line outline of the MODEL tree for documents with code / toggle / divider blocks:
 * `p(a) ; code:js(x\ny) ; toggle▾(Head){p(child)} ; toggle▸(Head){...} ; hr`. Newlines in text shown as `\n`.
 */
export async function tree(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const walk = (node: any): string => {
      const type = node.data.get('type');
      const t = node.data.get('text');
      const s = t ? t.toString() : '';
      const text = s === '' ? '∅' : s.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      const kids: any[] = node.children() ?? [];
      const body = kids.length ? '{' + kids.map(walk).join(' ') + '}' : '';
      if (type === 'divider') return 'hr';
      if (type === 'paragraph') return `p(${text})${body}`;
      if (type === 'code') return `code${node.data.get('language') ? ':' + node.data.get('language') : ''}(${text})`;
      if (type === 'toggle') return `toggle${node.data.get('collapsed') ? '▸' : '▾'}(${text})${body}`;
      if (type === 'heading') return `h${node.data.get('level') || 1}(${text})${body}`;
      return `${type}(${text})${body}`;
    };
    return n.tree.roots().map(walk).join(' ; ');
  });
}
