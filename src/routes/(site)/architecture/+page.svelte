<script>
  import '../../../site/architecture/arch.css';
  import Inline from '../../../site/architecture/Inline.svelte';
  import { ARCH_LEAD, ENTRY_CARDS, SWITCH } from '../../../site/architecture/data.js';

  let { data } = $props();

  const nn = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const records = $derived(`${data.counts.all} records, ${data.counts.superseded} superseded.`);
</script>

<div class="container">
  <section class="hero">
    <div class="intro">
      <span class="label eyebrow">ARCHITECTURE</span>
      <h1>How Nabu works,<br />and why it works that way.</h1>
      <p class="lead">{ARCH_LEAD}</p>
    </div>
    <aside class="switch" aria-labelledby="switch-title">
      <h2 id="switch-title">{SWITCH.title}</h2>
      <ul>
        {#each SWITCH.items as item (item.text)}
          <li>
            <span class="verdict {item.verdict}">{item.verdict}</span>
            <span><Inline text={item.text} /></span>
          </li>
        {/each}
      </ul>
      <a class="more" href={SWITCH.more.href}>{SWITCH.more.label} →</a>
    </aside>
  </section>

  <section class="story" aria-label="Chapters">
    <div class="story-head">
      <h2 class="label">THE STORY · {data.story.length} CHAPTERS</h2>
      <span class="hint">each chapter has a live editor under X-ray</span>
    </div>
    <ol class="chapters">
      {#each data.story as c (c.n)}
        <li>
          {#if c.href}
            <a class="row" href={c.href}>
              <span class="n">{nn(c.n)}</span>
              <span class="text"><span class="title">{c.title}</span><span class="desc">{c.description}</span></span>
              <span class="adrs label">{c.adrLine}</span>
            </a>
          {:else}
            <div class="row soon">
              <span class="n">{nn(c.n)}</span>
              <span class="text"><span class="title">{c.title}</span><span class="desc">{c.description}</span></span>
              <span class="adrs label">{c.adrLine}</span>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  </section>

  <section class="entries" aria-label="More">
    <a class="card" href={ENTRY_CARDS.limits.href}>
      <span class="label eyebrow accent">{ENTRY_CARDS.limits.eyebrow.toUpperCase()}</span>
      <h2>{ENTRY_CARDS.limits.title}</h2>
      <span class="blurb">{ENTRY_CARDS.limits.blurb}</span>
    </a>
    <a class="card" href={ENTRY_CARDS.records.href}>
      <span class="label eyebrow">{ENTRY_CARDS.records.eyebrow.toUpperCase()}</span>
      <h2>{ENTRY_CARDS.records.title}</h2>
      <span class="blurb">{ENTRY_CARDS.records.blurb} {records}</span>
    </a>
    <a class="card" href={ENTRY_CARDS.made.href}>
      <span class="label eyebrow">{ENTRY_CARDS.made.eyebrow.toUpperCase()}</span>
      <h2>{ENTRY_CARDS.made.title}</h2>
      <span class="blurb">{ENTRY_CARDS.made.blurb}</span>
    </a>
  </section>
</div>

<style>
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: var(--site-space-12);
    align-items: center;
    padding-block: var(--site-space-18) var(--site-space-10);
  }
  .intro {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .eyebrow {
    color: var(--site-text-subtle);
  }
  .eyebrow.accent {
    color: var(--site-accent);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(34px, 5.1vw, 52px);
    line-height: 1.04;
    letter-spacing: -0.03em;
  }
  .lead {
    max-width: 640px;
    margin: 0;
    color: var(--site-text-muted);
    font-size: 19px;
    line-height: 1.6;
  }

  .switch {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px 24px;
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    background: var(--site-surface);
  }
  .switch h2 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 20px;
  }
  .switch ul {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--site-text);
    font-size: 14px;
    line-height: 1.45;
  }
  .switch li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
  }
  .verdict {
    font-family: var(--site-font-mono);
  }
  .verdict.yes {
    color: var(--arch-ok);
  }
  .verdict.wait {
    color: var(--site-accent);
  }
  .more {
    color: var(--site-accent);
    font-weight: 500;
    font-size: 14px;
  }

  .story {
    padding-top: var(--site-space-6);
  }
  .story-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--site-space-2) var(--site-space-6);
    padding-bottom: 10px;
  }
  .story-head h2 {
    margin: 0;
    color: var(--site-text-subtle);
    font-weight: 500;
    letter-spacing: 0.08em;
  }
  .hint {
    color: var(--site-text-subtle);
    font-size: 13px;
  }
  .chapters {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    gap: 18px;
    align-items: baseline;
    padding: 20px 4px;
    border-top: 1px solid var(--site-border-subtle);
    color: inherit;
    text-decoration: none;
  }
  li:last-child .row {
    border-bottom: 1px solid var(--site-border-subtle);
  }
  .n {
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 22px;
    color: var(--site-accent);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .title {
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 22px;
    letter-spacing: -0.01em;
    color: var(--site-text);
  }
  a.row:hover .title {
    color: var(--site-accent);
  }
  .desc {
    color: var(--site-text-muted);
    font-size: 15px;
    line-height: 1.5;
  }
  .adrs {
    color: var(--site-text-subtle);
    white-space: nowrap;
  }
  .soon .title,
  .soon .n {
    color: var(--site-text-subtle);
  }

  .entries {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 20px;
    padding-block: var(--site-space-12) var(--site-space-16);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 24px;
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    background: var(--site-surface);
    text-decoration: none;
  }
  .card:hover {
    border-color: var(--site-border-strong);
  }
  .card h2 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 24px;
    color: var(--site-text);
  }
  .blurb {
    color: var(--site-text-muted);
    font-size: 15px;
    line-height: 1.55;
  }

  @media (max-width: 959.98px) {
    .hero {
      grid-template-columns: 1fr;
      gap: var(--site-space-8);
      padding-block: var(--site-space-10) var(--site-space-6);
    }
  }
  @media (max-width: 639.98px) {
    .row {
      grid-template-columns: 40px minmax(0, 1fr);
      gap: 4px 12px;
    }
    .adrs {
      grid-column: 2;
    }
    .title,
    .n {
      font-size: 20px;
    }
    .entries {
      grid-template-columns: 1fr;
    }
  }
</style>
