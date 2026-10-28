import { mkdirSync } from 'node:fs';
import { test, expect, type Page, type Browser } from './helpers/test.js';
import { domInvariantReport } from './helpers/dom-invariant.js';
import { CARDS, TYPING, PASTE } from '../../src/site/tour/tour-content.js';

// The Tour of the blocks (src/routes/(site)/docs/getting-started/tour-of-the-blocks, src/site/tour): a Svelte page of the docs, wide, whose story, cards and
// "after" are all real Nabu documents (read-only), built at build time, server-rendered and hydrated like the docs pages. See site-docs.spec.ts for the
// same checks on a markdown page.
//
// The editor DOM invariant fixture is off for the file: twenty read-only editors with a video, a PDF chip and code that scrolls sideways are not what it guards.
// What matters on a read-only page (no whitespace between tags) is checked explicitly.
test.use({ domInvariant: false });

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';
const PATH = '/docs/getting-started/tour-of-the-blocks';
const REFERENCE = '/docs/guides/blocks-reference';
const PAGE = '[data-testid="tour-page"]';
const ROOT = '[data-nabu-root]';
const STORY = '[data-testid="tour-story"]';
const GRID = '[data-testid="tour-grid"]';
const OPEN = '[data-testid="card-open"]';
const FILTERS = ['All', 'Text', 'Containers', 'Structure', 'Media'];

/** Every example has been hydrated: the page is interactive (TourDoc / the page set the attribute once the server markup was adopted). */
const hydrated = (page: Page) => page.locator(`${PAGE}[data-hydrated]`).waitFor();

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: net::ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const card = (page: Page, id: string) => page.locator(`${GRID} article[data-card="${id}"]`);
const visibleCards = (page: Page) => page.locator(`${GRID} article.card:not([hidden])`);
const label = (page: Page) => page.getByTestId('xray-label');
const panel = (page: Page) => page.getByTestId('xray-panel');
const stateText = (page: Page) => page.getByTestId('state-text');

async function openCard(page: Page, id: string) {
  await card(page, id).locator('button.open').click();
  await expect(page.locator(OPEN)).toHaveAttribute('data-card-open', id);
}

test.describe('the page', () => {
  test.use({ colorScheme: 'dark' });

  test('renders: title, description, one h1, the legend, a story, twelve cards, the cases', async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto(PATH);
    expect(res?.status()).toBe(200);
    await hydrated(page);
    await expect(page).toHaveTitle('Tour of the blocks — Docs — Nabu');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /every block Nabu ships/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Tour of the blocks');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Docs / Getting started');
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')).toHaveText('Docs');

    // the legend counts what the code says
    const legend = page.getByTestId('tour-legend');
    await expect(legend.locator('li')).toHaveText(['14 blocks', '3 text behaviours', '4 paste handlers', '1 transform']);

    // the story: ONE Nabu document, read-only
    const story = page.locator(`${STORY} ${ROOT}`);
    await expect(story).toHaveCount(1);
    await expect(story).toHaveAttribute('contenteditable', 'false');
    await expect(story).toHaveAttribute('role', 'document');
    await expect(story).toContainText('Nobody had crossed since noon.');
    // ...holding every block that can be drawn read-only
    for (const type of ['region', 'heading', 'paragraph', 'blockquote', 'dialogue', 'list', 'list-item', 'callout', 'toggle', 'divider', 'code', 'image', 'video', 'file']) {
      expect(await story.locator(`[data-block-type="${type}"]`).count(), `the story has a ${type}`).toBeGreaterThan(0);
    }
    // 1 story + 12 cards + 3 + 4 "after": every example is a read-only Nabu editor
    await expect(page.locator(ROOT)).toHaveCount(1 + CARDS.length + TYPING.length + PASTE.length);
    for (const root of await page.locator(ROOT).all()) await expect(root).toHaveAttribute('data-nabu-readonly', '');
    expect(errors).toEqual([]);
  });

  test('every card is there: its example, its name, its registered type, its sentence, its chips', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await expect(page.locator(`${GRID} article.card`)).toHaveCount(CARDS.length);
    for (const c of CARDS) {
      const el = card(page, c.id);
      await expect(el, c.id).toBeVisible();
      await expect(el.getByRole('heading', { level: 3 })).toHaveText(c.title);
      await expect(el.locator('.type')).toHaveText(c.names.join(' · '));
      await expect(el.locator('.sentence')).toHaveText(c.sentence);
      await expect(el.locator(ROOT), `${c.id} has a live example`).toHaveCount(1);
      expect(await el.locator('.chips li').count(), `${c.id} has chips`).toBeGreaterThan(0);
    }
    // the chips are the real slash entries and shortcuts (the unit test holds them to the editor)
    await expect(card(page, 'heading').locator('.chips li')).toHaveText(['# … ######', '/h1', '/h2', '/h3']);
    await expect(card(page, 'blockquote').locator('.chips li')).toHaveText(['> ␣', '/quote']);
    await expect(card(page, 'paragraph').locator('.chips li')).toHaveText(['/text']);
    await expect(card(page, 'list').locator('.chips li')).toHaveText(['- ␣', '1. ␣', '[ ] ␣', '/bullet', '/numbered', '/todo']);
    await expect(card(page, 'dialogue').locator('.chips li')).toHaveText(['-- ␣ at line start']);
    await expect(card(page, 'region').locator('.chips li')).toHaveText(['::: ␣', '/section-1', '/section-2', '/section-3', 'Mod-Enter']);
    // the examples are the blocks of the cards
    await expect(card(page, 'toggle').locator('[data-block-type="toggle"]')).toHaveCount(1);
    await expect(card(page, 'region').locator('.nabu-region-seam')).toHaveCount(1);
    await expect(card(page, 'video-file').locator('video')).toHaveAttribute('src', '/tour/river-at-dusk.mp4');
    await expect(card(page, 'video-file').locator('a[download]')).toHaveAttribute('href', '/tour/crossing-ledger.pdf');
    await expect(card(page, 'image').locator('img')).toHaveAttribute('src', '/tour/quay-at-dusk.svg');
    await expect(card(page, 'code').locator('pre.nabu-code span[style*="--shiki"]').first()).toBeVisible(); // highlighted at build time
  });

  test('what happens as you type and when you paste: before, a real Nabu "after", and the last two cards', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 2, name: 'What happens as you type' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'What happens when you paste' })).toBeVisible();
    for (const m of [...TYPING, ...PASTE]) {
      const el = page.locator(`article[data-case="${m.name}"]`);
      await expect(el.getByRole('heading', { level: 3 })).toHaveText(m.title);
      await expect(el.locator(ROOT)).toHaveCount(1);
      await expect(el.locator('.before')).toContainText(m.before.split('\n')[0]);
      await expect(el.getByRole('link', { name: m.name, exact: true })).toHaveAttribute('href', /^\/docs\/guides\/blocks-reference#/);
    }
    await expect(page.locator('[data-case="rich-text"] .after .nabu-bold')).toHaveText('ferryman');
    await expect(page.locator('[data-case="typography"] .after')).toContainText('noon — dusk');
    await expect(page.locator('[data-case="html-paste"] .after [data-block-type="heading"]')).toHaveText('Dusk');
    await expect(page.locator('[data-case="html-paste"] .after li')).toHaveText(['the rope', 'the oar']);
    await expect(page.locator('[data-case="markdown-paste"] .after [data-block-type="callout"]')).toContainText('It rises.');
    await expect(page.locator('[data-case="plain-text-paste"] .after [data-block-type="paragraph"]')).toHaveText(['line one', 'line two']);
    await expect(page.locator('[data-case="nabu-paste"] .after [data-block-type="callout"]')).toContainText('The river rises at night.');
    await expect(page.locator('[data-case="block"]')).toContainText("nabu.exec('block:transform', { type, props })");
    await expect(page.getByRole('link', { name: /Make your own block/ })).toHaveAttribute('href', '/docs/guides/extensions');
  });
});

