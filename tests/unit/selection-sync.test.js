// @ts-nocheck
/**
 * Unit tests for P-08 — the model selection must reflect the CURRENT DOM selection synchronously.
 * `selectionchange` is asynchronous, so input handlers call `selection.sync()` first.
 * Real Nabu / NabuSelection over happy-dom nodes (no editor rendered: we fake the block elements).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension] });
  engine.insert('paragraph', {});
  engine.insert('paragraph', {});
  await engine.commit();
  const [a, b] = engine.children;
  const root = document.createElement('div');
  const texts = {};
  for (const [blk, txt] of [[a, 'hello world'], [b, 'second']]) {
    const el = document.createElement('div');
    el.setAttribute('data-block-id', blk.id);
    const t = document.createTextNode(txt);
    el.appendChild(t);
    root.appendChild(el);
    texts[blk.id] = t;
  }
  document.body.appendChild(root);
  return { engine, a, b, ta: texts[a.id], tb: texts[b.id], root };
}

// happy-dom dispatches `selectionchange` synchronously, browsers queue it as a task. Swallow it so the
// model state is really stale between a DOM move and the sync (what a fast keystroke sees in a browser).
const swallow = (e) => e.stopImmediatePropagation();
beforeEach(() => document.addEventListener('selectionchange', swallow, true));

const caret = (node, offset) => window.getSelection().setBaseAndExtent(node, offset, node, offset);

describe('P-08 · selection.sync()', () => {
  afterEach(() => { document.removeEventListener('selectionchange', swallow, true); document.body.innerHTML = ''; });

  it('picks up a DOM selection the model has not been told about yet', async () => {
    const { engine, a, ta } = await makeEditor();
    caret(ta, 5);
    // no selectionchange has been delivered yet (it is async): the model state is stale
    expect(engine.selection.anchorBlock).toBeNull();
    expect(engine.selection.sync()).toBe(true);
    expect(engine.selection.anchorBlock).toBe(a);
    expect(engine.selection.focusBlock).toBe(a);
    expect(engine.selection.anchorOffset).toBe(5);
    expect(engine.selection.isCollapsed).toBe(true);
  });

  it('follows a caret move across blocks (anchor block + offset)', async () => {
    const { engine, a, b, ta, tb } = await makeEditor();
    caret(ta, 2);
    engine.selection.sync();
    expect(engine.selection.anchorBlock).toBe(a);

    caret(tb, 4); // moved; selectionchange still pending
    expect(engine.selection.anchorBlock).toBe(a); // stale
    engine.selection.sync();
    expect(engine.selection.anchorBlock).toBe(b);
    expect(engine.selection.anchorOffset).toBe(4);
    expect(engine.selection.focusBlock).toBe(b);
  });

  it('follows a collapsed -> range extension in the same node', async () => {
    const { engine, a, ta } = await makeEditor();
    caret(ta, 5);
    engine.selection.sync();
    window.getSelection().setBaseAndExtent(ta, 5, ta, 8); // shift+arrow x3
    expect(engine.selection.isCollapsed).toBe(true); // stale
    expect(engine.selection.sync()).toBe(true);
    expect(engine.selection.isCollapsed).toBe(false);
    // (anchor/focus offsets are not asserted: happy-dom's Selection reports them unreliably for ranges)
    expect(engine.selection.startOffset).toBe(5);
    expect(engine.selection.endOffset).toBe(8);
    expect(engine.selection.startBlock).toBe(a);
  });

  it('is idempotent: no state update when nothing moved', async () => {
    const { engine, ta } = await makeEditor();
    caret(ta, 3);
    expect(engine.selection.sync()).toBe(true);
    const range = engine.selection.range;
    expect(engine.selection.sync()).toBe(false);
    expect(engine.selection.sync()).toBe(false);
    expect(engine.selection.range).toBe(range);
  });

  it('reflects a cleared DOM selection', async () => {
    const { engine, ta } = await makeEditor();
    caret(ta, 1);
    engine.selection.sync();
    window.getSelection().removeAllRanges();
    expect(engine.selection.sync()).toBe(true);
    expect(engine.selection.anchorNode).toBeNull();
    expect(engine.selection.sync()).toBe(false);
  });

  it('does not touch stored marks (they are cleared by key/mouse listeners, not by state changes)', async () => {
    const { engine, ta } = await makeEditor();
    caret(ta, 3);
    engine.selection.sync();
    engine.storedMarks = { bold: true };
    caret(ta, 3); // same position re-set: nothing to do
    engine.selection.sync();
    expect(engine.storedMarks).toEqual({ bold: true });
    caret(ta, 4); // a programmatic move syncs without clearing them
    engine.selection.sync();
    expect(engine.storedMarks).toEqual({ bold: true });
  });

  it('every input entry point syncs first', async () => {
    const { engine } = await makeEditor();
    const spy = vi.spyOn(engine.selection, 'sync');
    const ev = (extra = {}) => ({ preventDefault() {}, inputType: 'insertText', key: 'a', clipboardData: { setData() {}, getData: () => '' }, ...extra });
    engine.handleBeforeinput(ev());
    engine.handleKeydown(ev());
    engine.handleCompositionStart(ev());
    engine.handleCopy(ev());
    engine.handleCut(ev());
    engine.handlePaste(ev());
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(6);
    for (const h of ['handleBeforeinput', 'handleKeydown', 'handleCompositionStart', 'handleCopy', 'handleCut', 'handlePaste']) {
      spy.mockClear();
      engine[h](ev());
      expect(spy, h).toHaveBeenCalled();
    }
  });
});
