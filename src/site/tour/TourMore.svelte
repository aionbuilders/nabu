<script>
  import TourDoc from './TourDoc.svelte';

  /**
   * What the blocks are not: the text behaviours ("what happens as you type") and the four paste readers ("what happens when you paste"), each a before and an
   * after (the after is a real Nabu document, drawn like every other example), then the `block` extension ("Turn into") and the way on to writing your own.
   * @type {{
   *   typing: Array<any>,
   *   paste: Array<any>,
   *   transform: any,
   * }}
   */
  let { typing, paste, transform } = $props();
</script>

{#snippet pair(/** @type {any} */ m)}
  <article class="case" data-case={m.name}>
    <div class="head">
      <h3>{m.title}</h3>
      <a class="name" href={m.reference.href} title="Everything about it, in the Blocks reference">{m.name}</a>
    </div>
    <div class="row">
      <div class="before" class:keys={m.beforeKind === 'keys'}><span class="sr">Before: </span>{m.before}</div>
      <span class="arrow" aria-hidden="true">→</span>
      <div class="after"><span class="sr">After: </span><TourDoc doc={m.doc} label={`${m.title}: the result`} variant="after" /></div>
    </div>
    <p>{m.sentence}</p>
  </article>
{/snippet}

<div class="more">
  <section class="group" aria-labelledby="typing-title" data-testid="tour-typing">
    <div class="title">
      <span class="kicker">NOT BLOCKS, BUT EVERYWHERE</span>
      <h2 id="typing-title">What happens as you type</h2>
    </div>
    <div class="cases three">
      {#each typing as m (m.name)}{@render pair(m)}{/each}
    </div>
  </section>

  <section class="group" aria-labelledby="paste-title" data-testid="tour-paste">
    <div class="title">
      <h2 id="paste-title">What happens when you paste</h2>
    </div>
    <div class="cases two">
      {#each paste as m (m.name)}{@render pair(m)}{/each}
    </div>
  </section>

  <section class="end" aria-label="Turn into, and your own blocks" data-testid="tour-end">
    <article class="case transform" data-case={transform.name}>
      <div class="head">
        <h3>{transform.title}</h3>
        <a class="name" href={transform.reference.href} title="Everything about it, in the Blocks reference">{transform.name}</a>
      </div>
      <p>{transform.sentence} <code>{transform.call}</code></p>
    </article>
    <a class="case own" href="/docs/guides/extensions">
      <span class="head"><h3>Make your own block <span aria-hidden="true">→</span></h3></span>
      <span class="own-text">A block is one extension. The extensions guide walks you through one.</span>
    </a>
  </section>
</div>

<style>
  .more {
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .title {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .kicker {
    color: var(--site-text-subtle);
    font: 500 12px / 1.4 var(--site-font-mono);
    letter-spacing: 0.08em;
  }
  h2 {
    margin: 0;
    font: 700 clamp(28px, 5vw, 36px) / 1.15 var(--site-font-display);
    letter-spacing: var(--site-ls-heading);
  }
  .cases {
    display: grid;
    gap: 18px;
  }
  .cases.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .cases.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .case {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    padding: 20px;
    border: 1px solid var(--site-border);
    border-radius: 16px;
    background: var(--site-surface);
    color: inherit;
    text-decoration: none;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font: 700 19px / 1.25 var(--site-font-display);
  }
  .name {
    color: var(--site-text-subtle);
    font: 400 12px / 1.4 var(--site-font-mono);
    text-decoration: none;
    text-align: right;
  }
  .name:hover {
    color: var(--site-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: stretch;
    gap: 10px;
  }
  .before,
  .after {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 64px;
    padding: 12px 14px;
    border: 1px solid var(--site-border);
    border-radius: 10px;
    background: var(--site-surface-2);
  }
  .before {
    color: var(--site-text-muted);
    font: 400 13px / 1.6 var(--site-font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .arrow {
    align-self: center;
    color: var(--site-accent);
    font-size: 18px;
  }
  p {
    margin: 0;
    color: var(--site-text-muted);
    font-size: 14px;
    line-height: 1.55;
  }
  p code {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--site-hover-bg);
    color: var(--site-text);
    font: 500 12.5px / 1.4 var(--site-font-mono);
    overflow-wrap: anywhere;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .end {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }
  .own:hover {
    border-color: var(--site-border-strong);
  }
  .own:hover h3 {
    color: var(--site-accent);
  }
  .own-text {
    color: var(--site-text-muted);
    font-size: 14px;
    line-height: 1.55;
  }

  @media (max-width: 899.98px) {
    .cases.three,
    .cases.two,
    .end {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 479.98px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }
    .arrow {
      justify-self: center;
      transform: rotate(90deg);
    }
  }
</style>
