import { test, expect, type Page } from './helpers/test.js';
import { collectErrors } from './helpers/model.js';
import { Keys } from './helpers/keyboard.js';

// What an engine leaves behind on the page (route /e2e/lifecycle, src/routes/e2e/lifecycle): listeners on `document` and `window`,
// open BroadcastChannels, and the engine itself (is it collectable?). An engine with no editor mounted holds nothing on the
// document (they are removed with the editor, and a remount of the same engine works), and `engine.destroy()` releases the rest.
//
// The listeners are counted by wrapping `addEventListener` / `removeEventListener` of `document` and `window` before any script
// runs: the net count per type (and per capture flag). Svelte registers the delegated events of the page once, at the first
// editor, and never removes them: every test that compares counts mounts and unmounts one editor first (`warm`).

/** Runs in the page before any script: counts the listeners of `document` and `window` and the open BroadcastChannels. */
function installCounters() {
  const tracked: Record<string, Map<string, Set<unknown>>> = { document: new Map(), window: new Map() };
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const key = (type: string, options: unknown) => `${type}${(typeof options === 'boolean' ? options : (options as any)?.capture) ? '+capture' : ''}`;
  for (const [label, target] of [['document', document], ['window', window]] as const) {
    (target as any).addEventListener = function (type: string, listener: unknown, options?: unknown) {
      // a `once` / `signal` listener leaves by itself: not counted
      const lasting = listener && !(options && typeof options === 'object' && ((options as any).once || (options as any).signal));
      if (lasting) {
        const set = tracked[label].get(key(type, options)) ?? new Set();
        set.add(listener);
        tracked[label].set(key(type, options), set);
      }
      return add.call(target, type, listener as any, options as any);
    };
    (target as any).removeEventListener = function (type: string, listener: unknown, options?: unknown) {
      tracked[label].get(key(type, options))?.delete(listener);
      return remove.call(target, type, listener as any, options as any);
    };
  }
  (window as any).__listeners = () => {
    const out: Record<string, number> = {};
    for (const label of Object.keys(tracked)) {
      for (const [k, set] of [...tracked[label]].sort(([a], [b]) => a.localeCompare(b))) if (set.size) out[`${label}:${k}`] = set.size;
    }
    return out;
  };

  const Native = window.BroadcastChannel;
  let open = 0;
  (window as any).BroadcastChannel = class extends Native {
    constructor(name: string) { super(name); (this as any).__open = true; open++; }
    close() { if ((this as any).__open) { (this as any).__open = false; open--; } super.close(); }
  };
  (window as any).__openChannels = () => open;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCounters);
  await page.goto('/e2e/lifecycle', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__life_ready === true, null, { timeout: 15000 });
});

type MountOptions = { ui?: boolean; destroyOnDestroy?: boolean };
const make = (page: Page, name: string, options: { persist?: string; text?: string | null; kinds?: boolean } = {}) => page.evaluate(([n, o]) => (window as any).life.make(n, o), [name, options] as const);
const mount = (page: Page, name: string, options: MountOptions = {}) => page.evaluate(([n, o]) => (window as any).life.mount(n, o), [name, options] as const);
const unmount = (page: Page, name: string) => page.evaluate((n) => (window as any).life.unmount(n), name);
const swap = (page: Page, name: string) => page.evaluate((n) => (window as any).life.swap(n), name);
/** Call a method of an engine (`destroy`, `serialize`…) in the page. */
const call = (page: Page, name: string, method: string, ...args: unknown[]) =>
  page.evaluate(([n, m, a]) => (window as any).life.engines[n][m](...(a as unknown[])), [name, method, args] as const);
const listeners = (page: Page): Promise<Record<string, number>> => page.evaluate(() => (window as any).__listeners());
const channels = (page: Page): Promise<number> => page.evaluate(() => (window as any).__openChannels());
const markdown = (page: Page, name: string): Promise<string> => call(page, name, 'serialize', 'markdown');

/** One mount / unmount of a throw-away editor: the page-wide delegated events Svelte registers once are then in place. */
async function warm(page: Page) {
  await make(page, 'warm');
  await mount(page, 'warm');
  await unmount(page, 'warm');
  await page.evaluate(() => (window as any).life.release('warm'));
}

const root = (page: Page, name: string) => page.locator(`[aria-label="Editor ${name}"]`);

/** A real click in the paragraph of an editor, then End: the caret at the end of its text. */
async function clickEnd(page: Page, name: string) {
  await root(page, name).locator('[data-block-type="paragraph"]').first().click();
  await page.keyboard.press('End');
}

