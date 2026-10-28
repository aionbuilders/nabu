import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page, type Browser } from './helpers/test.js';
import { domInvariantReport } from './helpers/dom-invariant.js';

// The documentation (src/routes/(site)/docs, /changelog): every page is a Nabu document in READ-ONLY mode, built from the repo's Markdown at
// build time, server-rendered and hydrated. Pages and their frontmatter are read from docs/ here too, so a new page is tested without a line.
//
// The editor DOM invariant fixture is turned off for the file: a docs page is full of code blocks and tables that scroll sideways inside
// their own box, and the text they hide beyond their edge is what the "phantom selection" rule flags. The rule that matters on a read-only
// page (no whitespace between tags) is checked explicitly, for every page, in "the markup has no whitespace between tags".
test.use({ domInvariant: false });

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';
const SECTION_ORDER = ['getting-started', 'guides', 'recipes'];
const ARTICLE = '[data-testid="doc-article"]';
const ROOT = '[data-nabu-root]';

interface Doc { section: string; slug: string; path: string; title: string; description: string; order: number; file: string }

function frontmatter(raw: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(raw.replace(/\r\n/g, '\n'));
  const data: Record<string, string> = {};
  for (const line of m?.[1].split('\n') ?? []) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return data;
}

const DOCS: Doc[] = SECTION_ORDER.flatMap((section) =>
  readdirSync(resolve('docs', section))
    .filter((f: string) => f.endsWith('.md'))
    .map((f: string) => {
      const file = `docs/${section}/${f}`;
      const fm = frontmatter(readFileSync(resolve(file), 'utf8'));
      const slug = f.replace(/\.md$/, '');
      return { section, slug, path: `/docs/${section}/${slug}`, title: fm.title, description: fm.description, order: Number(fm.order), file };
    })
    .sort((a: Doc, b: Doc) => a.order - b.order || a.title.localeCompare(b.title)),
);
// The pages that are NOT markdown (src/site/docs/content.js, CUSTOM_PAGES: a Svelte page of its own) sit in the sidebar and in previous / next at their place.
// Their own page is tested in site-tour.spec.ts.
const TOUR = { section: 'getting-started', slug: 'tour-of-the-blocks', path: '/docs/getting-started/tour-of-the-blocks', title: 'Tour of the blocks', description: '', order: 3, file: '' };
const NAV_DOCS: Doc[] = SECTION_ORDER.flatMap((section) =>
  [...DOCS.filter((d) => d.section === section), ...(section === TOUR.section ? [TOUR] : [])].sort((a: Doc, b: Doc) => a.order - b.order || a.title.localeCompare(b.title)),
);
const ALL = [...DOCS.map((d) => d.path), '/changelog'];
const REPO = 'https://github.com/aionbuilders/nabu';

/** The article has been hydrated: the page is interactive (DocBody.svelte sets the attribute once the server markup was adopted; the tour page sets its own). */
const hydrated = (page: Page) => page.locator(`${ARTICLE}[data-hydrated], [data-testid="tour-page"][data-hydrated]`).waitFor();

