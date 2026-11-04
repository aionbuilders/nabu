<script>
  // Test-only page (see +page.js; tests/e2e/format-entry.spec.ts): a read-only viewer that imports ONLY `@aionbuilders/nabu/format`
  // (here its source, `#lib/format.js`): no editor, no Loro. The page must not request any WebAssembly.
  import { deltaToHtml, jsonToText, sanitizeUrl, escapeHtml } from '#lib/format.js';

  /** A stored `serialize('json')` export, hostile parts included. */
  const stored = {
    version: '1',
    blocks: [
      { type: 'heading', props: { level: 2 }, content: [{ text: 'Release notes' }] },
      { type: 'paragraph', content: [{ text: 'Faster ' }, { text: 'paste', bold: true }, { text: ', 5 * 3 and ' }, { text: 'a guide', link: 'https://example.com/guide' }] },
      { type: 'paragraph', content: [{ text: 'click me', link: 'javascript:alert(1)' }, { text: ' <script>x<\/script>' }] },
      { type: 'list', props: { listType: 'bullet' }, children: [
        { type: 'list-item', content: [{ text: 'one' }], children: [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', content: [{ text: 'nested' }] }] }] },
        { type: 'list-item', content: [{ text: 'two' }] },
      ] },
    ],
  };

  /** @param {any} b */
  function render(b) {
    const inline = deltaToHtml((b.content ?? []).map((/** @type {any} */ { text, ...attributes }) => ({ insert: text, attributes })));
    const children = (b.children ?? []).map(render).join('');
    switch (b.type) {
      case 'heading': return `<h${b.props.level}>${inline}</h${b.props.level}>`;
      case 'list': return `<ul>${children}</ul>`;
      case 'list-item': return `<li>${inline}${children}</li>`;
      default: return `<p>${inline}</p>`;
    }
  }

  const html = stored.blocks.map(render).join('');
  const text = jsonToText(stored);
  const safe = sanitizeUrl('javascript:alert(1)') === null && escapeHtml('<') === '&lt;';
</script>

<main>
  <article data-testid="viewer">{@html html}</article>
  <pre data-testid="text">{text}</pre>
  <output data-testid="helpers">{safe ? 'safe' : 'unsafe'}</output>
</main>
