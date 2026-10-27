/**
 * The words and the lists of the Architecture section that are not read from a file: the landing page ("Should you switch?", the entry
 * cards), the fallback list of the seven chapters (shown, not linked, while a chapter file does not exist) and the short names of the
 * records for the timeline. Wording follows the design boards (ArchHome, ArchRecords).
 */
import { REPO_URL } from '../docs/content.js';

export const ARCH_TITLE = 'How Nabu works, and why it works that way.';
export const ARCH_LEAD =
  'Seven short chapters, written by the people who made the choices — including the ones we got wrong. Read them in order in about twenty minutes, or jump to what worries you.';
export const ARCH_DESCRIPTION =
  'How Nabu works and why: seven short chapters on the single contenteditable, the Loro model, the life of a keystroke, the selection, commands, persistence and regions, with the limits and every decision record.';

/** "Should you switch?": a `yes` is a fit today, a `wait` is a reason to wait. */
export const SWITCH = {
  title: 'Should you switch?',
  items: [
    { verdict: 'yes', text: 'A Svelte 5 app that wants an editor written *in* Svelte, not wrapped around it' },
    { verdict: 'yes', text: 'Documents that must survive crashes, tabs and offline, without a server' },
    { verdict: 'yes', text: 'Long-form writing: chapters, regions, word counts' },
    { verdict: 'wait', text: 'You need real-time multi-user collaboration over a network today' },
    { verdict: 'wait', text: 'You need tables, or mobile keyboards polished to production level' },
    { verdict: 'wait', text: 'You cannot ship a beta' },
  ],
  more: { label: 'The full honest answer', href: '/architecture/limits' },
};

/**
 * The seven chapters. A chapter file (`docs/architecture/chapters/NN-slug.md`, frontmatter `chapter: N`) overrides its entry here; an
 * entry without a file is shown with this title, not linked.
 */
export const CHAPTERS_FALLBACK = [
  { n: 1, title: 'One contenteditable', description: 'Why the whole document is one editable surface, and what that costs us.', adrs: [1, 3] },
  { n: 2, title: 'The model is the truth', description: 'A Loro tree holds the document. Blocks are Svelte classes over it. The DOM only reflects.', adrs: [2, 4, 10] },
  { n: 3, title: 'The life of a keystroke', description: 'From your key to the paint: every step, timed live.', adrs: [7, 8] },
  { n: 4, title: 'Where is the caret?', description: 'Mapping a browser selection to the model and back, and why undo puts it back.', adrs: [6, 15] },
  { n: 5, title: 'Commands, not keycodes', description: 'One action bus, a keymap you can rebind, confirmations that never trap you.', adrs: [11, 17] },
  { n: 6, title: 'Nothing gets lost', description: 'Saving, merging tabs, offline, files outside the document.', adrs: [10, 14] },
  { n: 7, title: 'We got regions wrong once', description: 'Markers, then boxes. The story of a decision we reversed.', adrs: [16, 18] },
];

/** The two entry cards under the chapters. `blurb` of the records gets its counts from the records themselves. */
export const ENTRY_CARDS = {
  limits: {
    eyebrow: 'The limits',
    title: "What Nabu doesn't do well (yet)",
    blurb: 'Mobile keyboards, Firefox and Safari, typing in huge documents, tables. What we know, the numbers, and what we plan.',
    href: '/architecture/limits',
  },
  records: {
    eyebrow: 'The record',
    title: 'Decision records',
    blurb: 'Every architectural decision, as it was taken: context, decision, consequences, status.',
    href: '/architecture/decisions',
  },
};

/** Where the section is reached from, and the pages of it that are not chapters (the rail of a chapter). */
export const STORY_LINKS = [
  { label: 'The limits', href: '/architecture/limits' },
  { label: 'Decision records', href: '/architecture/decisions' },
];

/** The short name of a record in the timeline (the title of an ADR is a sentence). A record missing here shows its own title. */
export const ADR_SHORT = /** @type {Record<number, string>} */ ({
  1: 'A single contenteditable',
  2: 'State in Svelte 5 classes',
  3: 'Flat map, recursive rendering',
  4: 'Rich text in LoroText',
  5: 'Strict JSDoc typing',
  6: 'Selection bridge',
  7: 'Event ascension',
  8: 'The beforeinput spine',
  9: 'Toggling marks',
  10: 'Persistence',
  11: 'Action bus',
  13: 'Pluggable code highlighting',
  14: 'Files outside the document',
  15: 'Undo restores the selection',
  16: 'Regions as markers',
  17: 'Commands, keymap, confirmations',
  18: 'Regions as containers',
});

/**
 * What a superseded record says about itself in the note above it, when the one-line status is not enough (the default is "It was replaced
 * by ADR NNN."). The record itself is never edited: it stays as it was written.
 */
export const ADR_NOTES = /** @type {Record<number, string>} */ ({
  16: 'Its data model was replaced: regions are now containers in the document tree, with seams only on screen.',
});

/** ADR 012 does not exist: said once, in the timeline. */
export const MISSING_ADR = {
  number: 12,
  text: 'ADR 012 (copy and paste) was never written; its design note is',
  noteLabel: 'docs/design/copy-paste.md',
  notePath: 'docs/design/copy-paste.md',
};

export const GITHUB_ISSUES_URL = `${REPO_URL}/issues/new`;
