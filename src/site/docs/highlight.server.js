/**
 * Build-time syntax highlighting (Shiki). Server-only: imported by `+page.server.js` loads of prerendered pages, so Shiki never
 * reaches the client bundle. The theme is the CSS-variables theme: the colours are `--shiki-*` custom properties that
 * `docs.css` maps to the `--site-*` tokens, so dark / light follow the site theme with no JavaScript.
 */
import { createHighlighter, createCssVariablesTheme } from 'shiki';

const theme = createCssVariablesTheme({ name: 'site', variablePrefix: '--shiki-', variableDefaults: {}, fontStyle: true });
const LANGS = ['ts', 'js', 'svelte', 'bash', 'json', 'css', 'html'];

/** @type {Promise<import('shiki').HighlighterGeneric<any, any>> | null} */
let highlighter = null;
export const getHighlighter = () => (highlighter ??= createHighlighter({ themes: [theme], langs: LANGS }));

/** @param {string} s */
export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ALIASES = /** @type {Record<string, string>} */ ({ javascript: 'js', typescript: 'ts', sh: 'bash', shell: 'bash', html: 'html', '': 'ts' });

/**
 * @param {import('shiki').HighlighterGeneric<any, any>} h
 * @param {string} code
 * @param {string} [lang]
 * @param {{ links?: Map<string, string>, self?: string }} [opts] `links`: identifier -> href, turns the documented type names of a signature into links
 */
export function highlightSync(h, code, lang = 'ts', { links, self } = {}) {
  const l = ALIASES[lang] ?? lang;
  const language = LANGS.includes(l) ? l : 'ts';
  return h.codeToHtml(code.replace(/\n$/, ''), {
    lang: language,
    theme: 'site',
    transformers: [
      {
        pre(node) { delete node.properties.style; },
        span(node) {
          if (!links || node.children.length !== 1) return;
          const child = node.children[0];
          if (child.type !== 'text') return;
          const name = child.value.trim();
          const href = links.get(name);
          if (href && name !== self) { node.tagName = 'a'; node.properties.href = href; node.properties.class = 'type-link'; }
        },
      },
    ],
  });
}

/**
 * A code block with its header (language label, copy button): the markup the shared `.cb` styles of docs.css draw.
 * @param {import('shiki').HighlighterGeneric<any, any>} h
 * @param {string} code
 * @param {string} [lang]
 * @param {{ links?: Map<string, string>, self?: string }} [opts]
 */
export function codeBlockSync(h, code, lang = 'ts', opts = {}) {
  const label = lang === 'ts' ? 'TypeScript' : lang === 'js' ? 'JavaScript' : lang;
  return `<div class="cb"><div class="cb-head"><span class="cb-lang">${escapeHtml(label)}</span><button type="button" class="cb-copy" data-copy aria-label="Copy code">Copy</button></div>${highlightSync(h, code, lang, opts)}</div>`;
}
