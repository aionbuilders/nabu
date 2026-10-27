<script>
  import '../../../../site/architecture/arch.css';
  import ArchFrame from '../../../../site/architecture/ArchFrame.svelte';
  import StoryRail from '../../../../site/architecture/StoryRail.svelte';
  import { STORY_LINKS } from '../../../../site/architecture/data.js';

  let { data, children } = $props();
</script>

<ArchFrame menuLabel="Browse the story">
  {#snippet rail()}
    <StoryRail story={data.story} links={STORY_LINKS} />
  {/snippet}
  {@render children()}
</ArchFrame>
