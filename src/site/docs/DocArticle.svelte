<script>
  import DocBody from './DocBody.svelte';
  import StaticArticle from './StaticArticle.svelte';

  /**
   * The article of a documentation page: a Nabu document, read-only. `doc` is what doc.server.js built (snapshot, heading anchors, code
   * tokens), or just `html` for a page shipped as plain HTML (see StaticArticle). Keyed on the snapshot: navigating from one page to the next builds a new engine instead of reusing the old one.
   * @type {{ doc: { snapshot: string, ids: Record<string, string>, code: Record<string, Array<[string, string?]>> } | { html: string }, label: string, lang?: string }}
   */
  let { doc, label, lang = 'en' } = $props();
</script>

{#if 'html' in doc}
  <StaticArticle html={doc.html} />
{:else}
  {#key doc.snapshot}
    <DocBody {doc} {label} {lang} />
  {/key}
{/if}
