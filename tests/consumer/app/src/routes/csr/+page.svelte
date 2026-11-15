<script>
  import { onMount } from 'svelte';
  import { NabuEditor, createMinimalEditor } from '@aionbuilders/nabu';

  const engine = createMinimalEditor();
  onMount(() => {
    window.__engine = engine;
    window.__ready = true;
  });
</script>

<h1>CSR page</h1>
<NabuEditor {engine} label="Editor" />
