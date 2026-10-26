/**
 * E2E — UI components audit: DragHandle, FloatingToolbar, SlashMenu, CommandInvite / CommandChooser, theming and the
 * region seam, driven by real mouse / keyboard input and asserted on concrete geometry (getBoundingClientRect), the model
 * and ARIA.
 *
 * Test-only route options used here (src/routes/e2e/+page.svelte): `layout: 'scroll'` (editor in a 360px `overflow:auto`
 * container under an opaque sticky top bar `.e2e-topbar`, 48px), `seed: 'long'` (80 numbered paragraphs), `theme`
 * (`dark` = dark host relying on the OS colour scheme, `dark-attr` = dark host + `data-nabu-theme="dark"`, `light`),
 * `vars` (CSS custom properties set on the host element), `commands: 'demo'` (the confirmation demo commands).
 *
 * Conventions: a `// CURRENT:` comment describes behaviour that is coherent today and worth a design discussion (it is
 * asserted or annotated, never silently ignored); a test is left FAILING only for clearly broken behaviour. Several
 * scenarios gather every violation they find in `problems` so a single failure reports all the numbers.
 *
 *  DragHandle   1 position per block type  2 drag a paragraph  3a-3d nested list / toggle / region container / invalid drops
 *               4 scroll while hovering  5 keyboard alternative (WCAG 2.5.7)  6 control semantics
 *  FloatingToolbar  7 position / flip  8 follows the selection on scroll  9 multi-block  10 click & keyboard  11 hide / flicker
 *  SlashMenu / Invite / Chooser   12 slash in a scroll container  13 invite + chooser in a scroll container
 *  Theming      14 contrast (light, dark OS scheme, dark attribute)  15 --nb-* custom properties
 *  Region seam  16 long titles WRAP (an editable title is never truncated), narrow viewport (375px)
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, press, flushRender } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { buildTree, Tog, Pp, tree, type TreeSpec } from './helpers/blocks.js';
import { outline, violations, allText, caret, focusAt, focusEnd, focusEmpty, selectRange, collectErrors } from './helpers/model.js';
import {
  PNG_DATA_URL, rect, mustRect, selectionRect, caretRect, pointOfText, dblclickWord, wheelScroll, dragWithHandle, contrast,
  blockBox, hoverPoint, dropPoint, type Box,
} from './helpers/ui.js';

/** A region spec for `buildTree`. */
const region = (regionType: string) => (title: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'region', props: { regionType, title }, children });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const HANDLE = '.nabu-drag-handle';
const TOOLBAR = '.nabu-toolbar';
const TOPBAR = '.e2e-topbar';
const SCROLLER = '.e2e-scroll-host';
const line = (n: number) => `Long line ${String(n).padStart(2, '0')} with some words to select`;

/** Print + annotate a CURRENT behaviour / finding (shown in the JSON / HTML reports, and on stdout with the list reporter). */
function note(kind: 'CURRENT' | 'FINDING', msg: string) {
  console.log(`${kind}: ${msg}`);
  test.info().annotations.push({ type: kind, description: msg });
}
const fmt = (b: Box | null) => (b ? `[x=${b.left.toFixed(1)} y=${b.top.toFixed(1)} w=${b.width.toFixed(1)} h=${b.height.toFixed(1)}]` : 'null');
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const overlap = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** One-line outline of the whole tree, regions nested: `p(text)`, `R:type(title){ … }`, `ul[…]` (see helpers/model.ts). */
const rootsWithRegions = (page: Page): Promise<string> => outline(page);
const seamLabels = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.nabu-region-label')].map((e) => e.textContent?.trim() ?? ''));

/** Scroll the window (or `scroller`) programmatically so the block holding `needle` has its top at `topPx` (test set-up, not the behaviour under test). */
async function scrollLineTo(page: Page, needle: string, topPx: number, scroller?: string) {
  await page.evaluate(([text, top, sel]) => {
    const walker = document.createTreeWalker(document.querySelector('.nabu-editor')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.nodeValue ?? '').includes(text as string)) continue;
      const r = (n.parentElement as HTMLElement).getBoundingClientRect();
      const delta = r.top - (top as number);
      if (sel) document.querySelector(sel as string)!.scrollTop += delta; else window.scrollBy(0, delta);
      return;
    }
    throw new Error('line not found: ' + text);
  }, [needle, topPx, scroller ?? ''] as [string, number, string]);
  await flushRender(page);
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

// ════════════════════════════════════════════════════════════════════════════
// DragHandle
// ════════════════════════════════════════════════════════════════════════════