test.describe('twenty editors on one page', () => {
  test.use({ colorScheme: 'dark' });

  // Every Nabu engine watches the document's selection and moves a caret it finds "dead" into its own text: on a page with several editors they would fight over it
  // (the engine acts on the selection of its own root only: NabuSelection.scope). Without that, none of this holds.
  test('text selected in a read-only example stays selected there: the story, a case, a card of the wall', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const selected = () => page.evaluate(() => {
      const s = getSelection()!;
      const el = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
      return { text: s.toString(), label: el?.closest('.nabu-editor')?.getAttribute('aria-label') ?? null };
    });
    await page.locator(`${STORY} [data-block-type="paragraph"]`).first().click({ clickCount: 3 });
    expect(await selected()).toMatchObject({ label: 'A short story, written with every block' });
    expect((await selected()).text).toContain('The ferryman waited under the eaves');

    await page.locator('[data-case="html-paste"] .after [data-block-type="heading"]').dblclick({ position: { x: 10, y: 8 } });
    await page.waitForTimeout(200);
    expect(await selected()).toEqual({ text: 'Dusk', label: 'HTML paste: the result' });
    await page.locator('[data-case="plain-text-paste"] .after [data-block-type="paragraph"]').first().click({ clickCount: 3, position: { x: 10, y: 8 } });
    await page.waitForTimeout(200);
    expect(await selected()).toMatchObject({ label: 'Plain text paste: the result' });
    expect((await selected()).text).toContain('line one');

    // and back in the story, a stretch across blocks can be copied as Markdown
    await page.locator(`${STORY} [data-block-type="heading"]`).dblclick({ position: { x: 10, y: 8 } });
    await page.waitForTimeout(200);
    expect(await selected()).toMatchObject({ label: 'A short story, written with every block' });
  });
});

