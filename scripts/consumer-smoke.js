#!/usr/bin/env node
/**
 * Consumer smoke test: packs the package exactly as npm would publish it, installs the tarball in a fresh copy of the
 * SvelteKit app in tests/consumer/app (in a temp folder), type-checks tests/consumer/types/probe.js against the installed .d.ts
 * files, builds that app for production and runs tests/consumer/smoke.spec.js against it on Chromium, Firefox and WebKit.
 *
 * It exists because a bundler-entry change for Loro's WASM broke a client-only route on WebKit while the unit tests and our own
 * e2e app (which import the sources) stayed green. Only a separate app that installed the tarball sees what a consumer sees.
 *
 *   bun run test:consumer            # the temp folder is deleted on success
 *   bun run test:consumer -- --keep  # keep it (it is printed either way)
 *
 * Needs network (npm install). Installs with npm, not bun: bun caches tarballs by name and version and can silently reuse an old one.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEMPLATE = join(ROOT, 'tests/consumer/app');
const KEEP = process.argv.includes('--keep');
const started = Date.now();

/**
 * Runs a command in the foreground, inherits its output, and exits the whole script on a non-zero code.
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [opts]
 */
function step(label, cmd, args, opts = {}) {
  console.log(`\n== ${label}\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, stdio: 'inherit', env: { ...process.env, ...opts.env } });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status ?? r.signal})`);
}

/** @param {string} message */
function fail(message) {
  console.error(`\nconsumer-smoke FAILED: ${message}\nTemp folder kept: ${tmp}`);
  process.exit(1);
}

/** @param {string} file */
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const tmp = mkdtempSync(join(tmpdir(), 'nabu-consumer-'));
console.log(`Temp folder: ${tmp}`);

// 1. A fresh dist and the tarball npm would publish (`npm pack` runs the `prepack` script).
const packDir = join(tmp, 'pack');
mkdirSync(packDir);
cpSync(TEMPLATE, join(tmp, 'app'), { recursive: true });
const app = join(tmp, 'app');
const pack = spawnSync('npm', ['pack', '--pack-destination', packDir, '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
if (pack.status !== 0) fail(`npm pack failed (exit ${pack.status})`);
const tarball = join(packDir, JSON.parse(pack.stdout.slice(pack.stdout.lastIndexOf('\n[')))[0].filename);
console.log(`\n== npm pack\n${tarball}`);

// 2. Install the tarball in the fresh app.
const pkgFile = join(app, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
pkg.dependencies['@aionbuilders/nabu'] = `file:${tarball}`;
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
step('npm install', 'npm', ['install', '--no-audit', '--no-fund'], { cwd: app });

// 3. The installed copy must be the packed one.
const installed = join(app, 'node_modules/@aionbuilders/nabu/dist/index.js');
if (sha(installed) !== sha(join(ROOT, 'dist/index.js'))) fail('the installed @aionbuilders/nabu is NOT the packed one (dist/index.js differs from the repo)');
console.log('\nInstalled package matches the repo dist (dist/index.js hash).');

// 4. The published types, as an editor sees them in the app (tests/consumer/types/probe.js).
cpSync(join(ROOT, 'tests/consumer/types'), join(app, 'types-probe'), { recursive: true });
step('types', join(ROOT, 'node_modules/.bin/tsc'), ['-p', join(app, 'types-probe/tsconfig.json')]);

// 5. Production build, then the browsers.
step('vite build', 'npx', ['vite', 'build'], { cwd: app });
step('playwright', join(ROOT, 'node_modules/.bin/playwright'), ['test', '--config', 'tests/consumer/playwright.config.js'], {
  env: { NABU_CONSUMER_APP: app },
});

const secs = Math.round((Date.now() - started) / 1000);
if (KEEP) console.log(`\nKept: ${tmp}`);
else rmSync(tmp, { recursive: true, force: true });
console.log(`\nconsumer-smoke OK in ${secs}s`);
