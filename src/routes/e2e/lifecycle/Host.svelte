<script>
  import { onDestroy } from 'svelte';
  import { NabuEditor } from '#lib';
  import { FloatingToolbar, SlashMenu, DragHandle, CommandInvite, CommandChooser } from '#lib/ui/index.js';

  /**
   * One mounted editor of /e2e/lifecycle: the editor, with the UI components when asked, and (`destroyOnDestroy`) the pattern
   * a host app uses, `onDestroy(() => engine.destroy())`, in a PARENT of the editor.
   * @type {{ engine: import('#lib').Nabu, label: string, ui?: boolean, destroyOnDestroy?: boolean }}
   */
  let { engine, label, ui = true, destroyOnDestroy = false } = $props();

  onDestroy(() => { if (destroyOnDestroy) engine.destroy(); });
</script>

{#if ui}
  <FloatingToolbar {engine} />
  <SlashMenu {engine} />
  <DragHandle {engine} />
  <CommandInvite {engine} />
  <CommandChooser {engine} />
{/if}
<NabuEditor {engine} {label} />
