<script>
  import { tick } from 'svelte';
  import { buildModel, describeBatch, treeLookup, formatTiming } from './xray.js';
  import { nextPaint } from './measure.js';

  /**
   * The X-ray: the live model of the home editor, next to it. Reads ONLY what the editor exposes publicly: `engine.doc` (the Loro
   * document: its `blocks` tree and its change events). The tree view is rebuilt from the document once per animation frame; the
   * operations log is derived from the Loro events of each commit.
   *
   * TIMING (never invented), the same measure as the lab (measure.js): KEY TO NEXT PAINT. A keystroke starts at the `event.timeStamp`
   * of its `keydown` / `beforeinput` (captured on the document, before the editor's own handlers; the time an event spent queued
   * counts), and ends at the first frame painted once the DOM has caught up with the commit: the Loro event of that commit fires, then
   * `await tick()` (Svelte has flushed the DOM updates it caused), then `nextPaint()`. The difference is the number shown. An operation
   * that did not come from a key (paste, cut, drop, undo / redo, IME composition, import, a toolbar command) shows its kind instead.
   *
   * @type {{ engine: import('#lib').Nabu | null, open?: boolean, id?: string }}
   */
  let { engine, open = false, id = 'xray-panel' } = $props();

  const LOG = 5;
  /** Operations per commit shown before folding the rest into one line. */
  const PER_COMMIT = 4;
  /** A key / clipboard gesture is the cause of the commits that follow it for this long (ms). */
  const CAUSE_WINDOW = 400;

  /** @typedef {{ t0: number, kind: string }} Cause */
  /** @typedef {{ key: number, batch: number, sign: string, text: string, timing: number | string }} LoggedOp */

  /** @type {import('./xray.js').ModelLine[]} */
  let lines = $state.raw([]);
  /** @type {LoggedOp[]} */
  let ops = $state.raw([]);

  const SIGN = { '+': '+', '-': '−', '~': '~' };

  $effect(() => {
    lines = [];
    ops = [];
    const eng = engine;
    if (!eng) return;
    const doc = eng.doc;
    const types = new Map();
    const lookup = treeLookup(doc);

    let raf = 0;
    const refresh = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; lines = buildModel(doc, { types }); });
    };
    lines = buildModel(doc, { types });

    // ── What caused the next commit ──
    /** @type {Cause | null} */
    let cause = null;
    const now = () => performance.now();
    /** @param {Event} e */
    const inEditor = (e) => {
      const t = e.target;
      const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
      return !!el?.closest('[data-nabu-root]');
    };
    const MODIFIERS = ['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock'];
    const TYPING = ['Backspace', 'Delete', 'Enter', 'Tab'];
    /** @param {KeyboardEvent} e */
    const onKeydown = (e) => {
      if (!inEditor(e) || e.isComposing || e.key === 'Process' || MODIFIERS.includes(e.key)) return;
      let kind = 'key';
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') kind = e.shiftKey ? 'redo' : 'undo';
        else if (k === 'y') kind = 'redo';
        else if (k === 'v') kind = 'paste';
        else if (k === 'x') kind = 'cut';
      } else if (e.key.length !== 1 && !TYPING.includes(e.key)) return; // arrows, Escape, F-keys: no edit
      cause = { t0: e.timeStamp, kind };
    };
    /** @param {InputEvent} e */
    const onBeforeinput = (e) => {
      if (!inEditor(e) || e.isComposing) return;
      const type = e.inputType;
      const kind =
        type === 'insertFromPaste' || type === 'insertFromPasteAsQuotation' ? 'paste'
        : type === 'deleteByCut' ? 'cut'
        : type === 'insertFromDrop' || type === 'deleteByDrag' ? 'drop'
        : type === 'historyUndo' ? 'undo'
        : type === 'historyRedo' ? 'redo'
        : 'key';
      const t = e.timeStamp;
      // The keydown of this very key came first (same task): keep its start. Without one (virtual keyboard, dictation) start here.
      const fresh = cause && t - cause.t0 < 100;
      cause = { t0: fresh ? /** @type {Cause} */ (cause).t0 : t, kind: kind === 'key' && fresh ? /** @type {Cause} */ (cause).kind : kind };
    };
    /** @param {string} kind @returns {(e: Event) => void} */
    const gesture = (kind) => (e) => { if (inEditor(e)) cause = { t0: now(), kind }; };
    const onPaste = gesture('paste'), onCut = gesture('cut'), onDrop = gesture('drop'), onCompositionend = gesture('ime');
    // A click (toolbar, handle) is not a key: its commit has no timing.
    const onPointerdown = () => { cause = null; };

    const opts = { capture: true };
    document.addEventListener('keydown', onKeydown, opts);
    document.addEventListener('beforeinput', onBeforeinput, opts);
    document.addEventListener('paste', onPaste, opts);
    document.addEventListener('cut', onCut, opts);
    document.addEventListener('drop', onDrop, opts);
    document.addEventListener('compositionend', onCompositionend, opts);
    document.addEventListener('pointerdown', onPointerdown, opts);

    // ── The operations log ──
    let seq = 0;
    let batchNo = 0;
    let alive = true;
    const unsubscribe = doc.subscribe((batch) => {
      if (batch.by === 'checkout') { refresh(); return; }
      const described = describeBatch(batch, types, lookup);
      refresh();
      if (!described.length) return;
      const t0 = cause && now() - cause.t0 < CAUSE_WINDOW ? cause : null;
      const origin = batch.origin;
      /** @type {{ kind: string, t0: number | null }} */
      const how =
        batch.by === 'import' ? { kind: 'import', t0: null }
        : origin === 'undo' || origin === 'redo' ? { kind: origin, t0: null }
        : t0 ? { kind: t0.kind, t0: t0.t0 }
        : { kind: 'command', t0: null };
      const shown = described.length > PER_COMMIT + 1
        ? [...described.slice(0, PER_COMMIT), { sign: '~', text: `… +${described.length - PER_COMMIT} more` }]
        : described;
      const no = ++batchNo;
      // The DOM has caught up with this commit once Svelte has flushed; the number is read after the next paint.
      tick().then(() => (how.kind === 'key' && how.t0 !== null ? nextPaint() : 0)).then((painted) => {
        if (!alive) return;
        const timing = how.kind === 'key' && how.t0 !== null ? painted - how.t0 : how.kind;
        const added = shown.map((op) => ({ key: ++seq, batch: no, sign: op.sign, text: op.text, timing })).reverse();
        ops = [...added, ...ops].slice(0, LOG);
      });
    });

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      unsubscribe();
      document.removeEventListener('keydown', onKeydown, opts);
      document.removeEventListener('beforeinput', onBeforeinput, opts);
      document.removeEventListener('paste', onPaste, opts);
      document.removeEventListener('cut', onCut, opts);
      document.removeEventListener('drop', onDrop, opts);
      document.removeEventListener('compositionend', onCompositionend, opts);
      document.removeEventListener('pointerdown', onPointerdown, opts);
    };
  });
