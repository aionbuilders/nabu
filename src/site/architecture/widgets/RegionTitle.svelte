<script>
  import ArchEditor from './ArchEditor.svelte';
  import RegionPanel from './RegionPanel.svelte';
  import { SEED_REGIONS } from './seeds.js';

  /**
   * Chapter 07, "We got regions wrong once" (widget id `region-title`). A region with a sub-region, its titles editable in place. The
   * panel shows what a region IS in the model: a container in the Loro tree (its title the text of the header, its body the children),
   * and what the registry (`engine.regions`) derives from the tree: label, level, words. Try Ctrl+A in the body: the titles stay out.
   */
</script>

<ArchEditor id="region-title" label="Edit a region and its title" title="X-ray · regions" seed={SEED_REGIONS} height={380} panelHeight={400} >
  {#snippet panel(ctx)}
    <RegionPanel {ctx} />
  {/snippet}
</ArchEditor>
