<script>
  import Logo from './Logo.svelte';
  import { FOOTER_COLUMNS } from './nav.js';
</script>

<footer class="site-footer">
  <div class="container">
    <div class="inner">
      <div class="about">
        <a class="brand" href="/" aria-label="Nabu, home"><Logo width={92} /></a>
        <p>A block editor for the web, built on a CRDT.<br />MIT licensed. Built with Nabu.</p>
      </div>
      {#each FOOTER_COLUMNS as column (column.title)}
        <nav class="column" aria-label={column.title}>
          <strong>{column.title}</strong>
          {#each column.links as link (link.label)}
            <a href={link.href}>{link.label}</a>
          {/each}
        </nav>
      {/each}
    </div>
  </div>
</footer>

<style>
  .site-footer {
    margin-top: var(--site-space-6);
    border-top: 1px solid var(--site-border-subtle);
  }
  .inner {
    display: flex;
    flex-wrap: wrap;
    gap: var(--site-space-10);
    padding-block: var(--site-space-10) var(--site-space-12);
    font-size: var(--site-fs-small);
    line-height: var(--site-lh-body);
    color: var(--site-text-muted);
  }
  .about {
    display: flex;
    flex: 1 1 260px;
    flex-direction: column;
    gap: 14px;
  }
  .about p {
    margin: 0;
  }
  .brand {
    display: flex;
    align-self: flex-start;
    border-radius: var(--site-radius-control);
  }
  .column {
    display: flex;
    flex: 0 1 160px;
    flex-direction: column;
    gap: 10px;
  }
  .column strong {
    color: var(--site-text);
    font-weight: 600;
  }
  .column a {
    color: inherit;
    text-decoration: none;
  }
  .column a:hover {
    color: var(--site-text);
  }

  @media (max-width: 759.98px) {
    .inner {
      flex-direction: column;
      gap: var(--site-space-8);
    }
    .about,
    .column {
      flex: none;
    }
    .column a {
      display: flex;
      align-items: center;
      min-height: 32px;
    }
  }
</style>
