---
title: Language and input methods
description: How Nabu handles IME composition (dead keys, Japanese, Chinese, Korean), what is tested and what is not, and the options for language, spellcheck, typography and the dialogue dash.
section: guides
order: 80
---

# Language and input methods

Nabu is built on a native `contenteditable` partly so that people can write in their own language the way they write everywhere else: the system's keyboard, dead keys, an input method editor (IME) for Chinese, Japanese or Korean, the browser's spellchecker. This page says what the editor does about them, what has been verified, and which options matter for a given language.

## Composition

Some input methods build a character in several steps: a dead key (`´` then `e` gives `é`), a Japanese romaji run that turns into kana and then into kanji, Korean jamo that assemble into a syllable. While the user is **composing**, the browser owns the text it is building and the editor must not touch it. Nabu's rule:

1. At `compositionstart` the editor records where the composition is (as a Loro cursor, so it follows other edits) and lets the browser mutate the DOM freely. `engine.composing` is `true`, `engine.composingBlock` is the block, and the block's placeholder is hidden.
2. At `compositionend` the committed text is written to the document in one change.
3. If the composition **replaced a selection** (several blocks included), the deletion and the composed text are **one undo step**. A cancelled composition is not an undo step and inserts nothing.

What follows from that, and is covered by tests:

- **Markdown shortcuts and typography do not fire inside a composition.** A composed `# ` does not turn the paragraph into a heading, a composed `- ` does not start a list, and `--` stays as typed. The same shortcut typed **after** the composition works normally.
- **Enter and Backspace belong to the IME while it composes.** An Enter swallowed by the IME commits the composition and does not split the block; a Backspace edits the composition and does not delete the committed text before it. Escape cancels and restores the text.
- **Other edits do not break it.** A block inserted elsewhere, text of another block edited by your code, a change imported with `engine.importRemote()` or arriving through multi-tab sync during a composition: they are applied (or held until it ends), and the composed text lands at the right place.
- **Marks and structure are kept.** Composed text inside bold text is bold, inside a link is part of the link; compositions work in headings, list items, toggle headers, code blocks and region titles, at the start, the middle and the end of a block, and in an empty block.

## What is tested

The composition behaviour is covered by a browser test suite that drives **real IME events through the Chrome DevTools Protocol** (`Input.imeSetComposition` and `Input.insertText`), in Chromium:

| Input | Scenarios |
|---|---|
| Dead keys | Acute and circumflex, at the end and in the middle of a text; a dead key followed by a letter that does not combine commits both characters |
| Japanese | `k` to `か` to `かん` to `漢`, committing `漢字` |
| Chinese | Pinyin `ni hao` to `你好` (spaces in the composition) |
| Korean | Hangul syllable building (`ㅎ` to `하` to `한`), the next syllable committing the previous one, a syllable followed by a space |
| Positions | Start, middle, end of a paragraph; bold, link, heading, list item, toggle header, code block, region title; an empty paragraph |
| Selections | A selection inside one block, at the start of a block, over several blocks (one undo step) |
| Keys | Enter, Backspace and Escape during a composition; undo and redo around a composition |
| Concurrency | Programmatic edits, `importRemote` and multi-tab sync during a composition |

This is a simulation, and its limits are the limits of the guarantee:

- It is **not a real operating-system IME**: no candidate window, no reconversion.
- **Firefox and Safari** are not covered. They fire the composition events in a different order than Chromium.
- **Mobile virtual keyboards** (Gboard, the iOS keyboard) are not covered. They send a different sequence of events, and the browsers' spelling-correction "replace the word" compositions are a separate case. The macOS press-and-hold accent popup is not covered either.

Cross-browser and mobile support is a planned workstream of its own, not a current promise. If you ship to those platforms, test the languages your users write in.

## The `lang` option

`lang` is a BCP 47 language tag (`'fr'`, `'en-GB'`, `'zh-Hant-TW'`, `'es-419'`). It is set on the editor root as the `lang` attribute, so the **spellchecker, hyphenation and screen readers** use it, whatever the language of your page. Unset, the editor inherits the page's language. An invalid tag is ignored (with a warning when `engine.debugging` is on). It is reactive: assign `engine.lang` to change it, for example when a user switches the language of a document.

## The `spellcheck` option

The browser's spellchecker is on by default. `spellcheck: false` turns it off and also adds the opt-out hints of the Grammarly extension (`data-gramm="false"` and its siblings), so that it does not inject its own DOM into the editor, which Nabu does not support. Code blocks are never spellchecked, whatever this says. Reactive: `engine.spellcheck`.

