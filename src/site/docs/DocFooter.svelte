<script>
  /**
   * The foot of a documentation page: where the source lives ("Edit this page") and the previous / next pages in the order of the sidebar.
   * @type {{ edit: string, prev?: { title: string, href: string } | null, next?: { title: string, href: string } | null }}
   */
  let { edit, prev = null, next = null } = $props();
</script>

<div class="foot">
  <a class="edit" href={edit} rel="noopener">Edit this page on GitHub<span aria-hidden="true"> &#8599;</span></a>
  {#if prev || next}
    <nav class="pager" aria-label="Previous and next pages">
      {#if prev}
        <a class="prev" rel="prev" href={prev.href}><span class="dir label">Previous</span><span class="title">{prev.title}</span></a>
      {/if}
      {#if next}
        <a class="next" rel="next" href={next.href}><span class="dir label">Next</span><span class="title">{next.title}</span></a>
      {/if}
    </nav>
  {/if}
</div>

<style>
  .foot {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-6);
    margin-top: var(--site-space-8);
    padding-top: var(--site-space-6);
    border-top: 1px solid var(--site-border-subtle);
  }
  .edit {
    align-self: flex-start;
    color: var(--site-text-muted);
    font-size: var(--site-fs-small);
    text-decoration: none;
  }
  .edit:hover {
    color: var(--site-accent);
  }
  .pager {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--site-space-4);
  }
  .pager a {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-card-sm);
    background: var(--site-surface);
    text-decoration: none;
  }
  .pager a:hover {
    border-color: var(--site-border-strong);
  }
  .pager a:hover .title {
    color: var(--site-accent);
  }
  .next {
    grid-column: 2;
    text-align: right;
  }
  .dir {
    color: var(--site-text-subtle);
    text-transform: uppercase;
  }
  .title {
    color: var(--site-text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  @media (max-width: 479.98px) {
    .pager {
      grid-template-columns: 1fr;
    }
    .next {
      grid-column: 1;
    }
  }
</style>
