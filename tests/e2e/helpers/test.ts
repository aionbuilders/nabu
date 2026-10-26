/**
 * The `test` of every e2e spec: `@playwright/test`'s, plus an AUTO fixture that checks the DOM / selection invariant of the
 * editor at the end of every test (see helpers/dom-invariant.ts for the exact rule).
 *
 * The check runs in the fixture teardown, so only when the test body (and its afterEach hooks) PASSED, the page is still open and has
 * a `[data-nabu-root]`; it is read-only (never changes the selection, the focus or the DOM). On a violation the test fails with the
 * offending node / rect and the nearest block ids.
 *
 * Opt-out (sparingly, always with a reason):
 *   - for a whole file / describe:  `test.use({ domInvariant: false })`
 *   - for one test, e.g. after it deliberately created odd DOM:
 *       `test.info().annotations.push({ type: 'skip-dom-invariant', description: 'why' })`
 *     or in the test details: `test('name', { annotation: { type: 'skip-dom-invariant', description: 'why' } }, async ...)`
 */

import { test as base, expect } from '@playwright/test';
import { checkDomInvariant } from './dom-invariant.js';

export const SKIP_ANNOTATION = 'skip-dom-invariant';

export const test = base.extend<{ domInvariant: boolean; domInvariantCheck: void }>({
  domInvariant: [true, { option: true }],
  domInvariantCheck: [
    async ({ page, domInvariant }, use, testInfo) => {
      await use();
      if (!domInvariant) return;
      if (testInfo.annotations.some((a) => a.type === SKIP_ANNOTATION)) return;
      if (testInfo.status !== 'passed' || testInfo.errors.length > 0) return;
      if (page.isClosed()) return;
      let violations: string[];
      try {
        violations = await Promise.race([
          checkDomInvariant(page),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 5000)),
        ]);
      } catch {
        return; // page closed / navigated away mid-check: nothing to guard
      }
      if (violations.length) {
        throw new Error(
          `DOM invariant violated at the end of the test (${violations.length}):\n  - ${violations.join('\n  - ')}\n` +
            `If this is deliberate, opt out with an annotation { type: '${SKIP_ANNOTATION}', description: '<reason>' } (or test.use({ domInvariant: false })).`,
        );
      }
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator, FileChooser, Browser, BrowserContext } from '@playwright/test';
