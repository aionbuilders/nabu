<script>
  let { data } = $props();
</script>

<header class="head">
  <span class="crumb">Reference</span>
  <h1>API reference</h1>
  <p class="lead">
    Everything the package exports, generated from the source's JSDoc at build time. Three entry points, each with its own
    import path. This is version <code class="doc-code">{data.version}</code>.
  </p>
</header>

{#each data.entries as entry (entry.id)}
  <section class="entry" aria-labelledby="entry-{entry.id}">
    <h2 id="entry-{entry.id}"><code>{entry.specifier}</code></h2>
    <p class="entry-summary">{entry.summary}</p>
    {#each entry.groups as group (group.kind)}
      <h3>{group.title} <span class="count">{group.items.length}</span></h3>
      <ul class="exports">
        {#each group.items as item (item.name)}
          <li>
            <a class="name" href={item.href}>{item.name}</a>
            <span class="summary">{@html item.summaryHtml}</span>
          </li>
        {/each}
      </ul>
    {/each}
  </section>
{/each}

<section class="entry unstable" aria-labelledby="internals">
  <h2 id="internals"><code>nabu.internals</code></h2>
  <p class="entry-summary">
    The door to the engine machinery behind the stable contract. <strong>Unstable: may change in any minor version.</strong>
    <a href="/api/internals">Read the warning and the keys &rarr;</a>
  </p>
</section>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-3);
  }
  .crumb {
    font-size: 13px;
    color: var(--site-text-subtle);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(32px, 6vw, var(--site-fs-h1));
    line-height: var(--site-lh-heading);
    letter-spacing: var(--site-ls-heading);
  }
  .lead {
    margin: 0;
    font-size: 18px;
    color: var(--site-text-muted);
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-2);
    margin-top: var(--site-space-8);
    scroll-margin-top: var(--site-space-4);
  }
  h2 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 26px;
    letter-spacing: var(--site-ls-h3);
    overflow-wrap: anywhere;
    scroll-margin-top: var(--site-space-4);
  }
  h2 code {
    font: inherit;
  }
  .entry-summary {
    margin: 0;
    color: var(--site-text-muted);
  }
  .unstable {
    padding: 14px 16px;
    border: 1px solid var(--site-note-border);
    border-radius: var(--site-radius-card-sm);
    background: var(--site-note-bg);
  }
  .unstable a {
    color: var(--site-accent);
    font-weight: 500;
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: var(--site-space-2);
    margin: var(--site-space-5) 0 0;
    color: var(--site-text-subtle);
    font: 500 var(--site-fs-label) / var(--site-lh-label) var(--site-font-mono);
    letter-spacing: var(--site-ls-label);
    text-transform: uppercase;
  }
  .count {
    font-weight: 400;
  }
  .exports {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .exports li {
    display: grid;
    grid-template-columns: minmax(150px, 260px) 1fr;
    gap: var(--site-space-4);
    padding: 9px 0;
    border-bottom: 1px solid var(--site-border-subtle);
    font-size: var(--site-fs-small);
  }
  .name {
    color: var(--site-text);
    font: 500 14px/1.5 var(--site-font-mono);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .name:hover {
    color: var(--site-accent);
  }
  .summary {
    color: var(--site-text-muted);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .summary :global(code) {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--site-hover-bg);
    font: 500 0.9em var(--site-font-mono);
  }
  .summary :global(a) {
    color: var(--site-accent);
  }
  @media (max-width: 639.98px) {
    .exports li {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
