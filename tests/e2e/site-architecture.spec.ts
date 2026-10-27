import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page, type Browser } from './helpers/test.js';
import { domInvariantReport } from './helpers/dom-invariant.js';

// The Architecture section (src/routes/(site)/architecture): the landing, the seven chapters (a route that renders whatever chapter files
// exist, 0 or 7), the decision records, the limits, "Nabu and the others". Everything is prerendered; the chapters and the records are Nabu
// documents in read-only mode, server-rendered and hydrated like the docs.
//
// Records and chapters are read from docs/ here too, so a new one is tested without a line. The e2e build (`build:e2e`) also reads TWO FIXTURE
// chapters (tests/fixtures/architecture/chapters, numbers 98 and 99) and a stand-in widget `e2e-probe`, so the chapter route is tested before
// the real chapters are written and next to them.
//
// The editor DOM-invariant fixture is off for the file, as in site-docs.spec.ts (a read-only page with tables and code that scroll sideways);
// the rule that matters on a read-only page (no whitespace between tags) is checked explicitly.
test.use({ domInvariant: false });

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';
const REPO = 'https://github.com/aionbuilders/nabu';
const ARTICLE = '[data-testid="doc-article"]';

// ── the sources, read from the repo ──────────────────────────────────────────────────────────────────────────────────────────

interface Adr { id: string; n: number; slug: string; file: string; path: string; status: 'accepted' | 'superseded' | 'proposed'; by: string | null; date: string; title: string; original: string }
const ADRS: Adr[] = readdirSync(resolve('docs/adr'))
  .filter((f: string) => /^\d{3}-.+\.md$/.test(f))
  .sort()
  .map((f: string) => {
    const raw = readFileSync(resolve('docs/adr', f), 'utf8');
    const status = /^\*\*Status:\*\*\s*(.*)$/m.exec(raw)![1];
    const by = /superseded by ADR\s*0*(\d+)/i.exec(status)?.[1];
    const id = f.slice(0, 3);
    return {
      id, n: Number(id), slug: f.slice(4, -3), file: f, path: `/architecture/decisions/${id}`,
      status: by ? 'superseded' : /^proposed/i.test(status) ? 'proposed' : 'accepted',
      by: by ? by.padStart(3, '0') : null,
      date: /^\*\*Date:\*\*\s*(.*)$/m.exec(raw)![1].trim(),
      title: /^#\s+ADR\s+\d+\s*[—–-]\s*(.*)$/m.exec(raw)![1].trim(),
      original: /^\*\*Original:\*\*\s*\[French\]\(([^)]+)\)/m.exec(raw)![1],
    } as Adr;
  });
const adr = (n: number) => ADRS.find((a) => a.n === n)!;

interface Chapter { n: number; slug: string; file: string; path: string; title: string; description: string; adrs: number[]; xray: string | null }
function chapterFile(dir: string, f: string): Chapter {
  const raw = readFileSync(resolve(dir, f), 'utf8').replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw)![1];
  const get = (k: string) => new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(fm)?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  const adrsInline = /^adrs:[ \t]*\[(.*)\]/m.exec(fm)?.[1];
  const adrsBlock = [...(/^adrs:[ \t]*\n((?:\s+-\s*\d+\n?)+)/m.exec(fm + '\n')?.[1] ?? '').matchAll(/\d+/g)].map((m) => m[0]);
  const slug = f.replace(/^\d+-/, '').replace(/\.md$/, '');
  return {
    n: Number(get('chapter')), slug, file: `${dir}/${f}`, path: `/architecture/chapters/${slug}`, title: get('title')!, description: get('description') ?? '',
    adrs: (adrsInline ? adrsInline.match(/\d+/g) ?? [] : adrsBlock).map(Number), xray: get('xray') ?? null,
  };
}
const dirChapters = (dir: string) => (existsSync(resolve(dir)) ? readdirSync(resolve(dir)).filter((f: string) => f.endsWith('.md')).sort().map((f: string) => chapterFile(dir, f)) : []);
const REAL = dirChapters('docs/architecture/chapters');
const FIXTURES = dirChapters('tests/fixtures/architecture/chapters');
const FIXTURE = FIXTURES.find((c) => c.n === 99)!;
const NO_WIDGET = FIXTURES.find((c) => c.n === 98)!;
const CHAPTERS = [...REAL, ...FIXTURES];

const SECTION_PAGES = ['/architecture', '/architecture/limits', '/architecture/others', '/architecture/decisions'];
const ALL = [...SECTION_PAGES, ...ADRS.map((a) => a.path), ...CHAPTERS.map((c) => c.path)];

