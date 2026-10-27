// @ts-nocheck
/**
 * The documentation is tested: every code block of `README.md` and `docs/**\/*.md` that is meant to run is fenced as
 *
 *     ```js test
 *
 * and is executed here, in the same vitest + happy-dom environment as the other unit tests. A failing snippet is reported
 * under the name `<file>:<line>` (the line of its first code line), so the page to fix is one click away.
 *
 * Conventions for the pages (see docs/README or the existing pages):
 * - ```js test      runs. It imports the PUBLIC package names (`@aionbuilders/nabu`, `/ui`, `/extend`, `/vite`; vitest.config.js
 *                   aliases them to the source entry files), may use top-level `await`, and checks what it claims with the global
 *                   `expect` (vitest globals are on). A snippet is its own module: nothing is shared between two blocks.
 * - ```svelte       a component. It cannot run here (no browser), but it MUST compile (`svelte/compiler`).
 * - ```js / others  illustrative only (shell, config files, partial code): not run.
 *
 * Pages under `docs/getting-started`, `docs/guides` and `docs/recipes` must also carry the YAML frontmatter the website needs:
 * `title`, `description`, `section`, `order`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { compile } from 'svelte/compiler';

// vitest runs from the project root (happy-dom replaces the global URL, so `import.meta.url` is not usable here).
const ROOT = process.cwd();
const OUT = join(ROOT, 'tests/unit/.docs-snippets');
const SECTIONS = ['getting-started', 'guides', 'recipes'];

/** @returns {string[]} markdown files (absolute paths): README.md and docs/**.md (the archive is frozen history: skipped) */
function markdownFiles() {
  const files = [join(ROOT, 'README.md')];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'archive') walk(full);
      } else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  walk(join(ROOT, 'docs'));
  return files.filter((f) => existsSync(f)).sort();
}

/**
 * Fenced code blocks of a markdown source: `{ lang, flags, line, code }` (`line` = 1-based line of the first code line).
 * @param {string} source
 */
export function extractBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*(.*)$/.exec(lines[i]);
    if (!open) continue;
    const [, indent, fence, info] = open;
    const [lang = '', ...flags] = info.trim().split(/\s+/).filter(Boolean);
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[j]);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
      body.push(indent && lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    blocks.push({ lang, flags, line: i + 2, code: body.join('\n') });
    i = j;
  }
  return blocks;
}

/** @param {string} source @returns {Record<string, string> | null} the flat `key: value` frontmatter, or null when there is none */
function frontmatter(source) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^["'](.*)["']$/, '$1');
  }
  return data;
}

const pages = markdownFiles().map((file) => {
  const source = readFileSync(file, 'utf8');
  return { file, rel: relative(ROOT, file).split(sep).join('/'), source, blocks: extractBlocks(source) };
});

const snippets = pages.flatMap((p) =>
  p.blocks.filter((b) => b.lang === 'js' && b.flags.includes('test')).map((b) => ({ ...b, page: p })),
);
const components = pages.flatMap((p) => p.blocks.filter((b) => b.lang === 'svelte').map((b) => ({ ...b, page: p })));

// The snippets are written to real modules (so that vite resolves the package aliases, `await` and `import` just work).
if (snippets.length) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}
const snippetFile = (s) => join(OUT, `${s.page.rel.replace(/[^A-Za-z0-9]+/g, '_')}_L${s.line}.js`);
for (const s of snippets) writeFileSync(snippetFile(s), `// @ts-nocheck\n// ${s.page.rel}:${s.line}\n${s.code}\n`);

afterAll(() => rmSync(OUT, { recursive: true, force: true }));

describe('docs: ```js test snippets run', () => {
  it('finds snippets (the extraction itself works)', () => {
    expect(snippets.length).toBeGreaterThan(0);
  });

  it.each(snippets.map((s) => [`${s.page.rel}:${s.line}`, s]))('%s', async (name, s) => {
    try {
      await import(/* @vite-ignore */ snippetFile(s));
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      e.message = `Documentation snippet ${name} failed: ${e.message}`;
      throw e;
    }
  });
});

describe('docs: ```svelte components compile', () => {
  it.each(components.map((c) => [`${c.page.rel}:${c.line}`, c]))('%s', (name, c) => {
    expect(() => compile(c.code, { filename: 'Snippet.svelte', generate: 'client' }), `Documentation component ${name}`).not.toThrow();
  });
});

describe('docs: extraction', () => {
  it('reads fences, flags and line numbers', () => {
    const blocks = extractBlocks('intro\n\n```js test\nconst a = 1;\n```\n\n````md\n```js test\nnot a block\n```\n````\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ lang: 'js', flags: ['test'], line: 4, code: 'const a = 1;' });
    expect(blocks[1].lang).toBe('md');
  });
});

describe('docs: frontmatter of the website pages', () => {
  const site = pages.filter((p) => SECTIONS.some((s) => p.rel.startsWith(`docs/${s}/`)));

  it('there are pages', () => expect(site.length).toBeGreaterThan(0));

  it.each(site.map((p) => [p.rel, p]))('%s', (rel, p) => {
    const fm = frontmatter(p.source);
    expect(fm, `${rel}: missing YAML frontmatter`).not.toBeNull();
    expect(fm.title, `${rel}: title`).toBeTruthy();
    expect(fm.description, `${rel}: description`).toBeTruthy();
    expect(SECTIONS, `${rel}: section`).toContain(fm.section);
    expect(rel.startsWith(`docs/${fm.section}/`), `${rel}: section must match its folder`).toBe(true);
    expect(Number.isFinite(Number(fm.order)) && fm.order !== '', `${rel}: order must be a number`).toBe(true);
  });
});