test.describe('the X-ray: the story, block by block', () => {
  test.use({ colorScheme: 'dark' });

  test('hovering a block outlines it, labels it, and shows its card in the panel', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await expect(label(page)).toHaveCount(0); // nothing under the pointer: an empty panel
    await expect(panel(page)).toContainText('Nothing yet');

    const story = page.locator(`${STORY} ${ROOT}`);
    const cases: Array<[string, string, string]> = [
      // selector, label, name in the panel
      ['[data-block-type="blockquote"]', 'blockquote · type > then Space · /quote', 'Blockquote'],
      ['[data-block-type="callout"]', 'callout · type ! then Space · /callout', 'Callout'],
      ['[data-block-type="divider"]', 'divider · type --- then Space · /divider', 'Divider'],
      ['[data-block-type="code"]', 'code · type ``` then Enter · /code', 'Code'],
      ['.nabu-toggle', 'toggle · /toggle', 'Toggle'],
      ['.nabu-toggle-arrow', 'toggle · /toggle', 'Toggle'],
      ['.nabu-callout-icon', 'callout · type ! then Space · /callout', 'Callout'],
      ['[data-block-type="image"]', 'image · /image', 'Image'],
      ['figure.nabu-video', 'video · /video', 'Video · File'],
      ['.nabu-file', 'file · /file', 'Video · File'],
      ['[data-block-type="dialogue"]', 'dialogue · type -- then Space', 'Dialogue'],
      ['[data-block-type="heading"]', 'heading · type # then Space · /h1', 'Heading'],
      ['[data-block-type="paragraph"]', 'paragraph · /text', 'Paragraph'],
    ];
    for (const [selector, text, name] of cases) {
      await story.locator(selector).first().hover();
      await expect(label(page), selector).toHaveText(text);
      await expect(panel(page).locator('.name')).toHaveText(name);
      await expect(page.getByTestId('xray-box')).toBeVisible();
    }

    // a list item stands for its list; the seam of a region for the region (its number, its title and its rule alike)
    await story.locator('[data-block-type="list-item"]').first().hover();
    await expect(label(page)).toHaveText('list · type - then Space · /bullet');
    await expect(panel(page).locator('.name')).toHaveText('List');
    await story.locator('.nabu-region-label').hover();
    await expect(label(page)).toHaveText('region · type ::: then Space · /section-1');
    await expect(panel(page).locator('.name')).toHaveText('Region');
  });

  test('the panel says how to make the block: Type, Slash, Markdown, HTML, and where its card is', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await page.locator(`${STORY} [data-block-type="blockquote"]`).hover();
    const facts = panel(page).locator('.facts');
    await expect(facts.locator('dt')).toHaveText(['Type', 'Slash', 'Markdown', 'HTML']);
    await expect(facts.locator('dd').nth(0)).toHaveText('> ␣');
    await expect(facts.locator('dd').nth(1)).toHaveText('/quote');
    await expect(facts.locator('dd').nth(2)).toHaveText('> text');
    await expect(facts.locator('dd').nth(3)).toHaveText('<blockquote>');
    // a block with no typed shortcut says so
    await page.locator(`${STORY} .nabu-toggle`).hover();
    await expect(panel(page).locator('.facts dd').nth(0)).toContainText('nothing');
    // "Open its card" opens the card of that block, in the wall
    await page.getByRole('button', { name: /Open its card/ }).click();
    await expect(page.locator(OPEN)).toHaveAttribute('data-card-open', 'toggle');
    await expect(card(page, 'toggle').locator('button.open')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(OPEN)).toBeInViewport();
  });

  test('keyboard: the blocks of the story take focus (one tab stop, then the arrows), and the focused block is the one under X-ray', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const story = page.locator(`${STORY} ${ROOT}`);
    const seam = story.locator('.nabu-region-seam');
    // one tab stop in the story: the first block; the others are reachable with the arrows
    expect(await page.locator(`${STORY} [tabindex="0"]`).count()).toBe(1);
    await expect(seam).toHaveAttribute('tabindex', '0');
    await seam.focus();
    await expect(label(page)).toHaveText('region · type ::: then Space · /section-1');
    await expect(panel(page)).toHaveAttribute('aria-live', 'polite'); // a keyboard reader hears the card

    await page.keyboard.press('ArrowDown');
    await expect(label(page)).toHaveText('heading · type # then Space · /h1');
    await expect(story.locator('[data-block-type="heading"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(label(page)).toHaveText('paragraph · /text');
    await page.keyboard.press('ArrowDown');
    await expect(label(page)).toHaveText('blockquote · type > then Space · /quote');
    await page.keyboard.press('ArrowUp');
    await expect(label(page)).toHaveText('paragraph · /text');
    await page.keyboard.press('End');
    await expect(label(page)).toHaveText('paragraph · /text');
    await expect(story.locator('[data-block-type="paragraph"]').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(label(page)).toHaveText('region · type ::: then Space · /section-1');
    // walking down goes through every block of the story, in order
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('ArrowDown');
      const text = (await label(page).innerText()).split(' · ')[0];
      if (seen.at(-1) === text && i > 20) break;
      seen.push(text);
    }
    for (const type of ['heading', 'blockquote', 'dialogue', 'list', 'callout', 'toggle', 'divider', 'code', 'image', 'video', 'file', 'paragraph']) expect(seen, type).toContain(type);
    // leaving the story clears the X-ray
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Tab');
    await expect(label(page)).toHaveCount(0);
  });

  test('a toggle of the story opens (a view), and the X-ray box follows the layout', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const story = page.locator(`${STORY} ${ROOT}`);
    const toggle = story.locator('.nabu-toggle');
    await toggle.hover();
    const before = await page.getByTestId('xray-box').boundingBox();
    const paragraphs = await story.locator('[data-block-type="paragraph"]').count();
    await toggle.locator('.nabu-toggle-arrow').click();
    await expect.poll(async () => story.locator('[data-block-type="paragraph"]').count()).toBeGreaterThan(paragraphs); // "The ford is upstream."
    await expect(story).toContainText('The ford is upstream.');
    await expect.poll(async () => (await page.getByTestId('xray-box').boundingBox())!.height).toBeGreaterThan(before!.height);
    await expect(story).toHaveAttribute('contenteditable', 'false');
  });
});

