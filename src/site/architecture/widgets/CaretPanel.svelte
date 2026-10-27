<script>
  import { describeDomPoint, describeModelPoint } from './helpers.js';

  /**
   * The panel of chapter 04: the same selection, twice, plus the last undo / redo.
   *   - DOM: `document.getSelection()`, the browser's range (node + offset), written by `describeDomPoint`;
   *   - model: `engine.selection.start` / `.end` (public): a block and a character index, written by `describeModelPoint`;
   *   - undo: when Loro reports a commit of origin `undo` / `redo` (`doc.subscribe`), the model selection is read again a few times over the
   *     next 700 ms (the engine restores it after the render, with retries) and the last reading is shown: where undo put the selection back.
   * Both readings happen one frame after `selectionchange`, once the engine has synced its own selection.
   *
   * @type {{ ctx: import('./helpers.js').WidgetContext }}
   */
  let { ctx } = $props();

  /** @type {{ start: string, end: string | null, direction: string } | null} */
  let dom = $state.raw(null);
  /** @type {{ start: string, end: string | null, direction: string } | null} */
  let model = $state.raw(null);
  /** @type {{ kind: string, text: string } | null} */
  let restored = $state.raw(null);

  $effect(() => {
    const { engine, scope } = ctx;
    const root = scope.querySelector('[data-nabu-root]');
    if (!root) return;
    /** @type {{ kind: string, until: number } | null} */
    let pending = null;
    let raf = 0;
    /** @type {number[]} */
    let timers = [];

    /** @param {{ start: string, end: string | null } | null} m */
    const sentence = (m) => (m ? (m.end ? `${m.start}  →  ${m.end}` : m.start) : '—');

    const read = () => {
      raf = 0;
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) { dom = null; model = null; return; }
      const range = sel.getRangeAt(0);
      const direction = range.collapsed ? 'caret' : sel.anchorNode === range.startContainer && sel.anchorOffset === range.startOffset ? 'forward' : 'backward';
      dom = {
        start: describeDomPoint(range.startContainer, range.startOffset),
        end: range.collapsed ? null : describeDomPoint(range.endContainer, range.endOffset),
        direction,
      };
      /** @type {{ start: string, end: string | null, direction: string } | null} */
      let m = null;
      try {
        const st = engine.selection.start;
        const en = engine.selection.end;
        m = {
          start: st ? describeModelPoint(st.block, st.from) : '—',
          end: range.collapsed ? null : en ? describeModelPoint(en.block, en.to) : '—',
          direction,
        };
      } catch { /* the selection state is not ready */ }
      model = m;
      if (pending && performance.now() < pending.until && m) restored = { kind: pending.kind, text: sentence(m) };
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(read); };

    document.addEventListener('selectionchange', schedule);
    const unsubscribe = engine.doc.subscribe((batch) => {
      const origin = batch.origin;
      if (origin !== 'undo' && origin !== 'redo') return;
      pending = { kind: origin, until: performance.now() + 700 };
      for (const ms of [40, 160, 380, 680]) timers.push(window.setTimeout(schedule, ms));
    });
    schedule();

    return () => {
      document.removeEventListener('selectionchange', schedule);
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
      timers.forEach((t) => clearTimeout(t));
    };
  });
</script>

<div class="rows">
  <section aria-label="The browser's selection">
    <p class="w-label">DOM · the browser</p>
    {#if dom}
      <p class="val" data-testid="dom-start"><span class="w-muted">{dom.end ? 'start' : 'caret'}</span> {dom.start}</p>
      {#if dom.end}<p class="val" data-testid="dom-end"><span class="w-muted">end</span> {dom.end}</p>{/if}
    {:else}
      <p class="val w-muted" data-testid="dom-none">Click in the text.</p>
    {/if}
  </section>
  <section aria-label="Nabu's selection">
    <p class="w-label">Model · Nabu</p>
    {#if model}
      <p class="val" data-testid="model-start"><span class="w-muted">{model.end ? 'start' : 'caret'}</span> <span class="w-accent">{model.start}</span></p>
      {#if model.end}<p class="val" data-testid="model-end"><span class="w-muted">end</span> <span class="w-accent">{model.end}</span></p>{/if}
    {:else}
      <p class="val w-muted" data-testid="model-none">—</p>
    {/if}
  </section>
  <section aria-label="What the last undo or redo restored">
    <p class="w-label">Last undo / redo restored</p>
    {#if restored}
      <p class="val" data-testid="restored"><span class="w-muted">{restored.kind}</span> <span class="w-accent">{restored.text}</span></p>
    {:else}
      <p class="val w-muted" data-testid="restored-none">Bold a word (Ctrl+B), then press Ctrl+Z.</p>
    {/if}
  </section>
</div>

<style>
  .rows { display: flex; flex-direction: column; gap: 14px; }
  .val { margin: 2px 0 0; color: var(--site-text); overflow-wrap: anywhere; }
</style>
