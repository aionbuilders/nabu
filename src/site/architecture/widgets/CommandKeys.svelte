<script>
  import ArchEditor from './ArchEditor.svelte';
  import CommandsPanel from './CommandsPanel.svelte';
  import { SEED_COMMANDS } from './seeds.js';

  /**
   * Chapter 05, "Commands, not keycodes" (widget id `command-keys`). Press a key in the editor: the panel shows the chord, the commands
   * bound to it, whether each applies where the caret is, and which one the engine took. "Rebind bold" rebuilds the editor with a
   * `keymap` option (`mark:bold` on Mod-Shift-B), to show that a shortcut is data.
   * @type {ArchEditor | undefined}
   */
  let shell = $state();
  let rebound = $state(false);

  async function toggleRebind() {
    rebound = !rebound;
    await Promise.resolve();
    await shell?.reset();
  }
</script>

<ArchEditor
  bind:this={shell}
  id="command-keys"
  label="Press shortcuts to see the command they resolve to"
  title="X-ray · last chord"
  seed={SEED_COMMANDS}
  options={rebound ? { keymap: { 'mark:bold': ['Mod-Shift-b'] } } : {}}
  height={360}
  panelHeight={400}
>
  {#snippet panel(ctx)}
    <CommandsPanel {ctx} />
  {/snippet}
  {#snippet below()}
    <button type="button" class="w-btn" data-testid="rebind-btn" aria-pressed={rebound} onclick={toggleRebind}>
      {rebound ? 'Bold is on Mod-Shift-B' : 'Rebind Bold to Mod-Shift-B'}
    </button>
    <span class="hint">A keymap option, then the editor is rebuilt.</span>
  {/snippet}
</ArchEditor>

<style>
  .hint { color: var(--site-text-subtle); font-size: var(--site-fs-small); }
</style>
