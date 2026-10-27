<script>
  import '../docs/docs.css'; // the code blocks and the Shiki colours of a Nabu document
  import { page } from '$app/state';

  /**
   * The frame of the two Architecture pages that have a rail (a chapter, a decision record): the rail on the left (sticky), the article
   * on the right. Below 900px the rail folds behind a button, like the documentation's. Same shape as DocsLayout, with a rail of its own
   * instead of the documentation's navigation and no "On this page".
   * @type {{ menuLabel: string, railWidth?: number, rail: import('svelte').Snippet, children: import('svelte').Snippet }}
   */
  let { menuLabel, railWidth = 230, rail, children } = $props();

  let open = $state(false);

  // Close the folded rail on navigation.
  $effect(() => {
    page.url.pathname;
    open = false;
  });
</script>

<div class="container frame" style:--rail-width="{railWidth}px">
  <div class="side">
    <button type="button" class="menu" aria-expanded={open} aria-controls="arch-rail-panel" onclick={() => (open = !open)}>
      {menuLabel}
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
    </button>
    <div class="panel" id="arch-rail-panel" data-open={open}>
      {@render rail()}
    </div>
  </div>
  <article class="article">
    {@render children()}
  </article>
</div>

<style>
  .frame {
    display: flex;
    align-items: flex-start;
    gap: var(--site-space-12);
    padding-block: 40px 96px;
  }
  .side {
    position: sticky;
    top: var(--site-space-4);
    flex: 0 0 var(--rail-width);
    max-height: calc(100dvh - 2 * var(--site-space-4));
    overflow-y: auto;
    padding: 2px 4px 2px 0;
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
    gap: 22px;
    color: var(--site-text);
  }

  @media (max-width: 899.98px) {
    .frame {
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
      padding: 0;
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
