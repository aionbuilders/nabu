<script>
  import ArchEditor from './ArchEditor.svelte';
  import KeystrokePanel from './KeystrokePanel.svelte';
  import { SEED_STORY } from './seeds.js';
  import { STEPS } from './helpers.js';

  /**
   * Chapter 03, "The life of a keystroke" (widget id `keystroke`). The frame, the "step" button (which row to explain) and the panel
   * (KeystrokePanel.svelte, where everything that is observed or measured lives).
   */

  /** The row "step" is on: -1 none, else an index into STEPS. */
  let stepAt = $state(-1);
  const nextStep = () => { stepAt = stepAt >= STEPS.length - 1 ? -1 : stepAt + 1; };
</script>

<ArchEditor id="keystroke" label="Type to follow a keystroke" title="X-ray · last key" seed={SEED_STORY} height={470} panelHeight={440} >
  {#snippet head()}
    <button type="button" class="w-btn" data-testid="step-btn" onclick={nextStep} aria-label="Explain the next step">
      {stepAt < 0 ? 'step' : `${stepAt + 1}/${STEPS.length}`} ▸
    </button>
  {/snippet}
  {#snippet panel(ctx)}
    <KeystrokePanel {ctx} {stepAt} />
  {/snippet}
</ArchEditor>
