/**
 * Reads the architecture chapters (server only, at build time): `docs/architecture/chapters/NN-slug.md`. There may be none yet, or seven.
 * The e2e build (`build:e2e`, VITE_NABU_E2E=1) also reads the fixture chapter of tests/fixtures/architecture/chapters/, so the chapter
 * route is tested before the real ones exist and next to them; the production build never does.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAPTERS_DIR, parseChapter } from './chapters.js';

export const FIXTURE_CHAPTERS_DIR = 'tests/fixtures/architecture/chapters';

/** @type {import('./chapters.js').Chapter[] | null} */
let cache = null;

/** The chapters that exist, in reading order (fixtures last). */
export function chapters() {
  if (cache) return cache;
  const root = process.cwd();
  const dirs = [CHAPTERS_DIR, ...(import.meta.env.VITE_NABU_E2E === '1' ? [FIXTURE_CHAPTERS_DIR] : [])];
  /** @type {import('./chapters.js').Chapter[]} */
  const found = [];
  for (const dir of dirs) {
    if (!existsSync(resolve(root, dir))) continue;
    for (const name of readdirSync(resolve(root, dir)).filter((n) => n.endsWith('.md')).sort()) {
      found.push(parseChapter(readFileSync(resolve(root, dir, name), 'utf8'), `${dir}/${name}`));
    }
  }
  found.sort((a, b) => a.n - b.n);
  const seen = new Map();
  for (const c of found) {
    if (seen.has(c.slug)) throw new Error(`${c.file}: the slug "${c.slug}" is used by ${seen.get(c.slug)} too`);
    seen.set(c.slug, c.file);
  }
  cache = found;
  return found;
}

/** The file names of the chapters (`04-where-is-the-caret.md`), for the links between chapters. */
export const chapterFiles = () => new Set(chapters().map((c) => c.file.split('/').pop() ?? ''));
