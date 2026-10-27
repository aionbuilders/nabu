/**
 * The pure parts of the Architecture widgets: what each step of a keystroke means, which commands a chord is bound to, how a DOM point
 * and a model position are written. No Svelte, no engine import (the engine is passed in): unit tested in
 * tests/unit/site-architecture-widgets.test.js.
 */

/**
 * What a widget's panel receives once its editor is ready (see ArchEditor.svelte).
 * @typedef {{ engine: import('#lib').Nabu, lib: typeof import('#lib'), ext: typeof import('#lib/extend.js'), scope: HTMLElement }} WidgetContext
 */

/**
 * One keystroke as the Keystroke panel follows it.
 * @typedef {Object} Rec
 * @property {number} id
 * @property {number} t0           the key's event.timeStamp
 * @property {string} key
 * @property {string | null} inputType
 * @property {string | null} caret  the model position the key started from
 * @property {string | null} op     the first Loro operation of the commit
 * @property {number | null} engineMs
 * @property {number | null} paintMs
 */

// ── Chapter 03: the life of a keystroke ─────────────────────────────────────────────────────────────

/**
 * The seven steps of a keystroke, in order. `brief` is the one-line description, `detail` what "step" shows, `where` the code to read.
 * Everything here is read from the code (nothing is guessed): see the chapter for the references. `observed`: whether this page can see the
 * step happen from outside (an event, a Loro operation, a DOM change, a frame). Only two steps carry a time (`timed`).
 * @type {Array<{ id: string, name: string, brief: string, detail: string, where: string, timed: boolean }>}
 */
export const STEPS = [
  {
    id: 'keydown', name: 'keydown', timed: false,
    brief: 'the browser hands us the key',
    detail: 'A capture listener on the document syncs the model selection with the browser, then the root asks the command registry whether this key is a shortcut. A letter is not: one chord computation and one map lookup.',
    where: 'src/lib/blocks/selection.svelte.js, Nabu#handleKeydown',
  },
  {
    id: 'beforeinput', name: 'beforeinput', timed: false,
    brief: 'one listener, on the root',
    detail: 'The browser is about to change the page. Nabu syncs the selection, moves the caret off any dead position, and calls preventDefault(): the browser will not touch the DOM.',
    where: 'Nabu#handleBeforeinput',
  },
  {
    id: 'selection', name: 'selection → model', timed: false,
    brief: 'DOM offsets become a block + index',
    detail: 'The caret is a DOM node and an offset. A throwaway Range from the start of the block to that point gives the character index; the block id comes from the nearest [data-block-id].',
    where: 'TextBehavior#calculateOffset',
  },
  {
    id: 'ascend', name: 'dispatch', timed: false,
    brief: 'who handles it',
    detail: 'Extension hooks look first, then the block under the caret. A plain character is handled by the block itself. Enter asks the block to split, and the block ascends: the parent container first, then the hooks of the extensions.',
    where: 'Nabu#dispatchEventToSelection, Block#ascend',
  },
  {
    id: 'loro', name: 'Loro', timed: false,
    brief: 'the truth changes',
    detail: 'The text behavior inserts into the LoroText and commits the transaction, which is also the undo step. Loro reports the operation.',
    where: 'TextBehavior#handleInsertText, Nabu#commit',
  },
  {
    id: 'svelte', name: 'Svelte', timed: true,
    brief: 'the block\'s $state updates, the DOM is patched',
    detail: 'The text subscription updates the block\'s runes and Svelte patches the DOM. The time shown runs from the key to the first change of the editor\'s DOM ("engine work"). After the next tick the engine puts the caret back.',
    where: 'TextBehavior (container.subscribe), RichText.svelte',
  },
  {
    id: 'paint', name: 'paint', timed: true,
    brief: 'the letter is on screen',
    detail: 'The first frame painted after the DOM changed. The time shown runs from the key\'s own event.timeStamp to that frame: the number a user feels.',
    where: 'src/site/measure.js',
  },
];

/**
 * What the `beforeinput` of this `inputType` does in the dispatch step. Read from `TextBehavior#handleBeforeInput`: a plain insertion and
 * the deletions are handled by the block; Enter ascends.
 * @param {string | null | undefined} inputType
 * @returns {{ ascends: boolean, text: string }}
 */
