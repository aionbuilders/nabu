<script>
  import { onMount } from 'svelte';
  import { NabuEditor, createMinimalEditor } from '@aionbuilders/nabu';

  let { data } = $props();
  // svelte-ignore state_referenced_locally
  const engine = createMinimalEditor({ snapshot: data.snapshot });
  onMount(() => {
    window.__engine = engine;
    window.__ready = true;
  });
</script>

<h1>Server page</h1>
<p id="server-text">{data.text}</p>
<NabuEditor {engine} label="Editor" />