/** Errors of the page, plus every message that mentions `state_unsafe_mutation` (a warning in the console counts too). */
function watch(page: Page) {
  const errors = collectErrors(page);
  const unsafe: string[] = [];
  page.on('console', (m) => { if (/state_unsafe_mutation/.test(m.text())) unsafe.push(m.text()); });
  page.on('pageerror', (e) => { if (/state_unsafe_mutation/.test(e.message)) unsafe.push(e.message); });
  return { problems: () => [...errors.list(), ...unsafe] };
}

const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

test.describe('what an engine leaves on the page', () => {
  test('mount and unmount, ten times, with the UI components: the listeners are back to where they started', async ({ page }) => {
    const errors = watch(page);
    await warm(page);
    const start = await listeners(page);

    for (let cycle = 0; cycle < 10; cycle++) {
      await make(page, 'a');
      await mount(page, 'a', { ui: true });
      const mounted = await listeners(page);
      expect(mounted['document:keydown+capture'], `cycle ${cycle}: the editor listens while mounted`).toBeGreaterThan(start['document:keydown+capture'] ?? 0);
      // a slash menu left open adds its own listeners (document keydown, window scroll / resize): unmounting removes them too
      await clickEnd(page, 'a');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await expect(page.locator('.nabu-slash')).toBeVisible();
      await unmount(page, 'a');
      expect(await listeners(page), `after the unmount of cycle ${cycle}`).toEqual(start);
      await page.evaluate(() => (window as any).life.release('a'));
    }
    expect(errors.problems()).toEqual([]);
  });

  test('an engine that is created and never mounted holds nothing on the document', async ({ page }) => {
    const start = await listeners(page);
    await make(page, 'a');
    await make(page, 'b');
    await settle(page);
    expect(await listeners(page)).toEqual(start);
  });

  test('the SAME engine, unmounted and mounted again: it types, deletes, moves and undoes as before, with the same listeners', async ({ page }) => {
    const errors = watch(page);
    await warm(page);
    const start = await listeners(page);
    await make(page, 'a');

    await mount(page, 'a');
    const first = await listeners(page);
    await clickEnd(page, 'a');
    await page.keyboard.type('XY');
    expect(await markdown(page, 'a')).toBe('HelloXY');
    await unmount(page, 'a');
    expect(await listeners(page)).toEqual(start);

    await mount(page, 'a');
    expect(await listeners(page)).toEqual(first);
    await clickEnd(page, 'a');
    await page.keyboard.press('Backspace');
    expect(await markdown(page, 'a')).toBe('HelloX');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('-');
    expect(await markdown(page, 'a')).toBe('Hell-oX');
    await page.keyboard.press(Keys.undo);
    expect(await markdown(page, 'a')).not.toContain('-');
    // the mirrored selection follows the caret again (the model reads it)
    await clickEnd(page, 'a');
    expect(await page.evaluate(() => (window as any).life.engines.a.selection.anchorBlock?.id ?? null)).not.toBeNull();
    expect(errors.problems()).toEqual([]);
  });

  test('a {#key} swap: the new element replaces the old one, the same engine stays connected and types', async ({ page }) => {
    const errors = watch(page);
    await warm(page);
    await make(page, 'a');
    await mount(page, 'a');
    const mounted = await listeners(page);
    await root(page, 'a').evaluate((el) => el.setAttribute('data-old', ''));

    await swap(page, 'a');
    await expect(root(page, 'a')).not.toHaveAttribute('data-old', '');
    expect(await listeners(page)).toEqual(mounted);
    expect(await page.evaluate(() => {
      const engine = (window as any).life.engines.a;
      return engine.internals.selection.root === document.querySelector('[aria-label="Editor a"]');
    })).toBe(true);
    await clickEnd(page, 'a');
    await page.keyboard.type('!');
    expect(await markdown(page, 'a')).toBe('Hello!');
    // a selection range is mirrored (the page listener is on): the toolbar of the engine shows
    await page.keyboard.press('Shift+Home');
    await expect(page.locator('.nabu-toolbar')).toBeVisible();
    expect(errors.problems()).toEqual([]);
  });

  test('two engines: unmounting one leaves the other typing and selecting normally', async ({ page }) => {
    const errors = watch(page);
    await warm(page);
    await make(page, 'a', { text: 'Alpha' });
    await make(page, 'b', { text: 'Bravo' });
    await mount(page, 'a');
    await mount(page, 'b');
    await clickEnd(page, 'b');
    await page.keyboard.type('1');
    await unmount(page, 'a');

    await clickEnd(page, 'b');
    await page.keyboard.type('2');
    expect(await markdown(page, 'b')).toBe('Bravo12');
    expect(await markdown(page, 'a')).toBe('Alpha');
    // a selection-driven feature: the floating toolbar and the model's selection
    await page.keyboard.press('Shift+Home');
    await expect(page.locator('.nabu-toolbar')).toBeVisible();
    expect(await page.evaluate(() => (window as any).life.engines.b.selection.text)).toBe('Bravo12');
    await page.keyboard.press('Control+b');
    expect(await call(page, 'b', 'serialize', 'markdown')).toContain('**Bravo12**');
    expect(errors.problems()).toEqual([]);
  });

  test('unmounting while the caret is in the editor and the focus is on it: no error, and a page selection afterwards is quiet', async ({ page }) => {
    const errors = watch(page);
    await warm(page);
    await make(page, 'a');
    await mount(page, 'a');
    await clickEnd(page, 'a');
    await page.keyboard.type('x');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Editor a');
    await unmount(page, 'a');

    // the engine does not hold on to the removed nodes: it reads as "no selection"
    expect(await page.evaluate(() => {
      const s = (window as any).life.engines.a.selection;
      return [s.is, s.anchorNode, s.focusNode, s.root];
    })).toEqual([false, null, null, null]);

    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<p id="page-text">Some text of the page</p>');
      getSelection()!.selectAllChildren(document.getElementById('page-text')!);
    });
    await settle(page);
    await page.locator('#page-text').dblclick();
    await settle(page);
    expect(await page.evaluate(() => (window as any).life.engines.a.selection.is)).toBe(false);
    expect(errors.problems()).toEqual([]);
  });
});