test.describe('DragHandle', () => {
  test('1 · the handle sits next to the hovered block (left edge) and is aligned with its first line, for every block type', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [
      { type: 'paragraph', text: 'Plain paragraph' },
      { type: 'heading', text: 'Heading one', props: { level: 1 } },
      { type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'Top item', children: [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'Nested item' }] }] }] },
      { type: 'blockquote', text: 'Quote text' },
      { type: 'code', text: 'let x = 1;' },
      { type: 'callout', text: 'Callout text', props: { variant: 'note' } },
      { type: 'toggle', text: 'Toggle head', props: { collapsed: false }, children: [{ type: 'paragraph', text: 'in body' }] },
      { type: 'image', props: { ref: PNG_DATA_URL, alt: 'pic' } },
      { type: 'divider' },
      { type: 'region', props: { regionType: 'section-1', title: 'Seam' } },
      { type: 'paragraph', text: 'After' },
    ]);
    await expect(page.locator('[data-block-type="image"] img')).toBeVisible();

    const cases: Array<[string, string]> = [
      ['paragraph', '[data-block-type="paragraph"]'],
      ['heading', '[data-block-type="heading"]'],
      ['list item (level 1)', '[data-block-type="list-item"]'],
      ['list item (level 2)', '[data-block-type="list-item"] [data-block-type="list-item"]'],
      ['quote', '[data-block-type="blockquote"]'],
      ['code', '[data-block-type="code"]'],
      ['callout', '[data-block-type="callout"]'],
      ['toggle header', '[data-block-type="toggle"]'],
      ['image', '[data-block-type="image"]'],
      ['divider', '[data-block-type="divider"]'],
      ['region title', '[data-block-type="region"]'],
    ];
    const problems: string[] = [];
    for (const [name, sel] of cases) {
      await page.mouse.move(3, 700); // away: hides the handle
      const info = await page.evaluate((s) => {
        const el = document.querySelector('.nabu-editor ' + s)!;
        const b = el.getBoundingClientRect();
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
        const tn = w.nextNode();
        let lineCy: number | null = null;
        if (tn) { const r = document.createRange(); r.selectNodeContents(tn); const rr = r.getClientRects()[0]; lineCy = rr.top + rr.height / 2; }
        return { left: b.left, top: b.top, width: b.width, height: b.height, lineCy };
      }, sel);
      const box: Box = { ...info, x: info.left, y: info.top, right: info.left + info.width, bottom: info.top + info.height, cx: info.left + info.width / 2, cy: info.top + info.height / 2 };
      // First visual line: the text's first line box, else (image) the top strip of the block, else (divider) the block itself.
      const expectedCy = info.lineCy ?? (info.height > 30 ? info.top + 11 : info.top + info.height / 2);
      const p = hoverPoint(box);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      const appeared = await page.waitForSelector(HANDLE, { timeout: 800 }).then(() => true).catch(() => false);
      if (!appeared) { problems.push(`${name}: no handle appeared when hovering (${p.x.toFixed(0)},${p.y.toFixed(1)}) over ${fmt(box)}`); continue; }
      const hb = (await rect(page, HANDLE))!;
      console.log(`handle ${name.padEnd(20)} block${fmt(box)} handle${fmt(hb)} firstLineCy=${expectedCy.toFixed(1)} handleCy=${hb.cy.toFixed(1)} dy=${(hb.cy - expectedCy).toFixed(1)} gapX=${(box.left - hb.right).toFixed(1)}`);
      if (!near(hb.right, box.left, 2)) problems.push(`${name}: handle.right=${hb.right.toFixed(1)} is not flush with block.left=${box.left.toFixed(1)}`);
      if (!near(hb.cy, expectedCy, 6)) problems.push(`${name}: handle centre y=${hb.cy.toFixed(1)} vs first line centre y=${expectedCy.toFixed(1)} (dy=${(hb.cy - expectedCy).toFixed(1)}, tolerance 6)`);
      if (hb.left < 0) problems.push(`${name}: handle off-screen (left=${hb.left.toFixed(1)})`);
    }
    expect(problems).toEqual([]);
  });

  test('2 · dragging a paragraph below / above another reorders it in ONE undo step, the indicator line shows at the drop edge, the caret is sane', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('Alpha'), Pp('Bravo'), Pp('Charlie'), Pp('Delta')]);
    const original = 'p(Alpha) ; p(Bravo) ; p(Charlie) ; p(Delta)';
    expect(await outline(page)).toBe(original);

    // Alpha → below Charlie (lower half)
    const alpha = await blockBox(page, 'paragraph', 'Alpha');
    const charlie = await blockBox(page, 'paragraph', 'Charlie');
    await dragWithHandle(page, hoverPoint(alpha), dropPoint(charlie, 'after'), {
      during: async () => {
        const ind = await mustRect(page, '.nabu-drop-indicator');
        const c = await blockBox(page, 'paragraph', 'Charlie');
        expect(near(ind.top, c.bottom, 2.5), `indicator.top=${ind.top} should sit on Charlie's bottom edge ${c.bottom}`).toBe(true);
        expect(near(ind.left, c.left, 1.5) && near(ind.width, c.width, 1.5), `indicator ${fmt(ind)} should span Charlie ${fmt(c)}`).toBe(true);
        await expect(page.locator('[data-block-type="paragraph"].nabu-dragging'), 'the dragged block is dimmed').toHaveCount(1);
        await expect(page.locator(HANDLE), 'the handle hides while dragging').toHaveCount(0);
      },
    });
    await expect.poll(() => outline(page)).toBe('p(Bravo) ; p(Charlie) ; p(Alpha) ; p(Delta)');
    await expect(page.locator('.nabu-drop-indicator')).toHaveCount(0);
    await expect(page.locator('.nabu-dragging')).toHaveCount(0);
    await expect.poll(() => caret(page), { message: 'the caret goes to the start of the moved block' }).toBe('|Alpha');
    expect(await violations(page)).toEqual([]);

    // one undo step brings the original order back, one redo moves it again
    await undo(page);
    await expect.poll(() => outline(page), { message: 'a single undo reverts the whole move' }).toBe(original);
    await redo(page);
    await expect.poll(() => outline(page)).toBe('p(Bravo) ; p(Charlie) ; p(Alpha) ; p(Delta)');

    // Delta → above Bravo (upper half)
    const delta = await blockBox(page, 'paragraph', 'Delta');
    const bravo = await blockBox(page, 'paragraph', 'Bravo');
    await dragWithHandle(page, hoverPoint(delta), dropPoint(bravo, 'before'), {
      during: async () => {
        const ind = await mustRect(page, '.nabu-drop-indicator');
        const b = await blockBox(page, 'paragraph', 'Bravo');
        expect(near(ind.top, b.top, 2.5), `indicator.top=${ind.top} should sit on Bravo's top edge ${b.top}`).toBe(true);
      },
    });
    await expect.poll(() => outline(page)).toBe('p(Delta) ; p(Bravo) ; p(Charlie) ; p(Alpha)');
    await expect.poll(() => caret(page)).toBe('|Delta');
    // the editor really has focus at the caret: typing lands in the moved block
    await page.keyboard.type('Z');
    expect(await outline(page)).toBe('p(ZDelta) ; p(Bravo) ; p(Charlie) ; p(Alpha)');
    expect(await violations(page)).toEqual([]);
  });

  test('3a · a nested list item can be dragged to another list, then to the root; no text is lost, the tree stays valid', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [
      { type: 'list', props: { listType: 'bullet' }, children: [
        { type: 'list-item', text: 'a', children: [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'a1' }, { type: 'list-item', text: 'a2' }] }] },
        { type: 'list-item', text: 'b' },
      ] },
      Pp('para'),
      { type: 'list', props: { listType: 'ordered' }, children: [{ type: 'list-item', text: 'c' }] },
    ]);
    const original = await outline(page);
    expect(original).toBe('ul[a > ul[a1, a2], b] ; p(para) ; ol[c]');
    const textBefore = (await allText(page)).sort();

    // a1 → below c (a list of ANOTHER type)
    await dragWithHandle(page, hoverPoint(await blockBox(page, 'list-item', 'a1')), dropPoint(await blockBox(page, 'list-item', 'c'), 'after'));
    await expect.poll(() => outline(page)).toBe('ul[a > ul[a2], b] ; p(para) ; ol[c, a1]');
    expect(await violations(page)).toEqual([]);
    await undo(page);
    await expect.poll(() => outline(page), { message: 'one undo step' }).toBe(original);
    await redo(page);
    await expect.poll(() => outline(page)).toBe('ul[a > ul[a2], b] ; p(para) ; ol[c, a1]');

    // a2 (the LAST item of its sub-list) → to the root, below the paragraph: the emptied sub-list must disappear
    await dragWithHandle(page, hoverPoint(await blockBox(page, 'list-item', 'a2')), dropPoint(await blockBox(page, 'paragraph', 'para'), 'after'));
    await expect.poll(() => outline(page)).toMatch(/^ul\[a, b\] ; p\(para\) ; /);
    const after = await outline(page);
    expect(after, 'the item is wrapped in a root list').toMatch(/a2/);
    expect(after, 'the emptied sub-list is gone').not.toMatch(/a > ul/);
    expect(await violations(page)).toEqual([]);
    expect((await allText(page)).sort()).toEqual(textBefore);
  });

  test('3b · a block dragged INTO a toggle body ends up as a body child, rendered ONCE (no stale copy left at the root)', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('outside'), Tog('Head', [Pp('inner')])]);
    expect(await tree(page)).toBe('p(outside) ; toggle▾(Head){p(inner)}');

    // outside → lower half of the body paragraph: becomes the 2nd body child
    await dragWithHandle(page, hoverPoint(await blockBox(page, 'paragraph', 'outside')), dropPoint(await blockBox(page, 'paragraph', 'inner'), 'after'));
    await expect.poll(() => tree(page)).toBe('toggle▾(Head){p(inner) p(outside)}');
    await flushRender(page);
    const dom = await page.evaluate(() => [...document.querySelectorAll('.nabu-editor [data-block-id]')].map((e) => `${e.getAttribute('data-block-type')}:${(e.textContent ?? '').trim().slice(0, 8)}`));
    expect(dom, 'each block is rendered once').toEqual(['toggle:Head', 'paragraph:inner', 'paragraph:outside']);
    expect(await violations(page)).toEqual([]);
  });

  test('3b2 · a toggle cannot be dropped inside its own body; dropping on a toggle header puts the block next to the toggle', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('outside'), Tog('Head', [Pp('inner'), Pp('other')])]);

    // dragging the toggle onto its own body is refused (cycle guard): nothing changes
    await dragWithHandle(page, hoverPoint(await blockBox(page, 'toggle', 'Head')), dropPoint(await blockBox(page, 'paragraph', 'inner'), 'after'));
    await page.waitForTimeout(200);
    expect(await tree(page), 'dropping a container into its own subtree is a no-op').toBe('p(outside) ; toggle▾(Head){p(inner) p(other)}');
    expect(await violations(page)).toEqual([]);

    // CURRENT: dropping on the LOWER half of the toggle HEADER puts the block after the whole toggle (a sibling), not first in the body.
    await dragWithHandle(page, hoverPoint(await blockBox(page, 'paragraph', 'outside')), dropPoint(await blockBox(page, 'toggle', 'Head'), 'after'));
    await expect.poll(() => tree(page)).toBe('toggle▾(Head){p(inner) p(other)} ; p(outside)');
    note('CURRENT', 'drop on the lower half of a toggle header = sibling AFTER the toggle (never "first child of the body"); the only way into an expanded body is to target one of its children');
    expect(await violations(page)).toEqual([]);
  });

  test('3c · dragging a REGION (by its title handle) moves the WHOLE container (title + body + sub-regions) in one undo step; labels renumber', async ({ page }) => {
    // A region is a container block (ADR 018): the handle of its title moves the block, i.e. its whole subtree (a tree move; no range to compute).
    await gotoEditor(page);
    await buildTree(page, [
      Pp('Pre'),
      { type: 'region', props: { regionType: 'section-1', title: 'One' }, children: [Pp('a'), { type: 'region', props: { regionType: 'section-2', title: 'Two' }, children: [Pp('b')] }] },
      { type: 'region', props: { regionType: 'section-1', title: 'Three' }, children: [Pp('c')] },
      Pp('d'),
    ]);
    const original = await rootsWithRegions(page);
    expect(original).toBe('p(Pre) ; R:section-1(One){ p(a) ; R:section-2(Two){ p(b) } } ; R:section-1(Three){ p(c) } ; p(d)');
    const labelsBefore = await seamLabels(page);
    expect(labelsBefore).toEqual(['1.', '1.1', '2.']);
    const textBefore = (await allText(page)).sort();

    // region "One" (with its paragraph "a" and its sub-region "Two" + "b") → below the last paragraph "d"
    await focusAt(page, 'Pre', 1); // the caret is in the editor first, like a user who was typing: the handle never takes the focus
    const seam = await mustRect(page, '[data-block-type="region"]', 0);
    await dragWithHandle(page, hoverPoint(seam), dropPoint(await blockBox(page, 'paragraph', 'd'), 'after'));
    await expect.poll(() => rootsWithRegions(page)).toBe('p(Pre) ; R:section-1(Three){ p(c) } ; p(d) ; R:section-1(One){ p(a) ; R:section-2(Two){ p(b) } }');
    const labelsAfter = await seamLabels(page);
    expect(labelsAfter, 'the seams are renumbered: Three is now the first section, One the second (and its sub-section 2.1)').toEqual(['1.', '2.', '2.1']);
    expect(await violations(page), 'tree + DOM invariants after moving a region').toEqual([]);
    expect((await allText(page)).sort()).toEqual(textBefore);

    await undo(page);
    await expect.poll(() => rootsWithRegions(page), { message: 'one undo step (Ctrl+Z right after the drop)' }).toBe(original);
    expect(await seamLabels(page)).toEqual(labelsBefore);
    expect(await violations(page)).toEqual([]);

    // a SUB-region ("Two" + "b") dragged below "c" nests into "Three" (the body of its drop target's parent)
    const two = await mustRect(page, '[data-block-type="region"]', 1);
    await dragWithHandle(page, hoverPoint(two), dropPoint(await blockBox(page, 'paragraph', 'c'), 'after'));
    await expect.poll(() => rootsWithRegions(page)).toBe('p(Pre) ; R:section-1(One){ p(a) } ; R:section-1(Three){ p(c) ; R:section-2(Two){ p(b) } } ; p(d)');
    expect(await violations(page)).toEqual([]);
    // dropping a region onto a block of its own body does nothing (cycle guard)
    const afterSub = await rootsWithRegions(page);
    const one = await mustRect(page, '[data-block-type="region"]', 0);
    await dragWithHandle(page, hoverPoint(one), dropPoint(await blockBox(page, 'paragraph', 'a'), 'after'));
    await page.waitForTimeout(200);
    expect(await rootsWithRegions(page), 'a region cannot be dropped inside its own body').toBe(afterSub);
    expect(await violations(page)).toEqual([]);
  });

  test('3d · dropping a paragraph or a region ONTO a list item keeps the tree valid (no foreign block inside a list)', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [
      Pp('Mov'),
      { type: 'region', props: { regionType: 'section-1', title: 'Seam' } },
      { type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'x' }, { type: 'list-item', text: 'y' }] },
    ]);
    const textBefore = (await allText(page)).sort();

    // paragraph → lower half of "x" (in the middle of the list)
    await dragWithHandle(page, hoverPoint(await blockBox(page, 'paragraph', 'Mov')), dropPoint(await blockBox(page, 'list-item', 'x'), 'after'));
    await expect.poll(() => outline(page)).toMatch(/ul\[x\] ; p\(Mov\) ; ul\[y\]$/);
    expect(await violations(page), 'paragraph dropped inside a list').toEqual([]);

    // region → lower half of "y"
    const seam = await mustRect(page, '[data-block-type="region"]', 0);
    await dragWithHandle(page, hoverPoint(seam), dropPoint(await blockBox(page, 'list-item', 'y'), 'after'));
    await page.waitForTimeout(200);
    expect(await violations(page), 'region dropped on a list item').toEqual([]);
    expect(await page.evaluate(() => (window as any).nabu.tree.roots().some((r: any) => r.data.get('type') === 'region')), 'the region survived at the root').toBe(true);
    expect((await allText(page)).sort()).toEqual(textBefore);
  });

  for (const layout of ['window', 'container'] as const) {
    test(`4 · scrolling (${layout}) while hovering a block: the handle follows its block or hides — never stays at a stale position`, async ({ page }) => {
      await gotoEditor(page, { seed: 'long', ...(layout === 'container' ? { layout: 'scroll' as const } : {}) });
      await expect(page.locator('[data-block-type="paragraph"]').nth(79)).toBeAttached();
      const scroller = layout === 'container' ? SCROLLER : undefined;
      const target = await blockBox(page, 'paragraph', line(layout === 'container' ? 4 : 6));
      const p = hoverPoint(target);
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await expect(page.locator(HANDLE)).toBeVisible();
      const h0 = (await rect(page, HANDLE))!;
      expect(near(h0.top, target.top + 2, 1.5), 'before scrolling the handle is on the block').toBe(true);

      const moved = await wheelScroll(page, p, 137, scroller);
      expect(moved).toBeGreaterThan(50);

      const state = await page.evaluate(([h]) => {
        const handle = document.querySelector(h as string);
        if (!handle) return { visible: false as const };
        const hr = handle.getBoundingClientRect();
        const blocks = [...document.querySelectorAll('.nabu-editor [data-block-type="paragraph"]')];
        const match = blocks.find((b) => { const r = b.getBoundingClientRect(); return Math.abs(hr.top - (r.top + 2)) <= 1.5 && Math.abs(hr.right - r.left) <= 2; });
        const host = document.querySelector('.e2e-scroll-host')?.getBoundingClientRect();
        return { visible: true as const, top: hr.top, matched: match ? match.textContent : null, insideHost: host ? hr.top >= host.top - 1 && hr.bottom <= host.bottom + 1 : true };
      }, [HANDLE]);
      console.log(`scroll ${layout}: scrolled ${moved}px, handle ${JSON.stringify(state)}`);
      if (state.visible) {
        expect(state.matched, `a visible handle must sit on a block (stale at y=${state.top} after scrolling ${moved}px)`).not.toBeNull();
        expect(state.insideHost, 'a visible handle must stay inside the scroll container').toBe(true);
      }
    });
  }

  test('5 · keyboard alternative to dragging: a command exists to move a block up / down without a pointer (WCAG 2.5.7 Dragging Movements)', async ({ page }) => {
    // ACCESSIBILITY (WCAG 2.5.7): the DragHandle is pointer-only, so every block has a keyboard alternative: the engine commands
    // block:move-up / block:move-down on Mod+Shift+ArrowUp / ArrowDown (P-80; the first draft of this test used Alt+ArrowUp, but
    // Alt+Arrow is a caret-navigation chord on macOS, so the decided chord is Mod+Shift+Arrow).
    await gotoEditor(page);
    await buildTree(page, [Pp('one'), Pp('two'), Pp('three')]);
    const ids = await page.evaluate(() => (window as any).nabu.commands.list().map((c: any) => c.id));
    const generic = ids.filter((id: string) => /move/i.test(id) && !id.startsWith('region:'));
    console.log('movement commands:', JSON.stringify(ids.filter((id: string) => /move/i.test(id))));
    expect(generic, 'a block-level move command (e.g. "block:move-up" / "block:move-down") exists').not.toEqual([]);
    expect(ids).toContain('block:move-up');
    expect(ids).toContain('block:move-down');

    await focusAt(page, 'two', 1);
    await press(page, `${MOD}+Shift+ArrowUp`);
    expect(await outline(page), 'Mod+Shift+ArrowUp moves the block holding the caret up').toBe('p(two) ; p(one) ; p(three)');
  });

  test('6 · the handle is a labelled button, focusable by script — but pointer-only (CURRENT: not reachable by Tab, no keyboard activation)', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('one'), Pp('two'), Pp('three')]);
    await page.mouse.move(3, 700);
    await expect(page.locator(HANDLE), 'no handle without a hover').toHaveCount(0);

    const two = await blockBox(page, 'paragraph', 'two');
    const p = hoverPoint(two);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    const handle = page.locator(HANDLE);
    await expect(handle).toBeVisible();
    // semantics
    expect(await handle.evaluate((el) => el.tagName)).toBe('BUTTON');
    await expect(handle).toHaveAttribute('aria-label', /drag|reorder|move/i);
    await expect(handle).not.toHaveAttribute('tabindex', '-1');
    await expect(handle, 'the control must not be part of the editable surface').toHaveAttribute('contenteditable', 'false');
    // it can take focus from script
    await handle.focus();
    expect(await page.evaluate((s) => document.activeElement?.matches(s), HANDLE)).toBe(true);
    // CURRENT: pointer-only — Enter / Space / arrows do nothing
    await press(page, 'Enter');
    await press(page, 'Space');
    await press(page, 'ArrowUp');
    const after = await outline(page);
    note('CURRENT', `focused handle + Enter/Space/ArrowUp → outline "${after}" (unchanged = the handle is pointer-only: it has no keyboard activation)`);
    expect(after).toBe('p(one) ; p(two) ; p(three)');

    // CURRENT: the handle only exists while the POINTER hovers a block, so keyboard users never get to it with Tab
    await focusAt(page, 'one', 0);
    await page.mouse.move(3, 700);
    const stops: string[] = [];
    for (let i = 0; i < 4; i++) { await press(page, 'Tab'); stops.push(await page.evaluate(() => document.activeElement?.className?.toString() || document.activeElement?.tagName || '')); }
    note('CURRENT', `Tab stops from the editor with the pointer away: ${JSON.stringify(stops)}; handle in DOM: ${await page.locator(HANDLE).count()}`);
    expect(await page.locator(HANDLE).count(), 'no handle in the DOM without a pointer hover').toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FloatingToolbar
