/**
 * The seeds of the architecture widgets: Nabu JSON exports (`importJSON`), English, all from the same little story so that the seven
 * chapters read as one. Plain data, no import: the widgets run `importJSON({ version, blocks })` once, then clear the undo history.
 */

export const FERRYMAN = 'The ferryman waited under the eaves, an unlit lantern in his hand.';
export const BANK = 'Across the river, the bank was already dark.';
export const NOON = 'Nobody had crossed since noon.';

/** Chapter 01: three plain blocks and a list, to count what is inside the single root. */
export const SEED_ROOT = [
  { type: 'paragraph', content: FERRYMAN },
  { type: 'paragraph', content: BANK },
  { type: 'paragraph', content: NOON },
  {
    type: 'list',
    props: { listType: 'bullet' },
    children: [
      { type: 'list-item', content: 'A list item is a block too.' },
      { type: 'list-item', content: 'So is the one after it.' },
    ],
  },
];

/** Chapters 02 and 03: three paragraphs. */
export const SEED_STORY = [
  { type: 'paragraph', content: FERRYMAN },
  { type: 'paragraph', content: BANK },
  { type: 'paragraph', content: NOON },
];

/** Chapter 04: a mark in the middle of a paragraph (three text nodes in the DOM, one string in the model), and a second paragraph. */
export const SEED_CARET = [
  { type: 'paragraph', content: [{ text: 'Across the river, ' }, { text: 'the bank', bold: true }, { text: ' was already dark.' }] },
  { type: 'paragraph', content: FERRYMAN },
  { type: 'paragraph', content: NOON },
];

/** Chapter 05: a paragraph and a to-do item inside a region, so that Mod-Enter means two different commands. */
export const SEED_COMMANDS = [
  {
    type: 'region',
    props: { regionType: 'section-2', title: 'The ferryman' },
    children: [
      { type: 'paragraph', content: FERRYMAN },
      {
        type: 'list',
        props: { listType: 'todo' },
        children: [
          { type: 'list-item', content: 'Light the lantern', props: { checked: false } },
          { type: 'list-item', content: 'Cross at dusk', props: { checked: false } },
        ],
      },
    ],
  },
];

/** Chapter 06: two paragraphs. This one is stored in IndexedDB, so a reload and a second tab have something to show. */
export const SEED_SAVED = [
  { type: 'paragraph', content: 'Type here, then reload the page, or open it in a second tab.' },
  { type: 'paragraph', content: NOON },
];

/** Chapter 07: a region holding a sub-region, with text after it (so that the end marker shows). */
export const SEED_REGIONS = [
  {
    type: 'region',
    props: { regionType: 'section-2', title: 'The ferryman' },
    children: [
      { type: 'paragraph', content: FERRYMAN },
      {
        type: 'region',
        props: { regionType: 'section-3', title: 'The bank' },
        children: [{ type: 'paragraph', content: BANK }],
      },
      { type: 'paragraph', content: NOON },
    ],
  },
];
