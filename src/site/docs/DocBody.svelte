<script>
  import './doc.css';
  import '#lib/themes/atelier.css';
  import DocEditor from './DocEditor.svelte';

  /** @type {{ doc: { snapshot: string, ids: Record<string, string>, code: Record<string, Array<[string, string?]>> }, label: string, lang?: string }} */
  let { doc, label, lang = 'en' } = $props();

  /** @type {HTMLElement | undefined} */
  let scope = $state();

  $effect(() => {
    if (!scope) return;
    scope.setAttribute('data-hydrated', ''); // the page is interactive: the server markup was adopted, not replaced (the e2e specs wait for it)
  });
</script>

<div class="doc-article nb-theme-atelier" bind:this={scope} data-testid="doc-article"><DocEditor {doc} {label} {lang} /></div>
