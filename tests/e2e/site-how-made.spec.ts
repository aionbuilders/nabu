import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page, type Browser } from './helpers/test.js';

// "How Nabu is made" (/architecture/how-it-is-made, src/routes/(site)/architecture/how-it-is-made): the strata of today's library, the ledger of
// real commits, and the owner's essay (English, with an EN · FR switch that writes the French over the English, a palimpsest; the French original is
// in a disclosure without JavaScript), the essays being Nabu documents in read-only mode.
// The numbers come from src/site/architecture/history.json (made by `bun run history`), the essays from docs/architecture/how-it-is-made.{en,fr}.md:
// this spec reads the same files, so it stays true when they are regenerated and compares the page with them EXACTLY.
test.use({ domInvariant: false });

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';
const PATH = '/architecture/how-it-is-made';
const SITE = 'https://nabu.aion.builders';
const REPO = 'https://github.com/aionbuilders/nabu';
const ARTICLE = '[data-testid="doc-article"]';

const history = JSON.parse(readFileSync(resolve('src/site/architecture/history.json'), 'utf8'));
const source = (lang: 'en' | 'fr') => readFileSync(resolve(`docs/architecture/how-it-is-made.${lang}.md`), 'utf8');
const paragraphs = (lang: 'en' | 'fr') => source(lang).split(/\n{2,}/).map((p: string) => p.trim()).filter(Boolean);

const STEERING = ['“No. Regions are boxes in Loro. Markers only on screen.”', '“It’s not that clean… it’s heavy. Don’t you think?”', '“Okay, go for 0.1.0.”'];

