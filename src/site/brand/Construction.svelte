<script>
  import { lockupDark, classed, inner } from './assets.js';
  import { GUIDES, MARK_TOP, MARK_WIDTH, MARK_HEIGHT, WORD_X } from './construction.js';

  // The drawing overlays guides on the REAL lockup: its markup (brand/nabu-logo-dark.svg, fills turned into classes so the
  // theme colours them) is drawn in the same coordinates, origin on the baseline. The guides come from construction.js.
  const lockup = inner(classed(lockupDark));

  const LEFT = -140;
  const RIGHT = 650;
  const GAP_Y = MARK_TOP - 22; // the "0.3 H" dimension line, above the mark
  const H_X = -22; // the "H" dimension line, left of the mark
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be reachable by keyboard) -->
<div class="frame" role="region" aria-label="Construction drawing of the lockup, scrollable" tabindex="0">
  <svg viewBox="-150 -130 900 190" role="img" aria-label="Construction of the Nabu lockup: the mark is 1.2 times the ascender, centred on half the x-height, 0.3 of its height away from the word." data-testid="construction">
    {#each GUIDES as g (g.id)}
      <line class="guide" class:accent={g.accent} x1={LEFT} x2={RIGHT} y1={g.y} y2={g.y} />
      <text class="note" x={RIGHT + 4} y={g.y + 3.5}>{g.label}</text>
    {/each}
    <rect class="box" x="0" y={MARK_TOP} width={MARK_WIDTH} height={MARK_HEIGHT} />
    <g class="lockup">{@html lockup}</g>
    <line class="dim" x1={MARK_WIDTH} x2={WORD_X} y1={GAP_Y} y2={GAP_Y} />
    <line class="dim" x1={MARK_WIDTH} x2={MARK_WIDTH} y1={GAP_Y - 4} y2={GAP_Y + 4} />
    <line class="dim" x1={WORD_X} x2={WORD_X} y1={GAP_Y - 4} y2={GAP_Y + 4} />
    <text class="dim-label" x={(MARK_WIDTH + WORD_X) / 2} y={GAP_Y - 6} text-anchor="middle">0.3 H</text>
    <line class="dim" x1={H_X} x2={H_X} y1={MARK_TOP} y2={MARK_TOP + MARK_HEIGHT} />
    <text class="dim-label" x={H_X - 6} y="-24" text-anchor="end">H = 1.2 × asc.</text>
  </svg>
</div>

<style>
  .frame {
    overflow-x: auto;
    background: var(--site-surface-2);
    border: 1px solid var(--site-border);
    border-radius: 18px;
    padding: 36px 28px;
  }
  svg {
    display: block;
    width: 100%;
    min-width: 700px; /* below this the labels stop being legible: the frame scrolls instead */
    height: auto;
  }
  .guide {
    stroke: color-mix(in srgb, var(--site-text) 24%, transparent);
    stroke-width: 1;
    stroke-dasharray: 4 4;
    vector-effect: non-scaling-stroke;
  }
  .guide.accent {
    stroke: var(--site-accent);
  }
  .box,
  .dim {
    fill: none;
    stroke: var(--site-accent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .note,
  .dim-label {
    font: 400 10.5px var(--site-font-mono);
    fill: var(--site-text-subtle);
  }
  .dim-label {
    fill: var(--site-accent);
  }
  .lockup :global(.mark) {
    fill: var(--site-logo-mark);
    opacity: 0.9;
  }
  .lockup :global(.word) {
    fill: var(--site-logo-text);
  }
  @media (max-width: 759.98px) {
    .frame {
      padding: 20px 16px;
    }
  }
</style>