```js test
import { createDocumentEditor, createFullEditor } from '@aionbuilders/nabu';

// A French document, with the browser's spellchecker.
const engine = createDocumentEditor({ lang: 'fr' });
expect(engine.lang).toBe('fr');
expect(engine.spellcheck).toBe(true);

// Both are reactive.
engine.lang = 'en-GB';
engine.spellcheck = false;
expect(engine.lang).toBe('en-GB');
expect(engine.spellcheck).toBe(false);

// A tag that is not BCP 47 is ignored: the previous value stays.
engine.lang = 'not a tag';
expect(engine.lang).toBe('en-GB');

// Unset: the page's language applies.
expect(createFullEditor().lang).toBeUndefined();
```

`lang` only describes the editor as a whole. A document that mixes languages (a quote in Latin in a French novel) has no per-span language yet: see the gaps.

## Typography per language

`TypographyExtension` has **no options**. It does one thing: typing `-- ` (two hyphens and a space, not preceded by another hyphen) becomes `— ` (an em dash). It does not turn straight quotes into curly ones, does not insert non-breaking spaces and knows nothing about languages. Those typographic conventions (guillemets and the narrow space before `;`, `:`, `!`, `?` in French, the quotation marks of German or Japanese) are yours to add.

You add them with an [input rule](./extensions.md#input-rules-markdown-shortcuts): a function called when a character is typed, with the text before the caret. This one puts a non-breaking space before a `?`, `!`, `;` or `:` in French:

```js test
import { createTextEditor } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

const NBSP = ' ';

const FrenchPunctuation = extension('french-punctuation', {
  inputRules: [
    {
      // The text before the caret ends with a word character or a closing quote...
      pattern: /[\p{L}\p{N}»”)]$/u,
      handler(nabu, block, match, sel) {
        // ...and the key typed is one of the "high" punctuation marks.
        if (!['?', '!', ';', ':'].includes(sel.data)) return;
        block.behaviors.get('text').insert(sel.from, NBSP + sel.data);
        return true; // handled: the engine does not insert the character itself
      }
    }
  ]
});

const engine = createTextEditor({ lang: 'fr', extensions: [FrenchPunctuation] });
engine.insert('paragraph', { text: 'Vraiment' });
await engine.commit();
const block = engine.children.at(-1);

// The editor calls the handler while the user types; here we do it by hand.
const [rule] = FrenchPunctuation.inputRules;
const typed = { from: 8, to: 8, isCollapsed: true, data: '?' };
expect(rule.handler(engine, block, 'Vraiment'.match(rule.pattern), typed)).toBe(true);
await engine.commit();

expect(block.text).toBe(`Vraiment${NBSP}?`);
```

Because input rules do not run inside an IME composition (above), this does not interfere with languages that compose, and a composed `?` is left as typed.

## The dialogue dash

The dialogue block (`FullPreset`) shows a marker in front of each line. Its **display** is a choice that varies by language and publisher: an en dash (`–`, the default), an em dash (`—`) in French, quotation marks elsewhere. It is purely visual:

- the **markdown** of a dialogue line is always `-- text`, whatever the dash on screen, so an exchange format does not depend on a visual preference;
- a line starting with `–` or `—` in pasted text is a plain paragraph, not a dialogue; `-- ` is.

Choose the dash with `createDialogueExtension({ dash })`, replacing the default instance of the preset:

```js test
import { createEditor, FullPreset, createDialogueExtension } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: FullPreset.filter((extension) => extension.name !== 'dialogue'),
  extensions: [createDialogueExtension({ dash: '—' })]
});

await engine.importMarkdown('-- Bonjour.\n\n-- Bonjour à vous.');

expect(engine.children.map((block) => block.type)).toEqual(['dialogue', 'dialogue']);
expect(engine.children[0].dash).toBe('—');           // what is drawn
expect(engine.serialize('markdown')).toContain('-- Bonjour.'); // what is written
```

Or in CSS, which wins over the option and needs no code: `--nb-dialogue-dash: '—'` on the editor or an ancestor, as a CSS string (see [Theming](./theming.md#layout-variables)).

Typing `-- ` at the start of an empty paragraph makes a dialogue line when `DialogueExtension` is loaded (and Backspace at its start turns it back into a paragraph); elsewhere the typography rule makes it an em dash.

## Gaps

- No per-span language: `lang` applies to the whole editor, so a foreign-language quote is spellchecked with the document's language and pronounced by the screen reader with it.
- `TypographyExtension` has no options and no language packs: smart quotes and the typographic spaces of a language are for you to write as input rules, as above.
- Firefox, Safari and mobile virtual keyboards: not covered by the IME tests (see above).
- The Atelier and base themes are language-neutral; font choices for non-Latin scripts are the host's (see [Theming, Fonts](./theming.md#fonts)).
