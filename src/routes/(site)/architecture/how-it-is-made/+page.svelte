<script>
  import '@fontsource/newsreader/400.css';
  import '@fontsource/newsreader/400-italic.css';
  import '../../../../site/architecture/arch.css';
  import '../../../../site/architecture/made.css';
  import EssaySwitch from '../../../../site/architecture/EssaySwitch.svelte';
  import { MADE_LEAD, WHO, logUrl } from '../../../../site/architecture/made.js';

  let { data } = $props();
</script>

<div class="container made">
  <header class="top">
    <h1>Written over, <span>not erased.</span></h1>
    <p class="lead">{MADE_LEAD}</p>
  </header>

  <figure class="strata" data-testid="strata">
    <div class="stack" role="img" aria-label={data.strata.label}>
      {#each data.strata.layers as layer (layer.id)}
        <div class="layer {layer.id}" style:flex-basis="{layer.percent}%" data-testid="layer-{layer.id}" data-percent={layer.percent}>
          <span class="name"><span class="title">{layer.title}</span><span class="detail">{layer.detail}</span></span>
          <span class="pct">{layer.percent}%</span>
        </div>
      {/each}
      <div class="rules" aria-hidden="true"></div>
    </div>
    <figcaption>{data.strata.caption}</figcaption>
  </figure>

  <section class="record" aria-labelledby="record-title">
    <div class="head">
      <h2 id="record-title">The record.</h2>
      <p>
        Whose hand made each change. <span class="who k">K.</span> is Killian, <span class="who c">C.</span> is Claude, working under his direction.
        The large lines are the moments where he steered.
      </p>
    </div>
    <ul class="ledger" role="list" aria-label="Commits, oldest first" data-testid="ledger">
      {#each data.rows as row (row.kind + (row.id ?? row.after ?? row.text))}
        {#if row.kind === 'commit'}
          <li class="row commit" data-who={row.who} data-change={row.id}>
            <time datetime={row.date}>{row.date}</time>
            <span class="who {row.who.toLowerCase()}" role="img" aria-label={WHO[row.who].name}>{WHO[row.who].letter}</span>
            <span class="subject">{row.subject}</span>
          </li>
        {:else if row.kind === 'steer'}
          <li class="row steer" data-who="K" data-testid="steer">
            <span class="who k" role="img" aria-label={WHO.K.name}>{WHO.K.letter}</span>
            <p>{row.text}</p>
          </li>
        {:else}
          <li class="row gap" data-testid="gap">{row.text}</li>
        {/if}
      {/each}
    </ul>
    <div class="note" data-testid="ledger-note">
      {#each data.note as sentence (sentence)}
        <p>{sentence}</p>
      {/each}
      <p><a href={logUrl} rel="noopener">The whole log on GitHub →</a></p>
    </div>
  </section>

  <section class="words" id="words" aria-labelledby="words-title">
    <span class="who k mark" aria-hidden="true">K.</span>
    <div class="col">
      <h2 id="words-title">In Killian’s own words</h2>
      <EssaySwitch en={data.en} fr={data.fr} />
    </div>
  </section>
</div>

<style>
  .made {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-12);
    padding-block: var(--site-space-18) var(--site-space-16);
  }

  /* header */
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: var(--site-space-16);
    align-items: end;
  }
  h1 {
    margin: 0;
    font-family: var(--made-serif);
    font-weight: 400;
    font-size: clamp(44px, 8vw, 84px);
    line-height: 0.98;
    letter-spacing: -0.02em;
  }
  h1 span {
    display: block;
  }
  .lead {
    margin: 0;
    color: var(--site-text-muted);
    font-size: 16px;
    line-height: 1.6;
  }

  /* the strata */
  .strata {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: var(--site-space-12);
    align-items: end;
    margin: 0;
  }
  .stack {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 420px;
    border: 1px solid var(--site-border);
  }
  .layer {
    position: relative;
    display: flex;
    flex: 1 1 0;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    min-height: 92px;
    padding: 0 28px 18px;
    border-top: 1px solid color-mix(in srgb, var(--site-text) 8%, transparent);
    color: var(--site-text);
  }
  .layer:first-child {
    border-top: 0;
  }
  .layer.since {
    background: var(--made-top);
  }
  .layer.before {
    flex: 0 0 auto;
    background: var(--made-bottom);
  }
  .name {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .title {
    font-family: var(--made-serif);
    font-size: 26px;
    line-height: 1.2;
  }
  .detail {
    color: var(--site-text-muted);
    font-size: 14px;
    line-height: 1.45;
  }
  .pct {
    font-family: var(--made-serif);
    font-style: italic;
    font-size: 22px;
    line-height: 1.2;
    color: var(--site-text-muted);
  }
  .rules {
    position: absolute;
    inset: 0 28px;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(to bottom, transparent 0, transparent 13px, var(--made-rule-strong) 13px, var(--made-rule-strong) 14px, transparent 14px, transparent 42px),
      repeating-linear-gradient(to bottom, transparent 0, transparent 13px, var(--made-rule) 13px, var(--made-rule) 14px);
  }
  figcaption {
    color: var(--site-text-muted);
    font-size: 14px;
    line-height: 1.6;
  }

  /* the record */
  .record,
  .words {
    width: 100%;
    max-width: 1080px;
    align-self: center;
  }
  .head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: var(--site-space-16);
    align-items: end;
  }
  h2 {
    margin: 0;
    font-family: var(--made-serif);
    font-weight: 400;
    font-size: clamp(40px, 6vw, 56px);
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .head p {
    margin: 0;
    color: var(--site-text-muted);
    font-size: 16px;
    line-height: 1.6;
  }
  .who {
    font-family: var(--made-serif);
    font-style: italic;
    font-size: 26px;
    line-height: 1.2;
  }
  .head .who {
    font-size: inherit;
    line-height: inherit;
  }
  .who.k {
    color: var(--site-accent);
  }
  .who.c {
    color: var(--site-peer);
  }
  .ledger {
    margin: var(--site-space-10) 0 0;
    padding: 0;
    list-style: none;
    border-bottom: 1px solid var(--site-border);
  }
  .row {
    display: grid;
    grid-template-columns: 140px 70px minmax(0, 1fr);
    gap: 0 18px;
    align-items: baseline;
    padding: 12px 0;
    border-top: 1px solid var(--site-border);
  }
  .row time {
    color: var(--site-text-subtle);
    font: 400 13px / 1.5 var(--site-font-mono);
  }
  .subject {
    min-width: 0;
    color: var(--site-text-muted);
    font: 400 15px / 1.55 var(--site-font-mono);
    overflow-wrap: anywhere;
  }
  .row.steer {
    padding: 26px 0;
  }
  .row.steer .who {
    grid-column: 2;
    font-size: 30px;
  }
  .row.steer p {
    grid-column: 3;
    margin: 0;
    font-family: var(--made-serif);
    font-size: 34px;
    line-height: 1.25;
    color: var(--site-text);
  }
  .row.gap {
    display: block;
    padding: 34px 0;
    text-align: center;
    font-family: var(--made-serif);
    font-style: italic;
    font-size: 22px;
    color: var(--site-text-subtle);
  }
  .note {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: var(--site-space-6);
    color: var(--site-text-subtle);
    font-size: 15px;
    line-height: 1.6;
  }
  .note p {
    margin: 0;
  }
  .note a {
    color: var(--site-accent);
  }

  /* his own words */
  .words {
    display: grid;
    grid-template-columns: 140px minmax(0, 1fr);
    gap: 0 18px;
    padding-top: var(--site-space-10);
    border-top: 1px solid var(--site-border);
  }
  .mark {
    font-size: 30px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-6);
    min-width: 0;
  }
  @media (max-width: 959.98px) {
    .top,
    .head,
    .strata {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--site-space-6);
    }
    .made {
      padding-block: var(--site-space-10) var(--site-space-12);
      gap: var(--site-space-10);
    }
  }
  @media (max-width: 639.98px) {
    .stack {
      height: 440px;
    }
    .layer {
      padding: 0 16px 16px;
      min-height: 150px;
    }
    .rules {
      inset: 0 16px;
    }
    .title {
      font-size: 24px;
    }
    .row {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 2px 14px;
    }
    .row .subject {
      grid-column: 1 / -1;
    }
    .row.steer {
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 0 12px;
    }
    .row.steer .who {
      grid-column: 1;
    }
    .row.steer p {
      grid-column: 2;
      font-size: 26px;
    }
    .row.gap {
      padding: 26px 0;
      font-size: 20px;
    }
    .words {
      grid-template-columns: minmax(0, 1fr);
    }
    .mark {
      margin-bottom: var(--site-space-2);
    }
  }
</style>
