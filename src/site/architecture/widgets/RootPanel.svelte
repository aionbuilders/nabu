<script>
  /**
   * The panel of chapter 01: three counts and a sentence, all read from the live DOM of the editor with plain queries
   * (`querySelectorAll`, `Range#intersectsNode`), refreshed when the DOM or the selection changes. No engine API involved: the point is
   * what the browser sees.
   * @type {{ ctx: import('./helpers.js').WidgetContext, outline: boolean }}
   */
  let { ctx, outline } = $props();

  let editable = $state(0);
  let blocks = $state(0);
  let ownEditable = $state(0);
  let touched = $state(0);
  let rootName = $state('');

  // The outline is an attribute on the editor's scope, styled by SingleRoot.svelte.
  $effect(() => {
    const el = ctx.scope;
    el.toggleAttribute('data-arch-outline', outline);
    return () => el.removeAttribute('data-arch-outline');
  });

  $effect(() => {
    const scope = ctx.scope;
    const root = /** @type {HTMLElement | null} */ (scope.querySelector('[data-nabu-root]'));
    if (!root) return;

    let raf = 0;
    const read = () => {
      raf = 0;
      editable = scope.querySelectorAll('[contenteditable="true"]').length;
      const all = [...root.querySelectorAll('[data-block-id]')];
      blocks = all.length;
      ownEditable = all.filter((b) => b.hasAttribute('contenteditable')).length;
      rootName = `${root.localName}.${root.classList[0] ?? ''}`;
      const sel = document.getSelection();
      if (sel && sel.rangeCount && root.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        touched = all.filter((b) => range.intersectsNode(b)).length;
      } else {
        touched = 0;
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();

    const mo = new MutationObserver(schedule);
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable'] });
    document.addEventListener('selectionchange', schedule);
    return () => {
      mo.disconnect();
      document.removeEventListener('selectionchange', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  });
</script>

<dl class="rows">
  <div class="row"><dt>editable roots</dt><dd data-testid="count-editable"><span class="w-accent big">{editable}</span></dd></div>
  <p class="note w-muted">Elements with <code>contenteditable="true"</code> inside the editor: <span class="w-text">{rootName}</span>.</p>
  <div class="row"><dt>blocks inside it</dt><dd data-testid="count-blocks"><span class="w-text big">{blocks}</span></dd></div>
  <div class="row"><dt>…with their own <code>contenteditable</code></dt><dd data-testid="count-own"><span class="w-text big">{ownEditable}</span></dd></div>
  <div class="row"><dt>blocks the selection touches</dt><dd data-testid="count-touched"><span class="w-text big">{touched}</span></dd></div>
  <p class="note w-muted">Drag from the first paragraph into the list. The selection is the browser's own; nobody wrote code to make it cross blocks.</p>
</dl>

<style>
  .rows { margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  dt { color: var(--site-text-muted); min-width: 0; overflow-wrap: anywhere; }
  dd { margin: 0; }
  .big { font-size: 18px; font-variant-numeric: tabular-nums; }
  .note { margin: 0; font: 400 12.5px / 1.5 var(--site-font-body); overflow-wrap: anywhere; }
  code { font: inherit; color: var(--site-text); }
</style>
