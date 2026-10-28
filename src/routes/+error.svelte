<script>
  import { page } from '$app/state';
  import Shell from '../site/Shell.svelte';

  // Not found is the common case and gets the brand's voice; anything else is a fault on our side, said plainly.
  // The title and `noindex` come from the root layout, which owns the head.
  const notFound = $derived(page.status === 404);
</script>

<Shell>
  <section class="container lost" data-testid="error-page">
    <span class="label eyebrow">{page.status}</span>
    {#if notFound}
      <h1>Nobody has crossed here.</h1>
      <p>There is no page at <code>{page.url.pathname}</code>. It may have moved, or the link may be wrong.</p>
    {:else}
      <h1>Something went wrong.</h1>
      <p>The page could not be shown. Try again in a moment; if it keeps happening, the issue tracker on GitHub is the place to say so.</p>
    {/if}
    <p class="links">
      <a href="/">Back to the home page</a>
      <a href="/docs">Read the docs</a>
    </p>
  </section>
</Shell>

<style>
  .lost {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--site-space-5);
    padding-block: var(--site-space-18) var(--site-space-16);
  }
  .eyebrow {
    color: var(--site-accent);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: var(--site-fs-h1);
    line-height: var(--site-lh-heading);
    letter-spacing: var(--site-ls-heading);
  }
  p {
    margin: 0;
    max-width: 640px;
    color: var(--site-text-muted);
    font-size: var(--site-fs-lead);
    line-height: var(--site-lh-lead);
    overflow-wrap: anywhere;
  }
  code {
    font-family: var(--site-font-mono);
    font-size: 0.9em;
    color: var(--site-text);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--site-space-6);
  }
  .links a {
    color: var(--site-accent);
    font-weight: 500;
  }
  @media (max-width: 759.98px) {
    .lost { padding-block: var(--site-space-10) var(--site-space-8); }
    h1 { font-size: 36px; }
  }
</style>
