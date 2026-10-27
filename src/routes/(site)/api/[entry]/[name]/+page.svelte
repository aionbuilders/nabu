<script>
  import ItemView from '../../../../../site/api/ItemView.svelte';

  let { data } = $props();
</script>

<ItemView item={data.item} specifier={data.specifier} importHtml={data.importHtml} groups={data.groups} />
