<script>
  import { onMount, tick, flushSync } from 'svelte';
  import { createFullEditor, createPersistedEditor, FullPreset } from '#lib';
  import Host from './Host.svelte';

  /**
   * Test-only page (dev, or a build made with `VITE_NABU_E2E=1`): engines that the test creates, mounts, unmounts, swaps and
   * destroys on demand, to check what an engine leaves behind on the page (tests/e2e/lifecycle.spec.ts). `window.life`:
   *   make(name, { persist?, text?, kinds? })   create an engine (persisted under the docId `persist`), seeded with one paragraph
                   (`text: null`: not seeded; `kinds`: one block of every type of the preset instead, nested ones included)
   *   mount(name, { ui?, destroyOnDestroy? })  render it, in a `<section>` labelled "Editor <name>"; unmount(name) removes it
   *   swap(name)    re-render it in a NEW element (what a `{#key}` does), the engine stays the same
   *   watch(name)   keep a WeakRef to the engine; release(name) forgets it; collected(name) says whether the GC took it
   *   engines       the engines by name (the test calls their methods; `release` removes them, so nothing here keeps one alive)
   * The mounts are synchronous (`flushSync`), so the page is in its final state when a call returns.
   */

  /** @typedef {import('#lib').Nabu} Nabu */

  /** @type {Record<string, Nabu>} */
  const engines = {};
  /** @type {Record<string, WeakRef<Nabu>>} */
  const refs = {};
  /** What is rendered. The engines are NOT stored here: a reactive record would hold them. @type {Array<{ name: string, key: number, ui: boolean, destroyOnDestroy: boolean }>} */
  let mounted = $state([]);

  /** @typedef {[string, Record<string, any>, any[]?]} Spec */
  /** One block of every type of the full preset (a container holds a child), to make an engine as heavy in subscriptions as a real document. @type {Spec[]} */
  const KINDS = [
    ['paragraph', { text: 'Paragraph' }],
    ['heading', { text: 'Heading', level: 2 }],
    ['blockquote', { text: 'Quote' }],
    ['divider', {}],
    ['code', { text: 'let a = 1', language: 'js' }],
    ['callout', { text: 'Callout', variant: 'note' }],
    ['toggle', { text: 'Toggle', collapsed: false }, [['paragraph', { text: 'Inside the toggle' }]]],
    ['list', { listType: 'bullet' }, [['list-item', { text: 'One' }], ['list-item', { text: 'Two' }]]],
    ['list', { listType: 'todo' }, [['list-item', { text: 'Task', checked: false }]]],
    ['dialogue', { text: 'Said' }],
    ['image', { ref: 'https://example.test/a.png', alt: 'An image' }],
    ['video', { ref: 'https://example.test/a.mp4' }],
    ['file', { ref: 'https://example.test/a.pdf', name: 'a.pdf' }],
    ['region', { regionType: 'section-1', title: 'Region' }, [['paragraph', { text: 'Inside the region' }]]],
  ];

  /** @param {Nabu} engine @param {Spec[]} specs @param {string | null} parentId */
  function build(engine, specs, parentId) {
    specs.forEach(([type, props, children], i) => {
      const block = engine.insert(type, props, parentId, i);
      if (children) build(engine, children, block.id);
    });
  }

  onMount(() => {
    /** @type {any} */ (window).life = {
      engines,
      async make(/** @type {string} */ name, { persist = '', text = /** @type {string | null} */ ('Hello'), kinds = false } = {}) {
        const engine = persist ? await createPersistedEditor({ docId: persist, preset: FullPreset }) : createFullEditor();
        if (text !== null) {
          for (const child of [...engine.children]) engine.delete(child);
          if (kinds) build(engine, KINDS, null);
          else engine.insert('paragraph', { text });
          await engine.commit();
          engine.undoManager.clear();
        }
        engines[name] = engine;
        await tick();
      },
      mount(/** @type {string} */ name, { ui = true, destroyOnDestroy = false } = {}) {
        mounted = [...mounted, { name, key: 0, ui, destroyOnDestroy }];
        flushSync();
      },
      swap(/** @type {string} */ name) {
        mounted = mounted.map((m) => (m.name === name ? { ...m, key: m.key + 1 } : m));
        flushSync();
      },
      unmount(/** @type {string} */ name) {
        mounted = mounted.filter((m) => m.name !== name);
        flushSync();
      },
      // the types of the registry that no block of the engine has (empty: the document holds one of each)
      missingKinds(/** @type {string} */ name) {
        const present = new Set([...engines[name].blocks.values()].map((b) => b.type));
        return [...engines[name].registry.keys()].filter((t) => !present.has(t));
      },
      watch(/** @type {string} */ name) { refs[name] = new WeakRef(engines[name]); },
      release(/** @type {string} */ name) { delete engines[name]; },
      collected(/** @type {string} */ name) { return refs[name]?.deref() === undefined; },
    };
    /** @type {any} */ (window).__life_ready = true;
  });
</script>

<main class="life">
  {#each mounted as m (m.name)}
    {#key m.key}
      <section><Host engine={engines[m.name]} label={`Editor ${m.name}`} ui={m.ui} destroyOnDestroy={m.destroyOnDestroy} /></section>
    {/key}
  {/each}
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }
  .life { max-width: 660px; margin: 0 auto; padding: 24px; }
  section { border: 1px solid #ccc; margin: 12px 0; }
</style>
