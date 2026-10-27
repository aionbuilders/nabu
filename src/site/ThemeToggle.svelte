<script>
  import { onMount } from 'svelte';

  const KEY = 'nabu-site-theme'; // 'dark' | 'light'; absent = follow the system. Read before paint by the script in app.html.
  /** @typedef {'dark' | 'light' | 'system'} Mode */
  /** @type {Mode[]} */
  const ORDER = ['dark', 'light', 'system'];
  /** @type {Record<Mode, string>} */
  const LABELS = { dark: 'Dark', light: 'Light', system: 'System' };

  /** @type {Mode} */
  let mode = $state('system');

  onMount(() => {
    const attr = document.documentElement.dataset.theme;
    mode = attr === 'dark' || attr === 'light' ? attr : 'system';
  });

  const next = $derived(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]);

  /** @param {Mode} m */
  function apply(m) {
    const root = document.documentElement;
    if (m === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', m);
    try {
      if (m === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, m);
    } catch {
      /* storage unavailable (private mode, blocked): the choice just does not persist */
    }
  }

  function cycle() {
    mode = next;
    apply(mode);
  }
</script>

<button
  type="button"
  class="theme-toggle"
  data-testid="theme-toggle"
  data-mode={mode}
  aria-label="Theme: {LABELS[mode]}. Switch to {LABELS[next]}."
  title="Theme: {LABELS[mode]}"
  onclick={cycle}
>
  <svg class="i-dark" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>
  <svg class="i-light" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  <svg class="i-system" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--site-border-strong);
    border-radius: 9px;
    background: var(--site-surface);
    color: var(--site-text-muted);
    cursor: pointer;
  }
  .theme-toggle:hover { color: var(--site-text); }

  /* The icon is chosen from the <html> attribute (set before paint), so there is no flash before hydration. */
  .i-light, .i-system { display: none; }
  :global(:root[data-theme='light']) .i-dark,
  :global(:root[data-theme='light']) .i-system { display: none; }
  :global(:root[data-theme='light']) .i-light { display: block; }
  :global(:root[data-theme='dark']) .i-dark { display: block; }
  :global(:root:not([data-theme])) .i-dark { display: none; }
  :global(:root:not([data-theme])) .i-system { display: block; }

  @media (max-width: 759.98px) {
    .theme-toggle { width: 44px; height: 44px; border-radius: var(--site-radius-button); }
  }
</style>
