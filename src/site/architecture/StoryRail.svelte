<script>
  import { page } from '$app/state';

  /**
   * "The story": the seven chapters, then the limits and the decision records. A chapter that has no page yet is shown, not linked.
   * @type {{ story: Array<{ n: number, title: string, href: string | null }>, links: Array<{ label: string, href: string }> }}
   */
  let { story, links } = $props();

  const current = $derived(page.url.pathname);
  /** @param {number} n */
  const nn = (n) => String(n).padStart(2, '0');
</script>

<nav class="rail" aria-label="The story">
  <span class="eyebrow label">THE STORY</span>
  <ol class="chapters">
    {#each story as c (c.n)}
      <li>
        {#if c.href}
          <a href={c.href} aria-current={current === c.href ? 'page' : undefined}><span class="num">{nn(c.n)}</span><span>{c.title}</span></a>
        {:else}
          <span class="soon" title="Not published yet"><span class="num">{nn(c.n)}</span><span>{c.title}</span></span>
        {/if}
      </li>
    {/each}
  </ol>
  <ul class="more">
    {#each links as l (l.href)}
      <li><a href={l.href} aria-current={current === l.href || current.startsWith(l.href + '/') ? 'page' : undefined}>{l.label}</a></li>
    {/each}
  </ul>
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 14px;
  }
  .eyebrow {
    margin-bottom: 8px;
    color: var(--site-text-subtle);
  }
  ol,
  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .more {
    margin-top: 14px;
  }
  .chapters a,
  .soon,
  .more a {
    display: flex;
    gap: 10px;
    padding: 7px 10px;
    border-radius: var(--site-radius-control);
    color: var(--site-text-muted);
    text-decoration: none;
    line-height: 1.35;
  }
  .chapters a:hover,
  .more a:hover {
    color: var(--site-text);
  }
  .num {
    flex: none;
    padding-top: 1px;
    color: var(--site-text-subtle);
    font: 400 12px / 1.5 var(--site-font-mono);
  }
  .soon {
    color: var(--site-text-subtle);
  }
  a[aria-current='page'] {
    background: var(--site-hover-bg);
    color: var(--site-text);
    box-shadow: inset 2px 0 0 var(--site-accent);
  }
</style>
