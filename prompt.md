Tu as accès à toute la codebase. Lis d'abord ces fichiers dans l'ordre avant d'écrire une seule ligne de test :

1. `e2e/plan.md` — le contrat de test, ta référence unique
2. `src/lib/blocks/block.svelte.js` — classe de base, ascend(), consume(), split()
3. `src/lib/blocks/nabu.svelte.js` — moteur principal, exec(), handlePaste(), insertFragment()
4. `src/lib/blocks/container.utils.js` — findLCA(), findDirectChildOf(), handleContainerBeforeInput()
5. `src/lib/behaviors/text/text.behavior.svelte.js` — calculateOffset(), getDOMPoint(), marks
6. `src/lib/blocks/selection.svelte.js` — NabuSelection
7. `src/lib/blocks/list/list.svelte.js` et `list-item.svelte.js`
8. `src/lib/blocks/dialogue/dialogue.svelte.js`
9. `src/lib/utils/extensions.js` — Extension, types PasteFragment/PasteBlock
10. `src/lib/index.js` — exports publics
11. `src/routes/+page.svelte` ou la route principale — pour savoir comment l'éditeur est monté en démo

---

## Ce que tu vas construire

Une suite de tests complète couvrant tout le plan.md, dans cette structure :
tests/
├── unit/                          ← Vitest, pas de browser
│   ├── text-behavior.test.js      ← U-TB-* (calculateOffset, getDOMPoint, marks)
│   ├── delta-markdown.test.js     ← U-MD-*
│   ├── serialize.test.js          ← U-SER-*
│   ├── consume.test.js            ← U-CON-*
│   ├── split.test.js              ← U-SPL-*
│   ├── selection.test.js          ← U-SEL-*
│   ├── wrap-orphan.test.js        ← U-WRP-*
│   ├── paste-markdown.test.js     ← U-PRS-*
│   ├── paste-html.test.js         ← U-HTML-*
│   └── ascend.test.js             ← Block.ascend() — non dans le plan mais critique
├── e2e/
│   ├── helpers/
│   │   ├── editor.ts              ← À faire EN PREMIER, fondation de tout
│   │   ├── keyboard.ts
│   │   └── clipboard.ts
│   ├── core/
│   │   ├── typing.spec.ts         ← E-TYPE-*
│   │   ├── structure.spec.ts      ← E-NAV-*
│   │   ├── marks.spec.ts          ← E-MARK-*
│   │   └── undo.spec.ts           ← E-UNDO-*
│   ├── blocks/
│   │   ├── lists.spec.ts          ← E-LIST-*
│   │   ├── dialogue.spec.ts       ← Dialogue : transformations, marks, sortie
│   │   └── transforms.spec.ts     ← E-TRF-*
│   ├── clipboard/
│   │   ├── copy.spec.ts           ← E-COPY-*
│   │   └── paste.spec.ts          ← E-PASTE-*
│   ├── persistence/
│   │   └── indexeddb.spec.ts      ← E-PERS-*
│   ├── serialize/
│   │   └── serialize.spec.ts      ← E-SER-*
│   ├── edge-cases/
│   │   └── edge.spec.ts           ← E-EDGE-*
│   ├── actions/                   ← Non dans le plan, mais critique
│   │   └── exec.spec.ts           ← nabu.exec() : mark:toggle, block:transform, list:indent, undo, redo
│   └── flaky/                     ← Suite séparée pour les FLAKY_RISK
│       └── *.flaky.spec.ts        ← Copie des tests FLAKY_RISK avec retries: 2
---

## Contraintes techniques — lis-les toutes avant de commencer

### Vitest (tests unitaires)

- Utilise `vitest` avec `bun test` comme runner
- Les classes Svelte 5 avec `$state` / `$derived` ne peuvent pas être instanciées hors contexte Svelte — tu devras mocker Nabu et les nœuds Loro dans les tests unitaires
- Pour mocker Loro : crée des objets plain JS qui imitent l'API `LoroText` (insert, delete, toDelta, sliceDelta, mark, unmark, length) — pas besoin d'importer loro-crdt
- Pour `calculateOffset` et `getDOMPoint` qui manipulent du DOM réel : utilise `happy-dom` ou `jsdom` comme environment Vitest (configure dans `vitest.config.js`)
- Ne teste pas l'intégration Svelte en unitaire — seulement la logique pure des méthodes

### Playwright (tests E2E)

