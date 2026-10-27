<script>
  import ArchEditor from './ArchEditor.svelte';
  import PersistencePanel from './PersistencePanel.svelte';
  import { SEED_SAVED } from './seeds.js';

  /**
   * Chapter 06, "Nothing gets lost" (widget id `persistence`). A PERSISTED editor (`createPersistedEditor`, IndexedDB, in this browser only,
   * under its own document id) and a panel with the save status, the size of the snapshot, and what the other tabs sent. "Open in a
   * second tab" opens this page again: type in one tab, the other receives it (BroadcastChannel). Reset clears the stored document.
   */
  const DOC_ID = 'nabu-architecture-persistence';
</script>

<ArchEditor id="persistence" label="Type here: it is saved in this browser" title="X-ray · saving" seed={SEED_SAVED} docId={DOC_ID} height={340} panelHeight={340} >
  {#snippet panel(ctx)}
    <PersistencePanel {ctx} />
  {/snippet}
  {#snippet below()}
    <a class="w-btn tab-link" data-testid="second-tab" href={typeof location === 'undefined' ? '#' : location.href} target="_blank" rel="noopener">Open this page in a second tab</a>
  {/snippet}
</ArchEditor>

<style>
  .tab-link { display: inline-flex; align-items: center; text-decoration: none; }
</style>