test.describe('the wall: filters and open cards', () => {
  test.use({ colorScheme: 'dark' });

  test('the filters keep the cards of a group, with their counts', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const pills = page.getByRole('group', { name: 'Filter the blocks' }).getByRole('button');
    await expect(pills).toHaveText(['All 12', 'Text 6', 'Containers 3', 'Structure 2', 'Media 2']);
    await expect(pills.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(visibleCards(page)).toHaveCount(12);

    const expected: Record<string, string[]> = {
      Text: ['paragraph', 'heading', 'blockquote', 'code', 'callout', 'dialogue'],
      Containers: ['toggle', 'list', 'region'],
      Structure: ['region', 'divider'],
      Media: ['image', 'video-file'],
    };
    for (const name of FILTERS.slice(1)) {
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-pressed', 'true');
      await expect(pills.first()).toHaveAttribute('aria-pressed', 'false');
      const ids = await visibleCards(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));
      expect(ids.slice().sort(), name).toEqual(expected[name].slice().sort());
    }
    await pills.first().click();
    await expect(visibleCards(page)).toHaveCount(12);
    // the hidden cards stay in the page (their editors are not rebuilt), they are only not drawn
    await page.getByRole('button', { name: /^Media/ }).click();
    await expect(card(page, 'paragraph')).toBeHidden();
    await expect(page.locator(`${GRID} article.card`)).toHaveCount(12);
  });

  test('opening a card: a disclosure that spans the grid, under its row, with the state of its example', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(PATH);
    await hydrated(page);
    const button = card(page, 'toggle').locator('button.open');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).toHaveAttribute('aria-controls', 'card-open');
    const open = page.locator(OPEN);
    await expect(open).toBeVisible();
    // it follows the row of the toggle (code, callout, toggle) and spans the three columns
    const [row, panelBox, grid, next] = await Promise.all([
      card(page, 'toggle').boundingBox(), open.boundingBox(), page.locator(GRID).boundingBox(), card(page, 'list').boundingBox(),
    ]);
    expect(panelBox!.y).toBeGreaterThanOrEqual(row!.y + row!.height);
    expect(next!.y).toBeGreaterThanOrEqual(panelBox!.y + panelBox!.height - 1);
    expect(Math.abs(panelBox!.width - grid!.width)).toBeLessThan(2);
    await expect(card(page, 'toggle')).toHaveClass(/active/);
    await expect(open).toBeInViewport();
    await expect(open.getByRole('heading', { level: 3, name: 'Toggle' })).toBeFocused();

    // what the card says: the example, how to make one, what it contains, the keys, the presets, where to read more
    await expect(open.locator(ROOT)).toHaveAttribute('contenteditable', 'false');
    await expect(open.locator('[data-block-type="toggle"]')).toContainText('What the ferryman knew');
    const facts = open.locator('.facts');
    await expect(facts.locator('dt')).toHaveText(['Make one', 'Contains', 'Keys', 'Presets']);
    await expect(facts.locator('dd').nth(0)).toContainText('/toggle');
    await expect(facts.locator('dd').nth(1)).toContainText('collapsed');
    await expect(facts.locator('dd').nth(2)).toContainText('Enter');
    await expect(facts.locator('dd').nth(3)).toHaveText('DocumentFull');
    await expect(open.getByRole('link', { name: /All keys and edge cases/ })).toHaveAttribute('href', `${REFERENCE}#toggle--toggle`);
    await expect(open.getByRole('link', { name: 'ToggleExtension in the API' })).toHaveAttribute('href', '/api/root/ToggleExtension');

    // its state, live, in tabs
    await expect(open.getByRole('tablist', { name: 'State of the example' })).toBeVisible();
    await expect(open.getByRole('tab')).toHaveText(['JSON', 'Markdown', 'HTML']);
    await expect(open.getByRole('tab', { name: 'JSON' })).toHaveAttribute('aria-selected', 'true');
    await expect(stateText(page)).toContainText('"type": "toggle"');
    await expect(stateText(page)).toContainText('"collapsed": false');
    await expect(stateText(page)).toContainText('The ford is upstream.');
    expect(await stateText(page).innerText()).not.toMatch(/"id"/);
    await open.getByRole('tab', { name: 'Markdown' }).click();
    await expect(open.getByRole('tabpanel')).toHaveAttribute('data-tab', 'markdown');
    await expect(stateText(page)).toContainText('<details open>');
    await expect(stateText(page)).toContainText('<summary>What the ferryman knew</summary>');
    await open.getByRole('tab', { name: 'HTML' }).click();
    await expect(stateText(page)).toContainText('<details open><summary>What the ferryman knew</summary><p>The ford is upstream.</p></details>');
    await expect(open).toContainText('no whole-document HTML export yet'); // the honest note

    // a second click on the card closes it; so does Escape, which gives the focus back to the card
    await button.click();
    await expect(open).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await openCard(page, 'divider');
    await page.keyboard.press('Escape');
    await expect(page.locator(OPEN)).toHaveCount(0);
    await expect(card(page, 'divider').locator('button.open')).toBeFocused();
    // another card replaces the open one
    await openCard(page, 'code');
    await openCard(page, 'image');
    await expect(page.locator(OPEN)).toHaveCount(1);
    await expect(card(page, 'code').locator('button.open')).toHaveAttribute('aria-expanded', 'false');
  });

  test('Try it makes the example editable, and typing updates the JSON, the Markdown and the HTML live', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(PATH);
    await hydrated(page);
    await openCard(page, 'paragraph');
    const open = page.locator(OPEN);
    const root = open.locator(ROOT);
    const tryIt = open.getByRole('switch', { name: 'Try it' });
    await expect(tryIt).toHaveAttribute('aria-checked', 'false');
    await expect(root).toHaveAttribute('contenteditable', 'false');
    await expect(open.getByText('Turn on Try it')).toBeVisible();

    await tryIt.click();
    await expect(tryIt).toHaveAttribute('aria-checked', 'true');
    await expect(root).toHaveAttribute('contenteditable', 'true');
    await expect(root).not.toHaveAttribute('data-nabu-readonly', '');
    await expect(open.locator('.example')).toHaveClass(/editing/);
    await expect(root).toBeFocused();

    // type at the end of the paragraph
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Dusk fell.');
    await expect(root).toContainText('The ferryman waited under the eaves. Dusk fell.');
    await expect(stateText(page)).toContainText('Dusk fell.'); // JSON tab
    await expect(stateText(page).locator('.hot').first()).toBeVisible(); // what was just written is lit
    // (the lit stretch is what the LAST change wrote: the last key, here the full stop)
    expect(await stateText(page).locator('.hot').allInnerTexts().then((t) => t.join(''))).toBe('.');
    await open.getByRole('tab', { name: 'Markdown' }).click();
    await expect(stateText(page)).toHaveText('The **ferryman** waited under the eaves. Dusk fell.');
    await open.getByRole('tab', { name: 'HTML' }).click();
    await expect(stateText(page)).toHaveText('<p>The <strong>ferryman</strong> waited under the eaves. Dusk fell.</p>');

    // the editor is a real one: a mark changes the state too
    await root.press('Control+a');
    await page.keyboard.press('Control+i');
    await expect(stateText(page)).toContainText('<em>');
    await open.getByRole('tab', { name: 'JSON' }).click();
    await expect(stateText(page)).toContainText('"italic": true');

    // turning it off makes it read-only again; the wall's own example never changed
    await tryIt.click();
    await expect(root).toHaveAttribute('contenteditable', 'false');
    await expect(card(page, 'paragraph').locator(ROOT)).toContainText('The ferryman waited under the eaves.');
    await expect(card(page, 'paragraph').locator(ROOT)).not.toContainText('Dusk fell.');
  });

  test('typing a Markdown shortcut or a slash-free block shortcut in an open example changes the block, and the state says so', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(PATH);
    await hydrated(page);
    await openCard(page, 'paragraph');
    const open = page.locator(OPEN);
    await open.getByRole('switch', { name: 'Try it' }).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' a *b*');
    await open.getByRole('tab', { name: 'Markdown' }).click();
    await expect(stateText(page)).toContainText('a *b*');
    await expect(open.locator('[data-block-type="paragraph"] .nabu-italic')).toHaveText('b');
  });

  test('the state is live without Try it too: a toggle of the example opens in the card and the document is untouched', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(PATH);
    await hydrated(page);
    await openCard(page, 'toggle');
    await expect(stateText(page)).toContainText('"collapsed": false');
    await expect(page.locator(`${OPEN} .live`)).toHaveText('live');
  });
});