const hydrated = async (page: Page) => {
  await page.locator(ARTICLE).first().waitFor({ state: 'attached' });
  await expect(page.locator(`${ARTICLE}:not([data-hydrated])`)).toHaveCount(0, { timeout: 15000 });
};
const toggleButton = (page: Page, lang: 'en' | 'fr') => page.getByTestId('lang-toggle').locator(`button[data-lang="${lang}"]`);
const STAGE = '[data-testid="essay-stage"]';
/** Click a language and wait for the palimpsest to be over (stage idle). */
async function switchLang(page: Page, lang: 'en' | 'fr') {
  await toggleButton(page, lang).click();
  await settled(page);
}
const settled = (page: Page) => expect(page.locator(STAGE)).toHaveAttribute('data-state', 'idle', { timeout: 12000 });
/** Everything a finished switch must have cleaned up: no ghost, no scribe, no animation, no fixed height. */
async function expectClean(page: Page) {
  await expect(page.locator('[data-role="ghost"], [data-role="scribe"], [data-role="incoming"]')).toHaveCount(0);
  const left = await page.evaluate((sel) => ({ anims: document.getAnimations().length, height: (document.querySelector(sel) as HTMLElement).style.height, current: document.querySelectorAll('.pane[data-role="current"]').length }), STAGE);
  expect(left).toEqual({ anims: 0, height: '', current: 1 });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('the page', () => {
  test.use({ colorScheme: 'dark' });

  test('renders: header, strata, record and the essay, with the meta of a page', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Written over, not erased.');
    await expect(page.getByText('A palimpsest is a page scraped and written again')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The record.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'In Killian’s own words' })).toBeVisible();
    await expect(page).toHaveTitle('How Nabu is made · Architecture · Nabu');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Nabu is built by one person and an AI/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE}${PATH}`);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Architecture', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: `${SHOTS}/how-made-render-check.png`, fullPage: false });
  });

  test('the strata: the shares are the ones of history.json, drawn in proportion, with a text alternative', async ({ page }) => {
    await page.goto(PATH);
    const { layers, lines } = history.shares;
    expect(layers.since + layers.before).toBe(100);
    const stack = page.getByTestId('strata').getByRole('img');
    const label = (await stack.getAttribute('aria-label'))!;
    expect(label).toContain(`${layers.since}%`);
    expect(label).toContain(`${layers.before}%`);
    expect(label).toContain(lines.kept.toLocaleString('en-US'));
    expect(label).toContain(lines.today.toLocaleString('en-US'));
    await expect(page.getByTestId('layer-since')).toContainText(`${layers.since}%`);
    await expect(page.getByTestId('layer-before')).toContainText(`${layers.before}%`);
    await expect(page.getByTestId('layer-since')).toContainText('Since October');
    await expect(page.getByTestId('layer-before')).toContainText('February – June');
    const h = await stack.evaluate((el) => ({
      total: el.getBoundingClientRect().height,
      since: el.querySelector('[data-testid="layer-since"]')!.getBoundingClientRect().height,
      before: el.querySelector('[data-testid="layer-before"]')!.getBoundingClientRect().height,
    }));
    expect(h.since).toBeGreaterThan(h.before);
    expect(Math.abs(h.before / (h.since + h.before) - layers.before / 100)).toBeLessThan(0.03);
    // the figure says in words what the colours say, with the numbers
    await expect(page.locator('figcaption')).toContainText(`${lines.kept.toLocaleString('en-US')} lines`);
    await expect(page.locator('figcaption')).toContainText('a line that moved counts as new');
  });

  test('the ledger: a list of real commits, K. and C., with the steering lines and the gap', async ({ page }) => {
    await page.goto(PATH);
    const ledger = page.getByTestId('ledger');
    await expect(ledger).toHaveAttribute('role', 'list');
    const commits = ledger.locator('li.commit');
    await expect(commits).toHaveCount(history.curated.length);
    expect(history.curated.length).toBeGreaterThanOrEqual(12);
    for (const [i, c] of history.curated.entries()) {
      const row = commits.nth(i);
      await expect(row.locator('time')).toHaveText(c.date);
      await expect(row.locator('time')).toHaveAttribute('datetime', c.date);
      await expect(row.locator('.who')).toHaveText(c.who === 'K' ? 'K.' : 'C.');
      await expect(row.locator('.who')).toHaveAttribute('aria-label', c.who === 'K' ? 'Killian' : 'Claude');
      await expect(row.locator('.subject')).toHaveText(c.subject);
    }
    // both hands are there, and the ledger is in date order
    await expect(ledger.locator('li.commit[data-who="K"]').first()).toBeVisible();
    await expect(ledger.locator('li.commit[data-who="C"]').first()).toBeVisible();
    const dates = history.curated.map((c: any) => c.date);
    expect([...dates].sort()).toEqual(dates);
    // the three large lines, exactly as the board writes them, each signed K.
    const steer = ledger.getByTestId('steer');
    await expect(steer).toHaveCount(3);
    for (const [i, text] of STEERING.entries()) {
      await expect(steer.nth(i).locator('p')).toHaveText(text);
      await expect(steer.nth(i).locator('.who')).toHaveText('K.');
    }
    // the gap is real: no commit between the two eras
    expect(history.gap.commits).toBe(0);
    await expect(ledger.getByTestId('gap')).toHaveText('July, August, September: nothing.');
    // the gap sits between the last commit before October and the first one since
    const gap = await ledger.locator(':scope > li').evaluateAll((lis) => {
      const i = lis.findIndex((li) => li.getAttribute('data-testid') === 'gap');
      return { i, before: lis[i - 1]?.querySelector('time')?.textContent, after: lis[i + 1]?.querySelector('time')?.textContent };
    });
    expect(gap.i).toBeGreaterThan(0);
    expect(gap.before! < history.boundary).toBe(true);
    expect(gap.after! >= history.boundary).toBe(true);
  });

  test('the note under the ledger is factual: the counts of history.json, the rule, the translation, the log', async ({ page }) => {
    await page.goto(PATH);
    const note = page.getByTestId('ledger-note');
    const { before, since } = history.eras;
    await expect(note).toContainText('His lines are translated from French and condensed.');
    await expect(note).toContainText(`From February to June: ${before.k} commits by Killian, ${before.c} by Claude (co-signed, or authored by Claude Code on GitHub)`);
    await expect(note).toContainText(`${since.c}`);
    await expect(note).toContainText('Co-Authored-By: Claude');
    await expect(note).not.toContainText('[');
    await expect(note).toContainText('or when Anthropic’s address is its author');
    await expect(note).toContainText('does not prove that no AI was used');
    await expect(note).not.toContainText('early commits have');
    expect(before.total + since.total).toBe(history.total);
    expect(before.k + before.c).toBe(before.total);
    // the K. / C. meaning is explained before the list
    await expect(page.locator('.head p')).toContainText('K. is Killian');
    await expect(page.locator('.head p')).toContainText('C. is Claude');
    await expect(note.getByRole('link', { name: /The whole log on GitHub/ })).toHaveAttribute('href', `${REPO}/commits/main`);
  });

  test('the essay is set as a letter, marked as his, translated, signed', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await expect(page.getByTestId('byline-en')).toHaveText('Written in French by Killian, translated with Claude’s help.');
    await expect(page.getByTestId('byline-en')).toBeVisible();
    await expect(page.getByTestId('byline-fr')).toBeHidden();
    const en = page.getByTestId('essay-en');
    await expect(en.locator('[data-block-type="paragraph"]').first()).toHaveCSS('font-family', /Newsreader/);
    expect(await en.locator('[data-block-type="paragraph"]').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
    await expect(page.locator('.signature').first()).toHaveText('Killian Di Vincenzo');
    // read-only: nothing to type into
    await expect(en.locator('[contenteditable="true"]')).toHaveCount(0);
  });

  test('the English essay is exactly the owner’s text, paragraph by paragraph', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const want = paragraphs('en');
    expect(want).toHaveLength(7);
    const got = await page.getByTestId('essay-en').locator('[data-block-type="paragraph"]').evaluateAll((els) => els.map((el) => el.textContent));
    expect(got).toEqual(want);
    await expect(page.getByTestId('essay-en')).toHaveAttribute('lang', 'en');
  });

  test('without JavaScript: both essays are in the HTML, the disclosure still opens, nothing external', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    const res = await page.goto(PATH);
    const html = await res!.text();
    for (const lang of ['en', 'fr'] as const) {
      for (const p of paragraphs(lang)) {
        const probe = p.slice(0, 60).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        expect(html, `${lang}: ${probe}`).toContain(probe);
      }
    }
    expect(html).toContain('Read the original in French');
    // the switch is in the HTML (so nothing moves when it shows) but there is nothing to press without JavaScript
    await expect(page.getByTestId('lang-toggle')).toBeHidden();
    await expect(page.getByTestId('byline-en')).toBeVisible();
    await expect(page.getByTestId('byline-fr')).toBeHidden();
    expect(html).toContain('July, August, September: nothing.');
    // the French is in the DOM before any click, and it opens with a click on the summary alone
    const got = await page.getByTestId('essay-fr').locator('[data-block-type="paragraph"]').evaluateAll((els) => els.map((el) => el.textContent));
    expect(got).toEqual(paragraphs('fr'));
    await expect(page.getByTestId('essay-fr')).toBeHidden();
    await page.getByTestId('original').locator('summary').click();
    await expect(page.getByTestId('essay-fr')).toBeVisible();
    const en = await page.getByTestId('essay-en').locator('[data-block-type="paragraph"]').evaluateAll((els) => els.map((el) => el.textContent));
    expect(en).toEqual(paragraphs('en'));
    await ctx.close();
  });

  test('no request leaves the site (fonts included), no console error', async ({ page }) => {
    const external: string[] = [];
    const errors: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith('http') && u.hostname !== 'localhost') external.push(r.url());
    });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(PATH);
    await hydrated(page);
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    expect(fonts.some((f) => /Newsreader/.test(f))).toBe(true);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// ── the EN · FR switch: the palimpsest ────────────────────────────────────────────────────────────────────────────────────────

const paragraphsOf = (page: Page, lang: 'en' | 'fr') => page.getByTestId(`essay-${lang}`).locator('[data-block-type="paragraph"]').evaluateAll((els) => els.map((el) => el.textContent));

test.describe('the switch', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });

  test('it appears once the page is live: EN pressed, English visible, the note in English, nothing to announce', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const group = page.getByTestId('lang-toggle');
    await expect(group).toBeVisible();
    await expect(group).toHaveAttribute('role', 'group');
    await expect(toggleButton(page, 'en')).toHaveAttribute('aria-pressed', 'true');
    await expect(toggleButton(page, 'fr')).toHaveAttribute('aria-pressed', 'false');
    await expect(toggleButton(page, 'en')).toHaveText('EN');
    await expect(toggleButton(page, 'fr')).toHaveText('FR');
    await expect(page.getByTestId('byline-en')).toBeVisible();
    await expect(page.getByTestId('essay-en')).toBeVisible();
    await expect(page.getByTestId('essay-fr')).toBeHidden();
    await expect(page.locator(STAGE)).toHaveAttribute('data-state', 'idle');
    // the disclosure is gone for the eye (open, its summary hidden), the French pane is neither seen nor reachable
    await expect(page.getByTestId('original').locator('summary')).toBeHidden();
    await expect(page.getByTestId('essay-fr')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('essay-fr')).toHaveAttribute('inert', '');
    await expectClean(page);
  });

  test('EN to FR: the English is scraped back (a ghost, aria-hidden), the French is written over it, then only the French remains', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const enHeight = await page.getByTestId('essay-en').evaluate((el) => el.getBoundingClientRect().height);
    await toggleButton(page, 'fr').click();
    // at once: pressed, busy, the stage still has the English height (nothing below jumps)
    await expect(toggleButton(page, 'fr')).toHaveAttribute('aria-pressed', 'true');
    await expect(toggleButton(page, 'en')).toHaveAttribute('aria-pressed', 'false');
    const stage = page.locator(STAGE);
    await expect(stage).toHaveAttribute('data-state', 'busy');
    expect(await stage.evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(enHeight, 0);
    // beat 2: the English is still there, as a ghost
    const ghost = page.getByTestId('essay-en');
    await expect(ghost).toHaveAttribute('data-role', 'ghost');
    await expect(ghost).toHaveAttribute('aria-hidden', 'true');
    await expect(ghost).toBeVisible();
    await expect.poll(() => ghost.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 3000 }).toBeLessThan(0.3);
    // beat 3: the French is written by a decorative copy, aria-hidden, not live, in French, with its words wrapped
    const scribe = page.locator('[data-role="scribe"]');
    await expect(scribe).toHaveCount(1);
    await expect(scribe).toHaveAttribute('aria-hidden', 'true');
    await expect(scribe).toHaveAttribute('lang', 'fr');
    await expect(scribe.locator('[aria-live], [contenteditable], [id], [data-testid]')).toHaveCount(0);
    expect(await scribe.locator('.w').count()).toBeGreaterThan(400);
    await expect(page.getByTestId('essay-fr')).toBeHidden(); // the real French waits, invisible, until it is written
    // the copy lays the text out exactly like the real document (so the swap moves no pixel)
    const heights = await page.evaluate(() => {
      const h = (root: Element | null) => [...(root?.querySelectorAll('[data-block-type="paragraph"]') ?? [])].map((p) => Math.round(p.getBoundingClientRect().height * 10) / 10);
      return { scribe: h(document.querySelector('[data-role="scribe"]')), real: h(document.querySelector('[data-testid="essay-fr"]')) };
    });
    expect(heights.scribe).toHaveLength(7);
    expect(heights.scribe).toEqual(heights.real);
    // beat 4: fully written, the English still shows through underneath
    await expect(page.getByTestId('essay-fr')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('byline-fr')).toBeVisible();
    await expect(scribe).toHaveCount(0);
    expect(await ghost.evaluate((el) => el.getAttribute('data-role'))).toBe('ghost');
    // beat 5: only the French remains
    await settled(page);
    await expect(page.getByTestId('essay-en')).toBeHidden();
    await expect(page.getByTestId('essay-fr')).toBeVisible();
    await expect(page.getByTestId('essay-fr')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('essay-fr').locator('[data-nabu-root]')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('essay-fr')).not.toHaveAttribute('aria-hidden', /.*/);
    await expect(page.getByTestId('essay-fr')).not.toHaveAttribute('inert', /.*/);
    await expect(page.getByTestId('byline-fr')).toHaveText('Texte original, en français.');
    await expect(page.getByTestId('byline-en')).toBeHidden();
    expect(await paragraphsOf(page, 'fr')).toEqual(paragraphs('fr'));
    expect(await paragraphsOf(page, 'en')).toEqual(paragraphs('en')); // the English document was never touched
    await expect(page.getByTestId('essay-fr').locator('[contenteditable="true"]')).toHaveCount(0);
    await expectClean(page);
    // the stage took the French height and nothing else is fixed
    const [stageH, frH] = await page.evaluate(() => [document.querySelector('[data-testid="essay-stage"]')!.getBoundingClientRect().height, document.querySelector('[data-testid="essay-fr"]')!.getBoundingClientRect().height]);
    expect(stageH).toBeCloseTo(frH, 0);
  });

  test('and back: FR is scraped back and EN written over it', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await switchLang(page, 'fr');
    await toggleButton(page, 'en').click();
    await expect(page.getByTestId('essay-fr')).toHaveAttribute('data-role', 'ghost');
    await expect(page.locator('[data-role="scribe"]')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('byline-fr')).toBeVisible(); // the note changes only when the writing ends
    await settled(page);
    await expect(toggleButton(page, 'en')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('essay-en')).toBeVisible();
    await expect(page.getByTestId('essay-en')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('essay-fr')).toBeHidden();
    await expect(page.getByTestId('byline-en')).toHaveText('Written in French by Killian, translated with Claude’s help.');
    await expect(page.getByTestId('byline-fr')).toBeHidden();
    expect(await paragraphsOf(page, 'en')).toEqual(paragraphs('en'));
    await expectClean(page);
  });

  test('the height eases during the writing, then nothing is fixed', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    const hs = await page.evaluate(() => ({ en: document.querySelector('[data-testid="essay-en"]')!.getBoundingClientRect().height, fr: document.querySelector('[data-testid="essay-fr"]')!.getBoundingClientRect().height }));
    await toggleButton(page, 'fr').click();
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      seen.push(await page.locator(STAGE).evaluate((el) => el.getBoundingClientRect().height));
      if (await page.locator(STAGE).getAttribute('data-state') === 'idle') break;
      await page.waitForTimeout(60);
    }
    await settled(page);
    const lo = Math.min(hs.en, hs.fr);
    const hi = Math.max(hs.en, hs.fr);
    if (hi - lo > 8) expect(seen.some((h) => h > lo + 1 && h < hi - 1), `heights ${seen.map(Math.round)} between ${lo} and ${hi}`).toBe(true);
    expect(seen.every((h) => h >= lo - 1 && h <= hi + 1)).toBe(true);
  });

  test('keyboard: the buttons are reached with Tab and pressed with Enter or Space', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await toggleButton(page, 'en').focus();
    await page.keyboard.press('Tab');
    await expect(toggleButton(page, 'fr')).toBeFocused();
    await page.keyboard.press('Enter');
    await settled(page);
    await expect(toggleButton(page, 'fr')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('essay-fr')).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(toggleButton(page, 'en')).toBeFocused();
    await page.keyboard.press('Space');
    await settled(page);
    await expect(page.getByTestId('essay-en')).toBeVisible();
    await expect(toggleButton(page, 'en')).toHaveAttribute('aria-pressed', 'true');
    await expectClean(page);
  });

  test('pressing the language that is already pressed does nothing', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await toggleButton(page, 'en').click();
    await expect(page.locator(STAGE)).toHaveAttribute('data-state', 'idle');
    await expectClean(page);
  });

  test('a click during the writing cancels it cleanly and goes to the language asked for', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    // EN -> FR, then EN again while the English is still the ghost: back to English, ink restored, no ghost left
    await toggleButton(page, 'fr').click();
    await page.waitForTimeout(500);
    await toggleButton(page, 'en').click();
    await settled(page);
    await expect(toggleButton(page, 'en')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('essay-en')).toBeVisible();
    expect(await page.getByTestId('essay-en').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expect(page.getByTestId('essay-fr')).toBeHidden();
    await expect(page.getByTestId('byline-en')).toBeVisible();
    await expectClean(page);
    // a flurry of clicks ends on the last one, whole
    await toggleButton(page, 'fr').click();
    await page.waitForTimeout(300);
    await toggleButton(page, 'en').click();
    await page.waitForTimeout(100);
    await toggleButton(page, 'fr').click();
    await settled(page);
    await expect(page.getByTestId('essay-fr')).toBeVisible();
    await expect(page.getByTestId('essay-en')).toBeHidden();
    await expect(page.getByTestId('byline-fr')).toBeVisible();
    expect(await paragraphsOf(page, 'fr')).toEqual(paragraphs('fr'));
    await expectClean(page);
    // after the French is written but while the English is still fading: back to English written over the French
    await toggleButton(page, 'en').click();
    await page.waitForTimeout(100);
    await toggleButton(page, 'fr').click();
    await page.waitForTimeout(100);
    await toggleButton(page, 'en').click();
    await settled(page);
    await expect(page.getByTestId('essay-en')).toBeVisible();
    await expect(page.getByTestId('essay-fr')).toBeHidden();
    expect(await paragraphsOf(page, 'en')).toEqual(paragraphs('en'));
    await expectClean(page);
  });

  test('a click while the old language fades out (after the writing) starts the way back from the new one', async ({ page }) => {
    await page.goto(PATH);
    await hydrated(page);
    await toggleButton(page, 'fr').click();
    await expect(page.getByTestId('essay-fr')).toBeVisible({ timeout: 6000 }); // written; the English is still fading underneath
    await expect(page.locator(STAGE)).toHaveAttribute('data-state', 'busy');
    await toggleButton(page, 'en').click();
    await expect(page.getByTestId('essay-fr')).toHaveAttribute('data-role', 'ghost');
    await settled(page);
    await expect(page.getByTestId('essay-en')).toBeVisible();
    await expect(page.getByTestId('essay-fr')).toBeHidden();
    await expectClean(page);
  });

  test('prefers-reduced-motion: the language is swapped at once, no ghost, no writing', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await hydrated(page);
    await toggleButton(page, 'fr').click();
    // no waiting for an animation: the very next check already sees the end state
    await expect(page.locator(STAGE)).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('essay-fr')).toBeVisible();
    await expect(page.getByTestId('essay-en')).toBeHidden();
    await expect(page.getByTestId('byline-fr')).toBeVisible();
    await expect(page.locator('[data-role="scribe"]')).toHaveCount(0);
    await expectClean(page);
    await toggleButton(page, 'en').click();
    await expect(page.getByTestId('essay-en')).toBeVisible();
    await expect(page.getByTestId('essay-fr')).toBeHidden();
    await expectClean(page);
    await ctx.close();
  });

  test('the settled text can be selected and copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(PATH);
    await hydrated(page);
    await switchLang(page, 'fr');
    const first = page.getByTestId('essay-fr').locator('[data-block-type="paragraph"]').first();
    await first.scrollIntoViewIfNeeded();
    await first.click({ clickCount: 3 });
    const selected = await page.evaluate(() => getSelection()!.toString().trim());
    expect(selected).toBe(paragraphs('fr')[0]);
    // the ghost never takes the selection: the visible text is the only thing under the pointer
    expect(await page.evaluate(() => getSelection()!.anchorNode?.parentElement?.closest('[data-testid="essay-fr"]') != null)).toBe(true);
  });

  test('the choice is remembered per viewer, and storage that throws changes nothing', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await hydrated(page);
    await switchLang(page, 'fr');
    expect(await page.evaluate(() => localStorage.getItem('nabu:made-lang'))).toBe('fr');
    await page.reload();
    await hydrated(page);
    await expect(toggleButton(page, 'fr')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('essay-fr')).toBeVisible();
    await expect(page.getByTestId('essay-en')).toBeHidden();
    await expect(page.getByTestId('byline-fr')).toBeVisible();
    await expectClean(page);
    await switchLang(page, 'en');
    expect(await page.evaluate(() => localStorage.getItem('nabu:made-lang'))).toBe('en');
    await page.reload();
    await hydrated(page);
    await expect(page.getByTestId('essay-en')).toBeVisible();
    await ctx.close();

    const blocked = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    const p2 = await blocked.newPage();
    const errors: string[] = [];
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(PATH);
    await hydrated(p2);
    await expect(p2.getByTestId('essay-en')).toBeVisible();
    await switchLang(p2, 'fr');
    await expect(p2.getByTestId('essay-fr')).toBeVisible();
    expect(errors).toEqual([]);
    await blocked.close();
  });

  test('light: the pill and the letter take the light colours during the switch', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await hydrated(page);
    await toggleButton(page, 'fr').click();
    await page.waitForTimeout(900);
    const ink = await page.evaluate(() => getComputedStyle(document.querySelector('[data-role="scribe"] [data-block-type="paragraph"]')!).color);
    expect(ink).toBe('rgb(20, 20, 22)');
    await settled(page);
    await expect(page.getByTestId('essay-fr')).toBeVisible();
    await ctx.close();
  });
});

// The storyboard as a strip of frames (palimpsest-*.png in SHOTS): the page runs at a tenth of its speed (CDP), and a frame is taken when the
// switch's own timeline reaches 0, 200, 600, 1000, 1600, 2200 ms, and at the end. Slow (about a minute), so only with NABU_STRIP=1.
test.describe('the strip of frames', () => {
  test.skip(!process.env.NABU_STRIP, 'set NABU_STRIP=1 to record the frames');
  test.use({ colorScheme: 'dark', viewport: { width: 1180, height: 820 } });

  for (const [from, to] of [['en', 'fr'], ['fr', 'en']] as const) {
    test(`${from} to ${to}`, async ({ page, context }) => {
      test.setTimeout(180000);
      mkdirSync(SHOTS, { recursive: true });
      await page.goto(PATH);
      await hydrated(page);
      await page.evaluate(() => document.fonts.ready);
      if (from === 'fr') await switchLang(page, 'fr');
      await page.getByTestId('lang-toggle').evaluate((el) => { el.scrollIntoView(); scrollBy(0, -24); });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Animation.enable');
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
      const clockNow = () => page.evaluate(() => {
        const a = document.getAnimations().filter((x) => (x.effect?.getTiming().duration as number) > 2000)[0];
        return a ? Number(a.currentTime) : -1;
      });
      await toggleButton(page, to).click();
      const tag = `${from}-${to}`;
      for (const ms of [0, 200, 600, 1000, 1600, 2200]) {
        await expect.poll(clockNow, { timeout: 90000, intervals: [20] }).toBeGreaterThanOrEqual(ms);
        const at = await clockNow();
        await page.screenshot({ path: `${SHOTS}/palimpsest-${tag}-${String(ms).padStart(4, '0')}ms.png` });
        console.log(`frame ${tag} wanted ${ms} got ${Math.round(at)}`);
      }
      await settled(page);
      await page.screenshot({ path: `${SHOTS}/palimpsest-${tag}-2800ms.png` });
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    });
  }
});

// ── the links in ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('links', () => {
  test('the Architecture landing leads here, next to the limits and the decision records', async ({ page }) => {
    await page.goto('/architecture');
    const cards = page.getByRole('region', { name: 'More' });
    const card = cards.getByRole('link', { name: /How Nabu is made/ });
    await expect(card).toHaveAttribute('href', PATH);
    await expect(cards.getByRole('link', { name: /What Nabu doesn't do well/ })).toBeVisible();
    await expect(cards.getByRole('link', { name: /Decision records/ })).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${PATH}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Written over, not erased.');
  });

  test('the footer has "How it\'s made" under Project, on any page', async ({ page }) => {
    for (const from of ['/', '/docs', '/architecture/limits']) {
      await page.goto(from);
      const link = page.locator('footer').getByRole('navigation', { name: 'Project' }).getByRole('link', { name: "How it's made", exact: true });
      await expect(link, from).toHaveAttribute('href', PATH);
    }
    await page.goto('/');
    await page.locator('footer').getByRole('link', { name: "How it's made", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  });

  test('the sitemap lists it once; the docs sidebar and the chapter list never show the essays', async ({ request, page }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml.split(`<loc>${SITE}${PATH}</loc>`)).toHaveLength(2);
    await page.goto('/docs');
    expect(await page.locator('a[href*="how-it-is-made"]').evaluateAll((as) => as.filter((a) => !a.closest('footer')).length)).toBe(0);
    await page.goto('/architecture');
    await expect(page.locator('ol.chapters li')).toHaveCount(7);
    await expect(page.locator('ol.chapters')).not.toContainText('How Nabu is made');
    expect((await request.get('/architecture/chapters/how-it-is-made')).status()).toBe(404);
  });
});

// ── zero layout shift ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('hydration', () => {
  const boxes = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('main :is(h1, h2, figure, .stack, .layer, .row, .note p, .toggle, .byline, .signature, [data-block-type="paragraph"])')].filter((el) => !el.closest('[data-testid="essay-fr"]')).map((el) => {
        const r = el.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 10) / 10;
        return `${el.tagName.toLowerCase()}.${(el as HTMLElement).className.toString().split(' ')[0]} ${round(r.x + scrollX)},${round(r.y + scrollY)} ${round(r.width)}x${round(r.height)}`;
      }),
    );

  async function context(browser: Browser, javaScriptEnabled: boolean, fonts: boolean) {
    const ctx = await browser.newContext({ javaScriptEnabled, colorScheme: 'light', viewport: { width: 1280, height: 800 } });
    if (!fonts) await ctx.route(/\.woff2?$/, (route) => route.abort());
    return ctx;
  }

  test('every block is where the server put it once hydrated, French disclosure open too (JavaScript off vs on)', async ({ browser }) => {
    for (const fonts of [false, true]) {
      const off = await context(browser, false, fonts);
      const offPage = await off.newPage();
      await offPage.goto(PATH);
      if (fonts) await offPage.evaluate(() => document.fonts.ready);
      const before = await boxes(offPage);
      await off.close();

      const on = await context(browser, true, fonts);
      const onPage = await on.newPage();
      await onPage.goto(PATH);
      await hydrated(onPage);
      await expect(onPage.getByTestId('lang-toggle').locator('button').first()).toBeVisible();
      await onPage.evaluate(() => document.fonts.ready);
      const after = await boxes(onPage);
      await on.close();

      expect(before.length).toBeGreaterThan(30);
      expect(before.some((b) => b.startsWith('div.toggle'))).toBe(true);
      expect(after, `fonts ${fonts ? 'loaded' : 'blocked'}`).toEqual(before);
    }
  });

  test('hydration adopts the server markup (no node replaced) and shifts nothing', async ({ browser }) => {
    const ctx = await context(browser, true, false);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const w = window as any;
      w.__shift = 0;
      w.__tagged = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) w.__shift += e.value; }).observe({ type: 'layout-shift', buffered: true });
      document.addEventListener('DOMContentLoaded', () => {
        if (document.querySelector('[data-hydrated]')) return;
        for (const el of document.querySelectorAll('[data-nabu-root], [data-nabu-root] *')) { (el as any).__ssr = true; w.__tagged++; }
      });
    });
    await page.goto(PATH);
    await hydrated(page);
    await page.waitForTimeout(400);
    const stats = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-nabu-root], [data-nabu-root] *')];
      return { tagged: (window as any).__tagged, now: els.length, notFromServer: els.filter((e) => !(e as any).__ssr).length, shift: (window as any).__shift };
    });
    expect(stats.tagged).toBeGreaterThanOrEqual(14); // two essays of seven paragraphs, and their roots
    expect(stats.notFromServer).toBe(0);
    expect(stats.now).toBe(stats.tagged);
    expect(stats.shift).toBe(0);
    await ctx.close();
  });
});

// ── responsive and themes ────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('responsive and themes', () => {
  test('375px: no horizontal scroll, nothing sticks out, in English, during the writing and in French', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PATH);
    await hydrated(page);
    const sticksOut = () => page.evaluate(() => [...document.querySelectorAll('main :is(h1, h2, .layer, .row, .subject, .note, .toggle, .byline span.on, .pane[data-role="current"], [data-role="scribe"], [data-block-type="paragraph"])')].filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5).length);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await sticksOut()).toBe(0);
    await toggleButton(page, 'fr').click();
    await page.waitForTimeout(700);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await sticksOut()).toBe(0);
    await settled(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await sticksOut()).toBe(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  for (const scheme of ['dark', 'light'] as const) {
    for (const [label, size] of [['1440', { width: 1440, height: 1000 }], ['375', { width: 375, height: 800 }]] as const) {
      test(`${scheme}, ${label}: readable, the layers and the K. / C. take their colours, screenshots`, async ({ browser }) => {
        const ctx = await browser.newContext({ colorScheme: scheme, viewport: size });
        const page = await ctx.newPage();
        await page.goto(PATH);
        await hydrated(page);
        await page.evaluate(() => document.fonts.ready);
        expect(await noHorizontalScroll(page)).toBe(true);
        const colors = await page.evaluate(() => {
          const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
          const color = (sel: string) => getComputedStyle(document.querySelector(sel)!).color;
          return {
            page: getComputedStyle(document.querySelector('.site')!).backgroundColor,
            since: bg('[data-testid="layer-since"]'),
            before: bg('[data-testid="layer-before"]'),
            text: color('.layer .title'),
            k: color('li.commit[data-who="K"] .who'),
            c: color('li.commit[data-who="C"] .who'),
            essay: color('[data-testid="essay-en"] [data-block-type="paragraph"]'),
          };
        });
        expect(colors.page).toBe(scheme === 'dark' ? 'rgb(11, 11, 12)' : 'rgb(250, 250, 248)');
        expect(colors.since).not.toBe(colors.before);
        expect(colors.since).not.toBe(colors.page);
        expect(colors.k).not.toBe(colors.c);
        // the text of a layer is the page's own text colour: dark on the pale layers, light on the dark ones
        const lum = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        expect(Math.abs(lum(colors.text) - lum(colors.since))).toBeGreaterThan(120);
        expect(Math.abs(lum(colors.text) - lum(colors.before))).toBeGreaterThan(120);
        expect(Math.abs(lum(colors.essay) - lum(colors.page))).toBeGreaterThan(150);
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/how-made-${scheme}-${label}.png`, fullPage: true });
        // the toggle in both states, and the French once written; the pill and the letter take the theme's colours
        const pill = await page.evaluate(() => {
          const on = document.querySelector('.toggle button[aria-pressed="true"]')!;
          const off = document.querySelector('.toggle button[aria-pressed="false"]')!;
          return { onBg: getComputedStyle(on).backgroundColor, onFg: getComputedStyle(on).color, offFg: getComputedStyle(off).color, page: getComputedStyle(document.querySelector('.site')!).backgroundColor };
        });
        expect(pill.onBg).not.toBe(pill.page);
        expect(pill.onFg).toBe(pill.page);
        expect(pill.offFg).not.toBe(pill.onFg);
        await switchLang(page, 'fr');
        const frColor = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="essay-fr"] [data-block-type="paragraph"]')!).color);
        expect(Math.abs(lum(frColor) - lum(colors.page))).toBeGreaterThan(150);
        await page.getByTestId('essay-stage').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/how-made-${scheme}-${label}-french.png` });
        await ctx.close();
      });
    }
  }
});
