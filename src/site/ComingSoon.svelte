<script>
  /** @type {{ title: string, blurb?: string }} */
  let { title, blurb = 'This section of the new site is being written.' } = $props();
</script>

<section class="container soon">
  <span class="label eyebrow">Coming soon</span>
  <h1>{title}</h1>
  <p>{blurb}</p>
  <a href="/">Back to the home page</a>
</section>

<style>
  .soon {
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
  }
  a {
    color: var(--site-accent);
    font-weight: 500;
  }
</style>