/** Console errors and uncaught exceptions of a page (a hydration failure shows up as one). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  // (a blocked font is a failed request on purpose, see the layout shift tests)
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: net::ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('the documentation pages', () => {
  test.use({ colorScheme: 'dark' });

  test('the sources are the three published folders, and nothing else of docs/', () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(14);
    for (const d of DOCS) {
      expect(d.title, d.file).toBeTruthy();
      expect(d.description, d.file).toBeTruthy();
      expect(Number.isFinite(d.order), d.file).toBe(true);
    }
  });

  for (const d of DOCS) {
    test(`${d.path} renders: an h1, a table of contents, a read-only document`, async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(d.path);
      expect(res?.status()).toBe(200);
      await hydrated(page);

      // the title and the description come from the frontmatter
      await expect(page).toHaveTitle(`${d.title} · Docs · Nabu`);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', d.description);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', d.description);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');

      // one h1, the first block of the document, with text (`h1` the element: the seam of a region is announced as a level 1 heading too, and the
      // Blocks reference has live regions in it)
      const h1 = page.locator('h1');
      await expect(h1).toHaveCount(1);
      expect(norm(await h1.innerText()).length).toBeGreaterThan(2);
      expect(await h1.evaluate((el) => !!el.closest('[data-nabu-root]'))).toBe(true);

      // the root is the read-only document
      const root = page.locator(ROOT);
      await expect(root).toHaveCount(1);
      await expect(root).toHaveAttribute('contenteditable', 'false');
      await expect(root).toHaveAttribute('role', 'document');
      await expect(root).toHaveAttribute('data-nabu-readonly', '');
      await expect(root).toHaveAttribute('aria-label', d.title);

      // "On this page": non-empty, anchors that exist and are unique
      const toc = page.getByRole('navigation', { name: 'On this page' });
      const links = toc.getByRole('link');
      expect(await links.count()).toBeGreaterThan(0);
      const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) {
        expect(href).toMatch(/^#[^\s]+$/);
        await expect(page.locator(`${ROOT} [id="${href.slice(1)}"]`)).toHaveCount(1);
      }

      // where the source lives, and where the page sits
      await expect(page.getByRole('link', { name: /Edit this page on GitHub/ })).toHaveAttribute('href', `${REPO}/edit/main/${d.file}`);
      await expect(page.getByRole('navigation', { name: 'Documentation' }).locator('a[aria-current="page"]')).toHaveText(d.title);
      await expect(page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')).toHaveText('Docs');

      expect(errors).toEqual([]);
    });
  }

  test('/docs lists every page under its section', async ({ page }) => {
    const res = await page.goto('/docs');
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle('Docs · Nabu');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Docs');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    for (const [id, title] of [['getting-started', 'Getting started'], ['guides', 'Guides'], ['recipes', 'Recipes']]) {
      await expect(page.locator(`section[aria-labelledby="${id}"]`).getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    for (const d of DOCS) {
      await expect(page.locator(`section[aria-labelledby="${d.section}"]`).getByRole('link', { name: d.title, exact: true })).toHaveAttribute('href', d.path);
    }
    await expect(page.getByRole('navigation', { name: 'On this page' }).getByRole('link')).toHaveCount(3);
    // the header and the footer point at real pages
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')).toHaveText('Docs');
    await expect(page.locator('footer').getByRole('link', { name: 'Getting started', exact: true })).toHaveAttribute('href', DOCS[0].path);
  });

  test('/changelog is rendered the same way, from CHANGELOG.md', async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto('/changelog');
    expect(res?.status()).toBe(200);
    await hydrated(page);
    await expect(page).toHaveTitle('Changelog · Nabu');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Changelog');
    const root = page.locator(ROOT);
    await expect(root).toHaveAttribute('contenteditable', 'false');
    await expect(root).toHaveAttribute('role', 'document');
    await expect(page.getByRole('heading', { level: 2, name: 'Unreleased' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: '0.1.0-beta.0' })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')).toHaveText('Changelog');
    expect(await page.getByRole('navigation', { name: 'On this page' }).getByRole('link').count()).toBeGreaterThan(10);
    await expect(page.getByRole('link', { name: /Edit this page on GitHub/ })).toHaveAttribute('href', `${REPO}/edit/main/CHANGELOG.md`);
    // the releases of the left column jump to their heading
    await page.getByRole('navigation', { name: 'Releases' }).getByRole('link', { name: '0.1.0-beta.0', exact: true }).click();
    await expect(page).toHaveURL(/#010-beta0$/);
    await expect(page.locator('[id="010-beta0"]')).toBeInViewport();
    expect(errors).toEqual([]);
  });

  test('the text is in the HTML sent by the server (search engines, no JavaScript): headings, tables, code', async ({ request, browser }) => {
    const d = DOCS.find((x) => x.slug === 'installation')!;
    const html = await (await request.get(d.path)).text();
    for (const needle of ['<h1 id="installation"', '<h2 id="requirements"', '<table', 'peerDependencies.svelte', 'Why esnext?']) expect(html).toContain(needle);
    expect(html).toContain('<meta name="description" content="Install Nabu');

    // and a browser without JavaScript reads it all
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(d.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Installation');
    await expect(page.getByRole('heading', { level: 2, name: 'Troubleshooting' })).toBeVisible();
    await expect(page.locator('table')).toHaveCount(2);
    await expect(page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Vite setup' })).toHaveAttribute('href', '#vite-setup');
    await expect(page.locator('pre.nabu-code').first()).toContainText('npm install @aionbuilders/nabu');
    await ctx.close();
  });
});

test.describe('read-only: nothing to type into, text to select and copy', () => {
  test.use({ colorScheme: 'dark' });

  test('typing, deleting, undoing, pasting and dropping change nothing', async ({ page }) => {
    await page.goto('/docs/guides/regions');
    await hydrated(page);
    const root = page.locator(ROOT);
    expect(await root.evaluate((el) => (el as HTMLElement).isContentEditable)).toBe(false);
    // (a click puts the selection classes `selected first last` on the block: that is view state, not content)
    const snapshot = () => root.evaluate((el) => el.innerHTML.replace(/ (selected|first|last)\b/g, ''));
    const before = await snapshot();

    const paragraph = root.locator('[data-block-type="paragraph"]').first();
    await paragraph.click();
    await page.keyboard.type('hello world');
    for (const key of ['Backspace', 'Delete', 'Enter', 'Tab', 'Control+b', 'Control+z', 'Control+y', 'Control+Shift+z']) await page.keyboard.press(key);
    await page.evaluate(() => {
      const target = document.querySelector('[data-nabu-root] [data-block-type="paragraph"]')!;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'pasted text');
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true }));
      const drop = new DataTransfer();
      drop.setData('text/plain', 'dropped');
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: drop, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(150);

    expect(await snapshot()).toBe(before);
    await expect(root).toHaveAttribute('contenteditable', 'false');
    expect(await root.locator('[data-block-type="paragraph"]').first().innerText()).not.toContain('hello world');
    // no editing UI: no toolbar, no slash menu, no drag handle
    await expect(page.locator('.nabu-toolbar, .nabu-slash, .nabu-drag-handle')).toHaveCount(0);
  });

  test('text can be selected and copied: a paragraph, a word of a heading, a stretch across blocks', async ({ page }) => {
    await page.goto('/docs/guides/regions');
    await hydrated(page);
    const root = page.locator(ROOT);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

    // a whole paragraph (triple click)
    const paragraph = root.locator('[data-block-type="paragraph"]').nth(1);
    await paragraph.click({ clickCount: 3 });
    expect(await page.evaluate(() => getSelection()!.toString().length)).toBeGreaterThan(20);
    await page.keyboard.press('Control+c');
    expect(norm(await clipboard())).toBe(norm(await paragraph.innerText()));

    // a word (double click)
    const heading = root.locator('h2[data-block-type="heading"]').first();
    await heading.dblclick({ position: { x: 20, y: 10 } });
    const word = (await page.evaluate(() => getSelection()!.toString())).trim();
    expect(word.length).toBeGreaterThan(1);
    await page.keyboard.press('Control+c');
    expect((await clipboard()).trim()).toBe(word);

    // from one block to another (a real range, as a drag would make)
    await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('[data-nabu-root] [data-block-type="paragraph"]')];
      const texts = (el: Element) => { const out: Node[] = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n); return out; };
      const first = texts(blocks[0])[0], last = texts(blocks[2]).at(-1)!;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.textContent!.length);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.keyboard.press('Control+c');
    const copied = norm((await clipboard()).replace(/[*`_]/g, '')); // (a stretch across blocks is copied as Markdown)
    const [first, third] = await Promise.all([root.locator('[data-block-type="paragraph"]').nth(0).innerText(), root.locator('[data-block-type="paragraph"]').nth(2).innerText()]);
    expect(copied).toContain(norm(first).slice(0, 40).replace(/[*`_]/g, ''));
    expect(copied).toContain(norm(third).slice(-40).replace(/[*`_]/g, ''));

    // the page is untouched by all this
    await expect(root).toHaveAttribute('contenteditable', 'false');
  });

  test('a table cell and a code block can be copied too; the Copy button copies the code', async ({ page }) => {
    await page.goto('/docs/getting-started/installation');
    await hydrated(page);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

    const cell = page.locator(`${ROOT} td`).first();
    await cell.click({ clickCount: 3 });
    await page.keyboard.press('Control+c');
    expect(norm(await clipboard())).toBe(norm(await cell.innerText()));

    const code = page.locator(`${ROOT} pre.nabu-code`).first();
    const text = await code.evaluate((el) => el.textContent!);
    await code.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('code')!);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.keyboard.press('Control+c');
    expect(await clipboard()).toBe(text);

    // the header of a code block is chrome: not selectable, not part of a selection
    await page.evaluate(() => navigator.clipboard.writeText(''));
    const block = page.locator(`${ROOT} .cb`).first();
    await block.getByRole('button', { name: 'Copy code' }).click();
    await expect(block.getByRole('button')).toHaveText('Copied');
    expect(await clipboard()).toBe(text);
  });
});

test.describe('navigation', () => {
  test.use({ colorScheme: 'dark' });

  test('the sidebar lists the pages in order, and every link works', async ({ page }) => {
    await page.goto(DOCS[0].path);
    await hydrated(page);
    const side = page.getByRole('navigation', { name: 'Documentation' });
    expect(await side.locator('a[href^="/docs/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))).toEqual(NAV_DOCS.map((d) => d.path));
    // grouped under its three sections
    await expect(side.locator('.label')).toHaveText(['Getting started', 'Guides', 'Recipes']);

    for (const d of [DOCS.find((x) => x.slug === 'regions')!, DOCS.find((x) => x.slug === 'word-count-with-regions')!, DOCS[0]]) {
      await side.getByRole('link', { name: d.title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${d.path}$`));
      await hydrated(page);
      await expect(side.locator('a[aria-current="page"]')).toHaveText(d.title);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(d.title);
      await expect(page.locator(ROOT)).toHaveCount(1); // the previous document is gone, not kept next to the new one
    }
    await side.getByRole('link', { name: 'Overview' }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test('previous / next follow the sidebar order, from the first page to the last (the tour page included)', async ({ page }) => {
    await page.goto(NAV_DOCS[0].path);
    await hydrated(page);
    const pager = page.getByRole('navigation', { name: 'Previous and next pages' });
    await expect(pager.getByRole('link', { name: /Previous/ })).toHaveCount(0); // nothing before the first page
    for (let i = 0; i < NAV_DOCS.length - 1; i++) {
      const next = pager.getByRole('link', { name: /Next/ });
      await expect(next).toHaveAttribute('href', NAV_DOCS[i + 1].path);
      await expect(next).toContainText(NAV_DOCS[i + 1].title);
      await next.click();
      await expect(page).toHaveURL(new RegExp(`${NAV_DOCS[i + 1].path}$`));
      await hydrated(page);
      await expect(page.locator('h1').first()).toContainText(/\S/);
      const prev = pager.getByRole('link', { name: /Previous/ });
      await expect(prev).toHaveAttribute('href', NAV_DOCS[i].path);
      await expect(prev).toContainText(NAV_DOCS[i].title);
    }
    await expect(pager.getByRole('link', { name: /Next/ })).toHaveCount(0); // nothing after the last one
    await pager.getByRole('link', { name: /Previous/ }).click();
    await expect(page).toHaveURL(new RegExp(`${NAV_DOCS[NAV_DOCS.length - 2].path}$`));
  });

  test('links between pages stay in the tab; a link to a heading scrolls to it; external links open elsewhere', async ({ page, context }) => {
    // page -> page
    await page.goto('/docs/getting-started/first-editor');
    await hydrated(page);
    const pages = context.pages().length;
    const link = page.locator(`${ROOT} a.nabu-link[href="/docs/getting-started/installation"]`).first();
    await expect(link).not.toHaveAttribute('target', /.+/);
    await link.click();
    await expect(page).toHaveURL(/\/docs\/getting-started\/installation$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Installation');
    expect(context.pages().length).toBe(pages);

    // page -> heading of the same page
    await page.goto('/docs/recipes/read-only-viewer');
    await hydrated(page);
    await page.locator(`${ROOT} a.nabu-link[href="#option-2-html-from-the-json-export"]`).first().click();
    await expect(page).toHaveURL(/#option-2-html-from-the-json-export$/);
    await expect(page.locator('#option-2-html-from-the-json-export')).toBeInViewport();
    expect(context.pages().length).toBe(pages);

    // outside the site
    await page.goto('/docs/getting-started/installation');
    await hydrated(page);
    const external = page.locator(`${ROOT} a.nabu-link[href="https://loro.dev"]`).first();
    await expect(external).toHaveAttribute('target', '_blank');
    await expect(external).toHaveAttribute('rel', /noopener/);
  });

  test('the table of contents jumps to its heading', async ({ page }) => {
    await page.goto('/docs/guides/extensions');
    await hydrated(page);
    const toc = page.getByRole('navigation', { name: 'On this page' });
    await toc.getByRole('link', { name: 'Hooks', exact: true }).click();
    await expect(page).toHaveURL(/#hooks$/);
    await expect(page.locator(`${ROOT} #hooks`)).toBeInViewport();
    await expect(page.locator(`${ROOT} #hooks`)).toHaveText('Hooks');
    await expect(toc.locator('a[aria-current]')).toHaveText('Hooks');
  });

  test('every internal link of every page resolves (page and anchor), and no .md link is left', async ({ page, request }) => {
    const targets = new Map<string, Set<string>>(); // path -> anchors asked for
    for (const path of ALL) {
      await page.goto(path);
      const hrefs = await page.locator(`${ROOT} a[href]`).evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
      for (const href of hrefs) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // outside the site (the ADRs live on GitHub)
        expect(href, `${path}: ${href}`).not.toMatch(/\.md(#|$)/);
        const m = /^(\/[^#]*)?(#.*)?$/.exec(href);
        if (!m) continue; // external
        const target = m[1] || path;
        if (!targets.has(target)) targets.set(target, new Set());
        if (m[2]) targets.get(target)!.add(m[2].slice(1));
      }
    }
    expect(targets.size).toBeGreaterThan(8);
    for (const [target, anchors] of targets) {
      const res = await request.get(target);
      expect(res.status(), target).toBe(200);
      const html = await res.text();
      for (const anchor of anchors) expect(html, `${target}#${anchor}`).toContain(`id="${anchor}"`);
    }
  });

  test('the API reference links into the docs, and they resolve', async ({ page, request }) => {
    // every /docs link of the API model (the "Related guide" of the pages), plus the ones a hand-written table of scripts/api-config.js holds
    const model = readFileSync(resolve('src/site/api/model.json'), 'utf8');
    const links = [...new Set([...model.matchAll(/"(\/docs\/[a-z0-9\-/]+)(?:#[^"]*)?"/g)].map((m) => m[1]))];
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      const res = await request.get(link);
      expect(res.status(), link).toBe(200);
      expect(DOCS.some((d) => d.path === link), `${link} is a published page`).toBe(true);
    }
    // and in the browser, from an API page
    await page.goto('/api/root/createPersistedEditor');
    await page.getByRole('link', { name: /Persistence and sync/ }).click();
    await expect(page).toHaveURL(/\/docs\/guides\/persistence-and-sync$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Persistence and sync');
  });
});

test.describe('server render, hydration and layout shift', () => {
  test.use({ colorScheme: 'light' });
  const SAMPLE = ['/docs/getting-started/installation', '/docs/guides/extensions', '/docs/guides/regions', '/docs/recipes/read-only-viewer', '/changelog'];

  /** Position and size of the blocks that make the page: headings, code, tables, paragraphs, list items. Document coordinates. */
  const boxes = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="doc-article"] :is(h1, h2, h3, .cb, .doc-table, [data-block-type="paragraph"], [data-block-type="list-item"])')].map((el) => {
        const r = el.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 10) / 10;
        return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} ${round(r.x + scrollX)},${round(r.y + scrollY)} ${round(r.width)}x${round(r.height)}`;
      }),
    );

  /** A context whose fonts never load (system fonts both times), so that a difference can only come from the markup. */
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
        // Mark every element the server sent while the document is still unhydrated; a hydration that REPLACED the markup would leave elements without the mark.
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
      expect(stats.tagged).toBeGreaterThan(50);
      expect(stats.notFromServer).toBe(0);
      expect(stats.now).toBe(stats.tagged);
      expect(stats.shift).toBe(0);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test('the markup has no whitespace between tags (it would become selectable phantom lines), on every page', async ({ page }) => {
    for (const path of ALL) {
      await page.goto(path);
      await hydrated(page);
      const report = (await domInvariantReport(page))!;
      // (a space between two inline marks of a table cell is text of the cell, not markup)
      expect(report.whitespace.filter((w) => !/ in div\.doc-table > table\.nabu-table > tbody > tr > t[dh]\./.test(w)), path).toEqual([]);
      // no selectable box between the blocks or in the padding of a container (a code block or a table that scrolls sideways hides text beyond
      // its edge, and a wrapped line may hang a space past the right edge: those are the invariant's other rule, not checked here)
      expect(report.phantoms.filter((p) => /outside the own element of every block|directly in the container/.test(p)), path).toEqual([]);
    }
  });
});

test.describe('responsive and themes', () => {
  test('375px: no horizontal scroll on any page, code and tables scroll inside their own box', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ['/docs', ...ALL]) {
      await page.goto(path);
      expect(await noHorizontalScroll(page), path).toBe(true);
      expect(
        await page.evaluate(() => [...document.querySelectorAll('.cb, .doc-table, .nabu-editor h1, .nabu-editor h2')].filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5).length),
        `${path}: a block sticks out`,
      ).toBe(0);
    }
    // the navigation folds behind a button, "On this page" is dropped
    await page.goto('/docs/guides/extensions');
    await hydrated(page);
    await expect(page.getByRole('button', { name: 'Browse the docs' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'On this page' })).toBeHidden();
    await page.getByRole('button', { name: 'Browse the docs' }).click();
    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Theming', exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/guides\/theming$/);
    expect(await noHorizontalScroll(page)).toBe(true);
    // a wide table scrolls by itself, and can be reached from the keyboard
    await page.goto('/docs/guides/extensions');
    const table = page.locator('.doc-table').first();
    expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(table).toHaveAttribute('tabindex', '0');
  });

  for (const scheme of ['dark', 'light'] as const) {
    test(`${scheme}: the document takes the site's colours, with readable text`, async ({ browser }) => {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('/docs/getting-started/installation');
      await hydrated(page);
      const colours = await page.evaluate(() => {
        const site = document.querySelector('.site')!;
        const probe = (css: string) => {
          const el = document.createElement('span');
          el.style.color = css;
          site.append(el);
          const c = getComputedStyle(el).color;
          el.remove();
          return c;
        };
        const style = (sel: string) => getComputedStyle(document.querySelector(sel)!);
        const lum = (c: string) => {
          const [r, g, b] = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const bg = style('.site').backgroundColor;
        const text = style('[data-nabu-root] [data-block-type="paragraph"]').color;
        const link = style('[data-nabu-root] a.nabu-link').color;
        const h2 = style('[data-nabu-root] h2').color;
        const cell = style('[data-nabu-root] td').color;
        const token = [...document.querySelectorAll('[data-nabu-root] pre span')].map((s) => (s as HTMLElement).style.color).find(Boolean);
        return {
          bg, text, link, h2, cell,
          wantText: probe('var(--site-text)'), wantMuted: probe('var(--site-text-muted)'), wantAccent: probe('var(--site-accent)'),
          codeBg: style('[data-nabu-root] .cb').backgroundColor, wantSurface: style('.site').getPropertyValue('--site-surface').trim(),
          pane: style('[data-nabu-root]').backgroundColor, border: style('[data-nabu-root]').borderTopWidth,
          token: token ?? '',
          contrast: { text: contrast(text, bg), link: contrast(link, bg), cell: contrast(cell, bg) },
        };
      });
      expect(colours.bg).toBe(scheme === 'dark' ? 'rgb(11, 11, 12)' : 'rgb(250, 250, 248)');
      expect(colours.text).toBe(colours.wantText);
      expect(colours.h2).toBe(colours.wantText);
      expect(colours.cell).toBe(colours.wantText); // the first cell of a row is the name
      expect(colours.link).toBe(colours.wantAccent);
      expect(colours.pane).toBe('rgba(0, 0, 0, 0)'); // no pane: the page's own surface
      expect(colours.border).toBe('0px');
      expect(colours.token).toContain('var(--shiki-');
      expect(colours.contrast.text).toBeGreaterThan(7);
      expect(colours.contrast.link).toBeGreaterThan(4.5);
      await ctx.close();
    });
  }

  test('an explicit choice of the site theme wins over the system one, and survives navigation', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('nabu-site-theme', 'light'));
    await page.goto('/docs/guides/theming');
    await hydrated(page);
    const paragraph = page.locator(`${ROOT} [data-block-type="paragraph"]`).first();
    expect(await paragraph.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(20, 20, 22)');
    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Regions', exact: true }).click();
    await hydrated(page);
    expect(await page.locator(`${ROOT} [data-block-type="paragraph"]`).first().evaluate((el) => getComputedStyle(el).color)).toBe('rgb(20, 20, 22)');
    // switching with the toggle repaints the document with no reload
    await page.getByTestId('theme-toggle').click(); // light -> system(dark here)
    await expect.poll(() => page.locator(`${ROOT} [data-block-type="paragraph"]`).first().evaluate((el) => getComputedStyle(el).color)).toBe('rgb(237, 237, 237)');
    await ctx.close();
  });
});

test('screenshots of the documentation', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  const pages = [
    ['index', '/docs'],
    ['installation', '/docs/getting-started/installation'],
    ['extensions', '/docs/guides/extensions'],
    ['changelog', '/changelog'],
  ] as const;
  for (const [scheme, width, height] of [['dark', 1440, 900], ['light', 1440, 900], ['dark', 375, 812], ['light', 375, 812]] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width, height } });
    const page = await ctx.newPage();
    for (const [name, path] of pages) {
      await page.goto(path);
      if (name !== 'index') await hydrated(page);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${SHOTS}/docs-${name}-${width}-${scheme}.png` });
    }
    // a screen of code and one of tables, further down
    for (const [name, path, selector] of [['code', '/docs/getting-started/installation', '.cb'], ['table', '/docs/guides/extensions', '.doc-table']] as const) {
      await page.goto(path);
      await hydrated(page);
      await page.evaluate(() => document.fonts.ready);
      await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: `${SHOTS}/docs-${name}-${width}-${scheme}.png` });
    }
    await ctx.close();
  }
});
