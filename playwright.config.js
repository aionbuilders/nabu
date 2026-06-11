import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Playwright runs the Nabu demo on a DEDICATED port (5180), not 5173 — that
  // way the suite is isolated from any other dev server you have running.
  // strictPort makes a port collision fail loudly instead of silently moving.
  webServer: {
    command: 'bun run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    timeout: 120000,
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
  reporter: [['list', { printSteps: true }], ['json', { outputFile: 'tests/results.json' }]],
});
