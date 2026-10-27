<script>
  import '#lib/themes/atelier.css';
  import './tour.css';
  import { NabuEditor } from '#lib';
  import { loadTourEngine } from './tour-preset.js';
  import { setDocMeta } from '../docs/context.js';

  /**
   * One example of the tour: a Nabu document, rebuilt SYNCHRONOUSLY from its snapshot on the server and in the browser alike, which is what lets Svelte
   * HYDRATE the markup the build rendered instead of replacing it (the pipeline of DocBody.svelte). `engine`, when the parent holds one (the open card reads
   * it), is used instead of a new one. Read-only unless `readonly` is false.
   * @type {{
   *   doc: { snapshot: string, code: Record<string, Array<[string, string?]>> },
   *   label: string,
   *   variant?: 'story' | 'card' | 'open' | 'after',
   *   readonly?: boolean,
   *   engine?: import('#lib').Nabu,
   * }}
   */
  let { doc, label, variant = 'card', readonly = true, engine = undefined } = $props();

  // svelte-ignore state_referenced_locally
  const nabu = engine ?? loadTourEngine(doc.snapshot, true);
  // svelte-ignore state_referenced_locally
  setDocMeta({ ids: {}, code: doc.code });

  /** @type {HTMLElement | undefined} */
  let scope = $state();

  $effect(() => {
    scope?.setAttribute('data-hydrated', ''); // interactive: the server markup was adopted, not replaced (the e2e specs wait for it)
  });
</script>

<div class="tour-doc nb-theme-atelier" data-variant={variant} bind:this={scope}><NabuEditor engine={nabu} {readonly} {label} /></div>
