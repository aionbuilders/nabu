import { defineConfig, devices } from '@playwright/test';

const DEV = !!process.env.NABU_E2E_DEV;

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
        command: 'bun run dev -- --port 5180 --strictPort',
        url: 'http://localhost:5180',
        reuseExistingServer: true,
        timeout: 120000,
      }
    : {
        command: 'bun run build:e2e && bun run preview -- --port 5180 --strictPort',
        url: 'http://localhost:5180',
        reuseExistingServer: false,
        timeout: 300000,
      },
  use: {
    baseURL: 'http://localhost:5180',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'core',
      testDir: 'tests/e2e',
      testIgnore: '**/flaky/**',
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
  ],
  timeout: 20000,
  // On the dev server, more than 6 browsers made editor boots time out in beforeEach
  // (on-demand transforms). See tests/README.md for the production-build measurements.
  workers: 6,
  reporter: [['list', { printSteps: true }], ['json', { outputFile: 'test-results/results.json' }]],
});
