// @ts-nocheck
/**
 * Compatibility guard: Nabu must load on Safari 15 (macOS 12's WebKit, 613). That engine has no RegExp lookbehind (Safari 16.4+)
 * and no RegExp `v` flag (Safari 17+): a regex literal using either is a SyntaxError when the module is parsed, which kills the
 * whole app bundle, and the same in a `new RegExp(...)` string throws when that line runs. This scans `src/` (and the built
 * `dist/` when it exists) and fails with the file and line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const EXTENSIONS = new Set(['.js', '.mjs', '.svelte', '.ts']);

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (EXTENSIONS.has(extname(name)) && !/\.(test|spec)\./.test(name)) out.push(full);
  }
  return out;
}

const LOOKBEHIND = /\(\?<[=!]/;
// A regex literal closed by flags that include `v`: `/…/v`, `/…/gv`, `/…/uv`... (then a delimiter), or `new RegExp(…, 'v')`.
const V_FLAG_LITERAL = /\/[dgimsuy]*v[dgimsuy]*(?=[\s.,;:)\]}]|$)/;
const V_FLAG_CTOR = /new RegExp\([^)]*,\s*['"`][dgimsuy]*v[dgimsuy]*['"`]\s*\)/;

/** Lines of a file that break Safari 15, as `path:line: text`. @param {string} file */
function offences(file) {
  const rel = relative(ROOT, file);
  const found = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return; // comments may talk about lookbehinds
    if (LOOKBEHIND.test(line)) found.push(`${rel}:${i + 1}: RegExp lookbehind: ${code}`);
    if (V_FLAG_CTOR.test(line) || (/\/[^/\s][^/]*\/[dgimsuy]*v/.test(line) && V_FLAG_LITERAL.test(line))) found.push(`${rel}:${i + 1}: RegExp "v" flag: ${code}`);
  });
  return found;
}

describe('Safari 15 compatibility (macOS 12)', () => {
  it('the detector sees lookbehinds and the v flag', () => {
    expect(LOOKBEHIND.test('/(?<=a)b/')).toBe(true);
    expect(LOOKBEHIND.test('new RegExp(`(?<!x)y`)')).toBe(true);
    expect(LOOKBEHIND.test('/(?:a)(?=b)/')).toBe(false);
    expect(V_FLAG_CTOR.test("new RegExp('[a--b]', 'v')")).toBe(true);
    expect(V_FLAG_LITERAL.test('const r = /[\\p{L}--[a-z]]/v;')).toBe(true);
    expect(V_FLAG_LITERAL.test('const r = /abc/u;')).toBe(false);
  });

  it('src/ has no RegExp lookbehind and no "v" flag', () => {
    const files = sourceFiles(resolve(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap(offences)).toEqual([]);
  });

  it.skipIf(!existsSync(resolve(ROOT, 'dist')))('the built dist/ has none either', () => {
    const files = sourceFiles(resolve(ROOT, 'dist'));
    expect(files.flatMap(offences)).toEqual([]);
  });
});
