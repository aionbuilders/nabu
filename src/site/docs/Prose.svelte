<script>
  import { copyable } from './copy.js';

  /** Server-rendered Markdown (see markdown.server.js). */
  let { html, tag = 'div', class: className = '' } = $props();
</script>

<svelte:element this={tag} class="prose {className}" use:copyable>{@html html}</svelte:element>
