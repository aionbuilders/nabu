<script>
  import './doc.css';
  import '#lib/themes/atelier.css';
  import { NabuEditor } from '#lib';
  import { loadDocEngine } from './doc-preset.js';
  import { setDocMeta } from './context.js';

  /** @type {{ doc: { snapshot: string, ids: Record<string, string>, code: Record<string, Array<[string, string?]>> }, label: string, lang?: string }} */
  let { doc, label, lang = 'en' } = $props();

  // Built synchronously from the snapshot, on the server and in the browser alike: that is what lets Svelte HYDRATE the markup the
  // build rendered instead of replacing it. The document is not reactive to `doc` (the parent re-creates this component when it changes).
  // svelte-ignore state_referenced_locally
  const engine = loadDocEngine(doc.snapshot, lang);
  // svelte-ignore state_referenced_locally
  setDocMeta({ ids: doc.ids, code: doc.code });

  /** @type {HTMLElement | undefined} */
  let scope = $state();

  $effect(() => {
    if (!scope) return;
    scope.setAttribute('data-hydrated', ''); // the page is interactive: the server markup was adopted, not replaced (the e2e specs wait for it)
  });
</script>

<div class="doc-article nb-theme-atelier" bind:this={scope} data-testid="doc-article"><NabuEditor {engine} readonly {label} /></div>