- Le runner est `bunx playwright test`
- L'URL de base est `http://localhost:5173` — l'app SvelteKit de démo doit tourner pendant les tests
- Pour accéder à l'engine depuis les tests : le `DebugPanel` expose `window.nabu` quand `engine.debugging = true`. Active-le via `page.evaluate(() => window.__nabu_debug?.())` en début de chaque test qui en a besoin
- Le `contenteditable` root est accessible via `page.locator('[contenteditable="true"]')`
- **Ne jamais utiliser `fill()` sur le contenteditable** — utilise exclusivement `page.keyboard.type()` et `page.keyboard.press()`
- Pour le clipboard en E2E : Playwright nécessite `browserContext` avec permissions. Configure dans `playwright.config.ts` :
```ts
  use: {
    permissions: ['clipboard-read', 'clipboard-write'],
    contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] }
  }
```
- Pour lire le clipboard depuis un test : `page.evaluate(() => navigator.clipboard.readText())`
- Pour injecter du contenu clipboard (paste HTML, nabu+json) : injecte via `page.evaluate()` avant de déclencher Ctrl+V :
```ts
  await page.evaluate((html) => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    document.querySelector('[contenteditable]').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
    );
  }, htmlContent);
```
- Pour vérifier l'état du modèle Loro (pas juste le DOM) : utilise `page.evaluate(() => window.nabu.serialize('json'))` — c'est plus fiable que d'inspecter le DOM
- Pour la persistence IndexedDB : utilise `page.evaluate(() => indexedDB.databases())` pour vérifier l'existence des entrées

### Gestion des timings (FLAKY_RISK)

Crée un helper `waitForEditor()` dans `helpers/editor.ts` qui encapsule toute attente :
```ts
export async function waitForEditor(page) {
  // Loro commit + tick Svelte + DOM update
  await page.waitForFunction(() => {
    return window.nabu && !window.nabu._pending;
  }, { timeout: 2000 });
}
```

- Appelle `waitForEditor()` systématiquement après : Enter, Backspace, Delete, Ctrl+Z, Ctrl+Y, paste, exec()
- **Ne pas utiliser** `page.waitForTimeout()` — c'est un timeout fixe, pas une condition
- Pour les tests IDB (debounce 2s) : utilise `page.waitForFunction()` avec une condition sur `window.nabu.isNew`
- Dans `playwright.config.ts`, configure la suite flaky séparément :
```ts
  projects: [
    { name: 'core', testDir: 'tests/e2e', testIgnore: '**/flaky/**' },
    { name: 'flaky', testDir: 'tests/e2e/flaky', retries: 2, timeout: 10000 }
  ]
```

### helpers/editor.ts — à faire EN PREMIER

Ce fichier est la fondation. Il doit exposer au minimum :
```ts
export async function clearEditor(page)       // remet l'éditeur à zéro
export async function typeIn(page, text)       // type du texte dans le CE
export async function press(page, key)         // presse une touche avec waitForEditor après
export async function getBlockCount(page)      // nombre de blocs dans le modèle
export async function getBlockText(page, i)    // texte du bloc i
export async function getModelJSON(page)       // serialize('json') complet
export async function getMarkdown(page)        // serialize('markdown') complet
export async function setCursorAt(page, blockIndex, offset)
export async function selectRange(page, startBlock, startOffset, endBlock, endOffset)
export async function execAction(page, topic, data?)  // window.nabu.exec(topic, data)
export async function waitForEditor(page)
```

---

## Ordre d'implémentation strict

1. `playwright.config.ts` et `vitest.config.js` — configuration en premier
2. `tests/e2e/helpers/editor.ts` — avant tout test E2E
3. Tests unitaires P0 (section 1 du plan) — validation rapide que l'outillage fonctionne
4. `tests/e2e/core/typing.spec.ts` — smoke test E2E de base
5. Tout le reste dans l'ordre du plan : structure → marks → undo → lists → clipboard → persistence → edge cases
6. `tests/e2e/actions/exec.spec.ts` — Action Bus (hors plan, mais à inclure)
7. `tests/e2e/blocks/dialogue.spec.ts` — Dialogue complet (hors plan, mais à inclure)
8. Suite flaky en dernier : copie les tests FLAKY_RISK dans `tests/e2e/flaky/` avec retry

---

## Ce que tu ne fais PAS

- Ne modifie aucun fichier dans `src/lib/` pour faire passer les tests — si un test révèle un bug, note-le dans un commentaire `// BUG: description` mais ne corrige pas le code source
- Ne skip pas de tests P0 pour des raisons de complexité — si un test est difficile à écrire, écris-le incomplet avec un `todo()` explicite plutôt que de l'omettre
- Ne crée pas de mocks "magiques" qui font passer des tests qui devraient échouer — un test qui passe sur un mock inutile ne vaut rien

---

## Livrable final attendu

- Tous les fichiers de tests créés
- `playwright.config.ts` et `vitest.config.js` configurés et fonctionnels avec Bun
- Un fichier `tests/README.md` qui explique comment lancer chaque suite :
bun test                          # unitaires Vitest
bunx playwright test --project=core   # E2E core
bunx playwright test --project=flaky  # E2E flaky avec retries
- Un compte-rendu `tests/RESULTS.md` après la première exécution :
  liste les tests qui passent, ceux qui échouent, et les bugs trouvés (avec leur ID du plan)

Lance-toi.
Tu es 100% autonome et full autorisé