<script>
  /**
   * A short text with `inline code` between backticks, drawn without `{@html}`. Glued tags: the spaces of the text are the only ones in the markup.
   * @type {{ text: string }}
   */
  let { text } = $props();
  const parts = $derived(text.split(/(`[^`]+`)/).filter(Boolean).map((s) => (s.startsWith('`') ? { code: true, s: s.slice(1, -1) } : { code: false, s })));
</script>

{#each parts as p, i (i)}{#if p.code}<code>{p.s}</code>{:else}{p.s}{/if}{/each}

<style>
  code {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--site-hover-bg);
    color: var(--site-text);
    font: 500 0.86em / 1.4 var(--site-font-mono);
    overflow-wrap: anywhere;
  }
</style>