test.describe('engine.destroy()', () => {
  test('in the onDestroy of a parent, before the unmount, and after it: no error, no state_unsafe_mutation', async ({ page }) => {
    const errors = watch(page);
    await warm(page);

    // 1. onDestroy(() => engine.destroy()) in the parent being unmounted
    await make(page, 'a');
    await mount(page, 'a', { destroyOnDestroy: true });
    await clickEnd(page, 'a');
    await page.keyboard.type('1');
    await unmount(page, 'a');

    // 2. destroy() while the editor is mounted, then the unmount
    await make(page, 'b');
    await mount(page, 'b');
    await clickEnd(page, 'b');
    await call(page, 'b', 'destroy');
    await settle(page);
    await unmount(page, 'b');

    // 3. the unmount, then destroy()
    await make(page, 'c');
    await mount(page, 'c');
    await clickEnd(page, 'c');
    await unmount(page, 'c');
    await call(page, 'c', 'destroy');
    await settle(page);

    expect(await markdown(page, 'a')).toBe('Hello1');
    expect(errors.problems()).toEqual([]);
  });

  test('twice is fine, and the document is still readable afterwards', async ({ page }) => {
    const errors = watch(page);
    await make(page, 'a', { text: 'Kept text' });
    await mount(page, 'a');
    await unmount(page, 'a');
    await call(page, 'a', 'destroy');
    await call(page, 'a', 'destroy');
    expect(await markdown(page, 'a')).toBe('Kept text');
    // an engine that was never mounted can be destroyed as well
    await make(page, 'b');
    await call(page, 'b', 'destroy');
    expect(await markdown(page, 'b')).toBe('Hello');
    expect(errors.problems()).toEqual([]);
  });

  test('a persisted engine: persistence is closed, the page listeners and the sync channel are gone', async ({ page }) => {
    const errors = watch(page);
    await warm(page);
    const start = await listeners(page);
    expect(await channels(page)).toBe(0);

    await make(page, 'a', { persist: `e2e-lifecycle-${test.info().testId}-${Date.now()}` });
    await mount(page, 'a');
    const mounted = await listeners(page);
    expect(mounted['document:visibilitychange'], 'persistence listens to the page').toBe(1);
    expect(mounted['window:pagehide']).toBe(1);
    expect(await channels(page)).toBe(1);

    await unmount(page, 'a');
    // the editor is gone but the persistence is not: that is what destroy() is for
    expect((await listeners(page))['window:pagehide']).toBe(1);
    await call(page, 'a', 'destroy');
    expect(await listeners(page)).toEqual(start);
    expect(await channels(page)).toBe(0);
    await expect(page.evaluate(() => (window as any).life.engines.a.saveNow())).rejects.toThrow(/disposed/);
    expect(errors.problems()).toEqual([]);
  });

  test('a persisted engine: the changes that are not saved yet are dropped, the saved ones are kept', async ({ page }) => {
    const docId = `e2e-lifecycle-${test.info().testId}-${Date.now()}`;
    await make(page, 'a', { persist: docId });
    await mount(page, 'a');
    await call(page, 'a', 'saveNow');
    await clickEnd(page, 'a');
    await page.keyboard.type('!');
    expect(await markdown(page, 'a')).toBe('Hello!');
    await call(page, 'a', 'destroy'); // before the autosave (2 s) and the page leaves
    expect(await markdown(page, 'a')).toBe('Hello!'); // still in memory

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__life_ready === true, null, { timeout: 15000 });
    await make(page, 'again', { persist: docId, text: null });
    expect(await markdown(page, 'again')).toBe('Hello');
    await call(page, 'again', 'destroy');
  });
});

