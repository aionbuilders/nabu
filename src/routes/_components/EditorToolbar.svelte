<script>
  // TODO: toolbar buttons — bold, italic, underline, code, strikethrough, block type selector
  // Wire via nabu.exec('bold'), nabu.exec('heading:1'), etc.
  // Active state via nabu.isMarkActive() — not yet exposed on Nabu instance

  let { engine = null } = $props();
</script>

<div class="toolbar">
  <span class="placeholder">Toolbar coming soon</span>
</div>

<style>
  .toolbar {
    height: 40px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    background: var(--color-bg);
  }

  .placeholder {
    font-size: 12px;
    color: var(--color-text-faint);
    user-select: none;
  }
</style>