const hydrated = async (page: Page) => {
  await page.locator(ARTICLE).first().waitFor();
  await expect(page.locator(`${ARTICLE}:not([data-hydrated])`)).toHaveCount(0);
};
const hasArticle = (path: string) => path.startsWith('/architecture/decisions/') || path.startsWith('/architecture/chapters/');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: net::ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// ── every page ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('every page of the section', () => {
  test.use({ colorScheme: 'dark' });

  test('the sources: records of the three statuses, chapters that honour the contract', () => {
    expect(ADRS.length).toBeGreaterThanOrEqual(17);
    expect(new Set(ADRS.map((a) => a.status))).toEqual(new Set(['accepted', 'superseded', 'proposed']));
    expect(ADRS.some((a) => a.n === 12)).toBe(false);
    for (const c of CHAPTERS) {
      expect(c.title, c.file).toBeTruthy();
      expect(Number.isInteger(c.n), c.file).toBe(true);
    }
    expect(FIXTURE?.xray).toBe('e2e-probe');
  });

  for (const path of ALL) {
    test(`${path} renders: one h1, a title, a description, a canonical, indexable, in the main nav`, async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      if (hasArticle(path)) await hydrated(page);

      const h1 = page.locator('h1');
      await expect(h1).toHaveCount(1);
      expect(norm(await h1.innerText()).length).toBeGreaterThan(3);
      await expect(page).toHaveTitle(/ — Nabu$/);
      const desc = await page.locator('meta[name="description"]').getAttribute('content');
      expect((desc ?? '').length).toBeGreaterThan(20);
      expect(desc).not.toMatch(/^A local-first, modular block editor engine/); // the site default: every page of the section has its own
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://nabu.aion.builders${path}`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
      await expect(page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')).toHaveText('Architecture');
      expect(errors).toEqual([]);
    });
  }

  test('requests nothing from another origin, on every kind of page', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).hostname !== 'localhost') external.push(r.url()); });
    for (const path of ['/architecture', '/architecture/limits', '/architecture/others', '/architecture/decisions/016', FIXTURE.path]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      if (hasArticle(path)) await hydrated(page);
    }
    expect(external).toEqual([]);
  });
});