test.describe('the engine can be collected', () => {
  /** Force the garbage collector (CDP) a few times: whether the engine, watched by a WeakRef, is gone. */
  async function collected(page: Page, name: string) {
    const cdp = await page.context().newCDPSession(page);
    for (let attempt = 0; attempt < 8; attempt++) {
      await cdp.send('HeapProfiler.collectGarbage');
      if (await page.evaluate((n) => (window as any).life.collected(n), name)) return true;
      await page.waitForTimeout(150);
    }
    return false;
  }

  // There is no "unmounted only" case on purpose: an unmounted engine stays subscribed to its document, since it can be mounted
  // again. Unmounting releases the page listeners, `destroy()` releases the memory.
  //
  // Two families: an engine that was only mounted (and edited through its API), and one the user focused with a click. The first
  // proves the subscriptions of the engine, of every kind of block, of the files and of the undo manager are cut.
  // Chromium keeps the LAST editor that had the focus alive from its native side, even removed, until another one takes the focus
  // (measured: of six clicked and destroyed in a row, five are collected, and the sixth once a new editor is clicked). One slot, it does
  // not add up: so the second family lets another editor take the focus before it checks.
  async function anotherEditorTakesTheFocus(page: Page) {
    await make(page, 'next');
    await mount(page, 'next');
    await clickEnd(page, 'next');
    await page.keyboard.type('q');
  }

  test('clicked engines do not add up: of six in a row, only the last one may still be held', async ({ page }) => {
    await warm(page);
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const name of names) {
      await make(page, name);
      await page.evaluate((n) => (window as any).life.watch(n), name);
      await mount(page, name);
      await clickEnd(page, name);
      await page.keyboard.type('x');
      await unmount(page, name);
      await call(page, name, 'destroy');
      await page.evaluate((n) => (window as any).life.release(n), name);
    }
    for (const name of names.slice(0, -1)) expect(await collected(page, name), name).toBe(true);
  });

  for (const focused of [false, true]) {
    const when = focused ? 'clicked in and typed in' : 'mounted and edited through its API';

    /** Mount the engine, use it the way the case says, unmount it, destroy it and forget it. */
    async function useAndDestroy(page: Page, name: string) {
      await page.evaluate((n) => (window as any).life.watch(n), name);
      await mount(page, name);
      if (focused) {
        await clickEnd(page, name);
        await page.keyboard.type('x');
        await page.keyboard.press('Shift+Home'); // the toolbar and the selection mirror have held the nodes
      }
      await page.evaluate(async (n) => {
        const engine = (window as any).life.engines[n];
        const first = engine.children.find((b: any) => b.type === 'paragraph');
        first.behaviors.get('text').insert(0, 'y'); // an edit goes through the text subscription and the undo manager
        const toggle = engine.children.find((b: any) => b.type === 'toggle');
        toggle?.node.data.set('collapsed', true); // a change of a block's data goes through its subscription
        await engine.commit();
        await engine.undo();
      }, name);
      await unmount(page, name);
      await call(page, name, 'destroy');
      await page.evaluate((n) => (window as any).life.release(n), name);
      if (focused) await anotherEditorTakesTheFocus(page);
    }

    test(`an engine ${when}, then destroyed`, async ({ page }) => {
      await warm(page);
      await make(page, 'a');
      await useAndDestroy(page, 'a');
      expect(await collected(page, 'a')).toBe(true);
    });

    test(`a document with one block of every type of the preset, ${when}, then destroyed`, async ({ page }) => {
      await warm(page);
      await make(page, 'a', { kinds: true });
      // every type of the registry is in the document, so that every kind of subscription (blocks, behaviors, files) was made
      expect(await page.evaluate(() => (window as any).life.missingKinds('a'))).toEqual([]);
      await useAndDestroy(page, 'a');
      expect(await collected(page, 'a')).toBe(true);
    });

    test(`a persisted engine ${when}, then destroyed`, async ({ page }) => {
      await warm(page);
      await make(page, 'a', { persist: `e2e-lifecycle-${test.info().testId}-${Date.now()}` });
      await useAndDestroy(page, 'a');
      expect(await collected(page, 'a')).toBe(true);
    });
  }
});
