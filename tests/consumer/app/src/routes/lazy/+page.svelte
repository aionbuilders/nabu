<script>
  import { mount } from 'svelte';

  let target;
  // The package is only imported when the button is clicked.
  async function open() {
    const { NabuEditor, createMinimalEditor } = await import('@aionbuilders/nabu');
    const engine = createMinimalEditor();
    mount(NabuEditor, { target, props: { engine, label: 'Editor' } });
    window.__engine = engine;
    window.__ready = true;
  }
</script>

<h1>Lazy page</h1>
<button id="open" onclick={open}>Open the editor</button>
<div bind:this={target}></div>
