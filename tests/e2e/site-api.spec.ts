import { test, expect } from './helpers/test.js';

// The generated API reference (src/routes/(site)/api, model from scripts/api-model.js). Prerendered pages, no editor:
// the editor DOM invariant fixture is a no-op here.

const horizontalOverflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('API reference', () => {
  test.use({ colorScheme: 'dark' });

  test('/api lists the three entry points, each with its exports grouped by kind', async ({ page }) => {
    await page.goto('/api');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('API reference');
    await expect(page).toHaveTitle('API reference — Nabu');
    for (const spec of ['@aionbuilders/nabu', '@aionbuilders/nabu/ui', '@aionbuilders/nabu/extend']) {
      await expect(page.getByRole('heading', { level: 2, name: spec, exact: true })).toBeVisible();
    }
    const root = page.locator('section[aria-labelledby="entry-root"]');
    for (const kind of ['Functions', 'Classes', 'Components', 'Constants', 'Types']) {
      await expect(root.getByRole('heading', { level: 3, name: new RegExp(`^${kind}`) })).toBeVisible();
    }
    // an export row: link + one-line summary
    const row = root.locator('li', { has: page.getByRole('link', { name: 'createEditor', exact: true }) });
    await expect(row).toContainText('Create a Nabu editor instance');
    await expect(root.getByRole('link', { name: 'createEditor', exact: true })).toHaveAttribute('href', '/api/root/createEditor');
    await expect(page.locator('section[aria-labelledby="entry-ui"]').getByRole('link', { name: 'FloatingToolbar', exact: true })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="entry-extend"]').getByRole('link', { name: 'TextBlock', exact: true })).toBeVisible();
    // the unstable door has its own entry
    await expect(page.getByRole('link', { name: /Read the warning/ })).toHaveAttribute('href', '/api/internals');
  });

  test('the header "API" item is active on every API page, other items are untouched', async ({ page }) => {
    await page.goto('/api/root/createEditor');
    const main = page.getByRole('navigation', { name: 'Main' });
    await expect(main.locator('a[aria-current="page"]')).toHaveText('API');
    await expect(main.getByRole('link', { name: 'API', exact: true })).toHaveAttribute('href', '/api');
    await expect(main.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute('href', '/docs');
  });

  test('an export page shows its signature, parameters, return type and stability', async ({ page }) => {
    await page.goto('/api/root/createPersistedEditor');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('createPersistedEditor');
    await expect(page.getByText('Stability: stable', { exact: true })).toBeVisible();
    // signature: highlighted code, with the documented types linked
    const signature = page.locator('.cb', { hasText: 'function createPersistedEditor' });
    await expect(signature).toBeVisible();
    await expect(signature.locator('pre span[style*="--shiki-"]').first()).toBeVisible();
    // parameters table (name, type, default, description)
    const table = page.getByRole('table', { name: 'Parameters of createPersistedEditor' });
    await expect(table.getByRole('columnheader')).toContainText(['Parameter', 'Type', 'Description']);
    await expect(table.locator('td.name code', { hasText: /^options\.docId$/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /options\.docId/ })).toContainText('Unique identifier for this document in IndexedDB');
    // returns + related guide
    await expect(page.getByRole('heading', { level: 2, name: 'Returns' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Persistence and sync/ })).toHaveAttribute('href', '/docs/guides/persistence-and-sync');
    // the "On this page" column follows the sections
    const toc = page.getByRole('navigation', { name: 'On this page' });
    await expect(toc.getByRole('link', { name: 'Parameters' })).toHaveAttribute('href', '#parameters');
    // the left navigation marks the current page
    await expect(page.getByRole('navigation', { name: 'API reference' }).locator('a[aria-current="page"]')).toHaveText('createPersistedEditor');
  });

  test('a type in a signature links to its page', async ({ page }) => {
    await page.goto('/api/root/createEditor');
    const link = page.locator('.cb a.type-link', { hasText: 'EditorOptions' });
    await expect(link).toHaveAttribute('href', '/api/root/EditorOptions');
    await link.click();
    await expect(page).toHaveURL(/\/api\/root\/EditorOptions$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('EditorOptions');
  });

  test('a class page lists the @public members: statics, properties, methods', async ({ page }) => {
    await page.goto('/api/root/Nabu');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nabu');
    await expect(page.getByText('Stable contract', { exact: true })).toBeVisible();
    for (const h of ['Constructor', 'Static members', 'Properties', 'Methods']) {
      await expect(page.getByRole('heading', { level: 2, name: h, exact: true })).toBeVisible();
    }
    // a method with its signature, and its parameters
    const exec = page.locator('#m-exec');
    await expect(exec.getByRole('heading', { level: 3 })).toContainText('exec()');
    await expect(exec.locator('.cb')).toContainText('exec(topic: string, data?: any)');
    await expect(exec.getByRole('cell', { name: 'topic' })).toBeVisible();
    // statics and properties
    await expect(page.locator('#s-BREAK')).toBeVisible();
    await expect(page.locator('#m-readonly')).toBeVisible();
    // 57 members tagged @public on Nabu
    await expect(page.locator('section.member')).toHaveCount(57);
    // what is not part of the contract is not listed
    await expect(page.locator('#m-handleKeydown')).toHaveCount(0);
    // internals is flagged unstable and points to its page
    const internals = page.locator('#m-internals');
    await expect(internals).toContainText('Unstable');
    await expect(internals.locator('a[href="/api/extend/NabuInternals"]').first()).toBeVisible();
  });

  test('a derived class lists its own members and links the inherited ones', async ({ page }) => {
    await page.goto('/api/extend/TextBlock');
    await expect(page.getByRole('heading', { level: 2, name: 'Inherited' })).toBeVisible();
    await expect(page.locator('section.member')).toHaveCount(14);
    await expect(page.locator('.inherited a[href="/api/extend/Block"]').first()).toBeVisible();
  });

  test('a class of the contract that is not exported by name says how to reach it', async ({ page }) => {
    await page.goto('/api/extend/CommandRegistry');
    await expect(page.getByText('Not exported by name')).toBeVisible();
    await expect(page.locator('main').getByText('nabu.commands').first()).toBeVisible();
  });

  test('a component page shows its usage and props', async ({ page }) => {
    await page.goto('/api/root/NabuEditor');
    await expect(page.getByRole('heading', { level: 2, name: 'Usage' })).toBeVisible();
    const props = page.getByRole('table', { name: 'Props of NabuEditor' });
    for (const prop of ['engine', 'label', 'labelledby', 'readonly']) await expect(props.getByRole('cell', { name: prop, exact: false }).first()).toBeVisible();
    await expect(props).toContainText('accessible name');
  });

  test('nabu.internals carries the "unstable" warning and its keys', async ({ page }) => {
    await page.goto('/api/internals');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('nabu.internals');
    const warning = page.getByRole('note').filter({ hasText: 'may change in any minor version' });
    await expect(warning).toBeVisible();
    await expect(warning.getByRole('heading')).toHaveText(/Unstable\s+—\s+may change in any minor version/);
    await expect(page.getByText('Stability: unstable', { exact: true })).toBeVisible();
    const keys = page.getByRole('table', { name: 'Keys of nabu.internals' });
    await expect(keys.locator('td.name code', { hasText: /^handleKeydown$/ })).toBeVisible();
    await expect(keys.locator('td.name code', { hasText: /^undoManager$/ })).toBeVisible();
    expect(await keys.locator('tbody tr').count()).toBeGreaterThanOrEqual(40);
    // the type page and the Nabu member say the same
    await page.goto('/api/extend/NabuInternals');
    await expect(page.getByText('Stability: unstable', { exact: true })).toBeVisible();
  });

  test('client-side navigation keeps the frame and updates the page', async ({ page }) => {
    await page.goto('/api');
    await page.getByRole('navigation', { name: 'API reference' }).getByRole('link', { name: 'Nabu', exact: true }).click();
    await expect(page).toHaveURL(/\/api\/root\/Nabu$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nabu');
    await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  });

  test('syntax colours follow the theme tokens', async ({ page }) => {
    await page.goto('/api/root/createEditor');
    const keyword = page.locator('.cb pre span', { hasText: /^function$/ }).first();
    const dark = await keyword.evaluate((el) => getComputedStyle(el).color);
    expect(dark).toBe('rgb(255, 111, 97)'); // --site-accent, dark
    await page.getByTestId('theme-toggle').click(); // system -> dark
    await page.getByTestId('theme-toggle').click(); // dark -> light
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await keyword.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(194, 56, 31)'); // --site-accent, light
  });

  test('copy button copies the code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/api/root/createEditor');
    const block = page.locator('.cb', { hasText: 'function createEditor' });
    await block.getByRole('button', { name: 'Copy code' }).click();
    await expect(block.getByRole('button')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('function createEditor(options?: EditorOptions): Nabu');
  });
});

test.describe('API reference at 375px', () => {
  test.use({ viewport: { width: 375, height: 800 }, colorScheme: 'dark' });

  for (const path of ['/api', '/api/root/createPersistedEditor', '/api/root/Nabu', '/api/root/NabuInit', '/api/extend/NabuInternals', '/api/internals', '/api/ui/SlashMenu']) {
    test(`${path}: no horizontal scroll`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('the navigation folds behind a button and opens', async ({ page }) => {
    await page.goto('/api/root/createEditor');
    const nav = page.getByRole('navigation', { name: 'API reference' });
    await expect(nav).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'On this page' })).toBeHidden();
    const button = page.getByRole('button', { name: 'Browse the API' });
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Nabu', exact: true }).click();
    await expect(page).toHaveURL(/\/api\/root\/Nabu$/);
    await expect(nav).toBeHidden(); // closed by the navigation
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
