<script>
  import { page } from '$app/state';
  import DocsLayout from '../../../site/docs/DocsLayout.svelte';

  let { data, children } = $props();
</script>

<DocsLayout
  navLabel="API reference"
  sections={data.nav}
  pinned={[{ label: 'Overview', href: '/api' }, { label: 'nabu.internals', href: '/api/internals', flag: 'unstable' }]}
  toc={page.data.toc ?? []}
  menuLabel="Browse the API"
>
  {@render children()}
</DocsLayout>