export function describeInput(inputType) {
  switch (inputType) {
    case 'insertText':
      return { ascends: false, text: 'insertText: the block handles it. No ascension.' };
    case 'insertParagraph':
      return { ascends: true, text: 'insertParagraph: the block asks to split and ascends, parent first.' };
    case 'insertLineBreak':
    case 'insertSoftLineBreak':
      return { ascends: false, text: `${inputType}: the block inserts a line break.` };
    case 'deleteContentBackward':
    case 'deleteContentForward':
      return { ascends: false, text: `${inputType}: the block deletes, or merges at its edge.` };
    case 'deleteWordBackward':
    case 'deleteWordForward':
      return { ascends: false, text: `${inputType}: the block deletes a word.` };
    case undefined:
    case null:
    case '':
      return { ascends: false, text: 'no beforeinput seen for this key' };
    default:
      return { ascends: false, text: `${inputType}: dispatched to the block under the caret.` };
  }
}

/** A key as a short label: `n`, `Enter`, `Space`. @param {string} key */
export function keyLabel(key) {
  return key === ' ' ? 'Space' : key;
}

/** Milliseconds for a step row: `2.6 ms`; `—` when unknown. @param {number | null | undefined} ms */
export function stepMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  if (ms < 0.1) return '<0.1 ms';
  return `${ms < 100 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

// ── Chapter 04: the caret ───────────────────────────────────────────────────────────────────────────

/** The tree id counter of a block: `12@7340…` -> `12`. @param {string} id */
export const shortBlockId = (id) => String(id).split('@')[0];

/**
 * A DOM selection point in words: `#text "Across the r…" @ 12 (in div[paragraph])`.
 * @param {Node | null} node @param {number} offset
 */
export function describeDomPoint(node, offset) {
  if (!node) return '—';
  const clip = (/** @type {string} */ s, /** @type {number} */ n) => (s.length > n ? s.slice(0, n) + '…' : s);
  if (node.nodeType === 3) {
    const parent = /** @type {Element | null} */ (node.parentElement);
    const owner = parent?.closest('[data-block-type]');
    const where = parent ? (parent === owner ? `${parent.localName}` : `${parent.localName}.${[...parent.classList][0] ?? ''}`.replace(/\.$/, '')) : '';
    return `#text "${clip((node.textContent ?? '').replace(/\n/g, '↵'), 14)}" @ ${offset}${where ? ` in ${where}` : ''}`;
  }
  const el = /** @type {Element} */ (node);
  return `<${el.localName}> @ child ${offset}`;
}

/**
 * A model position in words: `paragraph#12 · index 17`.
 * @param {{ id: string, type: string } | null | undefined} block @param {number} index
 */
export function describeModelPoint(block, index) {
  if (!block) return '—';
  return `${block.type}#${shortBlockId(block.id)} · index ${index}`;
}

// ── Chapter 05: commands ────────────────────────────────────────────────────────────────────────────

/**
 * The commands (as `nabu.commands.list(ctx)` returns them) whose keys include `chord`, sorted the way the engine takes them: the ones that
 * apply here first, a command whose `scope` is the block's type before a generic one, then registration order. `winner` is the first that
 * applies; `tie` is true when the engine would ask the user to choose (the top two have the same rank).
 * This is a READING of the registry for display; the engine does the real resolution (`CommandRegistry#handleKeydown`).
 *
 * @param {Array<{ id: string, label: string, keys: string[], display: string[], scope?: string, extension: string, available: boolean }>} infos in registration order
 * @param {string} chord a chord id (`eventChordId(event)`)
 * @param {(text: string) => string | null} chordOfKey the chord id of a written key (`'Mod-Enter'`), `null` when invalid
 * @param {string | undefined} blockType the type of the block under the caret
 */
export function resolveChord(infos, chord, chordOfKey, blockType) {
  const bound = infos
    .map((info, order) => ({ info, order }))
    .filter(({ info }) => info.keys.some((k) => chordOfKey(k) === chord));
  const rank = (/** @type {{ info: { scope?: string } }} */ e) => (e.info.scope !== undefined && e.info.scope === blockType ? 1 : 0);
  const applies = bound.filter((e) => e.info.available).sort((a, b) => rank(b) - rank(a) || a.order - b.order);
  const rest = bound.filter((e) => !e.info.available).sort((a, b) => a.order - b.order);
  const ordered = [...applies, ...rest];
  const tie = applies.length > 1 && rank(applies[0]) === rank(applies[1]);
  return {
    candidates: ordered.map((e) => ({ ...e.info, rank: rank(e) })),
    winner: applies[0]?.info.id ?? null,
    tie,
  };
}
