<script>
  import { apiHref } from './links.js';

  /** A type as the model stores it: plain strings, and `{ t, to }` for a documented export (linked). */
  let { parts } = $props();
</script>

{#each parts as part}{#if typeof part === 'string'}{part}{:else}<a href={apiHref(part.to)}>{part.t}</a>{/if}{/each}
