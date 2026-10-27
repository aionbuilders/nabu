<script>
  import DocArticle from '../../../../../site/docs/DocArticle.svelte';
  import DocFooter from '../../../../../site/docs/DocFooter.svelte';

  let { data } = $props();
</script>

<nav class="crumb" aria-label="Breadcrumb">
  <a href="/docs">Docs</a> / <a href="/docs#{data.page.section}">{data.page.sectionTitle}</a>
</nav>
<DocArticle doc={data.doc} label={data.page.title} />
<DocFooter edit={data.edit} prev={data.prev} next={data.next} />

<style>
  .crumb {
    margin-bottom: calc(var(--site-space-3) - 18px);
    font-size: 13px;
    color: var(--site-text-subtle);
    overflow-wrap: anywhere;
  }
  .crumb a {
    color: inherit;
    text-decoration: none;
  }
  .crumb a:hover {
    color: var(--site-text);
  }
</style>
