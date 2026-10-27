<script>
  /** @type {{ tone?: 'neutral' | 'stable' | 'unstable', children: import('svelte').Snippet }} */
  let { tone = 'neutral', children } = $props();
</script>

<span class="badge" data-tone={tone}>{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-pill);
    color: var(--site-text-muted);
    font: 500 var(--site-fs-label) / var(--site-lh-label) var(--site-font-mono);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .badge[data-tone='stable']::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--site-peer);
  }
  .badge[data-tone='unstable'] {
    border-color: var(--site-accent);
    color: var(--site-accent);
  }
  .badge[data-tone='unstable']::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--site-accent);
  }
</style>
