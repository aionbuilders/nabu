<script>
  /** One brand colour: a swatch whose hex code is a button that copies it. @type {{ color: (typeof import('./palette.js').PALETTE)[number] }} */
  let { color } = $props();

  let copied = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  /** @param {string} text */
  async function write(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Not a secure context, or the permission was refused: the old way still works from a click.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  async function copy() {
    if (!(await write(color.hex))) return;
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1600);
  }
</script>

<div class="swatch" data-testid="swatch-{color.id}">
  <div class="chip" class:outline={color.outline} style:background={color.hex} style:color={color.on}>
    <button type="button" class="copy" onclick={copy} aria-label="Copy {color.hex}" data-hex={color.hex}>
      <span class="hex">{color.hex}</span>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        {#if copied}
          <path d="M3 8.5l3.2 3L13 4.5" />
        {:else}
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
        {/if}
      </svg>
    </button>
  </div>
  <div class="meta">
    <span class="name">{color.name}</span>
    <span class="role">{color.role}</span>
  </div>
  <span class="sr-only" role="status">{copied ? `${color.hex} copied` : ''}</span>
</div>

<style>
  .swatch {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .chip {
    display: flex;
    align-items: flex-end;
    height: 120px;
    border-radius: 14px;
  }
  .chip.outline {
    border: 1px solid #2a2a2e;
  }
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    margin: 0 0 2px 2px;
    padding: 0 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: 400 13px / 1 var(--site-font-mono);
    cursor: pointer;
  }
  .copy:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .copy:focus-visible {
    outline-color: currentColor;
  }
  .copy svg {
    flex: none;
    opacity: 0.75;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
    line-height: 1.4;
  }
  .role {
    font-size: 13px;
    line-height: 1.45;
    color: var(--site-text-muted);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