// ── the landing ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('/architecture', () => {
  test.use({ colorScheme: 'dark' });

  test('the title, the lead and "Should you switch?" with its three yes and three wait', async ({ page }) => {
    await page.goto('/architecture');
    await expect(page).toHaveTitle('Architecture — Nabu');
    await expect(page.locator('h1')).toHaveText(/How Nabu works,\s*and why it works that way\./);
    await expect(page.getByText('Seven short chapters, written by the people who made the choices')).toBeVisible();
    const box = page.getByRole('complementary', { name: 'Should you switch?' });
    await expect(box).toBeVisible();
    await expect(box.locator('.verdict.yes')).toHaveCount(3);
    await expect(box.locator('.verdict.wait')).toHaveCount(3);
    await expect(box.getByText('You cannot ship a beta')).toBeVisible();
    await expect(box.getByRole('link', { name: /The full honest answer/ })).toHaveAttribute('href', '/architecture/limits');
  });

  test('seven chapters: a link for each one that has a file, the fallback title (not linked) for the others', async ({ page }) => {
    await page.goto('/architecture');
    const rows = page.getByRole('region', { name: 'Chapters' }).locator('li');
    await expect(rows).toHaveCount(7);
    for (let n = 1; n <= 7; n++) {
      const row = rows.nth(n - 1);
      await expect(row.locator('.n')).toHaveText(String(n).padStart(2, '0'));
      const real = REAL.find((c) => c.n === n);
      if (real) {
        await expect(row.getByRole('link')).toHaveAttribute('href', real.path);
        await expect(row.locator('.title')).toHaveText(real.title);
        // its records, as ADR 007 · 008
        for (const a of real.adrs) await expect(row.locator('.adrs')).toContainText(String(a).padStart(3, '0'));
      } else {
        await expect(row.getByRole('link')).toHaveCount(0);
        await expect(row.locator('.title')).not.toBeEmpty();
      }
    }
    // the chapter that is the story of a reversed decision reads 016 → 018
    await expect(rows.nth(6).locator('.adrs')).toHaveText('ADR 016 → 018');
    // a fixture chapter (number 98, 99) is not one of the seven
    await expect(page.getByRole('link', { name: FIXTURE.title })).toHaveCount(0);
  });

  test('the two entry cards: the limits, and the records with their count', async ({ page }) => {
    await page.goto('/architecture');
    const cards = page.getByRole('region', { name: 'More' });
    await expect(cards.getByRole('link', { name: /What Nabu doesn't do well/ })).toHaveAttribute('href', '/architecture/limits');
    const records = cards.getByRole('link', { name: /Decision records/ });
    await expect(records).toHaveAttribute('href', '/architecture/decisions');
    const superseded = ADRS.filter((a) => a.status === 'superseded').length;
    await expect(records).toContainText(`${ADRS.length} records, ${superseded} superseded.`);
  });

  test('the header and the footer lead into the section', async ({ page }) => {
    await page.goto('/architecture');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Architecture', exact: true })).toHaveAttribute('aria-current', 'page');
    const footer = page.locator('footer').getByRole('navigation', { name: 'Explore' });
    await expect(footer.getByRole('link', { name: 'Limits', exact: true })).toHaveAttribute('href', '/architecture/limits');
    await expect(footer.getByRole('link', { name: 'Decision records', exact: true })).toHaveAttribute('href', '/architecture/decisions');
  });
});

// ── the decision records ─────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('the decision records', () => {
  test.use({ colorScheme: 'dark' });

  test('every docs/adr/*.md has a page, and the page shows what the file says', async ({ page }) => {
    for (const a of ADRS) {
      await page.goto(a.path);
      await hydrated(page);
      await expect(page.locator('h1'), a.file).toHaveText(a.title);
      const head = page.locator('.record .meta');
      await expect(head, a.file).toContainText(`ADR ${a.id}`);
      await expect(head, a.file).toContainText(a.date);
      if (a.status === 'superseded') await expect(head.locator('.pill'), a.file).toHaveText(`Superseded by ADR ${a.by}`);
      else await expect(head.locator('.pill'), a.file).toHaveText(a.status === 'proposed' ? 'Proposed' : 'Accepted');
      // the French original and the source, on GitHub; the French one is in fr/
      await expect(head.getByRole('link', { name: /French original/ }), a.file).toHaveAttribute('href', `${REPO}/blob/main/docs/adr/${a.original}`);
      expect(a.original).toMatch(/^fr\//);
      await expect(page.getByRole('link', { name: 'View source on GitHub' }), a.file).toHaveAttribute('href', `${REPO}/blob/main/docs/adr/${a.file}`);
      // the body is a read-only Nabu document, and the header block is not repeated in it
      const root = page.locator('[data-nabu-root]');
      await expect(root).toHaveAttribute('contenteditable', 'false');
      await expect(root).toHaveAttribute('data-nabu-readonly', '');
      expect(await root.innerText()).not.toMatch(/Status:\s*Accepted|Original:\s*French/);
      expect(await root.locator('h2').count(), a.file).toBeGreaterThan(0);
    }
  });

  test('statuses: 016 is superseded by 018 and links to it, 018 is accepted, 013 is proposed', async ({ page }) => {
    await page.goto('/architecture/decisions/016');
    await hydrated(page);
    const pill = page.locator('.record .pill');
    await expect(pill).toHaveText('Superseded by ADR 018');
    await expect(pill).toHaveAttribute('href', '/architecture/decisions/018');
    await expect(page.locator('.record .meta')).toContainText(`Accepted ${adr(16).date} · replaced ${adr(18).date}`);
    const note = page.getByTestId('adr-note');
    await expect(note).toContainText('This record is kept as it was written.');
    await expect(note.getByRole('link', { name: 'Read ADR 018' })).toHaveAttribute('href', '/architecture/decisions/018');
    await pill.click();
    await expect(page).toHaveURL(/\/architecture\/decisions\/018$/);
    await expect(page.locator('h1')).toHaveText(adr(18).title);
    await expect(page.locator('.record .pill')).toHaveText('Accepted');
    await expect(page.locator('.record .meta').getByRole('link', { name: 'ADR 016' })).toHaveAttribute('href', '/architecture/decisions/016'); // "Supersedes ADR 016"
    await expect(page.getByTestId('adr-note')).toHaveCount(0);

    await page.goto('/architecture/decisions/013');
    await expect(page.locator('.record .pill')).toHaveText('Proposed');
    await expect(page.getByTestId('adr-note')).toContainText('deferred');
  });

  test('the timeline lists every record with its status, and says why ADR 012 is missing', async ({ page }) => {
    await page.goto('/architecture/decisions/016');
    await hydrated(page);
    const rail = page.getByRole('navigation', { name: 'Decision records' });
    const rows = rail.locator('ol.timeline > li');
    await expect(rows).toHaveCount(ADRS.length);
    for (const a of ADRS) {
      const row = rail.locator(`li a[href="${a.path}"]`);
      await expect(row.locator('.num')).toHaveText(a.id);
      await expect(row.locator('.dot')).toHaveClass(new RegExp(a.status));
    }
    await expect(rail.locator('li a[href="/architecture/decisions/016"]')).toHaveAttribute('aria-current', 'page');
    await expect(rail.locator('li a[href="/architecture/decisions/016"] .tag')).toHaveText('superseded');
    await expect(rail.locator('li a[href="/architecture/decisions/013"] .tag')).toHaveText('proposed');
    const missing = rail.locator('.missing');
    await expect(missing).toContainText('ADR 012 (copy and paste) was never written; its design note is');
    await expect(missing.getByRole('link', { name: 'docs/design/copy-paste.md' })).toHaveAttribute('href', `${REPO}/blob/main/docs/design/copy-paste.md`);
    expect(existsSync(resolve('docs/design/copy-paste.md'))).toBe(true);
  });

  test('the filters: All, Accepted, Superseded, Proposed; the record being read stays', async ({ page }) => {
    await page.goto('/architecture/decisions/001');
    await hydrated(page);
    const rail = page.getByRole('navigation', { name: 'Decision records' });
    const visible = () => rail.locator('ol.timeline > li:not([hidden])').evaluateAll((els) => els.map((e) => e.querySelector('.num')!.textContent));
    const ids = (status: string) => ADRS.filter((a) => a.status === status).map((a) => a.id);

    await expect(rail.getByRole('button', { name: `All ${ADRS.length}` })).toHaveAttribute('aria-pressed', 'true');
    expect(await visible()).toEqual(ADRS.map((a) => a.id));

    await rail.getByRole('button', { name: 'Superseded' }).click();
    expect(await visible()).toEqual([...new Set(['001', ...ids('superseded')])].sort()); // 001 is the page being read
    await rail.getByRole('button', { name: 'Proposed' }).click();
    expect(await visible()).toEqual([...new Set(['001', ...ids('proposed')])].sort());
    await rail.getByRole('button', { name: 'Accepted' }).click();
    expect(await visible()).toEqual(ADRS.filter((a) => a.status === 'accepted').map((a) => a.id));
    await expect(rail.getByRole('button', { name: 'Accepted' })).toHaveAttribute('aria-pressed', 'true');

    // the filter survives going to another record (the rail is not redrawn)
    await rail.locator('li a[href="/architecture/decisions/002"]').click();
    await expect(page).toHaveURL(/decisions\/002$/);
    expect(await visible()).toEqual(ADRS.filter((a) => a.status === 'accepted').map((a) => a.id));

    await rail.getByRole('button', { name: `All ${ADRS.length}` }).click();
    expect(await visible()).toEqual(ADRS.map((a) => a.id));
  });

  test('previous and next follow the numbers: no ADR 012, none before the first, none after the last', async ({ page }) => {
    const first = ADRS[0], last = ADRS[ADRS.length - 1];
    await page.goto(first.path);
    await expect(page.locator('.record .foot [rel="prev"]')).toHaveCount(0);
    await expect(page.locator('.record .foot [rel="next"]')).toHaveAttribute('href', ADRS[1].path);
    await page.goto(last.path);
    await expect(page.locator('.record .foot [rel="next"]')).toHaveCount(0);
    await expect(page.locator('.record .foot [rel="prev"]')).toHaveAttribute('href', ADRS[ADRS.length - 2].path);

    await page.goto('/architecture/decisions/011');
    await expect(page.locator('.record .foot [rel="next"]')).toHaveText('013 →');
    await expect(page.locator('.record .foot [rel="prev"]')).toHaveText('← 010');
    await page.locator('.record .foot [rel="next"]').click();
    await expect(page).toHaveURL(/decisions\/013$/);
    await expect(page.locator('h1')).toHaveText(adr(13).title);
    await page.locator('.record .foot [rel="prev"]').click();
    await expect(page).toHaveURL(/decisions\/011$/);
  });

  test('/architecture/decisions lists them all', async ({ page }) => {
    await page.goto('/architecture/decisions');
    await expect(page.locator('h1')).toHaveText('Decision records');
    const list = page.locator('.index .list li');
    await expect(list).toHaveCount(ADRS.length);
    for (const a of ADRS) await expect(page.locator(`.index .list a[href="${a.path}"]`)).toContainText(a.date);
    await expect(page.locator(`.index .list a[href="/architecture/decisions/016"] .status`)).toHaveText('superseded by 018');
    await expect(page.getByRole('navigation', { name: 'Decision records' })).toBeVisible();
  });

  test('links inside a record stay on the site or go to GitHub', async ({ page }) => {
    // every relative link of every record was rewritten: nothing points at a path of the page itself
    for (const a of ADRS) {
      await page.goto(a.path);
      await hydrated(page);
      const hrefs = await page.locator('[data-nabu-root] a.nabu-link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      for (const h of hrefs) expect(h, `${a.file}: ${h}`).toMatch(/^(https?:\/\/|\/|#)/);
    }
  });
});

// ── the chapters ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('the chapter route', () => {
  test.use({ colorScheme: 'dark' });

  test('the fixture: label, title, lead, the widget right after the first paragraph, the body, the callouts', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(FIXTURE.path);
    await hydrated(page);
    await expect(page).toHaveTitle(`${FIXTURE.title} — Architecture — Nabu`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', FIXTURE.description);
    await expect(page.locator('.chapter .eyebrow')).toHaveText('CHAPTER 99');
    await expect(page.locator('h1')).toHaveText(FIXTURE.title);
    // the H1 of the markdown is not drawn twice
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.arch-lead [data-nabu-root] p, .arch-lead [data-block-type="paragraph"]')).toHaveCount(1);
    await expect(page.locator('.arch-lead')).toContainText('This is the first paragraph, the lead of the chapter');

    // the widget slot: after the lead, before the body, once
    const widget = page.getByTestId('chapter-widget');
    await expect(widget).toHaveCount(1);
    await expect(widget).toHaveAttribute('data-xray', 'e2e-probe');
    await expect(widget.getByTestId('e2e-probe')).toBeVisible();
    const order = await page.evaluate(() => {
      const pos = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
      return [pos('.arch-lead'), pos('[data-testid="chapter-widget"]'), pos('.arch-body')];
    });
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    await expect(page.locator('.arch-body h2')).toHaveText(['A first section', 'A second section']);
    await expect(page.locator('.arch-body .cb')).toHaveCount(1);

    // "what it buys us" and "what it costs us", side by side, labelled
    const label = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el, '::before').content);
    expect(await label('.arch-body .nabu-callout.callout-tip')).toBe('"WHAT IT BUYS US"');
    expect(await label('.arch-body .nabu-callout.callout-warning')).toBe('"WHAT IT COSTS US"');
    const [tip, warn] = await Promise.all(['.callout-tip', '.callout-warning'].map((s) => page.locator(`.arch-body .nabu-callout${s}`).boundingBox()));
    expect(Math.abs(tip!.y - warn!.y)).toBeLessThan(2);
    expect(warn!.x).toBeGreaterThan(tip!.x + tip!.width - 1);
    expect(errors).toEqual([]);
  });

  test('the callout labels belong to the chapters only: a callout in a record or the docs is untouched', async ({ page }) => {
    await page.goto('/docs/guides/regions');
    await hydrated(page);
    const callouts = page.locator('.nabu-callout');
    if (await callouts.count()) expect(await callouts.first().evaluate((el) => getComputedStyle(el, '::before').content)).toMatch(/^(none|normal)$/);
  });

  test('the records behind the chapter are chips that link to the records; a record that does not exist is not a link', async ({ page }) => {
    await page.goto(FIXTURE.path);
    const foot = page.locator('.chapter .foot');
    await expect(foot.getByText('Decisions behind this chapter')).toBeVisible();
    await expect(foot.getByRole('link', { name: /^ADR 007 · Event ascension$/ })).toHaveAttribute('href', '/architecture/decisions/007');
    await expect(foot.getByRole('link', { name: /^ADR 016 · Regions as markers$/ })).toHaveAttribute('href', '/architecture/decisions/016');
    await expect(foot.locator('span.chip', { hasText: 'ADR 012' })).toBeVisible(); // there is no ADR 012
    await expect(foot.getByRole('link', { name: /ADR 012/ })).toHaveCount(0);
    await foot.getByRole('link', { name: /ADR 007/ }).click();
    await expect(page).toHaveURL(/decisions\/007$/);
    await expect(page.locator('h1')).toHaveText(adr(7).title);
  });

  test('links inside the text: a record is its page, any other repo file is on GitHub, a route is left alone', async ({ page }) => {
    await page.goto(FIXTURE.path);
    await hydrated(page);
    const link = (name: string) => page.locator('[data-nabu-root] a.nabu-link', { hasText: name });
    await expect(link('ADR 007')).toHaveAttribute('href', '/architecture/decisions/007');
    await expect(link('ADR 016')).toHaveAttribute('href', '/architecture/decisions/016#1-context');
    await expect(link('design note')).toHaveAttribute('href', `${REPO}/blob/main/docs/design/copy-paste.md`);
    await expect(link('link to the limits')).toHaveAttribute('href', '/architecture/limits');
    await expect(link('ADR 007')).not.toHaveAttribute('target', /.+/); // stays in the tab
  });

  test('no widget when the xray id is not registered, and no widget when there is none', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(NO_WIDGET.path);
    await hydrated(page);
    await expect(page.locator('h1')).toHaveText(NO_WIDGET.title);
    await expect(page.getByTestId('chapter-widget')).toHaveCount(0);
    await expect(page.locator('.arch-lead')).toContainText('Only a lead paragraph');
    await expect(page.locator('.arch-body li')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('the rail is the story: chapters 01 to 07, then the limits and the records; next leads on', async ({ page }) => {
    await page.goto(FIXTURE.path);
    const rail = page.getByRole('navigation', { name: 'The story' });
    const items = rail.locator('ol > li');
    await expect(items).toHaveCount(7);
    for (let n = 1; n <= 7; n++) {
      await expect(items.nth(n - 1).locator('.num')).toHaveText(String(n).padStart(2, '0'));
      const real = REAL.find((c) => c.n === n);
      if (real) await expect(items.nth(n - 1).getByRole('link')).toHaveAttribute('href', real.path);
      else await expect(items.nth(n - 1).getByRole('link')).toHaveCount(0);
    }
    await expect(rail.getByRole('link', { name: 'The limits' })).toHaveAttribute('href', '/architecture/limits');
    await expect(rail.getByRole('link', { name: 'Decision records' })).toHaveAttribute('href', '/architecture/decisions');
    // after the last chapter that exists, the limits
    await expect(page.locator('.chapter .foot [rel="next"]')).toHaveAttribute('href', '/architecture/limits');
    await expect(page.locator('.chapter .foot [rel="next"]')).toContainText('The limits');
  });

  for (const c of REAL) {
    test(`chapter ${c.n} (${c.slug}): the contract holds on the page`, async ({ page }) => {
      await page.goto(c.path);
      await hydrated(page);
      await expect(page.locator('.chapter .eyebrow')).toHaveText(`CHAPTER ${String(c.n).padStart(2, '0')}`);
      await expect(page.locator('h1')).toHaveText(c.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', c.description);
      await expect(page.getByRole('navigation', { name: 'The story' }).locator('a[aria-current="page"]')).toContainText(c.title);
      for (const n of c.adrs) {
        const id = String(n).padStart(3, '0');
        expect(ADRS.some((a) => a.n === n), `ADR ${n} exists`).toBe(true);
        await expect(page.locator('.chapter .foot').locator(`a.chip[href="/architecture/decisions/${id}"]`)).toHaveCount(1);
      }
      // the widget of the chapter, when it has an id and the registry has it, sits after the first paragraph
      const widget = page.getByTestId('chapter-widget');
      if (await widget.count()) {
        await expect(widget).toHaveAttribute('data-xray', c.xray ?? '');
        const [a, b] = await page.evaluate(() => [document.querySelector('.arch-lead')!.getBoundingClientRect().bottom, document.querySelector('[data-testid="chapter-widget"]')!.getBoundingClientRect().top]);
        expect(b).toBeGreaterThanOrEqual(a - 1);
      }
      // "what it buys us" / "what it costs us" are TIP and WARNING callouts
      for (const v of ['tip', 'warning']) expect(await page.locator(`.arch-body .nabu-callout.callout-${v}`).count(), `${c.file}: a ${v} callout`).toBeLessThanOrEqual(1);
    });
  }
});

// ── the limits ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('/architecture/limits', () => {
  test.use({ colorScheme: 'dark' });

  test('eight limits, each with a status, an honest description, a number and a source on GitHub', async ({ page }) => {
    await page.goto('/architecture/limits');
    await expect(page.locator('h1')).toHaveText(/What Nabu doesn.t do well \(yet\)/);
    await expect(page.getByText('Updated 2026-10-27')).toBeVisible();
    await expect(page.getByRole('link', { name: /^0\.1\.0/ })).toHaveAttribute('href', '/changelog');
    const limits = page.getByTestId('limit');
    await expect(limits).toHaveCount(8);
    const expected: Record<string, [string, string]> = {
      'Typing in huge documents': ['known · being fixed', '88 ms'],
      'Mobile keyboards': ['known · planned', '—'],
      'Firefox and Safari': ['known · planned', '1 / 3'],
      'Real-time collaboration': ['by design, not yet', 'tabs'],
      Tables: ['planned', '0'],
      'Browser extensions (Grammarly…)': ['known · untested', '—'],
      'Bundle weight': ['by design', '1.2 MB'],
      Setup: ['by design', '1 plugin'],
    };
    for (const [title, [status, value]] of Object.entries(expected)) {
      const item = limits.filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });
      await expect(item, title).toHaveCount(1);
      await expect(item.locator('.status')).toHaveText(status);
      await expect(item.locator('.value')).toHaveText(value);
      await expect(item.locator('.body p')).not.toBeEmpty();
      await expect(item.locator('.source')).toHaveAttribute('href', /^https:\/\/github\.com\/aionbuilders\/nabu\/blob\/main\/[^\s]+$/);
    }
    // the number that is being worked on says when it was true
    const typing = limits.filter({ hasText: 'Typing in huge documents' });
    await expect(typing.locator('.unit')).toContainText('at the time of writing');
    await expect(typing.locator('.source')).toHaveAttribute('href', `${REPO}/blob/main/tests/e2e/perf/lab-numbers.perf.ts`);
  });

  test('the statuses have their colours: coral, amber, blue', async ({ page }) => {
    await page.goto('/architecture/limits');
    const color = (text: string) => page.locator('.status', { hasText: new RegExp(`^${text}$`) }).first().evaluate((el) => getComputedStyle(el).color);
    const [fix, plan, design] = [await color('known · being fixed'), await color('known · planned'), await color('by design, not yet')];
    expect(new Set([fix, plan, design]).size).toBe(3);
    expect(fix).toBe('rgb(255, 111, 97)');
    expect(design).toBe('rgb(122, 162, 247)');
  });
});

