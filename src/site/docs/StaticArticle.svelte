<script>
  import './doc.css';
  import '#lib/themes/atelier.css';

  /**
   * The article of a page that is plain HTML in the browser: the markup doc.server.js rendered from the Nabu document (`renderDocHtml`),
   * adopted as it is, with no engine, no Loro and no hydration of the blocks. For a document too long to be rebuilt in the browser
   * (the changelog: ~550 blocks, seconds of main thread on a phone). The page is read-only, so what the editor did there is little: the
   * links are plain anchors, the headings carry their id, and the one thing left to do is the "Copy" button of the code blocks.
   * @type {{ html: string }}
   */
  let { html } = $props();

  /** @type {HTMLElement | undefined} */
  let scope = $state();

  $effect(() => {
    if (!scope) return;
    scope.setAttribute('data-hydrated', ''); // same signal as DocBody: the page is interactive
  });

  /** @type {WeakMap<Element, ReturnType<typeof setTimeout>>} */
  const timers = new WeakMap();

  /** @param {MouseEvent} e */
  async function onclick(e) {
    const button = e.target instanceof Element ? e.target.closest('.cb-copy') : null;
    const text = button?.closest('.cb')?.querySelector('pre')?.textContent;
    if (!button || text == null) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    button.textContent = 'Copied';
    clearTimeout(timers.get(button));
    timers.set(button, setTimeout(() => (button.textContent = 'Copy'), 1800));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="doc-article nb-theme-atelier" bind:this={scope} data-testid="doc-article" {onclick}>{@html html}</div>
