<script>
  import { onMount } from 'svelte';
  import { NabuEditor, createMinimalEditor } from '@aionbuilders/nabu';

  const engine = createMinimalEditor();
  onMount(async () => {
    await engine.importJSON({ version: '1', blocks: [{ type: 'paragraph', content: [{ text: 'Initial text.' }] }] });
    await engine.commit();
    window.__engine = engine;
    window.__ready = true;
  });
</script>

<h1>SSR page</h1>
<NabuEditor {engine} label="Editor" />
