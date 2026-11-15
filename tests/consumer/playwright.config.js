import { defineConfig, devices } from '@playwright/test';

// The consumer smoke test (scripts/consumer-smoke.js): the production build of a fresh SvelteKit app that installed the PACKED package,
// served by `node build/index.js`, on three default Playwright browsers. Run it through `bun run test:consumer`, not directly:
// NABU_CONSUMER_APP must be the folder of the built app.
export const PORT = 5178;
const APP = process.env.NABU_CONSUMER_APP;
if (!APP) throw new Error('NABU_CONSUMER_APP is not set: run `bun run test:consumer`.');

export default defineConfig({
  testDir: '.',
  testMatch: 'smoke.spec.js',
  outputDir: '../../test-results-consumer',
  timeout: 60000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  webServer: {
    command: 'node build/index.js',
    cwd: APP,
    env: { PORT: String(PORT), HOST: '127.0.0.1' },
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60000,
  },
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
