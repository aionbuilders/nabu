// @ts-nocheck
/**
 * Unit tests for IME composition handling (issue #6 / TÂCHE 12).
 * During composition the browser owns the DOM; at compositionend the
 * composed text is synced into Loro.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension] });
  await engine.commit();
  const block = engine.children[0];
  // Composition handlers read the anchor block from the selection; in unit
  // tests there is no DOM selection, so stub the minimal surface used.
  engine.selection = { anchorBlock: block, focusBlock: block, sync: vi.fn(), setCursor: vi.fn() };
  return { engine, block };
}

describe('IME composition', () => {
  it('does not preventDefault insertCompositionText during composition', async () => {
    const { engine } = await makeEditor();
    engine.handleCompositionStart({});
    const e = { inputType: 'insertCompositionText', preventDefault: vi.fn() };
    engine.handleBeforeinput(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('prevents native mutations again after composition ends', async () => {
    const { engine } = await makeEditor();
    engine.handleCompositionStart({});
    engine.handleCompositionEnd({ data: '' });
    const e = { inputType: 'insertCompositionText', preventDefault: vi.fn() };
    engine.handleBeforeinput(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('syncs the composed text into Loro at compositionend', async () => {
    const { engine, block } = await makeEditor();
    engine.handleCompositionStart({});
    engine.handleCompositionEnd({ data: 'にほんご' });
    await engine.commit();
    expect(block.text).toBe('にほんご');
  });

  it('inserts at the captured start offset', async () => {
    const { engine, block } = await makeEditor();
    block.insert(0, 'ab');
    await engine.commit();
    // Pretend the cursor was between 'a' and 'b' at compositionstart
    block.behaviors.get('text').selection = null; // DOM-less: falls back to 0
    engine.handleCompositionStart({});
    engine.handleCompositionEnd({ data: 'X' });
    await engine.commit();
    expect(block.text).toBe('Xab');
  });

  it('does nothing when the composition is canceled (empty data)', async () => {
    const { engine, block } = await makeEditor();
    block.insert(0, 'abc');
    await engine.commit();
    engine.handleCompositionStart({});
    engine.handleCompositionEnd({ data: '' });
    await engine.commit();
    expect(block.text).toBe('abc');
  });

  it('does nothing when the block was destroyed during composition', async () => {
    const { engine, block } = await makeEditor();
    engine.handleCompositionStart({});
    engine.tree.delete(block.node.id);
    await engine.commit();
    expect(() => engine.handleCompositionEnd({ data: 'X' })).not.toThrow();
  });
});