test.describe('accessibility', () => {
  test.use({ colorScheme: 'dark' });

  test('the cards are disclosure buttons, the tabs are a tablist with the arrows, Try it is a switch, the examples are named', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    // every card has ONE button, named by the card, that says whether it is open
    for (const c of CARDS) {
      const buttons = card(page, c.id).locator('button.open');
      await expect(buttons).toHaveCount(1);
      // the example is a specimen: inert, so that its own buttons (a toggle arrow, a tick, the icon of a callout) are no tab stop and no second target
      await expect(card(page, c.id).locator('.frame')).toHaveAttribute('inert', '');
      await expect(buttons).toHaveAccessibleName(c.title);
      await expect(buttons).toHaveAttribute('aria-expanded', 'false');
    }
    // the examples are documents with a name; the filter is a named group of toggle buttons
    for (const root of await page.locator(ROOT).all()) expect((await root.getAttribute('aria-label')) ?? '').not.toBe('');
    await expect(page.getByRole('group', { name: 'Filter the blocks' })).toBeVisible();

    await openCard(page, 'heading');
    const open = page.locator(OPEN);
    const tabs = open.getByRole('tab');
    await expect(open.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'state-tab-json');
    await expect(tabs.nth(0)).toHaveAttribute('aria-controls', 'state-panel');
    // only the selected tab is in the tab order
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('tabindex')))).toEqual(['0', '-1', '-1']);
    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true'); // wraps
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toBeFocused();
    // the state is a focusable, named panel (it may scroll)
    await expect(open.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');

    // the switch works from the keyboard
    const tryIt = open.getByRole('switch', { name: 'Try it' });
    await tryIt.focus();
    await page.keyboard.press('Space');
    await expect(tryIt).toHaveAttribute('aria-checked', 'true');
    await expect(open.locator(ROOT)).toBeFocused(); // turned on, the focus goes to the example, ready to type
    await tryIt.focus();
    await page.keyboard.press('Space');
    await expect(tryIt).toHaveAttribute('aria-checked', 'false');
    await expect(open.getByRole('button', { name: 'Close this card' })).toBeVisible();
  });

  test('prefers-reduced-motion: nothing moves (transitions are cut, the page scrolls without animating)', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await hydrated(page);
    await openCard(page, 'toggle');
    const t = await page.locator(`${OPEN} .switch`).evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(t).toBeLessThan(0.001);
    const card0 = await card(page, 'toggle').evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(card0).toBeLessThan(0.001);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await ctx.close();
  });

  test('every link of the page goes somewhere that exists (the reference, with its anchors, the API, the guides)', async ({ page, request }) => {
    await page.goto(PATH);
    await hydrated(page);
    const hrefs = new Set<string>();
    for (const c of CARDS) {
      await openCard(page, c.id);
      for (const h of await page.locator(`${OPEN} .links a`).evaluateAll((els) => els.map((e) => e.getAttribute('href')!))) hrefs.add(h);
    }
    for (const h of await page.locator(`${PAGE} a[href^="/"]`).evaluateAll((els) => els.map((e) => e.getAttribute('href')!))) hrefs.add(h);
    expect(hrefs.size).toBeGreaterThan(20);
    for (const href of hrefs) {
      const [path, anchor] = href.split('#');
      const res = await request.get(path || PATH);
      expect(res.status(), href).toBe(200);
      if (anchor) expect(await res.text(), href).toContain(`id="${anchor}"`);
    }
    // each card's "All keys and edge cases" goes to the section of ITS block
    const reference = [...hrefs].filter((h) => h.startsWith(`${REFERENCE}#`));
    expect(reference.length).toBeGreaterThanOrEqual(CARDS.length + 2 + TYPING.length + PASTE.length - 1);
  });
});

