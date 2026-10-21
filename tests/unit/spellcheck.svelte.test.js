// @ts-nocheck
/** Unit tests for the `spellcheck` / `lang` editor options: normalization, defaults and runtime changes. */
import { describe, it, expect } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { createEditor } from '$lib/presets.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { normalizeLang } from '$lib/utils/spellcheck.js';

const extensions = [ParagraphExtension];

describe('normalizeLang', () => {
  it('accepts BCP 47-like tags', () => {
    for (const tag of ['fr', 'en-GB', 'zh-Hant-TW', 'es-419', 'fil']) {
      expect(normalizeLang(tag)).toEqual({ lang: tag, valid: true });
    }
  });
  it('treats unset values as valid and empty', () => {
    for (const v of [undefined, null, '']) expect(normalizeLang(v)).toEqual({ lang: undefined, valid: true });
  });
  it('rejects invalid values', () => {
    for (const v of ['f', 'english', 'fr_FR', 'fr-', 'fr-x', 'fr GB', 12, {}, true]) {
      expect(normalizeLang(v).valid).toBe(false);
    }
  });
});

describe('Nabu spellcheck / lang options', () => {
  it('defaults: spellcheck on, no lang', () => {
    const nabu = new Nabu({ extensions });
    expect(nabu.spellcheck).toBe(true);
    expect(nabu.lang).toBeUndefined();
  });

  it('reads the init options (also through createEditor)', () => {
    const nabu = new Nabu({ extensions, spellcheck: false, lang: 'fr' });
    expect(nabu.spellcheck).toBe(false);
    expect(nabu.lang).toBe('fr');
    const viaFactory = createEditor({ spellcheck: false, lang: 'en-GB' });
    expect(viaFactory.spellcheck).toBe(false);
    expect(viaFactory.lang).toBe('en-GB');
  });

  it('ignores an invalid lang with a warning', () => {
    const nabu = new Nabu({ extensions });
    nabu.debugging = true;
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      nabu.lang = 'not a tag';
    } finally {
      console.warn = original;
    }
    expect(nabu.lang).toBeUndefined();
    expect(warnings.length).toBe(1);
    const bad = new Nabu({ extensions, lang: 'nope_nope' });
    expect(bad.lang).toBeUndefined();
  });

  it('an invalid runtime lang leaves the previous one unchanged; empty clears it', () => {
    const nabu = new Nabu({ extensions, lang: 'fr' });
    nabu.lang = '??';
    expect(nabu.lang).toBe('fr');
    nabu.lang = undefined;
    expect(nabu.lang).toBeUndefined();
  });

  it('is reactive at runtime', () => {
    const nabu = new Nabu({ extensions });
    const view = $derived([nabu.spellcheck, nabu.lang]);
    expect(view).toEqual([true, undefined]);
    nabu.spellcheck = false;
    expect(view).toEqual([false, undefined]);
    nabu.lang = 'de';
    expect(view).toEqual([false, 'de']);
  });
});