</script>

<section class="xray" class:open {id} aria-label="Live model" aria-live="off" data-testid="xray">
  <div class="inner">
    <div class="head">model <span class="live" class:on={!!engine}><span aria-hidden="true">●</span> live</span></div>
    <div class="tree" data-testid="xray-tree">
      {#each lines as l, i (i)}
        {#if l.kind === 'block'}
          <div class="line" data-kind="block" style:padding-left="{l.depth * 2}ch"><span class="ref">{l.type}#{l.id}</span>{#if l.detail}<span class="detail">{' ' + l.detail}</span>{/if}{#if l.hasText}<span class="text">{' "' + l.excerpt + '"'}</span>{/if}</div>
        {:else if l.kind === 'mark'}
          <div class="line" data-kind="mark" style:padding-left="{l.depth * 2}ch">{l.mark} [{l.range?.[0]}, {l.range?.[1]}]</div>
        {:else}
          <div class="line" data-kind="more">…</div>
        {/if}
      {/each}
    </div>
    <ol class="ops" data-testid="xray-ops" aria-label="Latest operations">
      {#each ops as op (op.key)}
        <li class="op" class:latest={op.batch === ops[0].batch} data-testid="xray-op">{SIGN[/** @type {'+' | '-' | '~'} */ (op.sign)]} {op.text} · {formatTiming(op.timing)}</li>
      {:else}
        <li class="op idle">No operations yet.</li>
      {/each}
    </ol>
  </div>
</section>

<style>
  .xray {
    --xray-lh: 22.75px;
    position: relative;
    grid-area: xray;
    min-width: 0;
    box-sizing: border-box;
    background: var(--site-surface-2);
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    color: var(--site-text-muted);
    font: 400 13px / var(--xray-lh) var(--site-font-mono);
  }
  .inner {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 20px 16px;
  }
  .head {
    margin-bottom: 8px;
    color: var(--site-text);
  }
  .live {
    color: var(--site-text-subtle);
  }
  .live.on {
    color: var(--site-accent);
  }
  .tree {
    min-height: 0;
    overflow: hidden auto;
  }
  .line {
    overflow: hidden;
    white-space: pre;
    text-overflow: ellipsis;
  }
  .ref {
    color: var(--site-text-muted);
  }
  .text {
    color: var(--site-text);
  }
  .ops {
    flex: none;
    height: calc(var(--xray-lh) * 5);
    margin: 10px 0 0;
    padding: 0;
    overflow: hidden;
    list-style: none;
  }
  .op {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--site-text-subtle);
  }
  .op.latest {
    color: var(--site-accent);
  }
  .op.idle {
    color: var(--site-text-subtle);
  }

  /* Under 1000px the panel sits below the editor and is collapsed until the visitor opens it. */
  @media (max-width: 999.98px) {
    .xray {
      margin-top: var(--site-space-3);
    }
    .xray:not(.open) {
      display: none;
    }
    .tree {
      max-height: 320px;
    }
  }

  /* Side by side: joined to the editor (the editor's right border is the shared edge), the same height as the editor. The panel's
     content is out of the flow, so what it shows never changes the row's height (the editor does not move when the model does). */
  @media (min-width: 1000px) {
    .xray {
      border-left: 0;
      border-radius: 0 var(--site-radius-panel) var(--site-radius-panel) 0;
    }
    .inner {
      position: absolute;
      inset: 0;
      padding: 24px 28px;
    }
    .tree {
      flex: 1;
    }
  }
</style>
