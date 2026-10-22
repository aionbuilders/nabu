/**
 * Test-only commands for the confirmation strategies (ADR 017 lot 2), installed by `/e2e?commands=demo`. This file lives in
 * the e2e route (dev / `build:e2e` only): it is never part of the library.
 *
 * Every run is recorded in `window.__demoLog` (`'hold'`, `'invite'`, `'tie-a'`, `'tie-b'`, `'variant:x'`).
 * `window.__demoHold = false` makes the hold command unavailable (its `when` turns false) to simulate a key held into a context.
 */

import { Extension } from '$lib/utils/extensions.js';

/** @param {string} entry */
const log = (entry) => {
  const w = /** @type {any} */ (window);
  (w.__demoLog ??= []).push(entry);
};

/** Caret collapsed at the very start of a paragraph. @param {import('$lib/utils/commands.js').CommandContext} ctx */
const atParagraphStart = (ctx) => {
  const sel = ctx.block?.behaviors?.get('text')?.selection;
  return ctx.isCollapsed && ctx.block?.type === 'paragraph' && sel?.from === 0;
};

export const DemoConfirmExtension = new Extension('demo-confirm', {
  commands: {
    'demo:hold': {
      label: 'Run the demo hold',
      keys: ['Mod-Shift-Backspace'],
      when: (ctx) => atParagraphStart(ctx) && /** @type {any} */ (window).__demoHold !== false,
      confirm: { strategy: 'hold', target: (ctx) => ctx.block },
      run: () => log('hold'),
    },
    'demo:invite': {
      label: 'Run the demo invite',
      keys: ['Mod-Alt-k'],
      when: (ctx) => ctx.block?.type === 'paragraph',
      confirm: { strategy: 'invite' },
      run: () => log('invite'),
    },
    'demo:tie-a': { label: 'Tie A', keys: ['Mod-Alt-u'], run: () => log('tie-a') },
    'demo:tie-b': { label: 'Tie B', keys: ['Mod-Alt-u'], run: () => log('tie-b') },
    'demo:variants': {
      label: 'Demo variants',
      keys: ['Mod-Alt-v'],
      confirm: {
        strategy: 'choose',
        options: () => [{ id: 'x', label: 'Variant X' }, { id: 'y', label: 'Variant Y', display: 'Y' }],
      },
      run: (_nabu, _ctx, option) => log(`variant:${option?.id}`),
    },
  },
});
