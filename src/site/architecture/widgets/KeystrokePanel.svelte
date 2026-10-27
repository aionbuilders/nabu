<script>
  import { STEPS, describeInput, describeModelPoint, keyLabel, stepMs } from './helpers.js';
  import { createKeyMeter, isEditKey } from '../../measure.js';
  import { describeBatch, treeLookup } from '../../xray.js';

  /**
   * The panel of chapter 03, "The life of a keystroke": the path of the LAST key typed in the editor, as seven steps.
   *
   * WHAT IS MEASURED, and nothing else: the two numbers of `src/site/measure.js`, the same ones as the Performance lab.
   *   - the "Svelte" row: ENGINE WORK, from the key's own `event.timeStamp` to the first change of the editor's DOM (a MutationObserver);
   *   - the "paint" row: KEY TO NEXT PAINT, from the same start to the first frame painted after that change.
   * The steps between are NOT timed: that would need marks inside the engine (see the report of this work: `performance.mark` behind an
   * opt-in flag). A row is "lit" when this page saw a trace of the step for this key (a keyboard event, the caret read through the public
   * selection, a Loro operation from `doc.subscribe`, a DOM change, a frame); it says nothing about how long the step took.
   * "step" (in the heading, owned by Keystroke.svelte) walks the rows one at a time and shows what the step does and where the code is.
   * No animation: nothing here moves by itself.
   *
   * @type {{ ctx: import('./helpers.js').WidgetContext, stepAt: number }}
   */
  let { ctx, stepAt = -1 } = $props();

  /** @type {import('./helpers.js').Rec | null} */
  let shown = $state.raw(/** @type {any} */ (null));

  const lit = $derived({
    keydown: !!shown,
    beforeinput: !!shown?.inputType,
    selection: !!shown?.caret,
    ascend: !!shown?.op,
    loro: !!shown?.op,
    svelte: shown?.engineMs != null,
    paint: shown?.paintMs != null,
  });

  /** @param {typeof STEPS[number]} s */
  function brief(s) {
    const r = shown;
    if (!r) return s.brief;
    switch (s.id) {
      case 'keydown': return `the browser hands us “${keyLabel(r.key)}”`;
      case 'beforeinput': return r.inputType ? `inputType ${r.inputType}, one listener on the root` : s.brief;
      case 'selection': return r.caret ? `the caret was at ${r.caret}` : s.brief;
      case 'ascend': return r.inputType ? describeInput(r.inputType).text : s.brief;
      case 'loro': return r.op ? `Loro reports: ${r.op}` : s.brief;
      default: return s.brief;
    }
  }

  /** @param {typeof STEPS[number]} s */
  function time(s) {
    if (s.id === 'svelte') return stepMs(shown?.engineMs);
    if (s.id === 'paint') return stepMs(shown?.paintMs);
    return '';
  }

  // Watch the editor: the keyboard events (document capture, ahead of the editor's own handlers, so that nothing the editor does can
  // delay the start), the Loro commits, and the shared key meter.
  $effect(() => {
    const { engine, scope } = ctx;
    const root = scope.querySelector('[data-nabu-root]');
    if (!root) return;
    const doc = engine.doc;
    const lookup = treeLookup(doc);

    /** @type {import('./helpers.js').Rec[]} newest last, a few kept so that a fast typist's samples find their key */
    let recs = [];
    let seq = 0;
    /** @param {import('./helpers.js').Rec} r */
    const publish = (r) => { if (recs[recs.length - 1] === r) shown = { ...r }; };
    /** @param {import('./helpers.js').Rec} r */
    const remember = (r) => { recs.push(r); if (recs.length > 12) recs.shift(); };

    /** @param {Event} e */
    const inEditor = (e) => {
      const t = e.target;
      const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
      return !!el && root.contains(el);
    };
    /** @param {KeyboardEvent} e */
    const onKeydown = (e) => {
      if (!inEditor(e) || !isEditKey(e)) return;
      let caret = null;
      try {
        const st = engine.selection.start;
        caret = st ? describeModelPoint(st.block, st.from) : null;
      } catch { /* no selection yet */ }
      /** @type {import('./helpers.js').Rec} */
      const r = { id: ++seq, t0: e.timeStamp, key: e.key, inputType: null, caret, op: null, engineMs: null, paintMs: null };
      remember(r);
      publish(r);
    };
    /** @param {InputEvent} e */
    const onBeforeinput = (e) => {
      if (!inEditor(e) || e.isComposing) return;
      let r = [...recs].reverse().find((x) => x.inputType === null && e.timeStamp - x.t0 < 400);
      if (!r) {
        // No keydown (virtual keyboard, dictation): the beforeinput starts the record.
        r = { id: ++seq, t0: e.timeStamp, key: e.data ?? '(input)', inputType: null, caret: null, op: null, engineMs: null, paintMs: null };
        remember(r);
      }
      r.inputType = e.inputType;
      publish(r);
    };
    const opts = { capture: true };
    document.addEventListener('keydown', onKeydown, opts);
    document.addEventListener('beforeinput', onBeforeinput, opts);

    const unsubscribe = doc.subscribe((batch) => {
      if (batch.by === 'import' || batch.by === 'checkout') return;
      const r = [...recs].reverse().find((x) => x.op === null && performance.now() - x.t0 < 400);
      if (!r) return;
      const first = describeBatch(batch, new Map(), lookup)[0];
      r.op = first ? first.text : 'a change';
      publish(r);
    });

    const meter = createKeyMeter(root, (sample) => {
      const t0 = sample.at - sample.paint;
      const r = recs.find((x) => Math.abs(x.t0 - t0) < 2) ?? recs[recs.length - 1];
      if (!r) return;
      r.engineMs = sample.engine;
      r.paintMs = sample.paint;
      publish(r);
    });

    return () => {
      document.removeEventListener('keydown', onKeydown, opts);
      document.removeEventListener('beforeinput', onBeforeinput, opts);
      unsubscribe();
      meter.dispose();
    };
  });
