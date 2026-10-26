import { defineConfig, devices } from '@playwright/test';

const DEV = !!process.env.NABU_E2E_DEV;
// Port of the dedicated e2e server (default 5180). `NABU_E2E_PORT` only exists to dodge a port that something else holds.
const PORT = Number(process.env.NABU_E2E_PORT ?? 5180);

// The `perf` project (large-document measurements, tests/e2e/perf/*.perf.ts) only exists when it is asked for:
// `bunx playwright test --project=perf` (or NABU_PERF=1), so that a plain `bunx playwright test` never runs it. The
// flag is written back to the environment so that the worker processes (which re-read this file) see the same projects.
if (process.argv.some((a, i, all) => a === '--project=perf' || (a === '--project' && all[i + 1] === 'perf'))) process.env.NABU_PERF = '1';
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
      testIgnore: ['**/flaky/**', '**/perf/**'],
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write'],
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
    ...(PERF
      ? [
          {
            // Performance measurements on large documents. One file, one worker: the timings must not compete with other tests.
            // Prints a results table and writes test-results/perf.json.
            name: 'perf',
            testDir: 'tests/e2e/perf',
            testMatch: /\.perf\.ts$/,
            timeout: 900000,
            retries: 0,
            use: {
              ...devices['Desktop Chrome'],
              permissions: ['clipboard-read', 'clipboard-write'],
            },
          },
        ]
      : []),
  ],
  timeout: 20000,
  // On the dev server, more than 6 browsers made editor boots time out in beforeEach
  // (on-demand transforms). See tests/README.md for the production-build measurements.
  workers: 6,
  reporter: [['list', { printSteps: true }], ['json', { outputFile: 'test-results/results.json' }]],
});
