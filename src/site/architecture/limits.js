/**
 * What Nabu does not do well (yet): the data of /architecture/limits. Every limit says what we know, how bad it is, what we plan, and where
 * the number comes from: `source` is a file of THIS repository (a test, a config, a guide, an audit entry) that measures or states it,
 * linked on GitHub. A unit test (tests/unit/site-architecture.test.js) checks that every source exists on disk.
 *
 * Numbers that are being worked on carry `volatile: true`: the page says "at the time of writing" next to them. When the fix lands, change
 * `value`, `asOf` and the description here, and nothing else.
 */
import { githubBlob } from './adr.js';

/** The day this file was last checked against the repository. Shown as "Updated". */
export const LIMITS_UPDATED = '2026-10-28';

export const LIMITS_TITLE = "What Nabu doesn't do well (yet)";
export const LIMITS_LEAD =
  'If you are deciding whether to build on Nabu, this page matters more than the home page. Everything here is true on the day it was last updated, and each number links to the test that measures it.';
export const LIMITS_DESCRIPTION =
  'What Nabu does not do well yet: loading very large documents, mobile keyboards, Firefox and Safari, network collaboration, tables, browser extensions, bundle weight and setup. What we know, the numbers, and what we plan.';

/**
 * Status vocabulary, with the colour token each one is drawn in (see arch.css): `fix` coral, `plan` amber, `design` blue.
 * @type {Record<string, { label: string, tone: 'fix' | 'plan' | 'design' }>}
 */
export const STATUSES = {
  'being-fixed': { label: 'known · being fixed', tone: 'fix' },
  'known-planned': { label: 'known · planned', tone: 'plan' },
  'by-design-not-yet': { label: 'by design, not yet', tone: 'design' },
  planned: { label: 'planned', tone: 'plan' },
  'known-untested': { label: 'known · untested', tone: 'plan' },
  'by-design': { label: 'by design', tone: 'design' },
};

/**
 * @typedef {{ path: string, label: string }} Source  a file of the repo
 * @typedef {{
 *   id: string, title: string, status: keyof typeof STATUSES, description: string,
 *   value: string, unit: string, volatile?: boolean, asOf?: string, source: Source,
 * }} Limit
 */

/** @type {Limit[]} */
export const LIMITS = [
  {
    id: 'typing',
    title: 'Loading huge documents',
    status: 'known-planned',
    description:
      'At the time of writing, opening a document of 10,000 blocks takes about 9 s in the lab, and the page does not answer while it loads (1,000 blocks: about 1.3 s). Typing in such a document was slow too (88 ms per key) and is fixed since 0.1.0: the browser skips what is off screen, and a key reaches the screen in about 13 ms at the median, 19 ms for the slow one in twenty (9 ms and 15 ms on a short page, on a busy machine). The load is next: the document is built block by block, and a single transaction is read several times by the extensions.',
    value: '9 s',
    unit: 'to load 10k blocks · at the time of writing',
    volatile: true,
    asOf: '2026-10-28',
    // The measure, run alone on a production build: it prints the load time and the typing numbers. The audit entry P-107 (docs/audit/2026-10.md) tracked the typing fix.
    source: { path: 'tests/e2e/perf/lab-numbers.perf.ts', label: 'tests/e2e/perf/lab-numbers.perf.ts' },
  },
  {
    id: 'mobile',
    title: 'Mobile keyboards',
    status: 'known-planned',
    description:
      'Android and iOS keyboards send their own input events (autocorrect, swipe, predictive text). Nabu has not been tuned on them yet.',
    value: '—',
    unit: 'not measured',
    source: { path: 'docs/guides/ime-and-languages.md', label: 'docs/guides/ime-and-languages.md' },
  },
  {
    id: 'browsers',
    title: 'Firefox and Safari',
    status: 'known-planned',
    description:
      'Developed and tested in Chromium. The test suite does not run in Firefox or WebKit yet, so we cannot promise they behave.',
    value: '1 / 3',
    unit: 'engines tested',
    source: { path: 'playwright.config.js', label: 'playwright.config.js' },
  },
  {
    id: 'collaboration',
    title: 'Real-time collaboration',
    status: 'by-design-not-yet',
    description:
      'The model is a CRDT and tabs already merge. A network transport between users is not shipped: you would bring your own.',
    value: 'tabs',
    unit: 'sync scope today',
    source: { path: 'docs/guides/persistence-and-sync.md', label: 'docs/guides/persistence-and-sync.md' },
  },
  {
    id: 'tables',
    title: 'Tables',
    status: 'planned',
    description: 'No table block yet. It needs a block-selection primitive we have not built.',
    value: '0',
    unit: 'table blocks',
    source: { path: 'docs/audit/2026-10.md', label: 'docs/audit/2026-10.md, roadmap' },
  },
  {
    id: 'extensions',
    title: 'Browser extensions (Grammarly…)',
    status: 'known-untested',
    description:
      'Extensions that rewrite the editable surface can fight with a single contenteditable. Not tested yet; `spellcheck: false` adds the opt-out hints Grammarly reads.',
    value: '—',
    unit: 'not tested',
    source: { path: 'docs/guides/ime-and-languages.md', label: 'docs/guides/ime-and-languages.md' },
  },
  {
    id: 'bundle',
    title: 'Bundle weight',
    status: 'by-design',
    description:
      'The document is a Loro CRDT, and Loro is a WebAssembly file: 1.2 MB gzipped (3.6 MB raw). Yjs, by comparison, is 28 KB. We have not measured the weight of Nabu’s own code separately.',
    value: '1.2 MB',
    unit: 'gzip · Loro WebAssembly',
    source: { path: 'docs/architecture/sources/comparison-2026-10-27.md', label: 'comparison notes, bundle sizes' },
  },
  {
    id: 'setup',
    title: 'Setup',
    status: 'by-design',
    description:
      'Loro’s WebAssembly needs the `nabu()` plugin in your Vite config and an `esnext` build target. Without them, Nabu fails to load. Svelte 5.20 or later only.',
    value: '1 plugin',
    unit: 'Vite + esnext target',
    source: { path: 'docs/getting-started/installation.md', label: 'docs/getting-started/installation.md' },
  },
];

/** The GitHub page of a limit's source. @param {Source} source */
export const sourceUrl = (source) => githubBlob(source.path);
