<script>
  let copied = $state(false);
  let timeout;

  const command = 'npm install @aionbuilders/nabu';

  function handleCopy() {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(command).then(() => {
      copied = true;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        copied = false;
      }, 1800);
    });
  }
</script>

<button
  class="snippet"
  class:copied
  onclick={handleCopy}
  title="Click to copy"
  aria-label="Copy install command to clipboard"
>
  <span class="prompt">$</span>
  <span class="command">{command}</span>
  <span class="copy-indicator">
    {#if copied}
      <span class="check">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Copied
      </span>
    {:else}
      <span class="copy-icon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="4" rx="1"/>
          <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>
        </svg>
      </span>
    {/if}
  </span>
</button>

<style>
  .snippet {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    background: var(--color-bg-tertiary);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    font-size: 12px;
    color: var(--color-text);
    transition: background 120ms ease, border-color 120ms ease;
  }

  .snippet:hover {
    background: var(--color-bg);
    border-color: rgba(79, 70, 229, 0.3);
  }

  .snippet.copied {
    border-color: var(--color-success);
  }

  .prompt {
    color: var(--color-text-faint);
    user-select: none;
    flex-shrink: 0;
  }

  .command {
    flex: 1;
    color: var(--color-text);
  }

  .copy-indicator {
    flex-shrink: 0;
    min-width: 52px;
    text-align: right;
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  .copy-icon {
    color: var(--color-text-faint);
    display: flex;
    align-items: center;
    transition: color 120ms ease;
  }

  .snippet:hover .copy-icon {
    color: var(--color-text-muted);
  }

  .check {
    color: var(--color-success);
    font-family: system-ui, sans-serif;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
</style>
