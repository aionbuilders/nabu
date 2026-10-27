<script>
  import DocsLayout from '../../../site/docs/DocsLayout.svelte';
  import DocArticle from '../../../site/docs/DocArticle.svelte';
  import DocFooter from '../../../site/docs/DocFooter.svelte';

  let { data } = $props();
</script>

<DocsLayout
  navLabel="Releases"
  sections={[{ id: 'releases', title: 'Releases', groups: [{ items: data.releases }] }]}
  pinned={[{ label: 'Documentation', href: '/docs' }, { label: 'API reference', href: '/api' }]}
  toc={data.toc}
  menuLabel="Browse the releases"
>
  <DocArticle doc={data.doc} label="Changelog" />
  <DocFooter edit={data.edit} />
</DocsLayout>
