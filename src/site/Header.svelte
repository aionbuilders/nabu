<script>
  import GitHubIcon from './GitHubIcon.svelte';
  import { page } from '$app/state';
  import Logo from './Logo.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import { NAV, GITHUB_URL } from './nav.js';

  let open = $state(false);

  /** @param {string} href */
  const isActive = (href) => page.url.pathname === href || page.url.pathname.startsWith(href + '/');

  // Close the mobile panel on navigation.
  $effect(() => {
    page.url.pathname;
    open = false;
  });

  /** @param {KeyboardEvent} e */
  function onkeydown(e) {
    if (e.key === 'Escape' && open) {
      open = false;
      document.getElementById('site-menu-button')?.focus();
    }
  }
</script>

<svelte:window {onkeydown} />

<header class="site-header">
  <div class="container">
    <div class="bar">
      <a class="brand" href="/" aria-label="Nabu, home"><Logo width={100} /></a>

      <div class="panel" id="site-menu" data-open={open}>
        <nav aria-label="Main">
          {#each NAV as item (item.href)}
            <a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>{item.label}</a>
          {/each}
        </nav>
        <span class="spacer"></span>
        <div class="actions">
          <!-- TODO: open the docs search palette (⌘K). No behaviour yet. -->
          <button type="button" class="search">Search docs <kbd>⌘K</kbd></button>
          <a class="github" href={GITHUB_URL}><GitHubIcon />GitHub</a>
        </div>
      </div>

      <ThemeToggle />

      <button
        type="button"
        id="site-menu-button"
        class="menu-button"
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onclick={() => (open = !open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          {#if open}
            <path d="M6 6l12 12M18 6L6 18" />
          {:else}
            <path d="M4 7h16M4 12h16M4 17h16" />
          {/if}
        </svg>
      </button>
    </div>
  </div>
</header>

<style>
  .site-header {
    position: relative;
  }
  /* The hairline lives inside the container, as in the mockup. */
  .bar {
    display: flex;
    align-items: center;
    gap: 28px;
    padding-block: 20px;
    border-bottom: 1px solid var(--site-border-subtle);
  }
  .brand {
    display: flex;
    flex: none;
    border-radius: var(--site-radius-control);
  }
  .panel {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 28px;
    min-width: 0;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 24px;
    font-size: var(--site-fs-small);
  }
  nav a,
  .search,
  .github {
    white-space: nowrap;
  }
  nav a {
    padding-block: 6px;
    color: var(--site-text-muted);
    text-decoration: none;
  }
  nav a:hover,
  nav a[aria-current='page'] {
    color: var(--site-text);
  }
  nav a[aria-current='page'] {
    box-shadow: inset 0 -2px 0 var(--site-accent);
  }
  .spacer {
    flex-grow: 1;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .search {
    min-height: 38px;
    padding: 0 12px;
    border: 1px solid var(--site-border-strong);
    border-radius: 9px;
    background: var(--site-surface);
    color: var(--site-text-muted);
    font: 500 13px var(--site-font-body);
    cursor: pointer;
  }
  .search:hover {
    color: var(--site-text);
  }
  kbd {
    font: 500 12px var(--site-font-mono);
    color: var(--site-text);
  }
  .github {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    padding-block: 6px;
    font-size: var(--site-fs-small);
    text-decoration: none;
    color: var(--site-text);
  }
  .github:hover {
    opacity: 0.85;
  }
  .menu-button {
    display: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-button);
    background: var(--site-surface);
    color: var(--site-text);
    cursor: pointer;
  }

  @media (min-width: 760px) and (max-width: 999.98px) {
    .bar,
    .panel {
      gap: var(--site-space-4);
    }
    nav {
      gap: var(--site-space-4);
    }
    .actions {
      gap: var(--site-space-3);
    }
    .search kbd {
      display: none;
    }
  }

  @media (max-width: 759.98px) {
    .bar {
      gap: var(--site-space-2);
      padding-block: var(--site-space-3);
    }
    .brand {
      margin-right: auto;
    }
    .menu-button {
      display: inline-flex;
    }
    .panel {
      display: none;
      position: absolute;
      top: 100%;
      left: var(--site-gutter);
      right: var(--site-gutter);
      z-index: 50;
      flex-direction: column;
      align-items: stretch;
      gap: var(--site-space-3);
      padding: var(--site-space-3);
      border: 1px solid var(--site-border-strong);
      border-radius: var(--site-radius-panel);
      background: var(--site-surface);
      box-shadow: var(--site-shadow-floating);
    }
    .panel[data-open='true'] {
      display: flex;
    }
    nav {
      flex-direction: column;
      align-items: stretch;
      gap: 0;
      font-size: var(--site-fs-body);
    }
    nav a {
      display: flex;
      align-items: center;
      min-height: 44px;
      padding: 0 var(--site-space-3);
      border-radius: var(--site-radius-control);
    }
    nav a[aria-current='page'] {
      background: var(--site-hover-bg);
      box-shadow: inset 2px 0 0 var(--site-accent);
    }
    .spacer {
      display: none;
    }
    .actions {
      flex-direction: column;
      align-items: stretch;
      gap: var(--site-space-2);
      padding-top: var(--site-space-3);
      border-top: 1px solid var(--site-border);
    }
    .search {
      min-height: 44px;
      text-align: left;
    }
    .search kbd {
      display: none;
    }
    .github {
      display: flex;
      align-items: center;
      gap: 0.3em;
      min-height: 44px;
      padding-inline: var(--site-space-3);
    }
  }
</style>
