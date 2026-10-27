<script>
  import { buildModel, describeBatch, treeLookup, formatTiming } from '../../xray.js';
  import { nextPaint } from '../../measure.js';
  import { tick } from 'svelte';

  /**
   * The model, live: the Loro tree of the editor (one line per block, marks under their block), then the last operations Loro reported,
   * each with its key-to-next-paint time when a key caused it, or its kind (`command`, `undo`, `import`...) when it did not.
   *
   * It reads ONLY `engine.doc` (a public `LoroDoc`) through `../../xray.js`, like the home page X-ray, and times a key like the lab does
   * (`../../measure.js`): from the key's `event.timeStamp` to the first frame painted once Svelte has flushed the commit. The pure
   * parts (tree lines, operation lines) are unit tested in tests/unit/xray.test.js.
   *
   * @type {{ engine: import('#lib').Nabu, tree?: boolean, ops?: boolean, opsRows?: number, treeLabel?: string }}
   */
  let { engine, tree = true, ops: showOps = true, opsRows = 4, treeLabel = 'model' } = $props();

  const PER_COMMIT = 3;
  const CAUSE_WINDOW = 400;
  const SIGN = { '+': '+', '-': '−', '~': '~' };

  /** @type {import('../../xray.js').ModelLine[]} */
  let lines = $state.raw([]);
  /** @type {Array<{ key: number, batch: number, sign: string, text: string, timing: number | string }>} */
  let ops = $state.raw([]);

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

    /** @type {{ t0: number, kind: string } | null} */
    let cause = null;
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
        kind = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' ? 'redo' : k === 'v' ? 'paste' : k === 'x' ? 'cut' : 'key';
      } else if (e.key.length !== 1 && !TYPING.includes(e.key)) return;
      cause = { t0: e.timeStamp, kind };
    };
    /** @param {InputEvent} e */
    const onBeforeinput = (e) => {
      if (!inEditor(e) || e.isComposing) return;
      const t = e.timeStamp;
      const fresh = cause && t - cause.t0 < 100;
      cause = { t0: fresh ? /** @type {NonNullable<typeof cause>} */ (cause).t0 : t, kind: fresh ? /** @type {NonNullable<typeof cause>} */ (cause).kind : 'key' };
    };
    const onPointerdown = () => { cause = null; };
    const opts = { capture: true };
    document.addEventListener('keydown', onKeydown, opts);
    document.addEventListener('beforeinput', onBeforeinput, opts);
    document.addEventListener('pointerdown', onPointerdown, opts);

    let seq = 0;
    let batchNo = 0;
    let alive = true;
    const unsubscribe = doc.subscribe((batch) => {
      if (batch.by === 'checkout') { refresh(); return; }
      const described = describeBatch(batch, types, lookup);
      refresh();
      if (!described.length) return;
      const t0 = cause && performance.now() - cause.t0 < CAUSE_WINDOW ? cause : null;
      const origin = batch.origin;
      const how = batch.by === 'import' ? { kind: 'import', t0: null }
        : origin === 'undo' || origin === 'redo' ? { kind: origin, t0: null }
        : t0 && t0.kind === 'key' ? { kind: 'key', t0: t0.t0 }
        : t0 ? { kind: t0.kind, t0: null }
        : { kind: 'command', t0: null };
      const shown = described.length > PER_COMMIT + 1
        ? [...described.slice(0, PER_COMMIT), { sign: '~', text: `… +${described.length - PER_COMMIT} more` }]
        : described;
      const no = ++batchNo;
      tick().then(() => (how.t0 !== null ? nextPaint() : 0)).then((painted) => {
        if (!alive) return;
        const timing = how.t0 !== null ? painted - how.t0 : how.kind;
        const added = shown.map((op) => ({ key: ++seq, batch: no, sign: op.sign, text: op.text, timing })).reverse();
        ops = [...added, ...ops].slice(0, opsRows);
      });
    });

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      unsubscribe();
      document.removeEventListener('keydown', onKeydown, opts);
      document.removeEventListener('beforeinput', onBeforeinput, opts);
      document.removeEventListener('pointerdown', onPointerdown, opts);
    };
  });
</script>

<div class="model">
  {#if tree}
    <div class="tree" data-testid="xray-tree" aria-label={treeLabel}>
      {#each lines as l, i (i)}
        {#if l.kind === 'block'}
          <div class="w-line" data-kind="block" style:padding-left="{l.depth * 2}ch"><span class="ref">{l.type}#{l.id}</span>{#if l.detail}<span class="w-muted">{' ' + l.detail}</span>{/if}{#if l.hasText}<span class="w-text">{' "' + l.excerpt + '"'}</span>{/if}</div>
        {:else if l.kind === 'mark'}
          <div class="w-line" data-kind="mark" style:padding-left="{l.depth * 2}ch">{l.mark} [{l.range?.[0]}, {l.range?.[1]}]</div>
        {:else}
          <div class="w-line" data-kind="more">…</div>
        {/if}
      {/each}
    </div>
  {/if}
  {#if showOps}
    <p class="w-label ops-label">last operations</p>
    <ol class="ops" data-testid="xray-ops" aria-label="Latest operations">
      {#each ops as op (op.key)}
        <li class="op w-line" class:latest={op.batch === ops[0].batch} data-testid="xray-op">{SIGN[/** @type {'+' | '-' | '~'} */ (op.sign)]} {op.text} · {formatTiming(op.timing)}</li>
      {:else}
        <li class="op w-line idle">No operations yet.</li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .model { display: flex; flex-direction: column; }
  .ref { color: var(--site-text-muted); }
  .tree { margin-bottom: 4px; }
  .ops-label { margin-top: 10px; }
  .ops { margin: 4px 0 0; padding: 0; list-style: none; }
  .op { color: var(--site-text-subtle); }
  .op.latest { color: var(--site-accent); }
</style>
