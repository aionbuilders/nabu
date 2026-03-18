<script>
  import { untrack } from 'svelte';
  import { createPersistedEditor } from '$lib/persistence/persistence.js';
  import { FullPreset } from '$lib/presets.js';
  import PitchPanel from './_components/PitchPanel.svelte';
  import EditorPanel from './_components/EditorPanel.svelte';
  import DebugPanel from './_components/DebugPanel.svelte';

  /** @type {import('$lib/blocks/nabu.svelte.js').Nabu | null} */
  let engine = $state(null);

  // ── Resizable panel ──────────────────────────────────────
  const MIN_WIDTH = 260;
  const MAX_WIDTH = 620;
  const DEFAULT_WIDTH = 380;

  let pitchWidth = $state(DEFAULT_WIDTH);
  let resizing = $state(false);

  function startResize(e) {
    e.preventDefault();
    resizing = true;
    const startX = e.clientX;
    const startWidth = pitchWidth;

    function onMove(e) {
      const delta = e.clientX - startX;
      pitchWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
    }

    function onUp() {
      resizing = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function handleDblClick() {
    pitchWidth = pitchWidth === DEFAULT_WIDTH ? MAX_WIDTH : DEFAULT_WIDTH;
  }

  // ── Editor init ──────────────────────────────────────────
  $effect(() => {
    untrack(() => {
      createPersistedEditor({
        docId: 'nabu-demo',
        preset: FullPreset,
      }).then(eng => {
        if (eng.isNew) {
          eng.insert('heading', { level: 1, text: 'Welcome to Nabu' });
          eng.insert('paragraph', {
            text: 'This sentence has bold, italic, and inline code — select any text and press Ctrl+B, Ctrl+I, or Ctrl+E to apply marks.',
          });
          eng.insert('paragraph', {
            text: 'Every block type is an extension. Register custom blocks by extending Block or MegaBlock and passing them to the Nabu constructor.',
          });
          const list = eng.insert('list', { listType: 'bullet' });
          const item1 = eng.insert(
            'list-item',
            { text: 'Single ContentEditable — seamless cross-block selection' },
            list.node.id.toString(),
            0,
          );
          const subList = eng.insert('list', { listType: 'bullet' }, item1.node.id.toString());
          eng.insert(
            'list-item',
            { text: 'Nested lists via Tab / Shift+Tab' },
            subList.node.id.toString(),
            0,
          );
          eng.insert(
            'list-item',
            { text: 'Loro CRDT — offline-first, conflict-free sync' },
            list.node.id.toString(),
            1,
          );
          eng.insert('dialogue', {
            text: 'Type -- (double dash) at the start of a line to enter dialogue mode.',
          });
          eng.insert('paragraph', { text: 'Edit freely — your content is saved automatically.' });
        }
        engine = eng;
      });
    });
  });
</script>


<div class="layout" class:is-resizing={resizing}>
  <aside class="pitch-col" style="width: {pitchWidth}px">
    <PitchPanel />
  </aside>

  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="resize-handle"
    class:is-dragging={resizing}
    role="separator"
    aria-orientation="vertical"
    aria-label="Drag to resize panel"
    onpointerdown={startResize}
    ondblclick={handleDblClick}
  ></div>

  <main class="editor-col">
    <EditorPanel {engine} />
  </main>
</div>

<DebugPanel {engine} />

<style>
  :root {
    --color-bg: #ffffff;
    --color-bg-secondary: #f7f7f5;
    --color-bg-tertiary: #efefec;
    --color-text: #1a1a1a;
    --color-text-muted: #6b6b67;
    --color-text-faint: #a0a09c;
    --color-border: rgba(0, 0, 0, 0.08);
    --color-accent: #4f46e5;
    --color-accent-muted: rgba(79, 70, 229, 0.12);
    --color-success: #16a34a;
    --color-warning: #d97706;
    --color-danger: #dc2626;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --color-bg: #0f0f0f;
      --color-bg-secondary: #1a1a1a;
      --color-bg-tertiary: #242424;
      --color-text: #e8e8e4;
      --color-text-muted: #888882;
      --color-text-faint: #555550;
      --color-border: rgba(255, 255, 255, 0.08);
      --color-accent: #4f46e5;
      --color-accent-muted: rgba(79, 70, 229, 0.18);
      --color-success: #4ade80;
      --color-warning: #fbbf24;
      --color-danger: #f87171;
    }
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  /* ── Scrollbars ────────────────────────────────────────── */

  /* Firefox */
  :global(*) {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
  }

  @media (prefers-color-scheme: dark) {
    :global(*) {
      scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }
  }

  /* WebKit (Chrome, Safari, Edge) */
  :global(::-webkit-scrollbar) {
    width: 5px;
    height: 5px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: rgba(0, 0, 0, 0.15);
    border-radius: 99px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: rgba(0, 0, 0, 0.28);
  }

  :global(::-webkit-scrollbar-corner) {
    background: transparent;
  }

  @media (prefers-color-scheme: dark) {
    :global(::-webkit-scrollbar-thumb) {
      background: rgba(255, 255, 255, 0.1);
    }

    :global(::-webkit-scrollbar-thumb:hover) {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    background-color: var(--color-bg);
    color: var(--color-text);
    height: 100vh;
    overflow: hidden;
  }

  .layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* Prevent text selection and snap cursor while dragging */
  .layout.is-resizing {
    cursor: col-resize;
    user-select: none;
  }

  .pitch-col {
    flex-shrink: 0;
    height: 100%;
    overflow-y: auto;
    background-color: var(--color-bg-secondary);
    /* Smooth width transitions only when NOT dragging */
    transition: width 200ms ease;
  }

  .layout.is-resizing .pitch-col {
    transition: none;
  }

  /* ── Resize handle ─────────────────────────────────────── */

  .resize-handle {
    width: 9px;
    flex-shrink: 0;
    height: 100%;
    cursor: col-resize;
    position: relative;
    z-index: 10;
  }

  /* The visible 1px line, centered in the 9px hit zone */
  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: var(--color-border);
    transition: width 150ms ease, background 150ms ease, opacity 150ms ease;
  }

  .resize-handle:hover::after,
  .resize-handle.is-dragging::after {
    width: 2px;
    background: var(--color-accent);
    opacity: 0.5;
  }

  /* Grip dots — 3 stacked dots in the center */
  .resize-handle::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 3px;
    height: 20px;
    background-image: radial-gradient(circle, var(--color-text-faint) 1px, transparent 1px);
    background-size: 3px 6px;
    background-repeat: repeat-y;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .resize-handle:hover::before,
  .resize-handle.is-dragging::before {
    opacity: 0.6;
  }

  /* ── Editor column ─────────────────────────────────────── */

  .editor-col {
    flex: 1;
    height: 100%;
    overflow: hidden;
    background-color: var(--color-bg);
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  /* ── Mobile ────────────────────────────────────────────── */

  @media (max-width: 1023px) {
    .layout {
      flex-direction: column;
      height: auto;
      overflow: visible;
    }

    :global(body) {
      height: auto;
      overflow: auto;
    }

    .pitch-col {
      width: 100% !important;
      height: auto;
      overflow: visible;
      transition: none;
    }

    .resize-handle {
      display: none;
    }

    .editor-col {
      height: auto;
      min-height: 100vh;
      overflow: visible;
    }
  }
</style>
