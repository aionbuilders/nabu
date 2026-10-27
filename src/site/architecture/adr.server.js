/**
 * Reads the decision records (server only, at build time): `docs/adr/NNN-*.md`, the English text. The French originals in `docs/adr/fr/`
 * are linked to on GitHub, not rendered.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADR_DIR, parseAdr, recordsModel } from './adr.js';

/** @type {ReturnType<typeof recordsModel> | null} */
let cache = null;

export function records() {
  if (cache) return cache;
  const root = process.cwd();
  const adrs = readdirSync(resolve(root, ADR_DIR))
    .filter((n) => /^\d{3}-.+\.md$/.test(n))
    .sort()
    .map((n) => parseAdr(readFileSync(resolve(root, ADR_DIR, n), 'utf8'), `${ADR_DIR}/${n}`));
  for (const a of adrs) {
    if (a.status === 'unknown') throw new Error(`${a.file}: unrecognised Status "${a.statusText}" (accepted, superseded or proposed)`);
  }
  cache = recordsModel(adrs);
  return cache;
}