test.describe('the docs around it', () => {
  test.use({ colorScheme: 'dark' });

  test('the sidebar lists it in Getting started, after "Your first editor" and before "Presets"; it opens from a menu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PATH);
    await hydrated(page);
    const button = page.getByRole('button', { name: 'Browse the docs' });
    const nav = page.getByRole('navigation', { name: 'Documentation' });
    await expect(nav).toBeHidden(); // wide page: the navigation is folded behind its button, even at 1440
    await expect(page.getByRole('navigation', { name: 'On this page' })).toHaveCount(0); // and there is no table of contents
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    const links = await nav.locator('a[href^="/docs/getting-started/"]').evaluateAll((els) => els.map((e) => [e.getAttribute('href'), e.textContent]));
    expect(links).toEqual([
      ['/docs/getting-started/installation', 'Installation'],
      ['/docs/getting-started/first-editor', 'Your first editor'],
      [PATH, 'Tour of the blocks'],
      ['/docs/getting-started/presets', 'Presets'],
    ]);
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Tour of the blocks');
    // the Blocks reference is the last page of the Guides
    const guides = await nav.locator('a[href^="/docs/guides/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(guides.at(-1)).toBe(REFERENCE);
    await expect(nav.getByRole('link', { name: 'Blocks reference', exact: true })).toBeVisible();
    // Escape closes the menu and gives the focus back
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(button).toBeFocused();
    // a click elsewhere closes it too
    await button.click();
    await page.locator('h1').click();
    await expect(nav).toBeHidden();
    // and a link of the menu goes there
    await button.click();
    await nav.getByRole('link', { name: 'Presets', exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/getting-started\/presets$/);
    await expect(page.getByRole('navigation', { name: 'Documentation' })).toBeVisible(); // a markdown page: the usual column
  });

  test('previous / next: "Your first editor" before, "Presets" after, and each of them points back', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const pager = page.getByRole('navigation', { name: 'Previous and next pages' });
    await expect(pager.getByRole('link', { name: /Previous/ })).toHaveAttribute('href', '/docs/getting-started/first-editor');
    await expect(pager.getByRole('link', { name: /Previous/ })).toContainText('Your first editor');
    await expect(pager.getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/docs/getting-started/presets');
    await expect(pager.getByRole('link', { name: /Next/ })).toContainText('Presets');
    await pager.getByRole('link', { name: /Next/ }).click();
    await expect(page).toHaveURL(/\/presets$/);
    await expect(page.getByRole('navigation', { name: 'Previous and next pages' }).getByRole('link', { name: /Previous/ })).toHaveAttribute('href', PATH);
    await page.getByRole('navigation', { name: 'Previous and next pages' }).getByRole('link', { name: /Previous/ }).click();
    await expect(page).toHaveURL(new RegExp(`${PATH}$`));
    await hydrated(page); // client navigation: the page builds its editors in the browser
    await expect(page.locator(ROOT)).toHaveCount(1 + CARDS.length + TYPING.length + PASTE.length);
    await expect(page.getByRole('link', { name: /Edit this page on GitHub/ })).toHaveAttribute('href', /edit\/main\/src\/routes\/\(site\)\/docs\/getting-started\/tour-of-the-blocks\/\+page\.svelte$/);
  });

  test('/docs lists it with its description, and the Blocks reference is the former exhaustive page', async ({ page }) => {
    await page.goto('/docs');
    const row = page.locator('section[aria-labelledby="getting-started"] li', { has: page.getByRole('link', { name: 'Tour of the blocks', exact: true }) });
    await expect(row.getByRole('link')).toHaveAttribute('href', PATH);
    await expect(row).toContainText('One short story written with every block Nabu ships');
    await expect(page.locator('section[aria-labelledby="guides"]').getByRole('link', { name: 'Blocks reference', exact: true })).toHaveAttribute('href', REFERENCE);
    await page.goto(REFERENCE);
    await page.locator('[data-nabu-root][data-nabu-readonly]').waitFor();
    await expect(page).toHaveTitle('Blocks reference — Docs — Nabu');
    await expect(page.locator('h1').first()).toHaveText('Blocks reference');
    await expect(page.locator('[id="toggle--toggle"]')).toHaveCount(1);
    await expect(page.locator('[data-nabu-root] a.nabu-link[href="/docs/getting-started/tour-of-the-blocks"]')).toHaveCount(1);
  });
});

test.describe('server render, hydration and layout shift', () => {
  test.use({ colorScheme: 'light' });

  /** Position and size of what makes the page, in document coordinates (hidden or absent boxes are left out). */
  const boxes = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tour-page"] :is(h1, h2, h3, .tour-doc, .card, .story, .panel, .case, .pill, [data-block-type="heading"], [data-block-type="paragraph"], [data-block-type="list-item"], .cb, video, img)')].map((el) => {
        const r = el.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 10) / 10;
        const owner = el.closest('[data-card], [data-case], [data-testid="tour-story"]');
        const tag = `${el.tagName.toLowerCase()}${owner ? '@' + (owner.getAttribute('data-card') ?? owner.getAttribute('data-case') ?? 'story') : ''}`;
        return `${tag} ${round(r.x + scrollX)},${round(r.y + scrollY)} ${round(r.width)}x${round(r.height)}`;
      }),
    );

  /** A context whose fonts never load (system fonts both times), so that a difference can only come from the markup. */
  async function context(browser: Browser, javaScriptEnabled: boolean, fonts: boolean, width = 1280) {
    const ctx = await browser.newContext({ javaScriptEnabled, colorScheme: 'light', viewport: { width, height: 800 } });
    if (!fonts) await ctx.route(/\.woff2?$/, (route) => route.abort());
    return ctx;
  }

  for (const width of [1280, 375]) {
    test(`every block is where the server put it once hydrated (JavaScript off vs on, zero shift), at ${width}px`, async ({ browser }) => {
      for (const fonts of [false, true]) {
        const off = await context(browser, false, fonts, width);
        const offPage = await off.newPage();
        await offPage.goto(PATH);
        if (fonts) await offPage.evaluate(() => document.fonts.ready);
        const before = await boxes(offPage);
        await off.close();

        const on = await context(browser, true, fonts, width);
        const onPage = await on.newPage();
        await onPage.goto(PATH);
        await hydrated(onPage);
        await onPage.evaluate(() => document.fonts.ready);
        const after = await boxes(onPage);
        await on.close();

        expect(before.length).toBeGreaterThan(60);
        expect(after, `fonts ${fonts ? 'loaded' : 'blocked'}`).toEqual(before);
      }
    });
  }

  test('without JavaScript the story, the wall and the cases are all there to read', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await expect(page.locator('h1')).toHaveText('Tour of the blocks');
    await expect(page.locator(`${STORY} ${ROOT}`)).toContainText('Nobody had crossed since noon.');
    await expect(page.locator(`${STORY} ${ROOT}`).locator('video[src="/tour/river-at-dusk.mp4"]')).toHaveCount(1);
    await expect(page.locator(`${GRID} article.card:not([hidden])`)).toHaveCount(12);
    await expect(page.locator('[data-case="html-paste"] .after li')).toHaveText(['the rope', 'the oar']);
    await expect(page.getByTestId('xray-panel')).toContainText('Nothing yet');
    await ctx.close();
  });

  test('hydration adopts the server markup of every editor (no node replaced) and shifts nothing; the cost is reported', async ({ browser }) => {
    const ctx = await context(browser, true, false);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__shift = 0;
      w.__tagged = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) w.__shift += e.value; }).observe({ type: 'layout-shift', buffered: true });
      // Mark every element the server sent while the document is still unhydrated; a hydration that REPLACED the markup would leave elements without the mark.
      document.addEventListener('DOMContentLoaded', () => {
        if (document.querySelector('[data-testid="tour-page"][data-hydrated]')) return;
        for (const el of document.querySelectorAll('[data-nabu-root], [data-nabu-root] *')) { (el as any).__ssr = true; w.__tagged++; }
        w.__domReady = performance.now();
      });
      const poll = () => { if (document.querySelector('[data-testid="tour-page"][data-hydrated]')) (w.__hydratedAt = performance.now()); else requestAnimationFrame(poll); };
      document.addEventListener('DOMContentLoaded', poll);
    });
    await page.goto(PATH);
    await hydrated(page);
    await page.waitForTimeout(500);
    const stats = await page.evaluate(() => {
      const w = window as any;
      const els = [...document.querySelectorAll('[data-nabu-root], [data-nabu-root] *')];
      return {
        editors: document.querySelectorAll('[data-nabu-root]').length,
        tagged: w.__tagged, now: els.length, notFromServer: els.filter((e) => !(e as any).__ssr).length, shift: w.__shift,
        hydrationMs: Math.round((w.__hydratedAt ?? NaN) - (w.__domReady ?? NaN)),
      };
    });
    console.log(`[tour] ${stats.editors} editors, ${stats.tagged} server nodes adopted, hydrated ${stats.hydrationMs} ms after DOMContentLoaded (scripts loaded, main thread)`);
    test.info().annotations.push({ type: 'hydration', description: `${stats.editors} editors, ${stats.hydrationMs} ms` });
    expect(stats.editors).toBe(1 + CARDS.length + TYPING.length + PASTE.length);
    expect(stats.tagged).toBeGreaterThan(100);
    expect(stats.notFromServer).toBe(0);
    expect(stats.now).toBe(stats.tagged);
    expect(stats.shift).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('the markup of every editor has no whitespace between tags (it would become selectable phantom lines)', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const found = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('[data-nabu-root]').forEach((root, i) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const parent = n.parentElement!;
          if (/^\s+$/.test(n.textContent ?? '') && !parent.closest('pre, [data-nabu-ui]') && (parent.children.length || !parent.textContent!.trim())) out.push(`editor ${i}: "${n.textContent}" in ${parent.tagName.toLowerCase()}.${parent.className}`);
        }
      });
      return out;
    });
    expect(found).toEqual([]);
  });
});

