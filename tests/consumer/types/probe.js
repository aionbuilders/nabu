// @ts-check
// Checked by scripts/consumer-smoke.js with the repo's TypeScript, against the INSTALLED package (its .d.ts files), the way an
// editor or `svelte-check` sees it in a consumer app. Every `@ts-expect-error` below must be an error: if a type became `any`,
// the directive would be unused and the check would fail.
import { createEditor, createFullEditor, DocumentPreset, RegionsExtension, Regions } from '@aionbuilders/nabu';
/** @import { RegionsEditor } from '@aionbuilders/nabu' */

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
