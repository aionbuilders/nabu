import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { FILES, KIT_NAME } from '../../../../../site/brand/files.js';
import { zip } from '../../../../../site/brand/zip.js';

// The brand files are served from `brand/` (the single source of truth) at stable URLs, `/brand/files/<name>`, and the kit is
// zipped from the same files. Everything is written at BUILD time (prerender): no copy of the files to keep in sync, nothing to
// read from disk at runtime, and the links cannot 404 (`entries` lists exactly what exists; anything else is a 404).
export const prerender = true;

const BRAND_DIR = join(process.cwd(), 'brand');
const read = (/** @type {string} */ name) => new Uint8Array(readFileSync(join(BRAND_DIR, name)));

export const entries = () => [...FILES.map((f) => ({ file: f.name })), { file: KIT_NAME }];

/** @type {import('./$types').RequestHandler} */
export function GET({ params }) {
  if (params.file === KIT_NAME) {
    const body = zip(FILES.map((f) => ({ name: `nabu-brand/${f.name}`, data: read(f.name) })));
    return new Response(new Blob([body]), { headers: { 'Content-Type': 'application/zip' } });
  }
  const file = FILES.find((f) => f.name === params.file);
  if (!file) error(404, 'Not found');
  return new Response(new Blob([read(file.name)]), { headers: { 'Content-Type': file.type } });
}
