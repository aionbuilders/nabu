<script>
  import PerfLab from '../../../../site/PerfLab.svelte';
</script>

<section class="container head">
  <a class="back label" href="/labs">Labs</a>
  <h1>10,000 blocks.<br />One frame.</h1>
  <p class="lead">Load a whole book into a real Nabu editor, then type anywhere in it. The meter times every keystroke, from the key to the pixels.</p>
</section>

<div class="container lab">
  <PerfLab />
</div>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-5);
    padding-block: var(--site-space-16) var(--site-space-8);
  }
  .back {
    align-self: flex-start;
    color: var(--site-accent);
    text-decoration: none;
    text-transform: uppercase;
  }
  .back:hover { text-decoration: underline; text-underline-offset: 3px; }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(36px, 8.5vw, var(--site-fs-h1));
    line-height: var(--site-lh-heading);
    letter-spacing: var(--site-ls-heading);
    overflow-wrap: break-word;
  }
  .lead {
    margin: 0;
    max-width: 640px;
    color: var(--site-text-muted);
    font-size: var(--site-fs-lead);
    line-height: var(--site-lh-lead);
  }
  .lab {
    padding-bottom: var(--site-space-16);
  }
  @media (max-width: 759.98px) {
    .head { padding-block: var(--site-space-10) var(--site-space-5); }
  }
</style>