// ════════════════════════════════════════════════════════════════════════════

const SENTENCE = (n: number) => line(n);

test.describe('FloatingToolbar', () => {
  test('7a · appears above a single-line selection, horizontally centred on it, close to it', async ({ page }) => {
    await gotoEditor(page, { seed: 'long' });
    await dblclickWord(page, SENTENCE(10), 'words', { scroll: true });
    const tb = await mustRect(page, TOOLBAR);
    const sel = await selectionRect(page);
    const vp = page.viewportSize()!;
    console.log(`toolbar ${fmt(tb)} selection ${fmt(sel)}`);
    expect(near(tb.cx, sel.cx, 3), `toolbar centre x=${tb.cx.toFixed(1)} vs selection centre x=${sel.cx.toFixed(1)}`).toBe(true);
    expect(tb.bottom, 'toolbar is above the selection').toBeLessThanOrEqual(sel.top + 0.5);
    expect(sel.top - tb.bottom, 'and close to it (gap)').toBeLessThanOrEqual(16);
    expect(tb.top).toBeGreaterThanOrEqual(0);
    expect(tb.left).toBeGreaterThanOrEqual(0);
    expect(tb.right).toBeLessThanOrEqual(vp.width);
  });

  test('7b · selection near the TOP of the window: the toolbar must not cover the selected text and must stay on screen', async ({ page }) => {
    await gotoEditor(page, { seed: 'long' });
    await scrollLineTo(page, SENTENCE(10), 12);
    await dblclickWord(page, SENTENCE(10), 'words');
    const tb = await mustRect(page, TOOLBAR);
    const sel = await selectionRect(page);
    console.log(`near top: toolbar ${fmt(tb)} selection ${fmt(sel)}`);
    expect(tb.top, 'toolbar fully on screen').toBeGreaterThanOrEqual(0);
    const covers = overlap(tb, sel);
    expect(covers, `toolbar ${fmt(tb)} covers the selection ${fmt(sel)} — it is clamped to top=8px instead of flipping below the selection`).toBe(false);
  });

  test('7c · selection near the top of a scroll container under a sticky top bar: the toolbar must not hide under the bar nor cover the selection', async ({ page }) => {
    await gotoEditor(page, { seed: 'long', layout: 'scroll' });
    await scrollLineTo(page, SENTENCE(10), 80 + 6, SCROLLER); // container top is 80px: line 6px below it
    await dblclickWord(page, SENTENCE(10), 'words');
    const tb = await mustRect(page, TOOLBAR);
    const bar = await mustRect(page, TOPBAR);
    const sel = await selectionRect(page);
    console.log(`scroll container: toolbar ${fmt(tb)} top bar ${fmt(bar)} selection ${fmt(sel)}`);
    expect(overlap(tb, bar), `toolbar ${fmt(tb)} is (partly) under the sticky top bar ${fmt(bar)} (z-index 1000 > 100): hidden`).toBe(false);
    expect(overlap(tb, sel), `toolbar ${fmt(tb)} covers the selection ${fmt(sel)}`).toBe(false);
  });

  for (const layout of ['window', 'container'] as const) {
    test(`8 · scrolling (${layout}) with a selection: the toolbar follows it or hides — never stale`, async ({ page }) => {
      await gotoEditor(page, { seed: 'long', ...(layout === 'container' ? { layout: 'scroll' as const } : {}) });
      const scroller = layout === 'container' ? SCROLLER : undefined;
      await scrollLineTo(page, SENTENCE(20), layout === 'container' ? 80 + 150 : 300, scroller);
      await dblclickWord(page, SENTENCE(20), 'words');
      await expect(page.locator(TOOLBAR)).toBeVisible();
      const sel0 = await selectionRect(page);
      const mouse = { x: sel0.cx, y: sel0.bottom + 40 };
      const moved = await wheelScroll(page, mouse, 90, scroller);
      expect(moved).toBeGreaterThan(40);
      const sel = await selectionRect(page);
      expect(near(sel0.top - sel.top, moved, 2), 'the selection moved with the scroll').toBe(true);
      const tb = await rect(page, TOOLBAR);
      console.log(`scroll ${layout}: scrolled ${moved}px; selection y ${sel0.top.toFixed(1)} → ${sel.top.toFixed(1)}; toolbar ${fmt(tb)}`);
      if (tb) {
        expect(near(tb.cx, sel.cx, 4) && sel.top - tb.bottom >= -1 && sel.top - tb.bottom <= 16,
          `stale toolbar ${fmt(tb)}: the selection is now at ${fmt(sel)} (it moved ${moved}px, the toolbar did not follow)`).toBe(true);
      }
    });
  }

  test('9 · multi-block selection: toolbar above the first selected line, within the editor width; B / I are active only when EVERY selected run has the mark', async ({ page }) => {
    await gotoEditor(page);
    // leading filler: room above the selection, so the near-top clamp of the toolbar (scenario 7b) does not interfere
    await buildTree(page, [Pp('lead 1'), Pp('lead 2'), Pp('lead 3'), Pp('alpha beta'), Pp('gamma delta'), Pp('epsilon zeta')]);
    const btn = (label: RegExp) => page.locator(`${TOOLBAR} .nabu-toolbar-btn`, { hasText: label });

    // bold the middle paragraph only (programmatic select, then the real shortcut)
    await selectRange(page, 'gamma delta', 0, 'gamma delta', -1);
    await press(page, `${MOD}+b`);
    await expect(btn(/^B$/), 'whole selection bold → B active').toHaveClass(/active/);
    await expect(btn(/^I$/)).not.toHaveClass(/active/);

    // select across the three blocks with the keyboard
    await focusAt(page, 'alpha beta', 2);
    await press(page, 'Shift+ArrowDown');
    await press(page, 'Shift+ArrowDown');
    await press(page, 'Shift+End');
    await expect(page.locator(TOOLBAR)).toBeVisible();
    const tb = await mustRect(page, TOOLBAR);
    const sel = await selectionRect(page);
    const first = await blockBox(page, 'paragraph', 'alpha beta');
    const editor = await mustRect(page, '.nabu-editor');
    console.log(`multi-block: toolbar ${fmt(tb)} selection union ${fmt(sel)} first block ${fmt(first)}`);
    expect(tb.bottom, 'toolbar sits above the FIRST selected line (not the middle of the union)').toBeLessThanOrEqual(first.top + 0.5);
    expect(tb.top).toBeGreaterThanOrEqual(0);
    expect(tb.cx).toBeGreaterThanOrEqual(editor.left);
    expect(tb.cx).toBeLessThanOrEqual(editor.right);
    expect(near(tb.cx, sel.cx, 3), 'centred on the union of the selection').toBe(true);

    await expect(btn(/^B$/), 'mixed bold / not bold → B NOT active (a click bolds everything)').not.toHaveClass(/active/);
    await expect(btn(/^I$/)).not.toHaveClass(/active/);
    await press(page, `${MOD}+i`); // italic on all three blocks
    await expect(btn(/^I$/), 'italic on every block → I active').toHaveClass(/active/);
    await expect(btn(/^B$/), 'italic does not make B active').not.toHaveClass(/active/);
    await btn(/^B$/).click(); // mixed → applies bold to all
    await expect(btn(/^B$/), 'after clicking B on a mixed selection every block is bold → active').toHaveClass(/active/);
    await expect(page.locator(TOOLBAR)).toBeVisible();
  });

  test('10 · clicking a button keeps the selection and the toolbar; keyboard access to the toolbar (documented)', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('Hello brave new world')]);
    await dblclickWord(page, 'Hello brave new world', 'brave');
    expect(await caret(page)).toBe('Hello ⟦brave⟧ new world');
    const bold = page.locator(`${TOOLBAR} .nabu-toolbar-btn`, { hasText: /^B$/ });
    await bold.click();
    expect(await caret(page), 'the selection survives the click').toBe('Hello ⟦brave⟧ new world');
    await expect(page.locator(TOOLBAR), 'the toolbar stays').toBeVisible();
    await expect(bold).toHaveClass(/active/);
    expect(await page.evaluate(() => (window as any).nabu.isMarkActive('bold'))).toBe(true);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[contenteditable="true"]')), 'focus stays in the editor').toBe(true);
    await bold.click(); // toggles off
    await expect(bold).not.toHaveClass(/active/);
    expect(await caret(page)).toBe('Hello ⟦brave⟧ new world');

    // keyboard: can the toolbar be reached? (documented)
    const attrs = await bold.evaluate((el) => ({ tag: el.tagName, role: el.getAttribute('role'), ariaPressed: el.getAttribute('aria-pressed'), ariaLabel: el.getAttribute('aria-label'), title: el.getAttribute('title'), tabindex: el.getAttribute('tabindex'), toolbarRole: el.parentElement?.getAttribute('role') ?? null }));
    const reached: string[] = [];
    for (const key of ['Tab', 'Shift+Tab', 'Alt+F10', 'F10']) {
      await press(page, key);
      reached.push(`${key}→${await page.evaluate(() => (document.activeElement?.closest('.nabu-toolbar') ? 'TOOLBAR' : document.activeElement?.closest('[contenteditable="true"]') ? 'editor' : document.activeElement?.tagName))}`);
    }
    note('CURRENT', `toolbar keyboard access: ${reached.join(', ')}; button semantics ${JSON.stringify(attrs)} — the container is role=toolbar (aria-label), buttons carry aria-pressed + aria-label; still not reachable by Tab (keyboard navigation is a design topic); formatting is available through the shortcuts (Mod+B…)`);
    await expect(bold).toBeVisible();
  });

  test('11 · hides on collapse / typing / blur; no show-hide flicker while the selection is extended with Shift+Arrow', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('Flicker test paragraph with many words')]);
    await page.evaluate(() => {
      const w = window as any;
      w.__tb = { added: 0, removed: 0 };
      const has = (n: Node) => n.nodeType === 1 && ((n as Element).matches('.nabu-toolbar') || !!(n as Element).querySelector('.nabu-toolbar'));
      new MutationObserver((ms) => { for (const m of ms) { m.addedNodes.forEach((n) => { if (has(n)) w.__tb.added++; }); m.removedNodes.forEach((n) => { if (has(n)) w.__tb.removed++; }); } })
        .observe(document.body, { childList: true, subtree: true });
    });
    const counts = () => page.evaluate(() => (window as any).__tb);

    await focusAt(page, 'Flicker test paragraph with many words', 0);
    await press(page, 'Shift+ArrowRight');
    await expect(page.locator(TOOLBAR)).toBeVisible();
    await page.evaluate(() => { document.querySelector('.nabu-toolbar')!.setAttribute('data-probe', '1'); });
    for (let i = 0; i < 9; i++) await press(page, 'Shift+ArrowRight');
    await flushRender(page);
    const c1 = await counts();
    expect(c1, 'one appearance, no remount while extending').toEqual({ added: 1, removed: 0 });
    await expect(page.locator(`${TOOLBAR}[data-probe="1"]`), 'it is the same element throughout').toHaveCount(1);

    // typing over the selection
    await page.keyboard.type('X');
    await expect(page.locator(TOOLBAR), 'typing replaces the selection → collapsed → hidden').toHaveCount(0);
    expect(await counts()).toEqual({ added: 1, removed: 1 });

    // collapse with an arrow key
    await press(page, 'Shift+ArrowRight');
    await press(page, 'Shift+ArrowRight');
    await expect(page.locator(TOOLBAR)).toBeVisible();
    await press(page, 'ArrowRight');
    await expect(page.locator(TOOLBAR), 'collapsing with ArrowRight hides it').toHaveCount(0);

    // blur: the user moves to another control of the host page
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'outside'; i.style.cssText = 'position:fixed;left:700px;top:600px;'; document.body.appendChild(i); });
    await press(page, 'Shift+ArrowLeft');
    await press(page, 'Shift+ArrowLeft');
    await expect(page.locator(TOOLBAR)).toBeVisible();
    await page.locator('#outside').click();
    await expect(page.locator(TOOLBAR), 'focus moved to another control of the page → hidden').toHaveCount(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SlashMenu / CommandInvite / CommandChooser
// ════════════════════════════════════════════════════════════════════════════

test.describe('Popups in a scroll container', () => {
  test('12a · SlashMenu: anchored under the caret, clamped inside the viewport, never under the sticky top bar', async ({ page }) => {
    await gotoEditor(page, { seed: 'long', layout: 'scroll' });
    await page.locator('[data-block-type="paragraph"]').nth(3).click();
    await press(page, 'End');
    await page.keyboard.type(' /');
    const menu = page.locator('.nabu-slash');
    await expect(menu).toBeVisible();
    const m = await mustRect(page, '.nabu-slash');
    const c = await caretRect(page);
    const bar = await mustRect(page, TOPBAR);
    const vp = page.viewportSize()!;
    console.log(`slash: menu ${fmt(m)} caret ${fmt(c)} bar ${fmt(bar)} viewport ${vp.width}x${vp.height}`);
    expect(near(m.top, c.bottom, 12), `menu top ${m.top.toFixed(1)} vs caret bottom ${c.bottom.toFixed(1)}`).toBe(true);
    expect(m.left, 'inside the viewport (left)').toBeGreaterThanOrEqual(8 - 0.5);
    expect(m.right, 'inside the viewport (right)').toBeLessThanOrEqual(vp.width - 8 + 0.5);
    expect(m.bottom, 'inside the viewport (bottom)').toBeLessThanOrEqual(vp.height);
    expect(overlap(m, bar), 'not under the sticky top bar').toBe(false);
    expect(near(m.left, Math.min(c.left, vp.width - 8 - m.width), 2), 'horizontally at the caret (or clamped)').toBe(true);
  });

  test('12b · SlashMenu: when the caret line is scrolled out of the container, the menu must not stay floating over the page', async ({ page }) => {
    await gotoEditor(page, { seed: 'long', layout: 'scroll' });
    await page.locator('[data-block-type="paragraph"]').nth(8).click();
    await press(page, 'End');
    await page.keyboard.type(' /');
    await expect(page.locator('.nabu-slash')).toBeVisible();
    const host = await mustRect(page, SCROLLER);
    const c0 = await caretRect(page);
    // push the caret line ~30px above the container's top edge
    await wheelScroll(page, { x: host.cx, y: host.cy }, Math.round(c0.bottom - (host.top - 30)), SCROLLER);
    const c = await caretRect(page);
    const m = await rect(page, '.nabu-slash');
    console.log(`slash after scroll: caret ${fmt(c)} container ${fmt(host)} menu ${fmt(m)}`);
    note('CURRENT', 'SlashMenu stays open while scrolling (it follows the caret via a capturing scroll listener)');
    const anchorClipped = c.bottom < host.top || c.top > host.bottom;
    if (m && anchorClipped) {
      expect(false, `the caret line ${fmt(c)} is clipped out of the scroll container ${fmt(host)} but the menu ${fmt(m)} still floats at that stale anchor over the page`).toBe(true);
    }
  });

  test('13 · CommandInvite and CommandChooser inside the scroll container: anchored at the caret, readable, follow the scroll', async ({ page }) => {
    await gotoEditor(page, { seed: 'long', layout: 'scroll', commands: 'demo' });
    await page.locator('[data-block-type="paragraph"]').nth(4).click();
    await press(page, 'End');
    const vp = page.viewportSize()!;
    const bar = await mustRect(page, TOPBAR);

    // invite
    await press(page, `${MOD}+Alt+k`);
    const invite = page.locator('.nabu-command-invite');
    await expect(invite).toBeVisible();
    let box = await mustRect(page, '.nabu-command-invite');
    let c = await caretRect(page);
    console.log(`invite ${fmt(box)} caret ${fmt(c)} text="${await invite.innerText()}"`);
    expect(near(box.top, c.bottom + 4, 6), `invite top ${box.top.toFixed(1)} vs caret bottom+4 ${(c.bottom + 4).toFixed(1)}`).toBe(true);
    expect(near(box.left, Math.min(c.left, vp.width - 8 - box.width), 2), 'at the caret (or clamped)').toBe(true);
    expect(box.right).toBeLessThanOrEqual(vp.width);
    expect(overlap(box, bar)).toBe(false);
    const readable = await invite.evaluate((el) => ({ fs: parseFloat(getComputedStyle(el).fontSize), clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 }));
    expect(readable.fs, 'font size').toBeGreaterThanOrEqual(12);
    expect(readable.clipped, 'text not clipped').toBe(false);
    // follows the scroll
    const host = await mustRect(page, SCROLLER);
    await wheelScroll(page, { x: host.cx, y: host.cy }, 60, SCROLLER);
    const box2 = await mustRect(page, '.nabu-command-invite');
    c = await caretRect(page);
    expect(near(box2.top, c.bottom + 4, 6), `after scrolling, invite top ${box2.top.toFixed(1)} follows the caret (bottom ${c.bottom.toFixed(1)})`).toBe(true);
    await press(page, 'Escape');
    await expect(invite).toHaveCount(0);

    // chooser
    await page.locator('[data-block-type="paragraph"]').nth(10).click();
    await press(page, 'End');
    await press(page, `${MOD}+Alt+v`);
    const chooser = page.getByRole('listbox');
    await expect(chooser).toBeVisible();
    box = await mustRect(page, '.nabu-command-chooser');
    c = await caretRect(page);
    console.log(`chooser ${fmt(box)} caret ${fmt(c)}`);
    expect(near(box.top, c.bottom + 4, 6) || near(box.bottom, c.top - 4, 6), `chooser ${fmt(box)} anchored to caret ${fmt(c)}`).toBe(true);
    expect(box.left).toBeGreaterThanOrEqual(8 - 0.5);
    expect(box.right).toBeLessThanOrEqual(vp.width - 8 + 0.5);
    expect(overlap(box, bar)).toBe(false);
    const opts = await page.evaluate(() => [...document.querySelectorAll('.nabu-command-option')].map((o) => { const r = o.getBoundingClientRect(); const p = document.querySelector('.nabu-command-chooser')!.getBoundingClientRect(); return { text: o.textContent?.replace(/\s+/g, ' ').trim(), inside: r.top >= p.top - 1 && r.bottom <= p.bottom + 1 && r.height > 12 }; }));
    expect(opts.length).toBe(2);
    expect(opts.every((o) => o.inside), `every option fully visible: ${JSON.stringify(opts)}`).toBe(true);
    await expect(chooser.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await wheelScroll(page, { x: host.cx, y: host.cy }, 60, SCROLLER);
    const box3 = await mustRect(page, '.nabu-command-chooser');
    c = await caretRect(page);
    expect(near(box3.top, c.bottom + 4, 6) || near(box3.bottom, c.top - 4, 6), `after scrolling, chooser ${fmt(box3)} follows the caret ${fmt(c)}`).toBe(true);
    await press(page, 'Escape');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Theming
// ════════════════════════════════════════════════════════════════════════════

/** Opens every component in turn and measures text contrast against its real, composited background. */
async function measureAll(page: Page) {
  type Row = { name: string; min: number; c: Awaited<ReturnType<typeof contrast>> };
  const rows: Row[] = [];
  const m = async (name: string, selector: string, min = 4.5, opts: { nth?: number; pseudo?: string } = {}) => {
    await page.waitForTimeout(250); // let the 0.1s background transitions of the buttons finish
    rows.push({ name, min, c: await contrast(page, selector, opts) });
  };

  // placeholder (an empty block with the placeholder shown)
  await page.evaluate(async () => { const n = (window as any).nabu; n.insert('paragraph', {}, null, n.children.length); await n.commit(); });
  await flushRender(page);
  await m('placeholder', '.nabu-editor [data-placeholder]:not([data-placeholder=""])', 4.5, { pseudo: '::after' });

  // region seam label + the hold hint
  await m('region seam label', '.nabu-region-label');
  await focusAt(page, 'Opening of the first section.', 0);
  await m('region label in the rail colour (caret inside)', '[data-region-caret] > .nabu-region-seam .nabu-region-label'); // the rail takes the same colour
  await m('region end marker', '.nabu-region-end-text'); // the empty root paragraph added above follows the last region
  await page.keyboard.down('Backspace');
  await page.waitForSelector('[data-region-hint]', { timeout: 2000 });
  await m('region hold hint', '[data-region-hint]');
  await page.keyboard.up('Backspace');
  await expect(page.locator('[data-region-hint]')).toHaveCount(0);

  // floating toolbar (idle button + active button)
  const w = await pointOfText(page, 'Preamble, outside any region.', { word: 'Preamble' });
  await page.mouse.dblclick(w.x, w.y);
  await expect(page.locator(TOOLBAR)).toBeVisible();
  await m('toolbar button', `${TOOLBAR} .nabu-toolbar-btn`);
  await press(page, `${MOD}+b`);
  await expect(page.locator(`${TOOLBAR} .nabu-toolbar-btn.active`).first()).toBeVisible();
  await m('toolbar active button', `${TOOLBAR} .nabu-toolbar-btn.active`);
  await press(page, `${MOD}+b`);
  await press(page, 'ArrowRight');

  // slash menu
  await focusEmpty(page);
  await page.keyboard.type('/');
  await expect(page.locator('.nabu-slash')).toBeVisible();
  await m('slash item title (active)', '.nabu-slash-item.active .nabu-slash-title');
  await m('slash item title', '.nabu-slash-item:not(.active) .nabu-slash-title');
  await m('slash item icon', '.nabu-slash-icon');
  await press(page, 'Escape');
  await press(page, 'Backspace');

  // invite
  await focusAt(page, 'Preamble, outside any region.', 3);
  await press(page, `${MOD}+Alt+k`);
  await expect(page.locator('.nabu-command-invite')).toBeVisible();
  await m('command invite text', '.nabu-command-invite-text');
  await press(page, 'Escape');

  // chooser
  await press(page, `${MOD}+Alt+v`);
  await expect(page.getByRole('listbox')).toBeVisible();
  await m('chooser option (active)', '.nabu-command-option.active .nabu-command-option-label');
  await m('chooser option', '.nabu-command-option:not(.active) .nabu-command-option-label');
  await m('chooser option index', '.nabu-command-option-index');
  await m('chooser option shortcut', '.nabu-command-option-display');
  await press(page, 'Escape');

  // the `:::` chooser: group header, detail, footer
  await focusEmpty(page);
  await page.keyboard.type('::: ');
  await expect(page.locator('.nabu-command-group').first()).toBeVisible();
  await m('region chooser group header', '.nabu-command-group');
  await m('region chooser detail', '.nabu-command-option-detail');
  await m('region chooser footer', '.nabu-command-footer');
  await press(page, 'Escape');

  // drag handle glyph (non-text UI component: 3:1)
  const p = await pointOfText(page, 'Text of the bank.');
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await expect(page.locator(HANDLE)).toBeVisible();
  await m('drag handle glyph (non-text, 3:1)', HANDLE, 3);
  return rows;
}

const themes = [
  { name: 'light host', scheme: 'light' as const, theme: 'light' as const },
  { name: 'dark host, OS colour scheme only (prefers-color-scheme: dark)', scheme: 'dark' as const, theme: 'dark' as const },
  { name: 'dark host, explicit data-nabu-theme="dark"', scheme: 'light' as const, theme: 'dark-attr' as const },
];
for (const t of themes) {
  test.describe(`14 · contrast — ${t.name}`, () => {
    test.use({ colorScheme: t.scheme });
    test(`text of the UI components has >= 4.5:1 against its composited background (${t.name})`, async ({ page }) => {
      await gotoEditor(page, { seed: 'regions', commands: 'demo', theme: t.theme, options: { placeholders: { show: 'empty' } } });
      const rows = await measureAll(page);
      const table = rows.map((r) => `${r.name.padEnd(36)} ${String(r.c.ratio).padStart(6)}:1 (need ${r.min})  fg ${r.c.fg} on bg ${r.c.bg}  ${r.c.size}`);
      console.log(`CONTRAST [${t.name}]\n  ` + table.join('\n  '));
      const bad = rows.filter((r) => r.c.ratio < r.min).map((r) => `${r.name}: ${r.c.ratio}:1 < ${r.min} (fg ${r.c.fg} on ${r.c.bg}, ${r.c.size})`);
      expect(bad, 'insufficient contrast (BROKEN)').toEqual([]);
    });
  });
}

test('15 · the documented --nb-* custom properties set on the host really restyle the components', async ({ page }) => {
  const vars = {
    '--nb-bg-surface': 'rgb(10, 20, 30)', '--nb-text-primary': 'rgb(200, 10, 10)', '--nb-text-secondary': 'rgb(10, 200, 10)',
    '--nb-text-muted': 'rgb(10, 10, 200)', '--nb-border': 'rgb(1, 2, 3)', '--nb-bg-surface-active': 'rgb(40, 50, 60)',
    '--nb-bg-surface-hover': 'rgb(70, 80, 90)', '--nb-accent': 'rgb(255, 0, 255)', '--nb-text-placeholder': 'rgb(255, 128, 0)',
    '--nb-command-bg': 'rgb(5, 6, 7)', '--nb-command-text': 'rgb(250, 250, 0)', '--nb-command-active': 'rgb(90, 91, 92)',
    '--nb-command-radius': '13px', '--nb-region-color': 'rgb(0, 128, 128)', '--nb-region-rule-color': 'rgb(128, 0, 128)', '--nb-region-label-size': '21px',
    '--nb-region-title-color': 'rgb(200, 100, 0)', '--nb-region-gap': '17px', '--nb-region-margin': '33px 0 5px',
  };
  await gotoEditor(page, { seed: 'regions', commands: 'demo', options: { placeholders: { show: 'empty' } }, vars: Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') });
  const css = (sel: string, prop: string, value: string, opts: { pseudo?: string } = {}) =>
    expect.configure({ soft: true }).poll(() => page.evaluate(([s, p, ps]) => { const el = document.querySelector(s as string); return el ? getComputedStyle(el, (ps as string) || null).getPropertyValue(p as string).trim() : '<missing>'; }, [sel, prop, opts.pseudo ?? ''] as [string, string, string]),
      { message: `${sel} ${opts.pseudo ?? ''} ${prop}` }).toBe(value);

  // region seam = the header of the region container: label prefix, editable title, hairline (+ placeholder on an empty block)
  await css('.nabu-region-seam', 'color', 'rgb(0, 128, 128)');
  await css('.nabu-region-seam', 'font-size', '21px');
  await css('.nabu-region-seam', 'column-gap', '17px');
  await css('.nabu-region-seam', 'margin-top', '33px');
  await css('.nabu-region-seam', 'margin-bottom', '5px');
  await css('.nabu-region-label', 'color', 'rgb(0, 128, 128)'); // the prefix inherits the seam colour
  await css('.nabu-region-title', 'color', 'rgb(200, 100, 0)');
  await css('.nabu-region-rule', 'border-top-color', 'rgb(128, 0, 128)');
  await page.evaluate(async () => { const n = (window as any).nabu; n.insert('paragraph', {}, null, n.children.length); await n.commit(); });
  await flushRender(page);
  await css('.nabu-editor [data-placeholder]:not([data-placeholder=""])', 'color', 'rgb(255, 128, 0)', { pseudo: '::after' });

  // toolbar
  const w = await pointOfText(page, 'Preamble, outside any region.', { word: 'Preamble' });
  await page.mouse.dblclick(w.x, w.y);
  await expect(page.locator(TOOLBAR)).toBeVisible();
  await css(TOOLBAR, 'background-color', 'rgb(10, 20, 30)');
  await css(TOOLBAR, 'border-top-color', 'rgb(1, 2, 3)');
  await css(`${TOOLBAR} .nabu-toolbar-btn`, 'color', 'rgb(200, 10, 10)');
  await press(page, `${MOD}+b`);
  await css(`${TOOLBAR} .nabu-toolbar-btn.active`, 'background-color', 'rgb(40, 50, 60)');
  await press(page, `${MOD}+b`);
  await page.locator(`${TOOLBAR} .nabu-toolbar-btn`, { hasText: /^U$/ }).hover();
  await css(`${TOOLBAR} .nabu-toolbar-btn:hover`, 'background-color', 'rgb(70, 80, 90)');
  await press(page, 'ArrowRight');

  // slash menu
  await focusEmpty(page);
  await page.keyboard.type('/');
  await expect(page.locator('.nabu-slash')).toBeVisible();
  await css('.nabu-slash', 'background-color', 'rgb(10, 20, 30)');
  await css('.nabu-slash', 'border-top-color', 'rgb(1, 2, 3)');
  await css('.nabu-slash-item.active', 'background-color', 'rgb(40, 50, 60)');
  await css('.nabu-slash-item', 'color', 'rgb(200, 10, 10)');
  await css('.nabu-slash-icon', 'color', 'rgb(10, 200, 10)');
  await press(page, 'Escape');
  await press(page, 'Backspace');

  // invite + chooser (--nb-command-* win over --nb-bg-surface / --nb-text-primary)
  await focusAt(page, 'Preamble, outside any region.', 3);
  await press(page, `${MOD}+Alt+k`);
  await expect(page.locator('.nabu-command-invite')).toBeVisible();
  await css('.nabu-command-invite', 'background-color', 'rgb(5, 6, 7)');
  await css('.nabu-command-invite', 'color', 'rgb(250, 250, 0)');
  await css('.nabu-command-invite', 'border-top-left-radius', '13px');
  await press(page, 'Escape');
  await press(page, `${MOD}+Alt+v`);
  await expect(page.getByRole('listbox')).toBeVisible();
  await css('.nabu-command-chooser', 'background-color', 'rgb(5, 6, 7)');
  await css('.nabu-command-option.active', 'background-color', 'rgb(90, 91, 92)');
  await css('.nabu-command-chooser', 'color', 'rgb(250, 250, 0)');
  await press(page, 'Escape');

  // drag handle + drop indicator
  const a = await blockBox(page, 'paragraph', 'Text of the bank.');
  const b = await blockBox(page, 'paragraph', 'Text of the water.');
  await page.mouse.move(hoverPoint(a).x, hoverPoint(a).y, { steps: 2 });
  await expect(page.locator(HANDLE)).toBeVisible();
  await css(HANDLE, 'color', 'rgb(10, 10, 200)');
  await dragWithHandle(page, hoverPoint(a), dropPoint(b, 'after'), {
    release: false,
    during: async () => { await css('.nabu-drop-indicator', 'background-color', 'rgb(255, 0, 255)'); },
  });
  await page.mouse.up();
});

// ════════════════════════════════════════════════════════════════════════════
// Region seam
// ════════════════════════════════════════════════════════════════════════════

const LONG_WORDS = 'Chapter ' + 'extraordinarily '.repeat(14) + 'long title';
const LONG_TOKEN = 'X'.repeat(160);

async function buildSeams(page: Page) {
  await buildTree(page, [
    Pp('Alpha beta gamma delta epsilon'),
    { type: 'region', props: { regionType: 'section-1', title: LONG_WORDS }, children: [
      Pp('Between the seams'),
      { type: 'region', props: { regionType: 'section-2', title: LONG_TOKEN }, children: [Pp('After the seams')] },
    ] },
  ] as TreeSpec[]);
}

/**
 * Layout invariants of every seam (ADR 018 §3.6): the title is EDITABLE, so it WRAPS (never truncated with an ellipsis); the label
 * prefix stays on one line; the hairline keeps a minimal width (2em); nothing overflows the editor horizontally or overlaps a block.
 * Returns the violations.
 */
async function seamProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw) out.push(`page scrolls horizontally: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    const editor = document.querySelector('.nabu-editor')!.getBoundingClientRect();
    const blocks = [...document.querySelectorAll('.nabu-editor [data-block-id]')];
    document.querySelectorAll('.nabu-region-seam').forEach((seam, i) => {
      const s = seam.getBoundingClientRect();
      const label = seam.querySelector('.nabu-region-label') as HTMLElement;
      const title = seam.querySelector('.nabu-region-title') as HTMLElement;
      const rule = seam.querySelector('.nabu-region-rule') as HTMLElement;
      const l = label.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      const r = rule.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(seam).fontSize);
      const tag = `seam#${i} (${label.textContent!.trim()} ${title.textContent!.trim().slice(0, 12)}…)`;
      // nothing overflows the editor (or the seam) horizontally
      if (s.right > editor.right + 0.5 || s.left < editor.left - 0.5) out.push(`${tag}: overflows the editor horizontally [${s.left.toFixed(0)}..${s.right.toFixed(0)}] vs [${editor.left.toFixed(0)}..${editor.right.toFixed(0)}]`);
      if (t.right > s.right + 0.5 || l.right > s.right + 0.5 || r.right > s.right + 0.5) out.push(`${tag}: label / title / hairline stick out of the seam (right edges ${l.right.toFixed(1)} / ${t.right.toFixed(1)} / ${r.right.toFixed(1)} > ${s.right.toFixed(1)})`);
      if (title.scrollWidth > title.clientWidth + 1) out.push(`${tag}: the title overflows its own box (scrollWidth ${title.scrollWidth} > ${title.clientWidth})`);
      // the label prefix stays on ONE line, whole
      if (l.height > fs * 1.6) out.push(`${tag}: the label prefix wraps (h=${l.height.toFixed(1)}, font ${fs}px)`);
      if (getComputedStyle(label).whiteSpace !== 'nowrap') out.push(`${tag}: label is not white-space: nowrap`);
      if (label.scrollWidth > label.clientWidth + 1) out.push(`${tag}: the label prefix is clipped`);
      // the title WRAPS: several lines, no ellipsis
      if (t.height < fs * 1.6 * 1.5) out.push(`${tag}: the very long title did not wrap (h=${t.height.toFixed(1)}, font ${fs}px)`);
      if (getComputedStyle(title).textOverflow === 'ellipsis') out.push(`${tag}: the title is truncated with an ellipsis`);
      // the hairline stays visible with a minimal width (2em)
      if (r.width < 2 * fs - 0.5) out.push(`${tag}: the hairline collapsed to ${r.width.toFixed(1)}px (< 2em = ${2 * fs}px)`);
      if (getComputedStyle(rule).borderTopWidth !== '1px' || getComputedStyle(rule).display === 'none') out.push(`${tag}: the hairline is not drawn`);
      for (const b of blocks) {
        if (seam.contains(b) || b.contains(seam)) continue;
        const o = b.getBoundingClientRect();
        if (Math.min(s.right, o.right) - Math.max(s.left, o.left) > 0.5 && Math.min(s.bottom, o.bottom) - Math.max(s.top, o.top) > 0.5) out.push(`${tag}: overlaps block "${(b.textContent ?? '').slice(0, 20)}"`);
      }
    });
    return out;
  });
}

test.describe('Region seam', () => {
  test('16a · very long region titles WRAP (an editable title is not truncated): no overflow, no overlap, label on one line, hairline kept', async ({ page }) => {
    await gotoEditor(page);
    await buildSeams(page);
    expect(await seamProblems(page)).toEqual([]);
    // the whole title is the text of the heading (nothing is cut), and it stays editable
    const info = await page.locator('.nabu-region-title').evaluateAll((els) => els.map((el) => [el.textContent, (el as HTMLElement).isContentEditable]));
    expect(info).toEqual([[LONG_WORDS, true], [LONG_TOKEN, true]]);
    note('CURRENT', 'a long title wraps over several lines in the seam (flex row: label | title | hairline of at least 2em); nothing is clipped, so no tooltip is needed');
    expect(await violations(page)).toEqual([]);
  });

  test('16a2 · a long title stays editable where it wraps: typing at its end extends it, the layout invariants hold', async ({ page }) => {
    await gotoEditor(page);
    await buildSeams(page);
    await focusEnd(page, LONG_WORDS);
    await page.keyboard.type(' and more');
    await expect(page.locator('.nabu-region-title').first()).toHaveText(LONG_WORDS + ' and more');
    expect(await seamProblems(page)).toEqual([]);
  });

  test('16e · the end marker and the margin rail shift nothing: every box of the document is the same with and without them', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('Preamble'), region('section-1')('One', Pp('a'), region('section-2')('Sub', Pp('s')), Pp('b')), Pp('outside'), region('section-1')('Two', Pp('t'))]);
    const boxes = () => page.evaluate(() => [...document.querySelectorAll('.nabu-editor [data-block-id], .nabu-region, .nabu-region-seam, .nabu-region-body, [data-region-end]')].map((e) => {
      const r = e.getBoundingClientRect();
      return [e.getAttribute('data-block-id') ?? String(e.className).split(' ')[0], +r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
    }));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator('[data-region-caret]')).toHaveCount(0);
    const without = await boxes();
    expect(without.filter((b) => String(b[0]).includes('nabu-region-end')).length).toBe(2);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    for (const [text, at] of [['a', 1], ['s', 0], ['t', 0], ['Two', 2]] as Array<[string, number]>) {
      await focusAt(page, text, at);
      await expect(page.locator('[data-region-caret]')).toHaveCount(1);
      expect(await boxes(), `rail on the region of "${text}"`).toEqual(without);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no horizontal scroll appears').toBe(scrollW);
    }
  });

  test('16f · the rail clears the drag handle (it sits just left of the 24px handle strip) and stays inside the page', async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [region('section-1')('One', Pp('a'), Pp('b'))]);
    await focusAt(page, 'a', 0);
    const rail = await page.locator('.nabu-region').first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const left = parseFloat(getComputedStyle(el, '::before').left);
      return { left: r.left + left, right: r.left + left + 2 };
    });
    const b = await blockBox(page, 'paragraph', 'b');
    const p = hoverPoint(b);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await expect(page.locator(HANDLE)).toBeVisible();
    const h = await mustRect(page, HANDLE);
    console.log(`rail x=[${rail.left.toFixed(1)}..${rail.right.toFixed(1)}] handle ${fmt(h)}`);
    expect(rail.right, 'the rail does not run under the handle').toBeLessThanOrEqual(h.left);
    expect(rail.left, 'the rail is on screen').toBeGreaterThanOrEqual(0);
  });

  test.describe('narrow viewport (375px)', () => {
    test.use({ viewport: { width: 375, height: 700 } });

    test('16b2 · the end marker never overflows (long names are cut with an ellipsis); the rail and the chooser stay inside the page', async ({ page }) => {
      await gotoEditor(page);
      const long = 'A very long section title that keeps going well past the width of a phone screen';
      await buildTree(page, [region('section-1')(long, region('section-2')(long, Pp('s')), Pp('b')), Pp('outside')]);
      await focusAt(page, 's', 0);
      const info = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const ends = [...document.querySelectorAll('[data-region-end]')].map((e) => {
          const r = e.getBoundingClientRect();
          const t = e.querySelector('.nabu-region-end-text') as HTMLElement;
          return { left: r.left, right: r.right, height: r.height, ellipsis: getComputedStyle(t).textOverflow === 'ellipsis', clipped: t.scrollWidth > t.clientWidth };
        });
        return { vw, ends, scroll: document.documentElement.scrollWidth };
      });
      expect(info.ends).toHaveLength(2);
      for (const e of info.ends) {
        expect(e.right).toBeLessThanOrEqual(info.vw);
        expect(e.ellipsis).toBe(true);
        expect(e.height).toBeCloseTo(11.5 * 2.6, 0); // one line, whatever the text
      }
      expect(info.scroll).toBeLessThanOrEqual(info.vw);
      // the rail (touch-style offset is not used here: a hover device) stays inside the layout viewport or is merely clipped, never a scrollbar
      const rail = await page.locator('.nabu-region[data-region-caret]').evaluate((el) => { const r = el.getBoundingClientRect(); return r.left + parseFloat(getComputedStyle(el, '::before').left); });
      expect(rail).toBeGreaterThanOrEqual(0);
      // the `:::` chooser with its groups and footer fits the width
      await buildTree(page, [region('section-1')('One', Pp(''))]);
      await focusEmpty(page);
      await page.keyboard.type('::: ');
      await expect(page.getByRole('listbox')).toBeVisible();
      const box = await mustRect(page, '.nabu-command-chooser');
      expect(box.left).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.right).toBeLessThanOrEqual(375 - 8 + 0.5);
      const foot = await mustRect(page, '.nabu-command-footer');
      expect(foot.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
      expect(foot.right).toBeLessThanOrEqual(box.right + 0.5);
      expect(await page.evaluate(() => { const c = document.querySelector('.nabu-command-chooser')!; return c.scrollWidth <= c.clientWidth; })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    });

    test('16b · seams lay out inside a 375px viewport', async ({ page }) => {
      await gotoEditor(page);
      await buildSeams(page);
      expect(await seamProblems(page)).toEqual([]);
    });

    test('16c · the toolbar stays fully inside a 375px viewport, even for a word at the very start of a line', async ({ page }) => {
      await gotoEditor(page);
      await buildTree(page, [Pp('Alpha beta gamma delta epsilon zeta eta theta iota kappa')]);
      await dblclickWord(page, 'Alpha beta gamma', 'Alpha');
      const tb = await mustRect(page, TOOLBAR);
      const sel = await selectionRect(page);
      console.log(`375px: toolbar ${fmt(tb)} selection ${fmt(sel)}`);
      expect(tb.left, `toolbar ${fmt(tb)} is cut off at the left edge of the viewport (centred on a selection at x=${sel.cx.toFixed(0)}, no horizontal clamp)`).toBeGreaterThanOrEqual(0);
      expect(tb.right).toBeLessThanOrEqual(375);
      // the same on the right edge
      await dblclickWord(page, 'iota kappa', 'kappa');
      const tb2 = await mustRect(page, TOOLBAR);
      expect(tb2.right, `toolbar ${fmt(tb2)} right edge`).toBeLessThanOrEqual(375);
      expect(tb2.left).toBeGreaterThanOrEqual(0);
    });

    test('16d · the slash menu and the drag handle stay inside a 375px viewport', async ({ page }) => {
      await gotoEditor(page);
      await buildTree(page, [Pp('Alpha'), Pp('')]);
      await focusEmpty(page);
      await page.keyboard.type('/');
      await expect(page.locator('.nabu-slash')).toBeVisible();
      const m = await mustRect(page, '.nabu-slash');
      expect(m.left).toBeGreaterThanOrEqual(8 - 0.5);
      expect(m.right).toBeLessThanOrEqual(375 - 8 + 0.5);
      expect(m.bottom).toBeLessThanOrEqual(700);
      await press(page, 'Escape');
      await press(page, 'Backspace');
      const b = await blockBox(page, 'paragraph', 'Alpha');
      const p = hoverPoint(b);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await expect(page.locator(HANDLE)).toBeVisible();
      const h = await mustRect(page, HANDLE);
      expect(h.left, `handle ${fmt(h)} on a phone-width page`).toBeGreaterThanOrEqual(0);
    });
  });
});