// ── nabu and the others ──────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('/architecture/others', () => {
  test.use({ colorScheme: 'dark' });

  test('the five options, the two lists, "so, which one?" and "how we checked"', async ({ page }) => {
    await page.goto('/architecture/others');
    await expect(page.locator('h1')).toHaveText('Nabu and the others');
    await expect(page.getByTestId('option')).toHaveCount(5);
    await expect(page.getByTestId('option').locator('h3')).toHaveText(['Tiptap', 'ProseKit', 'svelte-lexical', 'Svedit', 'Nabu']);
    await expect(page.getByRole('region', { name: 'Where Nabu is different' }).locator('li')).toHaveCount(5);
    await expect(page.getByRole('region', { name: 'Where the others are clearly ahead' }).locator('li')).toHaveCount(6);
    const which = page.getByRole('region', { name: 'So, which one?' });
    await expect(which.locator('li')).toHaveCount(3);
    await expect(which.getByRole('link', { name: /What Nabu doesn.t do well/ })).toHaveAttribute('href', '/architecture/limits');
    const checked = page.getByRole('complementary', { name: 'HOW WE CHECKED' });
    await expect(checked).toContainText('Checked on 2026-10-27');
    await expect(checked).toContainText('We ran no benchmark against them, so we claim no speed.');
    await expect(checked.getByRole('link', { name: /Open an issue/ })).toHaveAttribute('href', `${REPO}/issues/new`);
    await expect(checked.getByRole('link', { name: 'the repository' })).toHaveAttribute('href', `${REPO}/blob/main/docs/architecture/sources/comparison-2026-10-27.md`);
    // a deep Nabu vs Svedit comparison is coming: its link is hidden until it exists
    await expect(page.getByRole('link', { name: /Nabu vs Svedit in depth/ })).toHaveCount(0);
  });

  test('no price anywhere on the page', async ({ page }) => {
    await page.goto('/architecture/others');
    expect(await page.locator('main').innerText()).not.toMatch(/[$€£]\s?\d|\d\s?(USD|EUR)|per month|\/month/i);
  });

  test('side by side: six editors, "All 10 editors" opens the rest; every cell is a link to its source or marked unverified', async ({ page }) => {
    await page.goto('/architecture/others');
    const table = page.locator('table#compare');
    const heads = () => table.locator('thead th:visible').allInnerTexts();
    expect(await heads()).toEqual(['ProseMirror', 'Tiptap', 'Lexical', 'BlockNote', 'Svedit', 'Nabu']);
    await expect(table.locator('tbody th')).toHaveText(['Svelte', 'Contenteditable', 'Collaboration', 'Offline storage', 'Tables', 'Mobile', 'Licence', 'Version']);
    const toggle = page.locator('button[aria-controls="compare"]');
    await expect(toggle).toHaveText(/All 10 editors/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await heads()).toEqual(['ProseMirror', 'Tiptap', 'Lexical', 'Slate / Plate', 'BlockNote', 'Editor.js', 'Quill', 'Milkdown', 'Svedit', 'Nabu']);

    // the whole table (all ten columns are in the markup)
    const cells = await table.locator('tbody td').evaluateAll((tds) =>
      tds.map((td) => {
        const a = td.querySelector('a');
        const u = td.querySelector('.unverified');
        return { text: td.textContent!.trim(), href: a?.getAttribute('href') ?? null, unverified: !!u, title: (u ?? a)?.getAttribute('title') ?? '', id: `${td.getAttribute('data-row')}/${td.getAttribute('data-editor')}` };
      }),
    );
    expect(cells).toHaveLength(80);
    for (const c of cells) {
      expect(c.text, c.id).not.toBe('');
      if (c.unverified) expect(c.title, c.id).toMatch(/^unverified/);
      if (!c.unverified) expect(c.href, `${c.id} "${c.text}" needs a source`).toMatch(/^https?:\/\/[^\s]+$/);
      if (c.href) expect(c.href, c.id).toMatch(/^https?:\/\//);
    }
    // a cell with no URL has no link; the others have one
    expect(cells.some((c) => c.unverified && !c.href)).toBe(true);
    for (const c of cells.filter((x) => x.unverified && !x.href)) expect(c.title).toMatch(/^unverified: .{6,}/);
    // the Nabu column cites the repo
    for (const c of cells.filter((x) => x.id.endsWith('/nabu'))) expect(c.href, c.id).toMatch(/^https:\/\/github\.com\/aionbuilders\/nabu\/blob\/main\//);

    await toggle.click();
    expect(await heads()).toHaveLength(6);
  });

  test('the cards cite their sources too', async ({ page }) => {
    await page.goto('/architecture/others');
    const cards = page.getByTestId('option');
    for (let i = 0; i < 5; i++) {
      const links = await cards.nth(i).locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      expect(links.length).toBeGreaterThanOrEqual(3); // the name, the engine, the collaboration
      for (const h of links) expect(h).toMatch(/^https?:\/\//);
    }
  });
});

// ── server render, hydration, layout shift ───────────────────────────────────────────────────────────────────────────────────

test.describe('server render, hydration and layout shift', () => {
  test.use({ colorScheme: 'light' });
  const SAMPLE = ['/architecture/decisions/016', '/architecture/decisions/008', FIXTURE.path];

  const boxes = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('main :is(h1, h2, h3, .cb, .doc-table, .nabu-callout, [data-block-type="paragraph"], [data-block-type="list-item"], [data-testid="chapter-widget"], .record .meta, .note)')].map((el) => {
        const r = el.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 10) / 10;
        return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} ${round(r.x + scrollX)},${round(r.y + scrollY)} ${round(r.width)}x${round(r.height)}`;
      }),
    );

  async function context(browser: Browser, javaScriptEnabled: boolean, fonts: boolean) {
    const ctx = await browser.newContext({ javaScriptEnabled, colorScheme: 'light', viewport: { width: 1280, height: 800 } });
    if (!fonts) await ctx.route(/\.woff2?$/, (route) => route.abort());
    return ctx;
  }

  for (const path of SAMPLE) {
    test(`${path}: every block is where the server put it once hydrated (JavaScript off vs on, zero shift)`, async ({ browser }) => {
      for (const fonts of [false, true]) {
        const off = await context(browser, false, fonts);
        const offPage = await off.newPage();
        await offPage.goto(path);
        if (fonts) await offPage.evaluate(() => document.fonts.ready);
        const before = await boxes(offPage);
        await off.close();

        const on = await context(browser, true, fonts);
        const onPage = await on.newPage();
        await onPage.goto(path);
        await hydrated(onPage);
        await onPage.evaluate(() => document.fonts.ready);
        const after = await boxes(onPage);
        await on.close();

        expect(before.length).toBeGreaterThan(5);
        expect(after, `fonts ${fonts ? 'loaded' : 'blocked'}`).toEqual(before);
      }
    });

    test(`${path}: hydration adopts the server markup (no node replaced) and shifts nothing`, async ({ browser }) => {
      const ctx = await context(browser, true, false);
      const page = await ctx.newPage();
      const errors = watchErrors(page);
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
      await page.goto(path);
      await hydrated(page);
      await page.waitForTimeout(400);
      const stats = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[data-nabu-root], [data-nabu-root] *')];
        return { tagged: (window as any).__tagged, now: els.length, notFromServer: els.filter((e) => !(e as any).__ssr).length, shift: (window as any).__shift };
      });
      expect(stats.tagged).toBeGreaterThan(20);
      expect(stats.notFromServer).toBe(0);
      expect(stats.now).toBe(stats.tagged);
      expect(stats.shift).toBe(0);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test('the markup of a record and of a chapter has no whitespace between tags', async ({ page }) => {
    for (const path of ['/architecture/decisions/016', '/architecture/decisions/014', FIXTURE.path]) {
      await page.goto(path);
      await hydrated(page);
      const report = (await domInvariantReport(page))!;
      expect(report.whitespace.filter((w) => !/ in div\.doc-table > table\.nabu-table > tbody > tr > t[dh]\./.test(w)), path).toEqual([]);
      expect(report.phantoms.filter((p) => /outside the own element of every block|directly in the container/.test(p)), path).toEqual([]);
    }
  });
});

// ── responsive and themes ────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('responsive and themes', () => {
  test('375px: no horizontal scroll on any page; the comparison table scrolls inside its own scroller', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ALL) {
      await page.goto(path);
      expect(await noHorizontalScroll(page), path).toBe(true);
      expect(
        await page.evaluate(() => [...document.querySelectorAll('.cb, .doc-table, .nabu-editor h1, .nabu-editor h2, .nabu-callout, .limit, .option, .row')].filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5).length),
        `${path}: a block sticks out`,
      ).toBe(0);
    }
    await page.goto('/architecture/others');
    await page.getByRole('button', { name: /All 10 editors/ }).click();
    expect(await noHorizontalScroll(page)).toBe(true);
    const scroller = page.getByRole('region', { name: /Side-by-side comparison/ });
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 100)).toBe(true);
    expect(await scroller.evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 0.5)).toBe(true);
    await scroller.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });

  test('375px: the rail folds behind a button on a record and on a chapter', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/architecture/decisions/016');
    await hydrated(page);
    const rail = page.getByRole('navigation', { name: 'Decision records' });
    await expect(rail).toBeHidden();
    await page.getByRole('button', { name: 'Browse the records' }).click();
    await expect(rail).toBeVisible();
    await rail.locator('li a[href="/architecture/decisions/015"]').click();
    await expect(page).toHaveURL(/decisions\/015$/);
    await expect(page.getByRole('navigation', { name: 'Decision records' })).toBeHidden();

    await page.goto(FIXTURE.path);
    await hydrated(page);
    await expect(page.getByRole('navigation', { name: 'The story' })).toBeHidden();
    await page.getByRole('button', { name: 'Browse the story' }).click();
    await expect(page.getByRole('navigation', { name: 'The story' })).toBeVisible();
    // the two callouts stack on a phone
    const [tip, warn] = await Promise.all(['.callout-tip', '.callout-warning'].map((s) => page.locator(`.arch-body .nabu-callout${s}`).boundingBox()));
    expect(warn!.y).toBeGreaterThan(tip!.y + tip!.height - 1);
  });

  for (const scheme of ['dark', 'light'] as const) {
    test(`${scheme}: the tokens of the section and the colours of the statuses`, async ({ browser }) => {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('/architecture');
      const ok = await page.locator('.verdict.yes').first().evaluate((el) => getComputedStyle(el).color);
      const wait = await page.locator('.verdict.wait').first().evaluate((el) => getComputedStyle(el).color);
      expect(ok).toBe(scheme === 'dark' ? 'rgb(126, 231, 135)' : 'rgb(26, 127, 55)');
      expect(wait).toBe(scheme === 'dark' ? 'rgb(255, 111, 97)' : 'rgb(194, 56, 31)');
      expect(await page.locator('.site').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(scheme === 'dark' ? 'rgb(11, 11, 12)' : 'rgb(250, 250, 248)');

      await page.goto('/architecture/limits');
      const amber = await page.locator('.status.plan').first().evaluate((el) => getComputedStyle(el).color);
      expect(amber).toBe(scheme === 'dark' ? 'rgb(227, 179, 65)' : 'rgb(138, 97, 0)');

      await page.goto(FIXTURE.path);
      await hydrated(page);
      const buys = await page.locator('.arch-body .nabu-callout.callout-tip').evaluate((el) => getComputedStyle(el, '::before').color);
      expect(buys).toBe(scheme === 'dark' ? 'rgb(126, 231, 135)' : 'rgb(26, 127, 55)');
      await ctx.close();
    });
  }
});

// ── screenshots ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('screenshots of the section', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  const pages = [
    ['landing', '/architecture'],
    ['adr', '/architecture/decisions/016'],
    ['limits', '/architecture/limits'],
    ['others', '/architecture/others'],
    ['chapter', FIXTURE.path],
    ['records', '/architecture/decisions'],
  ] as const;
  for (const [scheme, width, height] of [['dark', 1440, 900], ['light', 1440, 900], ['dark', 375, 812], ['light', 375, 812]] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width, height } });
    const page = await ctx.newPage();
    for (const [name, path] of pages) {
      await page.goto(path);
      if (hasArticle(path)) await hydrated(page);
      await page.evaluate(() => document.fonts.ready);
      if (name === 'others') await page.getByRole('button', { name: /All 10 editors/ }).click();
      await page.screenshot({ path: `${SHOTS}/arch-${name}-${width}-${scheme}.png`, fullPage: name !== 'adr' });
    }
    await ctx.close();
  }
});
