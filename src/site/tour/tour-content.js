/**
 * What the code of the extensions cannot say, for the "Tour of the blocks": the story, and for each block its group, its one sentence, the example
 * (Markdown, or JSON for the blocks Markdown cannot make), the shortcuts the reader TYPES, and the facts of the card (what a block contains, the
 * keys it owns). Everything the code CAN say (the registered name, the slash menu, the actions, the keys of the commands, the presets, the API
 * export) is read from `FullPreset` by `tour-data.js`.
 *
 * These are claims, and tests/unit/tour-page.test.js holds them to the editor and to the Blocks reference (docs/guides/blocks-reference.md):
 *  - a typed shortcut (`type`) is typed into a paragraph and must make the block it says (the same method as the reference's test);
 *  - a Markdown chip (`md`) must be in the Markdown the example writes, an HTML chip (`html`) in the HTML it writes;
 *  - a key (`keys`) and a prop (backticks in `contains`) must be named by the reference, in the section of the block;
 *  - an example imports to the block types of its card, and every extension of `FullPreset` has its card or its section.
 * Plain English, short sentences. Backticks in a string make inline code.
 *
 * @typedef {{ typed: string, then: 'space' | 'enter', makes: Array<{ type: string, props?: Record<string, any>, children?: any[] }> | { chooser: string } }} Attempt
 * @typedef {{ label: string, tries: Attempt[] }} TypedChip A shortcut as the card shows it; `tries` are the ones it stands for.
 * @typedef {{ label: string, has: string }} Proof A chip, and the text the example must write for it to be true.
 * @typedef {{ keys: string[], does: string }} KeyFact
 * @typedef {{ md?: string, json?: any[] }} Example Markdown (`[[video url | name | alt]]` and `[[file url | name]]` stand for the two blocks Markdown cannot make), or the JSON of the blocks.
 * @typedef {{
 *   id: string,
 *   names: string[],
 *   title: string,
 *   groups: Array<'text' | 'containers' | 'structure' | 'media'>,
 *   sentence: string,
 *   about: string,
 *   example: Example,
 *   type: TypedChip[],
 *   md: Proof[],
 *   html: Proof[],
 *   files?: string[],
 *   slashQueries?: Record<string, string>,
 *   contains: string,
 *   keys: KeyFact[],
 *   keysNote?: string,
 *   wallKey?: boolean,
 * }} CardContent
 */

/** The story of the top of the page: every block that can be drawn read-only, in one document. */
export const STORY = {
  label: 'A short story, written with every block',
  md: [
    '<!-- region:section-1 {} -->',
    '# The river',
    '',
    '### The last ferry',
    '',
    'The **ferryman** waited under the eaves, an *unlit* lantern in his hand. Nobody had crossed since noon.',
    '',
    '> The river keeps no appointments, only debts.',
    '',
    '-- Are you crossing?',
    '-- If you are rowing.',
    '',
    '- [ ] the rope',
    '- [x] the oar',
    '',
    '> [!NOTE]',
    '> The river rises at night.',
    '',
    '<details>',
    '<summary>What the ferryman knew</summary>',
    '',
    'The ford is upstream.',
    '',
    '</details>',
    '',
    '---',
    '',
    '```js',
    'const lantern = { lit: false };',
    '```',
    '',
    '![The quay at dusk: a lantern on its post, a boat on the river](/tour/quay-at-dusk.svg)',
    '',
    '[[video /tour/river-at-dusk.mp4 | river-at-dusk.mp4 | The river at dusk]]',
    '',
    '[[file /tour/crossing-ledger.pdf | crossing-ledger.pdf]]',
    '',
    'Dusk fell on the quay.',
  ].join('\n'),
};

