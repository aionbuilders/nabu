// @ts-nocheck
/**
 * Architecture guards around the list normalizer:
 *  - the core engine stays agnostic (no import of any concrete block folder);
 *  - the normalizer is opt-in: it only runs when the List extension is installed.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { MinimalPreset } from '$lib/presets.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { normalizeLists } from '$lib/blocks/list/normalize.js';

vi.mock('$lib/blocks/list/normalize.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, normalizeLists: vi.fn(actual.normalizeLists) };
});

const root = resolve(__dirname, '../../src/lib');
const CORE_FILES = [
  'blocks/nabu.svelte.js',
  'blocks/block.svelte.js',
  'blocks/megablock.svelte.js',
  'blocks/container.utils.js',
  'blocks/selection.svelte.js',
  'blocks/undo-selection.js',
  'utils/extensions.js',
  'blocks/block.extension.js',
  'ui/slash-menu.svelte.js',
];

const blockFolders = readdirSync(join(root, 'blocks')).filter((name) => statSync(join(root, 'blocks', name)).isDirectory());

/** Module specifiers of every static / dynamic import and re-export of a source file. */
function importSpecifiers(source) {
  const specs = [];
  const re = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) specs.push(m[1]);
  return specs;
}

describe('core agnosticism guard', () => {
  it('there is at least one concrete block folder to guard against (sanity)', () => {
    expect(blockFolders).toContain('list');
    expect(blockFolders).toContain('paragraph');
  });

  for (const file of CORE_FILES) {
    it(`${file} imports no concrete block folder (list, paragraph, ...)`, () => {
      const specs = importSpecifiers(readFileSync(join(root, file), 'utf8'));
      const offenders = specs.filter((spec) => {
        const segments = spec.split(/[\\/]/);
        return blockFolders.some((folder) => segments.includes(folder));
      });
      expect(offenders).toEqual([]);
    });
  }
});

describe('list normalizer is opt-in', () => {
  it('MinimalPreset registers no list hook and commits never run the normalizer', async () => {
    normalizeLists.mockClear();
    const engine = new Nabu({ extensions: MinimalPreset });
    await engine.commit();
    await engine.commit();

    expect(engine.hooks.get('onBeforeTransaction') ?? []).not.toContain(normalizeLists);
    expect(engine.registry.has('list')).toBe(false);
    expect(engine.blocksByType.get('list')).toBeUndefined();
    expect(normalizeLists).not.toHaveBeenCalled();
  });

  it('positive control: with the List extension, commits do run it', async () => {
    normalizeLists.mockClear();
    const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension] });
    await engine.commit();

    expect(engine.hooks.get('onBeforeTransaction')).toContain(normalizeLists);
    expect(normalizeLists).toHaveBeenCalled();
  });
});
