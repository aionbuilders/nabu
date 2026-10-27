<script>
  import { inlineParts } from './inline.js';

  /** A text with `code` and *emphasis*, drawn without `{@html}`. @type {{ text: string }} */
  let { text } = $props();
</script>

{#each inlineParts(text) as part, i (i)}{#if part.kind === 'code'}<code>{part.text}</code>{:else if part.kind === 'em'}<em>{part.text}</em>{:else}{part.text}{/if}{/each}
