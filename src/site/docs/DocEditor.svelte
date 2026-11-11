<script>
  import { NabuEditor } from '#lib';
  import { loadDocEngine } from './doc-preset.js';
  import { setDocMeta } from './context.js';

  /**
   * The read-only Nabu document of a documentation page, without its frame: what DocBody draws in the browser (and hydrates), and what
   * doc.server.js renders to a string for a page that is shipped as plain HTML (see StaticArticle).
   * @type {{ doc: { snapshot: string, ids: Record<string, string>, code: Record<string, Array<[string, string?]>> }, label: string, lang?: string }}
   */
  let { doc, label, lang = 'en' } = $props();

  // Built synchronously from the snapshot, on the server and in the browser alike: that is what lets Svelte HYDRATE the markup the
  // build rendered instead of replacing it. The document is not reactive to `doc` (the parent re-creates this component when it changes).
  // svelte-ignore state_referenced_locally
  const engine = loadDocEngine(doc.snapshot, lang);
  // svelte-ignore state_referenced_locally
  setDocMeta({ ids: doc.ids, code: doc.code });
</script>

<NabuEditor {engine} readonly {label} />
