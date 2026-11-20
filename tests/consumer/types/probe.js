// @ts-check
// Checked by scripts/consumer-smoke.js with the repo's TypeScript, against the INSTALLED package (its .d.ts files), the way an
// editor or `svelte-check` sees it in a consumer app. Every `@ts-expect-error` below must be an error: if a type became `any`,
// the directive would be unused and the check would fail.
import { createEditor, createFullEditor, DocumentPreset, RegionsExtension, Regions, stampBlockUids } from '@aionbuilders/nabu';
/** @import { RegionsEditor } from '@aionbuilders/nabu' */
import { countWords } from '@aionbuilders/nabu/format';

// `createFullEditor()` includes RegionsExtension: `nabu.regions` is typed, without `undefined`.
const full = createFullEditor();
/** @type {number} */ const count = full.regions.list.length;
// @ts-expect-error the registry is a Regions, not a string (proves it is not `any`)
/** @type {string} */ const notAString = full.regions;

// Own preset with the extension: annotate with RegionsEditor.
const custom = /** @type {RegionsEditor} */ (createEditor({ preset: DocumentPreset, extensions: [RegionsExtension()] }));
/** @type {number} */ const words = custom.regions.list.reduce((sum, region) => sum + region.wordCount, 0);

// The engine's own type never names regions (the extension installs the getter): `Regions.get()` works on any editor.
const plain = createEditor({ preset: DocumentPreset });
/** @type {number} */ const viaGet = Regions.get(plain).list.length;
// @ts-expect-error `Nabu` has no `regions`: only the extension adds it
plain.regions;

export { count, notAString, words, viaGet };

// `countWords` option: a function type-checks, a number does not; the default rule is exported from the light entry.
createEditor({ countWords: (text, lang) => 1 });
// @ts-expect-error `countWords` is a function, not a number
createEditor({ countWords: 42 });
/** @type {(text: string, lang?: string) => number} */ const defaultCounter = countWords;
export { defaultCounter };

// `stableIds` option (ADR 019): the option type-checks, `block.uid` is a string or undefined, `blockByUid` exists, `stampBlockUids` is exported.
const stable = createEditor({ stableIds: true });
// @ts-expect-error `stableIds` is a boolean, not a string
createEditor({ stableIds: 'yes' });
const firstBlock = stable.children[0];
/** @type {string | undefined} */ const uid = firstBlock.uid;
// @ts-expect-error `uid` can be undefined (option off), so it is not a plain string
/** @type {string} */ const plainUid = firstBlock.uid;
const found = stable.blockByUid('u:1@1');
// @ts-expect-error `blockByUid` can return null
found.uid;
// @ts-expect-error `blockByUid` takes a uid string
stable.blockByUid(42);
/** @type {(doc: import('loro-crdt').LoroDoc) => number} */ const stamp = stampBlockUids;
export { uid, plainUid, found, stamp };
