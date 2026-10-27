/**
 * Builds the Nabu document of a documentation page at build time (server only): Markdown -> `importMarkdown` -> a snapshot the
 * browser rebuilds the same engine from, plus what the redrawn blocks need (heading anchors, Shiki tokens of the code blocks) and the
 * table of contents. The engine runs in Node (Loro's WebAssembly loads there too), no DOM is involved.
 */
import { createDocEngine, exportSnapshot } from './doc-preset.js';
import { prepareMarkdown, createSlugger } from './content.js';
import { getHighlighter } from './highlight.server.js';

const LANGS = ['ts', 'js', 'svelte', 'bash', 'json', 'css', 'html'];
const ALIASES = /** @type {Record<string, string>} */ ({ javascript: 'js', typescript: 'ts', sh: 'bash', shell: 'bash' });
const FOREGROUND = '--shiki-foreground';

/**
 * Shiki tokens of a code block as a flat run of `[text, colorVariable?]` whose texts add up to the source (the contract of ADR 013); null
 * when the language is not highlighted or the tokens do not add up.
 * @param {import('shiki').HighlighterGeneric<any, any>} h
 * @param {string} code
 * @param {string | null} language
 * @returns {Array<[string, string?]> | null}
 */
function tokensOf(h, code, language) {
  const lang = ALIASES[language ?? ''] ?? language ?? '';
  if (!LANGS.includes(lang) || !code) return null;
  const lines = h.codeToTokens(code, { lang, theme: 'site' }).tokens;
  /** @type {Array<[string, string?]>} */
  const out = [];
  /** @param {string} text @param {string} [color] */
  const push = (text, color) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last[1] === color) last[0] += text;
    else out.push(color ? [text, color] : [text]);
  };
  lines.forEach((line, i) => {
    if (i) push('\n');
    for (const t of line) {
      const m = /^var\((--[\w-]+)\)$/.exec(t.color ?? '');
      push(t.content, m && m[1] !== FOREGROUND ? m[1] : undefined);
    }
  });
  return out.map((s) => s[0]).join('') === code ? out : null;
}

/**
 * @param {string} markdown the body of a page
 * @param {{ dir: string, tocLevels?: number[] }} options `dir`: the repo directory of the file, for its relative links
 */
export async function buildDoc(markdown, { dir, tocLevels = [2, 3] }) {
  const engine = createDocEngine();
  // One author, one peer: the block ids (`counter@peer`) are the same at every build, so is the prerendered markup.
  engine.doc.setPeerId(1);
  await engine.importMarkdown(prepareMarkdown(markdown, dir));
  const h = await getHighlighter();
  const slug = createSlugger();

  /** @type {Record<string, string>} */
  const ids = {};
  /** @type {Record<string, Array<[string, string?]>>} */
  const code = {};
  /** @type {Array<{ id: string, label: string, level: 1 | 2, depth: number }>} */
  const headings = [];
  let title = '';

  /** @param {any[]} blocks */
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === 'heading') {
        const id = slug(block.text);
        ids[block.id] = id;
        if (block.level === 1 && !title) title = block.text;
        if (tocLevels.includes(block.level)) headings.push({ id, label: block.text, level: block.level === tocLevels[0] ? 1 : 2, depth: block.level });
      } else if (block.type === 'code') {
        const tokens = tokensOf(h, block.text, block.language);
        if (tokens) code[block.id] = tokens;
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(engine.children);

  const doc = { snapshot: exportSnapshot(engine), ids, code, title, toc: headings.map(({ id, label, level }) => ({ id, label, level })), headings };
    return doc;
}
