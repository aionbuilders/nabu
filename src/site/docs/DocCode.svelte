<script>
  /**
   * The code block of the documentation: the built-in one, drawn like the code blocks of the API reference (the shared `.cb` styles of
   * docs.css) and highlighted. The colours are Shiki tokens computed at build time (doc.server.js) and handed down through the context,
   * rendered as spans around the verbatim text, which is the contract ADR 013 sets for a highlighter: the text nodes still add up to
   * `block.text`, so the selection, the copy and the offsets work through the spans. A block whose text no longer matches the tokens
   * (once the page is edited) falls back to plain text.
   */
  import { getDocMeta } from './context.js';

  /** @type {{ block: import('#lib/extend.js').TextBlock & { language: string | null, text: string } }} */
  let { block } = $props();
  const meta = getDocMeta();

  const tokens = $derived.by(() => {
    const t = meta.code[block.id];
    return t && t.map((s) => s[0]).join('') === block.text ? t : null;
  });
  const LABELS = /** @type {Record<string, string>} */ ({ js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', bash: 'Bash', sh: 'Bash', svelte: 'Svelte', css: 'CSS', html: 'HTML', json: 'JSON' });
  const label = $derived(block.language ? (LABELS[block.language] ?? block.language) : 'Text');

  let copied = $state(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(block.text);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {}
  }
</script>

<div class="cb nabu-code-wrapper"><div class="cb-head" data-nabu-ui contenteditable="false"><span class="cb-lang">{label}</span><button type="button" class="cb-copy" aria-label="Copy code" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button></div><pre
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="code"
    spellcheck="false"
    data-placeholder={block.placeholder}
    class="nabu-code"
    class:selected={block.selected}
><code>{#if tokens}{#each tokens as [text, color]}{#if color}<span style:color={`var(${color})`}>{text}</span>{:else}{text}{/if}{/each}{:else}{block.text || '\n'}{/if}{#if block.text.endsWith('\n')}<br data-nabu-filler>{/if}</code></pre></div>
