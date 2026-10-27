<script>
  let { data } = $props();

  /** The first sentence of a description: the index shows a line, the page itself carries the rest. @param {string} text */
  const first = (text) => (text.match(/^.*?[.:](?=\s|$)/)?.[0] ?? text).replace(/[:]$/, '.');
</script>

<header class="head">
  <span class="crumb">Documentation</span>
  <h1>Docs</h1>
  <p class="lead">
    How to use Nabu, from the first editor to a synced, themed, extended one. Every page here is a Nabu document in read-only mode, the
    editor itself drawing its own manual. The exact signatures are in the <a href="/api">API reference</a>.
  </p>
</header>

{#each data.sections as section (section.id)}
  <section class="group" aria-labelledby={section.id}>
    <h2 id={section.id}>{section.title}</h2>
    <p class="blurb">{section.blurb}</p>
    <ul class="pages">
      {#each section.pages as p (p.href)}
        <li>
          <a class="name" href={p.href}>{p.title}</a>
          <span class="summary">{first(p.description)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/each}

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
  .lead a {
    color: var(--site-accent);
  }
  .group {
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
    scroll-margin-top: var(--site-space-4);
  }
  .blurb {
    margin: 0;
    color: var(--site-text-muted);
  }
  .pages {
    display: flex;
    flex-direction: column;
    margin: var(--site-space-2) 0 0;
    padding: 0;
    list-style: none;
  }
  .pages li {
    display: grid;
    grid-template-columns: minmax(150px, 260px) 1fr;
    gap: var(--site-space-4);
    padding: 10px 0;
    border-bottom: 1px solid var(--site-border-subtle);
    font-size: var(--site-fs-small);
  }
  .name {
    color: var(--site-text);
    font-weight: 600;
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
  @media (max-width: 639.98px) {
    .pages li {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
