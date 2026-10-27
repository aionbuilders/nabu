<script>
  import { untrack } from 'svelte';
  import { resolveChord } from './helpers.js';

  /**
   * The panel of chapter 05: for the last key pressed in the editor, the chord, the commands bound to it (from `nabu.commands.list(ctx)`,
   * public), whether each one applies at the caret (`available`), the one the engine takes first, and whether the key was consumed (the
   * event came back `defaultPrevented`). The ranking shown is a READING of the registry (`resolveChord` in helpers.js, the same rules as
   * `CommandRegistry#handleKeydown`); the engine does the real resolution, this panel does not run anything.
   * @type {{ ctx: import('./helpers.js').WidgetContext }}
   */
  let { ctx } = $props();

  /** @type {{ chord: string, block: string, candidates: Array<ReturnType<typeof resolveChord>['candidates'][number]>, winner: string | null, tie: boolean, consumed: boolean | null } | null} */
  let last = $state.raw(/** @type {any} */ (null));
  /** @type {Array<{ id: string, label: string, display: string[], keys: string[] }>} */
  let all = $state.raw([]);

  $effect(() => {
    const { engine, scope, ext } = ctx;
    const root = scope.querySelector('[data-nabu-root]');
    if (!root) return;
    const platform = engine.commands.platform;
    const chordOfKey = (/** @type {string} */ text) => ext.canonicalChord(text, { platform });
    // `list()` evaluates every command's `when`, which reads reactive state: untracked, or this effect would restart (and drop `last`) on every caret move.
    all = untrack(() => engine.commands.list().map(({ id, label, display, keys }) => ({ id, label, display, keys })));

    /** @type {KeyboardEvent | null} */
    let current = null;
    /** @param {Event} e */
    const inEditor = (e) => {
      const t = e.target;
      const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
      return !!el && root.contains(el);
    };
    /** Before the editor's own handlers (document capture): read the registry for this chord at the caret. @param {KeyboardEvent} e */
    const onKeydown = (e) => {
      current = null;
      if (!inEditor(e) || e.isComposing) return;
      const chord = ext.eventChordId(e);
      if (!chord) return;
      let infos;
      let blockType;
      try {
        const context = engine.commands.context(e);
        blockType = context.block?.type;
        infos = engine.commands.list(context);
      } catch { return; }
      const r = resolveChord(infos, chord, chordOfKey, blockType);
      last = { chord, block: blockType ?? 'none', candidates: r.candidates, winner: r.winner, tie: r.tie, consumed: null };
      current = e;
    };
    /** After the editor's handlers (document bubble): was the key taken? @param {KeyboardEvent} e */
    const onKeydownLate = (e) => {
      if (e !== current || !last) return;
      last = { ...last, consumed: e.defaultPrevented };
      current = null;
    };
    const opts = { capture: true };
    document.addEventListener('keydown', onKeydown, opts);
    document.addEventListener('keydown', onKeydownLate);
    return () => {
      document.removeEventListener('keydown', onKeydown, opts);
      document.removeEventListener('keydown', onKeydownLate);
    };
  });

  const pressedKeys = $derived(new Set(last?.candidates.map((c) => c.id) ?? []));
</script>

<div class="host">
  {#if last}
    <p class="w-label">chord</p>
    <p class="chord" data-testid="chord"><span class="w-accent">{last.chord}</span> <span class="w-muted">· caret in {last.block}</span></p>
    {#if last.candidates.length}
      <ul class="cands" data-testid="candidates" aria-label="Commands bound to this chord">
        {#each last.candidates as c (c.id)}
          <li class="cand" data-command={c.id} data-winner={c.id === last.winner ? 'true' : 'false'} data-available={c.available ? 'true' : 'false'}>
            <span class="id" class:win={c.id === last.winner}>{c.id}</span>
            <span class="meta w-muted">
              {c.label}{c.scope ? ` · scope ${c.scope}` : ''} · {c.available ? 'applies here' : 'does not apply here'}{c.id === last.winner ? (last.tie ? ' · tie: the user would choose' : ' · taken') : ''}
            </span>
          </li>
        {/each}
      </ul>
      <p class="verdict w-muted" data-testid="consumed">
        {#if last.consumed === null}…{:else if last.consumed}The engine consumed the key (preventDefault).{:else}Nothing took the key here: it falls to the older hooks, then to the browser.{/if}
      </p>
    {:else}
      <p class="verdict w-muted" data-testid="consumed">No command is bound to this chord. The key falls to the older hooks, then to the browser{last.consumed ? ' (and something did consume it)' : ''}.</p>
    {/if}
  {:else}
    <p class="w-muted" data-testid="chord-none">Press a key in the editor: Ctrl+B, Ctrl+Enter in the paragraph, then in a to-do item.</p>
  {/if}

  <details class="all">
    <summary>All commands ({all.length})</summary>
    <ul class="list">
      {#each all as c (c.id)}
        <li class:hit={pressedKeys.has(c.id)}><span class="w-text">{c.id}</span> <span class="w-muted">{c.display.length ? c.display.join(', ') : 'no key'}</span></li>
      {/each}
    </ul>
  </details>
</div>

<style>
  .host { display: flex; flex-direction: column; gap: 6px; }
  .chord { margin: 0 0 4px; font-size: 14px; }
  .cands { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .cand { display: flex; flex-direction: column; gap: 1px; }
  .id { color: var(--site-text-muted); }
  .id.win { color: var(--site-accent); }
  .meta { font: 400 12.5px / 1.45 var(--site-font-body); overflow-wrap: anywhere; }
  .verdict { margin: 4px 0 0; font: 400 12.5px / 1.5 var(--site-font-body); }
  .all { margin-top: 8px; }
  summary { cursor: pointer; color: var(--site-text-muted); }
  .list { margin: 6px 0 0; padding: 0; list-style: none; font-size: 12px; }
  .list li { overflow-wrap: anywhere; }
  .list li.hit .w-text { color: var(--site-accent); }
</style>
