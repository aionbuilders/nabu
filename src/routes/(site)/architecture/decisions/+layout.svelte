<script>
  import '../../../../site/architecture/arch.css';
  import ArchFrame from '../../../../site/architecture/ArchFrame.svelte';
  import RecordsRail from '../../../../site/architecture/RecordsRail.svelte';

  let { data, children } = $props();
</script>

<ArchFrame menuLabel="Browse the records" railWidth={300}>
  {#snippet rail()}
    <RecordsRail records={data.records} counts={data.counts} missing={data.missing} />
  {/snippet}
  {@render children()}
</ArchFrame>
