<script>
  import { page } from '$app/state';
  import DocsLayout from '../../../site/docs/DocsLayout.svelte';

  let { data, children } = $props();
</script>

<DocsLayout
  navLabel="Documentation"
  sections={data.nav}
  pinned={[{ label: 'Overview', href: '/docs' }]}
  toc={page.data.toc ?? []}
  menuLabel="Browse the docs"
>
  {@render children()}
</DocsLayout>
