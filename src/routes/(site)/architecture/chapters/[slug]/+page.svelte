<script>
  import '../../../../../site/architecture/arch.css';
  import DocArticle from '../../../../../site/docs/DocArticle.svelte';
  import { registry } from '../../../../../site/architecture/widget-registry.js';

  let { data } = $props();

  // The live widget of the chapter (its `xray` id), right after the first paragraph. No id, or an id nobody registered: nothing.
  const Widget = $derived(data.xray ? (registry[data.xray] ?? null) : null);
</script>

<div class="chapter">
  <span class="label eyebrow">CHAPTER {data.chapter.number}</span>
  <h1>{data.chapter.title}</h1>

  {#if data.lead}
    <div class="arch-lead"><DocArticle doc={data.lead} label={data.chapter.title} /></div>
  {/if}

  {#if Widget}
    <section class="widget" aria-label="Live editor under X-ray" data-testid="chapter-widget" data-xray={data.xray}>
      <Widget />
    </section>
  {/if}

  {#if data.rest}
    <div class="arch-body"><DocArticle doc={data.rest} label="{data.chapter.title} (continued)" /></div>
  {/if}

  <footer class="foot">
    {#if data.adrs.length}
      <span class="caption">Decisions behind this chapter</span>
      {#each data.adrs as adr (adr.id)}
        {#if adr.href}
          <a class="chip" href={adr.href}>{adr.label}</a>
        {:else}
          <span class="chip" title="This record does not exist">{adr.label}</span>
        {/if}
      {/each}
    {/if}
    {#if data.prev}<a class="step prev" rel="prev" href={data.prev.href}>← {data.prev.label}</a>{/if}
    <a class="step next" rel="next" href={data.next.href}>{data.next.label} →</a>
  </footer>
</div>

<style>
  .chapter {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 900px;
    min-width: 0;
  }
  .eyebrow {
    color: var(--site-accent);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(32px, 6vw, 48px);
    line-height: 1.05;
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }
  .widget {
    min-width: 0;
  }
  .arch-body {
    min-width: 0;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: var(--site-space-4);
    padding-top: var(--site-space-3);
    border-top: 1px solid var(--site-border-subtle);
  }
  .caption {
    color: var(--site-text-subtle);
    font-size: 13px;
  }
  .chip {
    padding: 5px 10px;
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-pill);
    color: var(--site-text);
    font: 400 12px / 1.4 var(--site-font-mono);
    text-decoration: none;
  }
  a.chip:hover {
    border-color: var(--site-accent);
    color: var(--site-accent);
  }
  .step {
    font-weight: 500;
    font-size: 15px;
  }
  .next {
    margin-left: auto;
    color: var(--site-accent);
  }
  .prev {
    color: var(--site-text-muted);
    text-decoration: none;
  }
  .prev:hover {
    color: var(--site-text);
  }
</style>
