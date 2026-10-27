<section class="container head">
  <h1>Labs</h1>
  <p class="lead">Small, honest experiments you can run in your browser. Don't take our word for it.</p>
</section>

<section class="container list" aria-label="Available labs">
  <a class="lab" href="/labs/performance" data-testid="lab-card-performance">
    <span class="label eyebrow">Lab 01</span>
    <h2>Performance</h2>
    <p>Load up to 10,000 blocks and keep typing. A meter times every keystroke, from the key to the screen.</p>
    <span class="open">Open the lab →</span>
  </a>
</section>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-5);
    padding-block: var(--site-space-18) var(--site-space-8);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: var(--site-fs-h1);
    line-height: var(--site-lh-heading);
    letter-spacing: var(--site-ls-heading);
  }
  .lead {
    margin: 0;
    max-width: 640px;
    color: var(--site-text-muted);
    font-size: var(--site-fs-lead);
    line-height: var(--site-lh-lead);
  }
  .list {
    padding-bottom: var(--site-space-16);
  }
  .lab {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--site-space-3);
    max-width: 560px;
    padding: var(--site-space-6);
    background: var(--site-surface);
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    text-decoration: none;
  }
  .lab:hover { border-color: var(--site-border-strong); background: var(--site-hover-bg); }
  .eyebrow { color: var(--site-accent); text-transform: uppercase; }
  h2 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: var(--site-fs-h3);
    line-height: var(--site-lh-h3);
    letter-spacing: var(--site-ls-h3);
  }
  p {
    margin: 0;
    color: var(--site-text-muted);
    font-size: var(--site-fs-body);
    line-height: var(--site-lh-body);
  }
  .open { color: var(--site-accent); font-weight: 500; }
  @media (max-width: 759.98px) {
    .head { padding-block: var(--site-space-10) var(--site-space-5); }
    h1 { font-size: 36px; }
  }
</style>
