<script>
  import './docs.css';
  import { page } from '$app/state';
  import DocsNav from './DocsNav.svelte';
  import Toc from './Toc.svelte';

  /**
   * The documentation frame (DocsRead): left navigation, the article, "On this page" on the right. Shared by the API reference
   * and (soon) the guides. Below 900px the navigation folds behind a button; below 1100px the right column is dropped.
   * @type {{
   *   navLabel: string,
   *   sections: any[],
   *   pinned?: Array<{ label: string, href: string, flag?: string }>,
   *   toc?: Array<{ id: string, label: string, level?: 1 | 2 }>,
   *   menuLabel?: string,
   *   children: import('svelte').Snippet
   * }}
   */
  let { navLabel, sections, pinned = [], toc = [], menuLabel = 'Browse', children } = $props();

  let open = $state(false);

  // Close the folded navigation on navigation.
  $effect(() => {
    page.url.pathname;
    open = false;
  });
</script>

<div class="container docs">
  <div class="side">
    <button type="button" class="menu" aria-expanded={open} aria-controls="docs-nav-panel" onclick={() => (open = !open)}>
      {menuLabel}
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
    </button>
    <div class="panel" id="docs-nav-panel" data-open={open}>
      <DocsNav label={navLabel} {sections} {pinned} />
    </div>
  </div>

  <article class="article">
    {@render children()}
  </article>

  <aside class="aside">
    <Toc items={toc} />
  </aside>
</div>

<style>
  .docs {
    display: flex;
    align-items: flex-start;
    gap: var(--site-space-12);
    padding-block: 36px 120px;
  }
  .side {
    position: sticky;
    top: var(--site-space-4);
    flex: 0 0 230px;
    max-height: calc(100dvh - 2 * var(--site-space-4));
    overflow-y: auto;
    padding-top: 6px;
    scrollbar-width: thin;
  }
  .menu {
    display: none;
  }
  .article {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
    color: var(--site-text);
  }
  .aside {
    position: sticky;
    top: var(--site-space-4);
    flex: 0 0 200px;
    max-height: calc(100dvh - 2 * var(--site-space-4));
    overflow-y: auto;
    padding-top: 6px;
    scrollbar-width: thin;
  }

  @media (max-width: 1099.98px) {
    .aside {
      display: none;
    }
  }

  @media (max-width: 899.98px) {
    .docs {
      flex-direction: column;
      align-items: stretch;
      gap: var(--site-space-6);
      padding-block: var(--site-space-6) var(--site-space-16);
    }
    .side {
      position: static;
      flex: none;
      max-height: none;
      overflow: visible;
      padding-top: 0;
    }
    .menu {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: 44px;
      padding: 0 var(--site-space-4);
      border: 1px solid var(--site-border-strong);
      border-radius: var(--site-radius-button);
      background: var(--site-surface);
      color: var(--site-text);
      font: 600 14px var(--site-font-body);
      cursor: pointer;
    }
    .panel {
      display: none;
      margin-top: var(--site-space-2);
      padding: var(--site-space-4);
      border: 1px solid var(--site-border);
      border-radius: var(--site-radius-card-sm);
      background: var(--site-surface);
      max-height: 60dvh;
      overflow-y: auto;
    }
    .panel[data-open='true'] {
      display: block;
    }
  }
</style>