</script>

<div class="host">
  <ol class="steps" data-testid="xray-steps" aria-label="The path of the last key">
    {#each STEPS as s, i (s.id)}
      {@const on = lit[/** @type {keyof typeof lit} */ (s.id)]}
      <li class="step" class:lit={on} class:sel={stepAt === i} data-step={s.id} data-lit={on ? 'true' : 'false'}>
        <span class="dot" aria-hidden="true"></span>
        <span class="txt">
          <span class="name">{s.name}</span>
          <span class="brief">{brief(s)}</span>
          {#if stepAt === i}
            <span class="detail">{s.detail} <span class="where">{s.where}</span></span>
          {/if}
        </span>
        <span class="ms" data-testid={s.timed ? `ms-${s.id}` : undefined}>{time(s)}</span>
      </li>
    {/each}
  </ol>
  <p class="legend">
    {#if shown}
      Lit: a trace of the step was seen for this key. Times run from the key: <em>engine work</em> to the first DOM change, <em>paint</em> to the next frame.
    {:else}
      Click in the editor and type. Two steps are timed, on your machine: the DOM update (engine work) and the next paint. The others are described, not timed.
    {/if}
    <a href="/labs/performance">Performance lab →</a>
  </p>
</div>

<style>
  .host { display: flex; flex-direction: column; gap: 10px; }
  .steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .step {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    padding: 2px 6px 2px 0;
    border-radius: 6px;
  }
  .step.sel { background: var(--site-hover-bg); outline: 1px solid var(--site-border-strong); outline-offset: 2px; }
  .dot {
    margin-top: 6px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--site-border-strong);
  }
  .step.lit .dot { background: var(--site-accent); }
  .txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .name { color: var(--site-text-subtle); font-size: 13px; }
  .step.lit .name { color: var(--site-text); }
  .brief { color: var(--site-text-subtle); font: 400 12.5px / 1.45 var(--site-font-body); overflow-wrap: anywhere; }
  .detail { margin-top: 4px; color: var(--site-text-muted); font: 400 12.5px / 1.5 var(--site-font-body); overflow-wrap: anywhere; }
  .where { display: block; margin-top: 2px; color: var(--site-text-subtle); font: 400 11.5px / 1.4 var(--site-font-mono); }
  .ms { color: var(--site-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .legend { margin: 4px 0 0; color: var(--site-text-subtle); font: 400 12px / 1.5 var(--site-font-body); }
  .legend a { color: var(--site-accent); white-space: nowrap; }
</style>
