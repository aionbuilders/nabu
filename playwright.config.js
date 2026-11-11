import { defineConfig, devices } from '@playwright/test';

const DEV = !!process.env.NABU_E2E_DEV;
// Port of the dedicated e2e server (default 5180). `NABU_E2E_PORT` only exists to dodge a port that something else holds.
// `NABU_SLOT=<1-9>` runs a separate suite next to the default one: its own build folders (see vite.config.js), its own
// results folder and port 5180 + slot. Two runs in the SAME slot still overwrite each other.
const SLOT = process.env.NABU_SLOT;
if (SLOT && !/^[1-9]$/.test(SLOT)) throw new Error(`NABU_SLOT must be a digit 1-9, got "${SLOT}"`);
const PORT = Number(process.env.NABU_E2E_PORT ?? 5180 + Number(SLOT ?? 0));
const RESULTS = SLOT ? `test-results-${SLOT}` : 'test-results';

// The `perf` project (large-document measurements, tests/e2e/perf/*.perf.ts) only exists when it is asked for:
// `bunx playwright test --project=perf` (or NABU_PERF=1), so that a plain `bunx playwright test` never runs it. The
// flag is written back to the environment so that the worker processes (which re-read this file) see the same projects.
if (process.argv.some((a, i, all) => /^--project=perf(-webkit)?$/.test(a) || (a === '--project' && /^perf(-webkit)?$/.test(all[i + 1] ?? '')))) process.env.NABU_PERF = '1';
const PERF = process.env.NABU_PERF === '1';

export default defineConfig({
  // Playwright runs the Nabu demo on a DEDICATED port (5180), not 5173 — that
  // way the suite is isolated from any other dev server you have running.
  // strictPort makes a port collision fail loudly instead of silently moving.
  //
  // Default: a PRODUCTION build (`build:e2e` = `VITE_NABU_E2E=1 vite build`, which enables the
  // otherwise-404 `/e2e` route) served by `vite preview`. No on-demand transforms, so the editor
  // boots fast and stably under load. `reuseExistingServer: false` on purpose: a stale server
  // could silently serve an OLD build.
  // Escape hatch for debugging: `NABU_E2E_DEV=1` (or `bun run test:e2e:dev`) uses the Vite dev server.
  webServer: DEV
    ? {
        command: `bun run dev -- --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 120000,
      }
    : {
        command: `bun run build:e2e && bun run preview -- --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 300000,
      },
  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'core',
      testDir: 'tests/e2e',
      // `perf/` holds the large-document measurements (`*.perf.ts`, run on demand: `bunx playwright test --project=perf`).
      testIgnore: ['**/flaky/**', '**/perf/**', '**/firefox/**'],
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      // What only Firefox shows (tests/e2e/firefox). `bunx playwright install firefox` once. It knows no clipboard permission.
      name: 'firefox',
      testDir: 'tests/e2e/firefox',
      use: {
        ...devices['Desktop Firefox'],
        permissions: [],
      },
    },
    {
      name: 'flaky',
      testDir: 'tests/e2e/flaky',
      retries: 2,
      timeout: 15000,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    // The whole `core` suite on the other engines, on demand while it is being made green: `NABU_BROWSERS=1 bunx playwright test --project=core-firefox`.
    ...(process.env.NABU_BROWSERS === '1'
      ? (['firefox', 'webkit']).map((engine) => ({
          name: `core-${engine}`,
          testDir: 'tests/e2e',
          testIgnore: ['**/flaky/**', '**/perf/**', '**/firefox/**'],
          use: {
            ...devices[engine === 'firefox' ? 'Desktop Firefox' : 'Desktop Safari'],
            permissions: [],
          },
        }))
      : []),
    ...(PERF
      ? [
          {
            // Performance measurements on large documents. One file, one worker: the timings must not compete with other tests.
            // Prints a results table and writes test-results/perf.json.
            name: 'perf',
            testDir: 'tests/e2e/perf',
            testMatch: /\.perf\.ts$/,
            testIgnore: /novel-typing\.perf\.ts$/, // WebKit only: see `perf-webkit`
            timeout: 900000,
            retries: 0,
            use: {
              ...devices['Desktop Chrome'],
              permissions: ['clipboard-read', 'clipboard-write'],
            },
          },
          {
            // Typing in the middle of a 90,000-word novel of nested regions on WebKit (tests/e2e/perf/novel-typing.perf.ts): the case that
            // made WebKit take ~380 ms per key when nested `content-visibility: auto` boxes were stacked (see region/Region.svelte).
            // `bunx playwright install webkit` once. EXECUTABLE OVERRIDE: `NABU_WEBKIT_EXE=<path to the browser launcher>` runs another
            // WebKit build than the one Playwright pins, e.g. `NABU_WEBKIT_EXE=~/.cache/ms-playwright/webkit-2370/pw_run.sh`.
            name: 'perf-webkit',
            testDir: 'tests/e2e/perf',
            testMatch: /novel-typing\.perf\.ts$/,
            timeout: 900000,
            retries: 0,
            use: {
              ...devices['Desktop Safari'],
              viewport: { width: 1440, height: 1000 },
              permissions: [],
              launchOptions: process.env.NABU_WEBKIT_EXE ? { executablePath: process.env.NABU_WEBKIT_EXE.replace(/^~(?=\/)/, process.env.HOME ?? '~') } : {},
            },
          },
        ]
      : []),
  ],
  timeout: 20000,
  outputDir: RESULTS,
  // On the dev server, more than 6 browsers made editor boots time out in beforeEach
  // (on-demand transforms). See tests/README.md for the production-build measurements.
  workers: 6,
  reporter: [['list', { printSteps: true }], ['json', { outputFile: `${RESULTS}/results.json` }]],
});