/** @type {CardContent[]} The twelve cards of the wall, in the order of the wall. Together they hold the 14 blocks of `FullPreset`. */
export const CARDS = [
  {
    id: 'paragraph',
    names: ['paragraph'],
    title: 'Paragraph',
    groups: ['text'],
    sentence: 'Plain text: the block Nabu makes for a line.',
    about: 'The plain block: a run of text. It is the default block, the one Nabu creates whenever it needs an empty line of its own.',
    example: { md: 'The **ferryman** waited under the eaves.' },
    type: [],
    md: [],
    html: [{ label: '<p>', has: '<p>' }],
    slashQueries: { Text: 'text' },
    contains: 'Text, with marks. No children, no props.',
    keys: [
      { keys: ['Enter'], does: 'splits the block at the caret' },
      { keys: ['Backspace'], does: 'at the start joins it to the block above' },
    ],
  },
  {
    id: 'heading',
    names: ['heading'],
    title: 'Heading',
    groups: ['text'],
    sentence: 'A title, levels 1 to 6.',
    about: 'A title, from level 1 to level 6. Every story needs a chapter.',
    example: { md: '#### The last ferry' },
    type: [{
      label: '# … ######',
      tries: [
        { typed: '#', then: 'space', makes: [{ type: 'heading', props: { level: 1 } }] },
        { typed: '###', then: 'space', makes: [{ type: 'heading', props: { level: 3 } }] },
        { typed: '######', then: 'space', makes: [{ type: 'heading', props: { level: 6 } }] },
      ],
    }],
    md: [{ label: '# text', has: '#### ' }],
    html: [{ label: '<h1> … <h6>', has: '<h4>' }],
    contains: 'Text, with marks. One prop: `level`, from 1 to 6.',
    keys: [
      { keys: ['Enter'], does: 'at the end starts a paragraph below; in the middle it cuts the heading in two' },
      { keys: ['Backspace'], does: 'at the start turns the heading into a paragraph' },
    ],
  },
  {
    id: 'blockquote',
    names: ['blockquote'],
    title: 'Blockquote',
    groups: ['text'],
    sentence: 'A line someone else said.',
    about: 'A line someone else said, set apart by a bar in the margin. A quote is a text block: it holds text and marks, never other blocks.',
    example: { md: '> The river keeps no appointments.' },
    type: [{ label: '> ␣', tries: [{ typed: '>', then: 'space', makes: [{ type: 'blockquote' }] }] }],
    md: [{ label: '> text', has: '> ' }],
    html: [{ label: '<blockquote>', has: '<blockquote>' }],
    contains: 'Text, with marks. It cannot hold other blocks.',
    keys: [
      { keys: ['Enter'], does: 'ends the quote: the text after the caret moves to a paragraph below' },
      { keys: ['Backspace'], does: 'at the start turns the quote back into a paragraph' },
    ],
  },
  {
    id: 'code',
    names: ['code'],
    title: 'Code',
    groups: ['text'],
    sentence: 'Verbatim text, with a language.',
    about: 'Verbatim text in a monospace box, with a language. No marks, no shortcuts, no typography: what you type is what is kept.',
    example: { md: '```js\nconst lantern = { lit: false };\n```' },
    type: [{
      label: '```js ↵',
      tries: [
        { typed: '```', then: 'enter', makes: [{ type: 'code', props: { language: null } }] },
        { typed: '```js', then: 'enter', makes: [{ type: 'code', props: { language: 'js' } }] },
      ],
    }, {
      label: '```js ␣',
      tries: [
        { typed: '```', then: 'space', makes: [{ type: 'code', props: { language: null } }] },
        { typed: '```js', then: 'space', makes: [{ type: 'code', props: { language: 'js' } }] },
      ],
    }],
    md: [{ label: '```js', has: '```js' }],
    html: [{ label: '<pre><code>', has: '<pre><code' }],
    contains: 'Text, verbatim: no marks. One prop: `language`, a string or `null`.',
    keys: [
      { keys: ['Enter'], does: 'inserts a new line instead of a new block' },
      { keys: ['Tab'], does: 'inserts two spaces' },
      { keys: ['Backspace'], does: 'at the start turns the block into a paragraph' },
    ],
  },
  {
    id: 'callout',
    names: ['callout'],
    title: 'Callout',
    groups: ['text'],
    sentence: 'A note set apart, with an icon and a tint.',
    about: 'A note set apart, with an icon and a tint. Five kinds, one prop: note, tip, important, warning, caution. Clicking the icon in an editor cycles through them.',
    example: { md: '> [!NOTE]\n> The river rises at night.' },
    type: [{ label: '! ␣', tries: [{ typed: '!', then: 'space', makes: [{ type: 'callout', props: { variant: 'note' } }] }] }],
    md: [{ label: '> [!NOTE]', has: '> [!NOTE]' }],
    html: [{ label: '<aside class="callout">', has: '<aside class="callout callout-note"' }],
    contains: 'Text, with marks. One prop: `variant`, one of `note`, `tip`, `important`, `warning`, `caution`.',
    keys: [
      { keys: ['Enter'], does: 'inserts a new line inside the callout' },
      { keys: ['Backspace'], does: 'on an empty callout turns it into a paragraph' },
    ],
  },
  {
    id: 'toggle',
    names: ['toggle'],
    title: 'Toggle',
    groups: ['containers'],
    sentence: 'A title that opens on what it hides.',
    about: 'A header that hides a body. The body is a little document of its own: it can hold any block, even another toggle. Reading it does not change it: opening a toggle on a read-only page is only a view.',
    example: { md: '<details open>\n<summary>What the ferryman knew</summary>\n\nThe ford is upstream.\n\n</details>' },
    type: [],
    md: [{ label: '<details>', has: '<details' }],
    html: [{ label: '<details>', has: '<details' }],
    contains: 'A header (text, with marks) and a body: any blocks, toggles too. One prop: `collapsed`.',
    keys: [
      { keys: ['Enter'], does: 'in the header cuts it at the caret' },
      { keys: ['Backspace'], does: 'at the start of the header dissolves the toggle into a paragraph: nothing is lost' },
    ],
  },
  {
    id: 'list',
    names: ['list', 'list-item'],
    title: 'List',
    groups: ['containers'],
    sentence: 'Bullets, numbers and to-dos, nested.',
    about: 'Bullets, numbers or to-dos. The list is the container; its items hold text and sublists, and in a to-do list a tick. Nested to any depth.',
    example: { md: '- [ ] the rope\n- [x] the oar' },
    type: [
      { label: '- ␣', tries: [{ typed: '-', then: 'space', makes: [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item' }] }] }] },
      { label: '1. ␣', tries: [{ typed: '1.', then: 'space', makes: [{ type: 'list', props: { listType: 'ordered' }, children: [{ type: 'list-item' }] }] }] },
      { label: '[ ] ␣', tries: [{ typed: '[ ]', then: 'space', makes: [{ type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', props: { checked: false } }] }] }] },
    ],
    md: [{ label: '- [ ] item', has: '- [ ] ' }],
    html: [{ label: '<ul> <ol> <li>', has: '<li>' }],
    contains: 'Items, nested. Props: `listType` (`bullet`, `ordered`, `todo`) and, for an ordered list, `start`. An item holds text and sublists; in a to-do list, `checked`.',
    keys: [
      { keys: ['Tab'], does: 'nests the item under the one above' },
      { keys: ['Shift-Tab'], does: 'brings it back out' },
      { keys: ['Enter'], does: 'starts a new item; on an empty item it steps back one level' },
      { keys: ['Mod-Enter'], does: 'ticks or unticks the to-dos of the selection' },
    ],
  },
  {
    id: 'dialogue',
    names: ['dialogue'],
    title: 'Dialogue',
    groups: ['text'],
    sentence: 'Lines of speech, one speaker each.',
    about: 'A line of speech, with a dash in front. For novels, plays and chats. The dash on screen is a choice of display: in the markdown it is always `-- `.',
    example: { md: '-- Are you crossing?\n-- If you are rowing.' },
    type: [{ label: '-- ␣ at line start', tries: [{ typed: '--', then: 'space', makes: [{ type: 'dialogue' }] }] }],
    md: [{ label: '-- text', has: '-- ' }],
    html: [{ label: '<p>', has: '<p>' }],
    contains: 'Text, with marks. No props.',
    keys: [
      { keys: ['Enter'], does: 'starts the next line of dialogue; on an empty line it leaves the dialogue' },
      { keys: ['Backspace'], does: 'at the start turns the line into a paragraph' },
    ],
  },
  {
    id: 'region',
    names: ['region'],
    title: 'Region',
    groups: ['containers', 'structure'],
    sentence: 'A chapter with a title, inside one continuous text.',
    about: 'A division of a long text: a part, a chapter, a scene. It has a title, a body and a number, and regions nest. The title is a field, not a heading: a text selection only touches text, never the structure.',
    example: { md: '<!-- region:section-1 {} -->\n# The river\n\nNobody had crossed since noon.' },
    type: [{ label: '::: ␣', tries: [{ typed: ':::', then: 'space', makes: { chooser: 'region:create' } }] }],
    md: [{ label: '<!-- region:section-1 {} -->', has: '<!-- region:section-1 {} -->' }],
    html: [{ label: '<section data-nabu-region>', has: '<section data-nabu-region="section-1"' }],
    contains: 'A title (a locked text field) and a body: any blocks, sub-regions included. Props: `regionType` and `fields`.',
    keys: [
      { keys: ['Mod-Enter'], does: 'cuts the region at the caret' },
      { keys: ['Mod-Shift-Enter'], does: 'leaves the region' },
      { keys: ['Tab', 'Shift-Tab'], does: 'in a title demote and promote the region' },
    ],
    wallKey: true,
  },
  {
    id: 'divider',
    names: ['divider'],
    title: 'Divider',
    groups: ['structure'],
    sentence: 'The scene changes.',
    about: 'A horizontal rule. The scene changes; the story does not stop. It holds nothing: a void block with one caret position.',
    example: { json: [{ type: 'divider' }] },
    type: [{ label: '--- ␣', tries: [{ typed: '---', then: 'space', makes: [{ type: 'divider' }, { type: 'paragraph' }] }] }],
    md: [{ label: '---', has: '---' }],
    html: [{ label: '<hr>', has: '<hr>' }],
    contains: 'Nothing: it is a void block, no text, no props.',
    keys: [
      { keys: ['Backspace'], does: 'at the start of the block under a divider deletes the divider' },
    ],
  },
  {
    id: 'image',
    names: ['image'],
    title: 'Image',
    groups: ['media'],
    sentence: 'A picture, stored outside the document.',
    about: 'A picture, as a block of its own. In an editor it comes from the picker, a paste, a drop or code; the document keeps a reference to the file, not the file.',
    example: { md: '![The quay at dusk](/tour/quay-at-dusk.svg)' },
    type: [],
    md: [{ label: '![alt](url)', has: '![' }],
    html: [{ label: '<img>', has: '<img src=' }],
    files: ['paste', 'drop'],
    contains: 'Nothing to type: a void block. Props: `ref`, `alt`, `name` and `status`.',
    keys: [],
    keysNote: 'None of its own: it holds no text.',
  },
  {
    id: 'video-file',
    names: ['video', 'file'],
    title: 'Video · File',
    groups: ['media'],
    sentence: 'A clip to play, a file to download.',
    about: 'A video is a block of its own, with the browser’s controls. Any other file is a chip you can download. Both come from the picker, a paste, a drop or code.',
    example: { md: '[[video /tour/river-at-dusk.mp4 | river-at-dusk.mp4 | The river at dusk]]\n\n[[file /tour/crossing-ledger.pdf | crossing-ledger.pdf]]' },
    type: [],
    md: [{ label: '[label](url)', has: '[' }],
    html: [{ label: '<video> <a download>', has: '<video src=' }],
    files: ['paste', 'drop'],
    contains: 'Nothing to type: void blocks. Props: `ref`, `alt`, `name` and `status` for a video; `ref`, `name` and `status` for a file.',
    keys: [],
    keysNote: 'None of their own.',
  },
];

/**
 * @typedef {{
 *   name: string,
 *   title: string,
 *   sentence: string,
 *   before: string,
 *   beforeKind: 'keys' | 'text',
 *   after: string,
 *   proof: { kind: 'type', md: string, typed: string, data: string } | { kind: 'key', command: string, chord: string } | { kind: 'paste', format: string, payload: string }
 * }} MoreContent
 */

/** @type {MoreContent[]} "What happens as you type": the text behaviours. `after` is Markdown, drawn by Nabu. */
export const TYPING = [
  {
    name: 'rich-text',
    title: 'Rich text',
    sentence: 'Bold, italic, underline, code, strike, links, with their shortcuts.',
    before: 'Mod-B on “ferryman”',
    beforeKind: 'keys',
    after: '**ferryman**',
    proof: { kind: 'key', command: 'mark:bold', chord: 'Mod-b' },
  },
  {
    name: 'markdown-shortcuts',
    title: 'Markdown shortcuts',
    sentence: 'Inline markdown turns into marks as you type.',
    before: '**ferry**',
    beforeKind: 'text',
    after: '**ferry**',
    proof: { kind: 'type', md: 'x', typed: ' **ferry*', data: '*' },
  },
  {
    name: 'typography',
    title: 'Typography',
    sentence: 'Two hyphens and a space become a dash.',
    before: 'noon -- dusk',
    beforeKind: 'text',
    after: 'noon — dusk',
    proof: { kind: 'type', md: 'x', typed: ' noon --', data: ' ' },
  },
];

/** @type {MoreContent[]} "What happens when you paste": the four readers. `payload` is what is on the clipboard, `after` the Markdown of what Nabu makes of it. */
export const PASTE = [
  {
    name: 'nabu-paste',
    title: 'Nabu paste',
    sentence: 'Between two Nabu editors, nothing is lost.',
    before: 'copy from a Nabu editor',
    beforeKind: 'text',
    after: '## The last ferry\n\n> [!NOTE]\n> The river rises at night.',
    proof: {
      kind: 'paste',
      format: 'application/x-nabu+json',
      payload: JSON.stringify({
        version: 1,
        blocks: [
          { type: 'heading', partial: false, props: { level: 2 }, delta: [{ insert: 'The last ferry' }] },
          { type: 'callout', partial: false, props: { variant: 'note' }, delta: [{ insert: 'The river rises at night.' }] },
        ],
      }),
    },
  },
  {
    name: 'html-paste',
    title: 'HTML paste',
    sentence: 'From web pages and applications.',
    before: '<h2>Dusk</h2><ul><li>the rope</li><li>the oar</li></ul>',
    beforeKind: 'text',
    after: '## Dusk\n\n- the rope\n- the oar',
    proof: { kind: 'paste', format: 'text/html', payload: '<h2>Dusk</h2><ul><li>the rope</li><li>the oar</li></ul>' },
  },
  {
    name: 'markdown-paste',
    title: 'Markdown paste',
    sentence: 'Markdown text becomes blocks.',
    before: '> [!NOTE]\n> It rises.',
    beforeKind: 'text',
    after: '> [!NOTE]\n> It rises.',
    proof: { kind: 'paste', format: 'text/plain', payload: '> [!NOTE]\n> It rises.' },
  },
  {
    name: 'plain-text-paste',
    title: 'Plain text paste',
    sentence: 'The last resort: one line, one block.',
    before: 'line one\nline two',
    beforeKind: 'text',
    after: 'line one\n\nline two',
    proof: { kind: 'paste', format: 'text/plain', payload: 'line one\nline two' },
  },
];

/** The extension that turns a block into another: not a block, not a behaviour. */
export const TRANSFORM = {
  name: 'block',
  title: 'Turn into',
  topic: 'block:transform',
  sentence: 'Turns the block holding the caret into another type, and keeps its text, its marks and its id. Slash entries and toolbar buttons are made of it. So can you:',
  call: "nabu.exec('block:transform', { type, props })",
};

/** The three extensions that act on the text of any block. */
export const TEXT_BEHAVIOURS = ['rich-text', 'typography', 'markdown-shortcuts'];
