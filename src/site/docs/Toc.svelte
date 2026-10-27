<script>
  /**
   * "On this page": the headings of the article, the one being read highlighted.
   * @type {{ items: Array<{ id: string, label: string, level?: 1 | 2 }> }}
   */
  let { items = [] } = $props();

  let active = $state('');

  $effect(() => {
    if (!items.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= 120) current = item.id;
      }
      active = current;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  });
</script>

{#if items.length}
  <nav class="toc" aria-label="On this page">
    <span class="label heading">On this page</span>
    <ul>
      {#each items as item (item.id)}
        <li data-level={item.level ?? 1}>
          <a href="#{item.id}" aria-current={active === item.id ? 'location' : undefined}>{item.label}</a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}

<style>
  .toc {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-2);
    font-size: 13px;
  }
  .heading {
    color: var(--site-text-subtle);
    text-transform: uppercase;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li[data-level='2'] {
    padding-left: var(--site-space-3);
  }
  a {
    display: block;
    color: var(--site-text-muted);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a:hover,
  a[aria-current] {
    color: var(--site-text);
  }
  a[aria-current] {
    box-shadow: -10px 0 0 -8px var(--site-accent);
  }
</style>
