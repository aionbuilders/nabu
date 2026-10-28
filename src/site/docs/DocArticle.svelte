<script>
  import DocBody from './DocBody.svelte';

  /**
   * The article of a documentation page: a Nabu document, read-only. `doc` is what doc.server.js built (snapshot, heading anchors, code
   * tokens). Keyed on the snapshot: navigating from one page to the next builds a new engine instead of reusing the old one.
   * @type {{ doc: { snapshot: string, ids: Record<string, string>, code: Record<string, Array<[string, string?]>> }, label: string, lang?: string }}
   */
  let { doc, label, lang = 'en' } = $props();
</script>

{#key doc.snapshot}
  <DocBody {doc} {label} {lang} />
{/key}
