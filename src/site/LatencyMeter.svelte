<script>
  import { FRAME_MS, summarize, sparklinePoints, formatMs } from './measure.js';

  /**
   * The Performance lab's meter. Pure display: the lab feeds it the samples of the shared meter (measure.js).
   *
   * @type {{ samples: Array<{ paint: number, engine: number }>, recent: number, ready: boolean }}
   *   `samples`: every keystroke since the load, oldest first. `recent`: how many of the last ones the sparkline draws.
   */
  let { samples, recent = 60, ready = false } = $props();

  const W = 240;
  const H = 64;

  const last = $derived(samples.length ? samples[samples.length - 1] : null);
  const paintAll = $derived(summarize(samples.map((s) => s.paint)));
  const engineAll = $derived(summarize(samples.map((s) => s.engine)));
  const shown = $derived(samples.slice(-recent).map((s) => s.paint));
  /** The scale always reaches 2 frames, so the budget line stays at the same height unless a keystroke goes beyond. */
  const top = $derived(Math.max(2 * FRAME_MS, ...shown) * 1.05);
  const points = $derived(sparklinePoints(shown, { width: W, height: H, max: top }));
  const budgetY = $derived(+(H - 2 - (FRAME_MS / top) * (H - 4)).toFixed(2));
  const within = $derived(last ? last.paint <= FRAME_MS : null);
</script>

<section class="meter" aria-label="Typing latency" data-testid="lab-meter">
  <span class="label caption">Key to next paint</span>
  <p class="big" data-testid="lab-last" data-ms={last ? last.paint : ''}>
    <span class="num">{last ? formatMs(last.paint) : '—'}</span><span class="unit"> ms</span>
  </p>
  <p class="verdict" class:over={within === false}>
    {#if !last}
      {ready ? 'Click in the editor and type.' : 'Waiting for the document…'}
    {:else if within}
      Within one frame ({formatMs(FRAME_MS)} ms)
    {:else}
      Over one frame ({formatMs(FRAME_MS)} ms)
    {/if}
  </p>

  <svg class="spark" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Key to next paint of the last {shown.length} keystrokes, against the one-frame budget" data-testid="lab-spark">
    <line class="budget" x1="0" x2={W} y1={budgetY} y2={budgetY} vector-effect="non-scaling-stroke" />
    {#if points}<polyline class="line" {points} vector-effect="non-scaling-stroke" data-testid="lab-spark-line" />{/if}
  </svg>
  <p class="budget-label label"><span aria-hidden="true">┄</span> one frame · {formatMs(FRAME_MS)} ms</p>

  <dl class="stats">
    <div><dt class="label">p50</dt><dd data-testid="lab-p50">{samples.length ? formatMs(paintAll.p50) + ' ms' : '—'}</dd></div>
    <div><dt class="label">p95</dt><dd data-testid="lab-p95">{samples.length ? formatMs(paintAll.p95) + ' ms' : '—'}</dd></div>
    <div><dt class="label">keys</dt><dd data-testid="lab-count">{samples.length}</dd></div>
  </dl>
  <p class="engine" data-testid="lab-engine">Engine work · p50 {samples.length ? formatMs(engineAll.p50) + ' ms' : '—'}</p>
</section>

<style>
  .meter {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: var(--site-space-6);
    background: var(--site-surface-2);
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
  }
  .caption {
    color: var(--site-text-subtle);
    text-transform: uppercase;
  }
  .big {
    margin: var(--site-space-2) 0 0;
    font-family: var(--site-font-mono);
    font-weight: 500;
    color: var(--site-text);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .num {
    font-size: 64px;
    letter-spacing: -0.03em;
  }
  .unit {
    font-size: 20px;
    color: var(--site-text-muted);
  }
  .verdict {
    min-height: 1.5em;
    margin: var(--site-space-3) 0 0;
    color: var(--site-accent);
    font-size: var(--site-fs-small);
    line-height: var(--site-lh-small);
  }
  .verdict.over {
    color: var(--site-text-muted);
  }
  .spark {
    display: block;
    width: 100%;
    height: 64px;
    margin-top: var(--site-space-5);
    overflow: visible;
  }
  .budget {
    stroke: var(--site-text-subtle);
    stroke-width: 1;
    stroke-dasharray: 3 4;
    opacity: 0.8;
  }
  .line {
    fill: none;
    stroke: var(--site-accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .budget-label {
    margin: var(--site-space-1) 0 0;
    color: var(--site-text-subtle);
    font-size: 11px;
  }
  .stats {
    display: flex;
    gap: var(--site-space-8);
    margin: var(--site-space-5) 0 0;
    padding-top: var(--site-space-4);
    border-top: 1px solid var(--site-border);
  }
  .stats div { min-width: 0; }
  dt {
    color: var(--site-text-subtle);
    text-transform: uppercase;
  }
  dd {
    margin: 2px 0 0;
    color: var(--site-text);
    font: 500 18px / 1.3 var(--site-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .engine {
    margin: var(--site-space-4) 0 0;
    color: var(--site-text-subtle);
    font: 400 12px / 1.5 var(--site-font-mono);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 759.98px) {
    .meter { padding: var(--site-space-4); }
    .num { font-size: 48px; }
    .spark { height: 48px; margin-top: var(--site-space-4); }
    .stats { gap: var(--site-space-6); margin-top: var(--site-space-4); }
  }
</style>
