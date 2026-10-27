<script>
  import HeroEditor from '../../site/HeroEditor.svelte';
</script>

<section class="container hero">
  <h1>Every keystroke,<br />accounted for.</h1>
  <p class="lead">A block editor whose truth is a CRDT. Type on the left, watch the model move on the right.</p>
</section>

<div class="container">
  <HeroEditor />
</div>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-5);
    padding-block: var(--site-space-18) var(--site-space-10);
  }
  h1 {
    margin: 0;
    max-width: 960px;
    font-family: var(--site-font-display);
    font-weight: 700;
    /* 76px from ~724px wide up; scales down so "Every keystroke," never overflows a phone. */
    font-size: clamp(36px, 10.5vw, var(--site-fs-display));
    line-height: var(--site-lh-display);
    letter-spacing: var(--site-ls-display);
    overflow-wrap: break-word;
  }
  .lead {
    margin: 0;
    max-width: 640px;
    color: var(--site-text-muted);
    font-size: var(--site-fs-lead);
    line-height: var(--site-lh-lead);
  }
</style>
