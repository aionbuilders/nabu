/**
 * Build-time Markdown for the documentation pages (JSDoc descriptions today, the guides later). Server-only.
 * Raw HTML in the source is escaped, never passed through. `api:<item id>[#anchor]` links point into the API reference.
 */
import { Marked } from 'marked';
import { codeBlockSync, escapeHtml } from './highlight.server.js';

/** @param {string} href */
export const resolveHref = (href) => (href.startsWith('api:') ? '/api/' + href.slice(4) : href);

/**
 * @param {import('shiki').HighlighterGeneric<any, any>} highlighter
 * @param {{ links?: Map<string, string>, self?: string }} [codeOpts] type links inside fenced code blocks
 */
export function createMarkdown(highlighter, codeOpts = {}) {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      code({ text, lang }) { return codeBlockSync(highlighter, text, (lang ?? '').split(/\s/)[0], codeOpts); },
      html({ text }) { return escapeHtml(text); },
      link({ href, title, tokens }) {
        const url = resolveHref(href);
        const external = /^https?:\/\//.test(url);
        return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return {
    /** Block Markdown -> HTML. */
    block: (/** @type {string} */ md) => (md ? /** @type {string} */ (marked.parse(md)) : ''),
    /** Inline Markdown -> HTML (no wrapping paragraph). */
    inline: (/** @type {string} */ md) => (md ? /** @type {string} */ (marked.parseInline(md)) : ''),
  };
}
