// @ts-nocheck
/**
 * The engine lifecycle that does not need a browser: `connected` follows the root (attached / detached, in either order on a
 * swap), and `destroy()` is idempotent and reaches the systems, the persistence and the pending repair. The page listeners
 * themselves are added by effects, which do not run here: they are counted in a real browser by tests/e2e/lifecycle.spec.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';

const engineOf = () => new Nabu({ extensions: [ParagraphExtension] });
const rootEl = () => {
  const el = document.createElement('div');
  el.setAttribute('data-nabu-root', 'true');
  document.body.appendChild(el);
  return el;
};

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('NabuSelection#connected', () => {
  it('is off until a root is attached, on while it is, off after the detach, and on again for a remount', () => {
    const { selection } = engineOf();
    expect(selection.connected).toBe(false);
    const detach = selection.attachRoot(rootEl());
    expect(selection.connected).toBe(true);
    detach();
    expect(selection.connected).toBe(false);
    expect(selection.root).toBeNull();
    selection.attachRoot(rootEl());
    expect(selection.connected).toBe(true);
  });

  it('a new element attached before the old one is detached keeps the engine connected', () => {
    const { selection } = engineOf();
    const first = rootEl();
    const second = rootEl();
    const detachFirst = selection.attachRoot(first);
    const detachSecond = selection.attachRoot(second);
    detachFirst();
    expect(selection.connected).toBe(true);
    expect(selection.root).toBe(second);
    detachSecond();
    expect(selection.connected).toBe(false);
  });
});

describe('engine.destroy()', () => {
  it('is idempotent, stops every system once per call, and leaves the document readable', async () => {
    const engine = engineOf();
    for (const c of [...engine.children]) engine.delete(c);
    engine.insert('paragraph', { text: 'Kept' });
    await engine.commit();
    const stop = vi.fn();
    engine.systems.set('probe', { stop });
    const detach = engine.selection.attachRoot(rootEl());

    engine.destroy();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(engine.selection.root).toBeNull();
    expect(() => engine.destroy()).not.toThrow();
    expect(() => detach()).not.toThrow(); // the unmount that follows
    expect(engine.serialize('markdown')).toBe('Kept');
  });

  it('works on an engine that was never mounted', () => {
    expect(() => engineOf().destroy()).not.toThrow();
  });

  it('cancels a pending repair of the caret', () => {
    vi.useFakeTimers();
    try {
      const engine = engineOf();
      const repair = vi.spyOn(engine.selection, 'repairAfterRemoval');
      engine.selection.scheduleRepair();
      engine.destroy();
      vi.runAllTimers();
      expect(repair).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes the persistence of a persisted engine and the upload retries of the files', () => {
    const engine = engineOf();
    const dispose = vi.fn();
    const filesDispose = vi.spyOn(engine.systems.get('files'), 'dispose');
    engine.persistence = { dispose };
    engine.destroy();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(filesDispose).toHaveBeenCalledTimes(1);
  });

  it('calls each tracked function once, however often it is called, and returns what track was given', () => {
    const engine = engineOf();
    const a = vi.fn();
    const b = vi.fn();
    expect(engine.track(a)).toBe(a);
    engine.track(b);
    engine.destroy();
    engine.destroy();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the blocks and the document: a change after destroy() is not followed any more', async () => {
    const engine = engineOf();
    for (const c of [...engine.children]) engine.delete(c);
    const block = engine.insert('paragraph', { text: 'Before' });
    await engine.commit();
    const text = block.behaviors.get('text');
    engine.destroy();
    text.container.insert(text.container.length, ' after');
    engine.doc.commit();
    expect(text.text).toBe('Before'); // the behavior no longer follows its Loro text
  });

  it('the undo manager no longer reaches the engine after destroy()', async () => {
    const engine = engineOf();
    for (const c of [...engine.children]) engine.delete(c);
    engine.insert('paragraph', { text: 'One' });
    await engine.commit();
    engine.destroy();
    const sel = vi.spyOn(engine.selection, 'setCursor');
    expect(() => { engine.insert('paragraph', { text: 'Two' }); engine.doc.commit(); engine.undoManager.undo(); }).not.toThrow();
    expect(sel).not.toHaveBeenCalled();
  });
});
