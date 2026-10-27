<script>
  import '../../../../site/architecture/arch.css';
  import Inline from '../../../../site/architecture/Inline.svelte';
  import { LIMITS, LIMITS_LEAD, LIMITS_TITLE, LIMITS_UPDATED, STATUSES, sourceUrl } from '../../../../site/architecture/limits.js';

  let { data } = $props();
</script>

<div class="container limits">
  <span class="label eyebrow">ARCHITECTURE · THE LIMITS</span>
  <h1>{LIMITS_TITLE}</h1>
  <p class="lead">{LIMITS_LEAD}</p>
  <p class="updated">
    Updated <time datetime={LIMITS_UPDATED}>{LIMITS_UPDATED}</time> · at release <a href="/changelog">{data.version}</a>
  </p>

  <div class="list">
    {#each LIMITS as limit (limit.id)}
      {@const status = STATUSES[limit.status]}
      <article class="limit" id={limit.id} data-testid="limit">
        <div class="body">
          <div class="head">
            <h2>{limit.title}</h2>
            <span class="status {status.tone}">{status.label}</span>
          </div>
          <p><Inline text={limit.description} /></p>
        </div>
        <div class="figure">
          <span class="value">{limit.value}</span>
          <span class="unit">{limit.unit}</span>
          <a class="source" href={sourceUrl(limit.source)} rel="noopener" title="The file that measures or states this">{limit.source.label}</a>
        </div>
      </article>
    {/each}
  </div>
</div>

<style>
  .limits {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 980px;
    padding-block: var(--site-space-16) var(--site-space-16);
  }
  .eyebrow {
    color: var(--site-accent);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(32px, 6vw, 52px);
    line-height: 1.04;
    letter-spacing: -0.03em;
  }
  .lead {
    max-width: 720px;
    margin: 0 0 12px;
    color: var(--site-text-muted);
    font-size: 19px;
    line-height: 1.6;
  }
  .updated {
    margin: 0;
    color: var(--site-text-subtle);
    font-size: 13px;
  }
  .updated a {
    color: var(--site-text-muted);
  }
  .list {
    margin-top: var(--site-space-2);
  }
  .limit {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 190px;
    gap: 24px;
    padding: 22px 0;
    border-top: 1px solid var(--site-border-subtle);
    scroll-margin-top: var(--site-space-4);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
  }
  h2 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 22px;
    letter-spacing: -0.01em;
  }
  .status {
    font: 500 12px / 1.4 var(--site-font-mono);
  }
  .status.fix {
    color: var(--site-accent);
  }
  .status.plan {
    color: var(--arch-warn);
  }
  .status.design {
    color: var(--site-peer);
  }
  p {
    max-width: 680px;
    margin: 0;
    color: var(--site-text);
    font-size: 16px;
    line-height: 1.65;
  }
  p :global(code) {
    padding: 2px 6px;
    border-radius: 6px;
    background: var(--site-hover-bg);
    font: 500 0.875em / 1.4 var(--site-font-mono);
  }
  .figure {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
    text-align: right;
  }
  .value {
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 30px;
    line-height: 1.15;
    color: var(--site-text);
  }
  .unit {
    color: var(--site-text-subtle);
    font-size: 12px;
    line-height: 1.4;
  }
  .source {
    margin-top: 6px;
    color: var(--site-text-subtle);
    font: 400 11px / 1.4 var(--site-font-mono);
    overflow-wrap: anywhere;
    text-decoration-color: var(--site-border-strong);
    text-underline-offset: 3px;
  }
  .source:hover {
    color: var(--site-accent);
  }
  @media (max-width: 639.98px) {
    .limit {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .figure {
      align-items: flex-start;
      text-align: left;
    }
  }
</style>
