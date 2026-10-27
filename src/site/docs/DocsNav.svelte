<script>
  import { page } from '$app/state';

  /**
   * The left navigation of a documentation section: titled sections, each with optional sub-groups of links.
   * @type {{
   *   label: string,
   *   sections: Array<{ id: string, title: string, href?: string, groups: Array<{ title?: string, items: Array<{ label: string, href: string, mono?: boolean }> }> }>,
   *   pinned?: Array<{ label: string, href: string, flag?: string }>
   * }}
   */
  let { label, sections, pinned = [] } = $props();

  const current = $derived(page.url.pathname);
</script>

<nav class="docs-nav" aria-label={label}>
  {#if pinned.length}
    <div class="section">
      {#each pinned as link (link.href)}
        <a href={link.href} aria-current={current === link.href ? 'page' : undefined}>{link.label}{#if link.flag}<span class="flag">{link.flag}</span>{/if}</a>
      {/each}
    </div>
  {/if}
  {#each sections as section (section.id)}
    <div class="section">
      {#if section.href}
        <a class="label title" href={section.href}>{section.title}</a>
      {:else}
        <span class="label title">{section.title}</span>
      {/if}
      {#each section.groups as group, gi (gi)}
        {#if group.title}<span class="group">{group.title}</span>{/if}
        {#each group.items as item (item.href)}
          <a class:mono={item.mono ?? true} href={item.href} aria-current={current === item.href ? 'page' : undefined}>{item.label}</a>
        {/each}
      {/each}
    </div>
  {/each}
</nav>

<style>
  .docs-nav {
    display: flex;
    flex-direction: column;
    gap: 22px;
    font-size: 14px;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    margin-bottom: 4px;
    color: var(--site-text-subtle);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a.title:hover {
    color: var(--site-text);
  }
  .group {
    margin: 10px 0 2px 10px;
    color: var(--site-text-subtle);
    font-size: 12px;
  }
  .section a:not(.title) {
    padding: 5px 10px;
    border-radius: var(--site-radius-control);
    color: var(--site-text-muted);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .section a.mono {
    font-family: var(--site-font-mono);
    font-size: 13px;
  }
  .section a:not(.title):hover {
    color: var(--site-text);
  }
  .section a[aria-current='page'] {
    background: var(--site-hover-bg);
    color: var(--site-text);
    box-shadow: inset 2px 0 0 var(--site-accent);
  }
  .flag {
    margin-left: 8px;
    color: var(--site-accent);
    font: 500 11px var(--site-font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
