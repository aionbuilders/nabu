// @ts-nocheck — mocks intentionally implement only the surface the hooks use
/**
 * Typing into an editor without a browser: the way the engine reads a typed shortcut. Shared by the guards of the Blocks reference
 * (blocks-reference.test.js) and of the Tour of the blocks (tour-page.test.js), which both make claims about what a keystroke does.
 */
import { vi } from 'vitest';
import { createFullEditor } from '#lib/index.js';

export const flush = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 20)); };

/** Puts the (stubbed) caret in `block` at `from`: the text block's `selection` reads it. */
export function setCaret(engine, block, from, to = from) {
  const read = () => ({ from, to, isCollapsed: from === to, direction: 'none' });
  Object.defineProperty(block, 'selection', { configurable: true, get: read });
  const behavior = block.behaviors?.get('text');
  if (behavior) Object.defineProperty(behavior, 'selection', { configurable: true, get: read });
  const setCursor = engine.selection?.setCursor ?? vi.fn();
  engine.selection = { anchorBlock: block, focusBlock: block, startBlock: block, endBlock: block, blocks: new Set([block]), isCollapsed: from === to, sync: vi.fn(), normalize: vi.fn(), setCursor };
}

/** A block as the outline of its JSON export: type, props, children. */
export const outline = (b) => ({ type: b.type, ...(b.props ? { props: b.props } : {}), ...(b.children?.length ? { children: b.children.map(outline) } : {}) });

/**
 * Types `prefix` into an empty paragraph, then the trigger (a Space, or an Enter), the way the engine does it: the `onBeforeInput`
 * hooks of the extensions, in order, until one takes the event. Returns the document that results.
 */
export async function typeBlockShortcut(prefix, trigger = 'space') {
  const engine = createFullEditor();
  await engine.commit();
  const block = engine.children[0];
  block.insert(0, prefix);
  await engine.commit();
  setCaret(engine, block, prefix.length);
  engine.undoManager.clear();
  const event = trigger === 'enter'
    ? { inputType: 'insertParagraph', data: null, preventDefault: vi.fn() }
    : { inputType: 'insertText', data: ' ', preventDefault: vi.fn() };
  let took = false;
  for (const hook of engine.hooks.get('onBeforeInput')) {
    if (hook(engine, event, block) === engine.BREAK) { took = true; break; }
  }
  await flush();
  return { engine, took, blocks: engine.serialize('json').blocks.map(outline) };
}

/**
 * Types `typed` (already in `md`'s first text block, at its end), then the character `data`, through the text behavior and the input
 * rules of the editor (typography, markdown shortcuts). Returns the delta that results.
 */
export async function typeInline(md, typed, data, { engine = createFullEditor() } = {}) {
  await engine.importMarkdown(md);
  const top = engine.children[0];
  const block = top.type === 'list' ? top.children[0] : top;
  const behavior = block.behaviors.get('text');
  block.insert(behavior.text.length, typed);
  await engine.commit();
  const from = behavior.text.length;
  const selection = { from, to: from, isCollapsed: true };
  Object.defineProperty(behavior, 'selection', { configurable: true, get: () => selection });
  behavior.handleBeforeInput({ inputType: 'insertText', data, preventDefault: vi.fn(), getTargetRanges: () => [] }, selection);
  await flush();
  return { delta: behavior.container.toDelta(), text: behavior.text };
}

export const marksOf = (delta) => delta.filter((run) => run.attributes).map((run) => ({ text: run.insert, marks: Object.keys(run.attributes).sort() }));