test.describe('a phone, 375px', () => {
  test.use({ colorScheme: 'dark' });

  test('no horizontal scroll; the grid is one column; the panel is under the story; the blocks stay inside', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(PATH);
    await hydrated(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await page.evaluate(() => [...document.querySelectorAll('[data-testid="tour-page"] *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5 && !el.closest('pre, .state, .tabs')).length), 'something sticks out').toBe(0);
    // one column
    const xs = await visibleCards(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(xs).size).toBe(1);
    expect(await page.locator(GRID).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
    // the X-ray panel is under the story (an inline card), not beside it: once the foot of the story is on screen it rests right below it
    // (before that it stays at the bottom of the screen, which is the point of it)
    await page.evaluate((sel) => window.scrollTo(0, document.querySelector(sel)!.getBoundingClientRect().bottom + scrollY - 300), STORY);
    const [story, side] = await Promise.all([page.locator(STORY).boundingBox(), panel(page).boundingBox()]);
    expect(side!.y).toBeGreaterThanOrEqual(story!.y + story!.height - 2);
    expect(Math.abs(side!.width - story!.width)).toBeLessThan(2);
    // the menu is the button of every docs page on a phone
    await expect(page.getByRole('button', { name: 'Browse the docs' })).toBeVisible();
    // the cases and the end cards stack
    const caseXs = await page.locator('article[data-case]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(caseXs).size).toBe(1);
  });

  test('a tap stands for the hover; an open card stacks its example above its state, with no sideways scroll', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await hydrated(page);
    await page.locator(`${STORY} [data-block-type="callout"]`).tap();
    await expect(label(page)).toHaveText('callout · type ! then Space · /callout');
    await expect(panel(page).locator('.kicker')).toHaveText('X-RAY · YOU TAPPED');
    await expect(panel(page).locator('.name')).toHaveText('Callout');
    await page.locator(`${STORY} [data-block-type="blockquote"]`).tap();
    await expect(label(page)).toHaveText('blockquote · type > then Space · /quote');
    // the card opens under its own tile, which is one per row now
    await card(page, 'code').locator('button.open').tap();
    const open = page.locator(OPEN);
    await expect(open).toBeVisible();
    // the open card may still be settling (its own scroll into view / layout) when it becomes visible: poll the geometry
    await expect.poll(async () => {
      const [tile, box, next] = await Promise.all([card(page, 'code').boundingBox(), open.boundingBox(), card(page, 'callout').boundingBox()]);
      const [left, right] = await Promise.all([open.locator('.left').boundingBox(), open.locator('.right').boundingBox()]);
      return box!.y >= tile!.y + tile!.height && next!.y >= box!.y + box!.height - 1 && right!.y >= left!.y + left!.height - 1;
    }).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
    // a tab of the state works by touch
    await open.getByRole('tab', { name: 'Markdown' }).tap();
    await expect(stateText(page)).toContainText('```js');
    await ctx.close();
  });
});

test.describe('themes and the network', () => {
  for (const scheme of ['dark', 'light'] as const) {
    test(`${scheme}: the story, the cards and the X-ray take the site's colours, with readable text`, async ({ browser }) => {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(PATH);
      await hydrated(page);
      await page.locator(`${STORY} [data-block-type="blockquote"]`).hover();
      const c = await page.evaluate(() => {
        const site = document.querySelector('.site')!;
        const probe = (css: string) => {
          const el = document.createElement('span');
          el.style.color = css;
          site.append(el);
          const v = getComputedStyle(el).color;
          el.remove();
          return v;
        };
        const style = (sel: string) => getComputedStyle(document.querySelector(sel)!);
        const lum = (col: string) => {
          const [r, g, b] = col.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const surface = style('[data-testid="tour-story"]').backgroundColor;
        const text = style('[data-testid="tour-story"] [data-block-type="paragraph"]').color;
        const muted = style('.card .sentence').color;
        const tag = style('[data-testid="xray-label"]');
        return {
          page: style('.site').backgroundColor, surface, text, wantText: probe('var(--site-text)'), wantMuted: probe('var(--site-text-muted)'), muted,
          paneEditor: style('[data-testid="tour-story"] [data-nabu-root]').backgroundColor, border: style('[data-testid="tour-story"] [data-nabu-root]').borderTopWidth,
          tagBg: tag.backgroundColor, tagFg: tag.color, wantAccentFill: probe('var(--site-accent-fill)'),
          contrast: { text: contrast(text, surface), muted: contrast(muted, surface), tag: contrast(tag.color, tag.backgroundColor) },
          code: [...document.querySelectorAll('[data-testid="tour-story"] pre span')].map((s) => (s as HTMLElement).style.color).find(Boolean) ?? '',
        };
      });
      expect(c.page).toBe(scheme === 'dark' ? 'rgb(11, 11, 12)' : 'rgb(250, 250, 248)');
      expect(c.surface).toBe(scheme === 'dark' ? 'rgb(20, 20, 22)' : 'rgb(255, 255, 255)');
      expect(c.text).toBe(c.wantText);
      expect(c.muted).toBe(c.wantMuted);
      expect(c.paneEditor).toBe('rgba(0, 0, 0, 0)'); // no pane of the theme: the page draws the frame
      expect(c.border).toBe('0px');
      expect(c.tagBg).toBe(c.wantAccentFill);
      expect(c.code).toContain('var(--shiki-');
      expect(c.contrast.text).toBeGreaterThan(7);
      expect(c.contrast.muted).toBeGreaterThan(4.5);
      expect(c.contrast.tag).toBeGreaterThan(3.4); // the label of the X-ray, 11px text on the accent fill: the DS pairs them
      // the state of an open card, too
      await openCard(page, 'callout');
      const s = await page.evaluate(() => {
        const st = (sel: string) => getComputedStyle(document.querySelector(sel)!);
        const key = [...document.querySelectorAll('[data-testid="state-text"] span')].find((e) => e.className.includes('key')) as HTMLElement;
        const str = [...document.querySelectorAll('[data-testid="state-text"] span')].find((e) => e.className.includes('string')) as HTMLElement;
        return { right: st('[data-card-open] .right').backgroundColor, key: getComputedStyle(key).color, str: getComputedStyle(str).color, live: st('[data-card-open] .live').color };
      });
      expect(s.right).toBe(scheme === 'dark' ? 'rgb(11, 11, 12)' : 'rgb(250, 250, 248)');
      expect(s.str).toBe(scheme === 'dark' ? 'rgb(126, 231, 135)' : 'rgb(21, 128, 61)');
      expect(s.key).toBe(scheme === 'dark' ? 'rgb(122, 162, 247)' : 'rgb(47, 98, 204)');
      expect(s.live).toBe(s.str);
      await ctx.close();
    });
  }

  test('an explicit choice of the site theme wins over the system one: the story repaints with the toggle, with no reload', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('nabu-site-theme', 'light'));
    await page.goto(PATH);
    await hydrated(page);
    const p = page.locator(`${STORY} [data-block-type="paragraph"]`).first();
    expect(await p.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(20, 20, 22)');
    await page.getByTestId('theme-toggle').click(); // light -> system (dark here)
    await expect.poll(() => p.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(237, 237, 237)');
    await ctx.close();
  });

  test('requests nothing outside the site: no font, no image, no video, no script from elsewhere', async ({ page }) => {
    const external: string[] = [];
    const local: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost') external.push(r.url());
      else local.push(u.pathname);
    });
    await page.goto(PATH);
    await hydrated(page);
    await openCard(page, 'video-file');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    expect(external).toEqual([]);
    // the media come from static/, and nothing 404s
    expect(local).toContain('/tour/quay-at-dusk.svg');
    for (const file of ['/tour/quay-at-dusk.svg', '/tour/river-at-dusk.mp4', '/tour/crossing-ledger.pdf']) {
      const res = await page.request.get(file);
      expect(res.status(), file).toBe(200);
      expect(Number(res.headers()['content-length'] ?? '1')).toBeLessThan(60 * 1024);
    }
    expect(await page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
  });
});

test('screenshots of the tour', async ({ browser }) => {
  test.setTimeout(240000);
  mkdirSync(SHOTS, { recursive: true });
  for (const [scheme, width, height] of [['dark', 1440, 900], ['light', 1440, 900], ['dark', 375, 812], ['light', 375, 812]] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width, height }, hasTouch: width < 500 });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await hydrated(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const shot = (name: string) => page.screenshot({ path: `${SHOTS}/tour-${name}-${width}-${scheme}.png` });
    const scrollTo = (selector: string, block: 'start' | 'center' = 'start', offset = 0) =>
      page.locator(selector).first().evaluate((el, [b, o]) => { el.scrollIntoView({ block: b as ScrollLogicalPosition, behavior: 'instant' as ScrollBehavior }); scrollBy(0, -(o as number)); }, [block, offset] as const);
    await shot('top');
    await page.locator(`${STORY} [data-block-type="blockquote"]`).first().hover();
    await shot('xray');
    if (width < 500) { await page.locator(`${STORY} [data-block-type="blockquote"]`).first().tap(); await scrollTo(`${STORY} [data-block-type="callout"]`, 'center'); await shot('xray-tap'); }
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await scrollTo('[data-testid="tour-wall"]', 'start', 20);
    await shot('wall');
    await scrollTo(`${GRID} article[data-card="list"]`, 'start', 20);
    await shot('wall-2');
    await page.getByRole('button', { name: /^Media/ }).click();
    await scrollTo('[data-testid="tour-wall"]', 'start', 20);
    await shot('filter-media');
    await page.getByRole('button', { name: /^All/ }).click();
    await card(page, 'toggle').locator('button.open').click();
    await page.waitForTimeout(500);
    await scrollTo(OPEN, 'start', 24);
    await shot('card');
    await page.getByRole('switch', { name: 'Try it' }).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' x');
    await page.waitForTimeout(200);
    await shot('card-try');
    await page.getByRole('tab', { name: 'HTML' }).click();
    await shot('card-html');
    await page.keyboard.press('Escape');
    await scrollTo('[data-testid="tour-typing"]', 'start', 20);
    await shot('typing');
    await scrollTo('[data-testid="tour-paste"]', 'start', 20);
    await shot('paste');
    await scrollTo('[data-testid="tour-end"]', 'center');
    await shot('end');
    await page.getByRole('button', { name: 'Browse the docs' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('menu');
    await page.screenshot({ path: `${SHOTS}/tour-full-${width}-${scheme}.png`, fullPage: true });
    await ctx.close();
  }
});
