# Nabu and the others: research notes

Prepared 2026-10-27 for the website page "Nabu and the others". Facts only; the copywriting comes later.

## 0. How to read this file

- **Access date.** Every web source below was accessed on **2026-10-27**. I only repeat the date in the header of each section, not on every line.
- **Source tags.** `[npm]` = `https://registry.npmjs.org/<package>` (publish dates, versions, licences, peer deps). `[dl]` = `https://api.npmjs.org/downloads/point/last-month/<package>` (window 2026-09-27 to 2026-10-26). `[gh]` = `https://api.github.com/repos/<owner>/<repo>` (stars, licence, dates). `[bp]` = `https://bundlephobia.com/api/size?package=<package>`. Other URLs are written out in full.
- **How the web pages were read.** Most doc pages were fetched through a summarising tool, not read raw. Where the summary said "the page does not mention X", I report "not stated on that page", never "does not exist". Anything I could not confirm is tagged **[unverified]**. Contradictions are tagged **[contradiction]**.
- **Numbers.** Star counts are GitHub API values on 2026-10-27, to be quoted as an order of magnitude. npm download counts are inflated by CI and mirrors (and ProseMirror's are inflated further by Tiptap and others depending on it); use only for ordering.
- **Bundle sizes.** Bundlephobia measures one package plus its non-peer dependencies, minified + gzip. The figures are **not comparable** between editors (Tiptap's core has ProseMirror as a peer; Nabu's cost is mostly a WebAssembly file). They are given so the page can say something real, with that caveat.
- **Nabu facts** come from the repo itself (`README.md`, `docs/**`, `CHANGELOG.md`, `package.json`, `docs/audit/2026-10.md`), plus npm for publish dates.

---

## 1. Fact sheets: the others

### 1.1 ProseMirror

- **Model.** Schema-bound, immutable document tree (nodes + marks); edits are *steps* grouped into *transactions*; inline content is a flat sequence with marks as metadata. Source: https://prosemirror.net/docs/guide/
- **Relation to contenteditable.** One editable DOM root. The view renders the document into it, syncs the DOM selection with the state, **leaves typing mostly to the browser**, then re-parses the changed DOM into a transaction (same page: partly to keep behaviours like mobile autocapitalisation). https://prosemirror.net/docs/guide/ . Historical rationale (letting the browser mutate text nodes and rolling back, at the cost of "edit flashes"): https://lists.w3.org/Archives/Public/public-editing-tf/2017Feb/0035.html
- **Collaboration / offline.**
  - Official module `prosemirror-collab`: a **central authority** orders steps; rejected clients rebase and resubmit (OT-style, not a CRDT). https://prosemirror.net/docs/guide/ ; npm `prosemirror-collab` 1.3.1, last published 2023-05-17 [npm].
  - CRDT bindings are third-party: `y-prosemirror` 1.3.7 (2025-07-03) [npm]; `loro-prosemirror` 0.4.4 (2026-08-22, MIT, 144 stars on GitHub), providing sync, cursor/presence and undo for Loro: https://github.com/loro-dev/loro-prosemirror
  - No built-in offline persistence or network transport.
- **Framework support.** Framework-agnostic core, no official Svelte package. Svelte options: `@prosemirror-adapter/svelte` 0.5.5 (2026-07-24, peer `svelte ^4 || ^5`, repo `prosekit/prosemirror-adapter`, ~86k downloads/month) [npm][dl]; ProseKit (see 1.9).
- **Capabilities.**
  - Tables: `prosemirror-tables` 1.8.5 (2025-12-24, MIT): rowspan/colspan, `CellSelection`, add/delete/merge/split commands, copy/paste of cells. https://github.com/ProseMirror/prosemirror-tables
  - Markdown: `prosemirror-markdown` 1.13.9 (2026-10-22, MIT) [npm].
  - Mobile: the guide makes no mobile support claim (https://prosemirror.net/docs/guide/). The `prosemirror-view` changelog shows a continuing stream of Android fixes (SwiftKey Backspace read as Enter, Chrome Android deletions read as Enter, multi-line paste from a virtual keyboard): https://unpkg.com/prosemirror-view@1.42.8/CHANGELOG.md . Forum threads show open pain: https://discuss.prosemirror.net/t/contenteditable-on-android-is-the-absolute-worst/3810 , https://discuss.prosemirror.net/t/samsung-keyboard-within-android-webview-causes-a-spam-of-new-lines/5246
  - Extension API: plugin system (state, view, props, transactions); everything else (UI, toolbars, slash menus, block handles) is yours to build. https://prosemirror.net/
- **Project facts.**
  - Licence MIT [gh][npm]. No paid tier; the site asks commercial users to help fund maintenance ("a social expectation"). Sponsors named: Posit, The New York Times, Tiptap, Asana, Box, Desmos, The Guardian, Fellow, Sunsama and others. https://prosemirror.net/
  - Maturity: npm packages since 2016-09-21 (`prosemirror-model`); `prosemirror-view` 1.42.8 published 2026-10-24, 313 versions [npm]. Development is on Forgejo per the site, so the GitHub repo's `pushed_at` (2026-04-01) is a mirror signal, not an activity signal [gh]. GitHub stars (umbrella repo): ~8.7k [gh]. npm downloads of `prosemirror-view`: ~95M/month [dl] (mostly transitive).
  - Bundle: `prosemirror-view` 55 KB gzip alone (plus model/state/transform it depends on) [bp].
- **Known weaknesses (acknowledged).** Low-level: you assemble schema, commands, plugins and UI. Android/IME is an ongoing area (changelog above). The home page still mentions IE11 support, which is stale (https://prosemirror.net/). Collab module needs your own authority server.

### 1.2 Tiptap

- **Model.** Headless layer over ProseMirror: same schema/document tree, with an `Editor` class, extensions, commands. https://tiptap.dev/docs/editor/getting-started/overview . One contenteditable (inherited from ProseMirror).
- **Collaboration / offline.**
  - Collaboration uses **Yjs**. Backend **Hocuspocus is open source**; **Tiptap Collaboration (cloud or on-prem) is paid**. Swapping means replacing `HocuspocusProvider` with `TiptapCollabProvider`. https://tiptap.dev/docs/collaboration/getting-started/overview
  - Offline: documented as a guide using `y-indexeddb` next to the provider: https://tiptap.dev/docs/guides/offline-support . (A GitHub comment says maintainers removed IndexedDB from the official collab example after corrupted-local-data sync problems, informal and undated: https://github.com/ueberdosis/hocuspocus/issues/84 . **[unverified]** whether it still applies.)
  - `@tiptap/extension-collaboration` is MIT [npm].
- **Framework support.** "Headless; plug into React, Vue, Svelte, plain JS". Official **Svelte guide** uses `@tiptap/core` directly, with an `Editor` created in `onMount`; the main guide targets Svelte 5 runes: https://tiptap.dev/docs/editor/getting-started/install/svelte . No `@tiptap/svelte` package exists (404 on npm). Official wrappers are `@tiptap/react` and `@tiptap/vue-3` [npm]. The home page names React as the only framework with UI components/templates: https://tiptap.dev/ . Community Svelte wrappers: see 1.9.
- **Capabilities.**
  - Tables: `@tiptap/extension-table` (MIT), insert/delete rows and columns, merge/split cells, header toggles, resizable (off by default): https://tiptap.dev/docs/editor/extensions/nodes/table
  - Markdown: `@tiptap/markdown` 3.32.0 (MIT); the docs warn it is "an early release and can be subject to change": https://tiptap.dev/docs/editor/markdown . Paid tier also lists DOCX/Markdown import and DOCX/PDF/ODT/EPUB/Markdown export.
  - Mobile: no statement found. **[unverified]**; inherits ProseMirror's behaviour.
  - Extension API: extensions for nodes, marks and behaviours; 100+ extensions claimed on https://tiptap.dev/ .
- **Project facts.**
  - Editor core MIT. Paid "Tiptap Platform" (per https://tiptap.dev/pricing , read through a summarising tool, verify before quoting): Start $59/month ($49 annual), Team $179 ($149), Business $1,199 ($999), Enterprise custom; **no permanent free plan**, 30-day trial on Start and Team. Includes real-time collaboration, AI, comments, document history, DOCX/Markdown conversion, cloud documents (500 / 5,000 / 50,000 per environment). Third-party articles list the same Start/Team figures (https://dev.to/eddyter/tiptap-pricing-explained-2026-free-vs-pro-vs-cloud-cost-breakdown-3l5g).
  - In June 2025 Tiptap open-sourced (MIT) more extensions (Details, Emoji, DragHandle, FileHandler, Mathematics, TableOfContents, UniqueID, …) and **sunset the free Tiptap Cloud tier**: https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap . The same post says collaboration, AI, conversion and documents remain paid.
  - Maturity: `@tiptap/core` on npm since 2020-11-16, v3.32.0 on 2026-10-13, 513 versions [npm]; GitHub repo created 2018-08-20, ~39k stars [gh]; ~85M npm downloads/month [dl] (transitive heavy). Notable users (logos on the home page, not necessarily what each uses it for): Notion, GitLab, Substack, Spotify, LinkedIn, Cursor, PostHog, Datadog, Bluesky and others: https://tiptap.dev/
  - Bundle: `@tiptap/core` 37 KB gzip (ProseMirror is a peer, not counted); `@tiptap/starter-kit` 106 KB gzip [bp].
- **Known weaknesses (acknowledged).** The features most teams want next to the editor (collaboration server, AI, version history, DOCX/PDF conversion) are paid; markdown extension labelled early release; React-first UI; 921 open GitHub issues [gh].

### 1.3 Lexical

- **Model.** Immutable **EditorState**: a node tree under a `RootNode` plus a selection; "the editor state, not the DOM, is the source of truth"; `toJSON()` to save; updates in synchronous `editor.update()` callbacks, batched; reconciler patches only changed DOM. It "attaches to a `contenteditable` element and keeps its own model". One contenteditable root. https://lexical.dev/docs/intro
- **Collaboration / offline.** Yjs-based: `@lexical/yjs` (MIT). `y-websocket` is "the only officially supported Yjs connection provider at this point"; docs warn clients must not bootstrap initial content concurrently in production. Offline storage is left to the provider and is not explained. https://lexical.dev/docs/collaboration/react . The docs say the collab plugin is for React; the binding `createYjsBinding` is usable outside React.
- **Framework support.** "Works with any UI framework, with official React bindings" (https://github.com/facebook/lexical). No official Svelte package. Community: `svelte-lexical` 0.6.5 (2026-07-15, peer `svelte ^5`, MIT, 599 stars, personal GitHub account `umaranis`, ~15k downloads/month) [npm][gh][dl].
- **Capabilities.**
  - Tables: `@lexical/table` (MIT). Cell selection, headers, copy/paste. Caveats stated: no nested tables; pasting a table into a cell is blocked; nested tables in pasted HTML are dropped by default. https://lexical.dev/docs/packages/lexical-table
  - Markdown, HTML and JSON import/export: README (https://github.com/facebook/lexical); `@lexical/markdown` 0.52.0 [npm].
  - Mobile: the README makes no mobile statement. Release 0.52.0 (2026-09-28) is described as "an ad-hoc release for mobile text input fixes", "as we move towards Lexical 1.0": https://github.com/facebook/lexical/releases . README browser list: Chrome 86+, Firefox 115+, Safari 15+, Edge 86+.
  - Extension API: extensions bundling nodes, config, commands, listeners; custom nodes; commands and transforms. https://lexical.dev/docs/intro
- **Project facts.**
  - MIT [gh]. No paid tier.
  - Maturity: GitHub repo created 2020-12-03, ~24k stars [gh]; current 0.52.0 (2026-09-28), 731 versions including nightlies [npm]. **Still pre-1.0** and ships breaking changes (0.52.0 notes: selection command timing moved before DOM reconciliation, a removed API, deprecations): https://github.com/facebook/lexical/releases . ~22M npm downloads/month [dl].
  - Users: "powers text editing in Meta's web products and at Bloomberg"; Payload CMS and Supabase listed (https://lexical.dev/docs/intro); `@payloadcms/richtext-lexical` exists [npm].
  - Bundle: `lexical` 63 KB gzip; `@lexical/rich-text` 80 KB gzip (includes core) [bp].
- **Known weaknesses (acknowledged).** Pre-1.0 with breaking changes in releases; collaboration officially supports one provider; mobile text input is still being fixed (0.52.0 notes); table nesting limits above.

### 1.4 Slate (and Plate)

**Slate**

- **Model.** "A pluggable implementation of `contenteditable` built on top of React": recursive tree, **schema-less core**, JSON-like data. Inspired by Draft.js, ProseMirror, Quill. https://docs.slatejs.org/ . One contenteditable managed by `slate-react`.
- **Collaboration / offline.** The model is "designed to allow for collaborative editing to be layered on top" (https://github.com/ianstormtaylor/slate). No built-in collaboration. Yjs binding is third-party: `@slate-yjs/core` 1.0.2, last published **2023-07-11** [npm].
- **Framework support.** React only: "built on top of React"; `slate-react` provides the components (https://github.com/ianstormtaylor/slate). No Svelte binding mentioned.
- **Capabilities.** No tables, markdown or UI in core (bring-your-own; Plate provides them). Mobile: the FAQ says Chrome on Android was unsupported except in an old release and was added later, through compositions and DOM mutations instead of `beforeinput`, so it "may have more bugs": https://docs.slatejs.org/general/faq (seen via search snippet; **[unverified]** against the live page). Extension model: plugins as function composition over the editor object (https://docs.slatejs.org/concepts/xx-migrating).
- **Project facts.**
  - MIT [gh]. GitHub created 2016-06-18, ~32k stars [gh]. npm `slate` 0.147.4 (2026-10-26), 937 versions [npm]; ~11M downloads/month [dl].
  - Self-described **beta**: "Slate is currently in beta"; "There isn't currently a 1.0 release schedule, we're still getting the architecture right." https://github.com/ianstormtaylor/slate , https://docs.slatejs.org/ .
  - GitHub shows only **6 open issues** against ~32k stars [gh] **[unverified]**: unusual, may reflect a triage purge; do not use as a quality signal.
  - Bundle: `slate` 32 KB gzip; `slate-react` 26 KB gzip [bp].
- **Known weaknesses (acknowledged).** Beta, API may break, no 1.0 schedule; React-only; Android support newer and less mature (FAQ above).

**Plate** (`platejs`, a React framework on top of Slate)

- **Model/framework.** Built on Slate; `platejs` has `react >= 18` as a peer dependency [npm]. React only. Repo description: "Rich-text editor with AI and shadcn/ui" (https://github.com/udecode/plate).
- **Collaboration / offline.** `@platejs/yjs` 53.2.0: Yjs binding with provider wrappers for **IndexedDB, Hocuspocus and WebRTC**, plus custom providers (https://unpkg.com/@platejs/yjs/README.md).
- **Capabilities.** `@platejs/table`, `@platejs/markdown` (uses unified/remark/marked) [npm].
- **Project facts.** Licence MIT, with "Unless otherwise specified in a LICENSE file within an individual package directory" (https://raw.githubusercontent.com/udecode/plate/main/LICENSE); GitHub API reports `NOASSERTION` [gh]. ~17k stars [gh]; `platejs` 53.3.18 (2026-10-18), 54.0.0-beta.1 on the beta tag [npm]; ~1.9M downloads/month [dl]. **Plate Plus** (paid, one-time): Personal EUR 299, Teams EUR 799; 100+ premium components and the "Potion" AI template: https://pro.platejs.org/pricing . The core is free.
- **Known weaknesses.** React only; inherits Slate's beta status. I could not read platejs.org docs (HTTP 500), so no Plate-specific self-acknowledged limits were collected. **[unverified]**.

### 1.5 BlockNote

- **Model.** Block-based JSON document (`editor.document`), documented as "guaranteed to be lossless" and recommended for storage. Built on **ProseMirror and Tiptap** (README: https://github.com/TypeCellOS/BlockNote). One contenteditable (ProseMirror). Formats: https://www.blocknotejs.org/docs/foundations/supported-formats
- **Collaboration / offline.** **Yjs** via a `withCollaboration` helper; providers y-webrtc (WebRTC + BroadcastChannel), `y-indexeddb` "for offline storage", hosted options Liveblocks or Y-Sweet. Collaboration and comments are in the free tier. https://www.blocknotejs.org/docs/features/collaboration , https://www.blocknotejs.org/pricing
- **Framework support.** "The AI-native, open source rich text editor **for React**" (https://www.blocknotejs.org/). UI packages: Mantine, shadcn, Ariakit. A vanilla-JS guide exists but "We recommend using BlockNote with React"; without React you lose the built-in UI and build your own: https://www.blocknotejs.org/docs/getting-started/vanilla-js . No Svelte package found. **[unverified]** whether any community wrapper exists.
- **Capabilities.**
  - Tables: built-in table block; split cells, cell colours and headers are opt-in options (search result for https://www.blocknotejs.org/docs/features/blocks/tables ; cell-merge support in the shape of `colspan`/`rowspan`).
  - Markdown / HTML: both **lossy** ("converting to and from Markdown is a lossy conversion"; parser covers a minimal CommonMark/GFM subset). DOCX/PDF/ODT/Email/Typst export: Pro. https://www.blocknotejs.org/docs/foundations/supported-formats
  - Mobile: an "experimental mobile formatting toolbar" example is flagged experimental due to flicker (https://www.blocknotejs.org/examples/ui-components/experimental-mobile-formatting-toolbar); an open Android Chrome issue about popovers closing: https://github.com/TypeCellOS/BlockNote/issues/2146 (**[unverified]** current status).
  - Extension API: custom blocks, inline content, styles (https://www.blocknotejs.org/docs/custom-schemas/custom-blocks); slash menu, side menu with drag handle, format menu.
- **Project facts.**
  - Licence: core **MPL-2.0** (file-level copyleft: changes to BlockNote source files must be published; usable in closed-source apps). **XL packages** (AI, multi-column, DOCX/PDF/ODT/email exporters) are **GPL-3.0 OR PROPRIETARY** [npm]; commercial licence via Business, **$390/month listed, shown as $195/month with a "-50%" marker, $2,340 billed yearly**, one app per licence; Community free; Enterprise custom: https://www.blocknotejs.org/pricing . (The price display is a promotion; verify.)
  - Maturity: GitHub created 2022-03-02, ~10k stars [gh]; npm `@blocknote/core` since 2022-08-23, **v0.56.0 (2026-10-14), pre-1.0**, 158 versions, about monthly releases [npm]; ~2.9M downloads/month [dl]. Supporters named on the home page: NLnet, DINUM, OpenProject, Twenty and others; "France, Germany and the Netherlands use it for Docs" (https://www.blocknotejs.org/).
  - Bundle: `@blocknote/core` 188 KB gzip main (+ lazy chunks) [bp].
- **Known weaknesses (acknowledged).** Pre-1.0; React-first; lossy markdown/HTML; "suggestions and versioning" listed as coming soon (home page); non-React usage is discouraged by its own docs.

### 1.6 Editor.js

- **Model.** Block tool pattern: output is a **clean JSON** list of blocks. Each block is "an independent **contenteditable** element (or more complex structure)" supplied by a plugin and coordinated by the core, so it is **one contenteditable per block**. https://editorjs.io/
- **Collaboration / offline.** None shipped. The README roadmap lists "Collaborative editing" as planned work (https://github.com/codex-team/editor.js). No CRDT binding found on npm in a search for "editorjs yjs" (only unrelated results) **[unverified]**. No offline persistence.
- **Framework support.** Vanilla JS, framework-agnostic; no framework named on the home page. Svelte: no official package found; **[unverified]** community wrappers.
- **Capabilities.**
  - Tables: `@editorjs/table` 2.4.6 (2026-08-17, MIT) as a separate tool [npm]. Lists: `@editorjs/list` 2.0.9.
  - Markdown: no official import/export found. **[unverified]**
  - Mobile: README says nothing about mobile *editing* (it says the JSON can be consumed on iOS/Android). Release 2.32.0-rc.1 (2026-10-26) mentions a responsive action rail "on non-mobile viewports": https://github.com/codex-team/editor.js/releases
  - Extension API: tools (blocks), inline tools, block tunes, "simple API". https://editorjs.io/
- **Project facts.**
  - Apache-2.0 [gh][npm]. Free; sponsors via Open Collective (Mister Auto, UPLUCID, Content Harmony, …): https://github.com/codex-team/editor.js
  - Maturity: GitHub created 2015-11-28, ~32k stars [gh]; npm since 2019-02-28; latest **2.31.7 (2026-09-17)**, **2.32.0-rc.1 (2026-10-26)**; releases about monthly to a few per year (2.31.3 Feb, .4 Mar, .5 Mar, .6 Apr, .7 Sep) [npm][github releases]. ~1.2M downloads/month [dl].
  - Bundle: `@editorjs/editorjs` 64 KB gzip [bp].
- **Known weaknesses (acknowledged).** Roadmap lists collaborative editing, **cross-block selection and caret movement**, unified toolbars and drag-and-drop as planned (https://github.com/codex-team/editor.js), which is the consequence of one-contenteditable-per-block; 703 open issues [gh].

### 1.7 Quill

- **Model.** **Delta**: JSON `ops` (insert / retain / delete) with `attributes`; line formats live on the newline; "suitable for Operational Transform". https://quilljs.com/docs/delta . One editor root (Parchment-based DOM model). **[unverified]** The single-contenteditable detail was not found on a fetched page.
- **Collaboration / offline.** Delta is designed for OT (above); no built-in collaboration or persistence. Yjs bindings are third-party **[unverified]**.
- **Framework support.** Vanilla JS. No official Svelte package found **[unverified]**; wrappers exist for other frameworks (not checked).
- **Capabilities.**
  - Tables: `table.ts` and `tableEmbed.ts` exist in `packages/quill/src/modules` (https://api.github.com/repos/slab/quill/contents/packages/quill/src/modules), but the long-running "Add support for tables" issue (#117, open since 2014-05-22, no substantive update since 2024) points users to third parties such as `quill-table-better` (MIT, 1.2.3, 2025-09-04) [npm]: https://github.com/slab/quill/issues/117 . The official docs page for a table module returned 404 for me.
  - Markdown: no official import/export found. **[unverified]**
  - Mobile: "Supports all modern browsers on desktops, tablets and phones" (https://quilljs.com/). 2.0 notes: "improved IME and spell-checker handling" and Safari composition fixes: https://github.com/slab/quill/blob/main/CHANGELOG.md
  - Extension API: modules, formats (Parchment blots), themes.
- **Project facts.**
  - BSD-3-Clause [gh][npm]. No paid tier. GitHub repo `slab/quill` created 2012-07-30, ~47k stars [gh] (the highest of this set).
  - Maturity: **v2.0.0 on 2024-04-17; latest 2.0.3 on 2024-11-30**; npm last modified 2025-01-20; GitHub last push **2025-07-25** [npm][gh]. That is about 11 months without a push as of 2026-10-27. 1.x line ended at 1.3.7 (2019-09-09). ~24M downloads/month [dl]. The repository states no maintenance policy or EOL (changelog page).
  - Bundle: `quill` 57 KB gzip [bp].
- **Known weaknesses (acknowledged).** Tables are the oldest open feature request in the tracker (#117); release cadence has slowed to near zero since late 2024; 664 open issues [gh].

### 1.8 Milkdown

- **Model.** "A plugin-driven WYSIWYG markdown editor, inspired by Typora", built on **ProseMirror and remark** (https://github.com/Milkdown/milkdown). Markdown is the exchange/source format; ProseMirror schema in memory. One contenteditable (ProseMirror).
- **Collaboration / offline.** `@milkdown/plugin-collab` 7.23.0 (peers `yjs`, `y-protocols`, `y-prosemirror`) [npm]; the docs say Milkdown can be used in real-time collaborative editing and list Yjs (https://milkdown.dev/docs/plugin/collaborative-editing). Offline: not stated.
- **Framework support.** Framework-agnostic core; official packages `@milkdown/react` and `@milkdown/vue` [npm]. **No official Svelte package on npm** (searched "milkdown svelte": none). Note: the `@milkdown/crepe` ready-made UI has **`vue` as a dependency** [npm unpkg package.json], which matters for a Svelte bundle.
- **Capabilities.** GFM preset `@milkdown/preset-gfm` depends on `remark-gfm` [unpkg] (tables are part of GFM; **[unverified]** UI details). Markdown is the native format. Mobile: not stated. **[unverified]**. Extension API: plugins; also `prosemirror-safari-ime-span` is a dependency of the GFM preset, which suggests Safari IME handling.
- **Project facts.**
  - MIT [gh]. No paid tier; the author asks for sponsorship (README).
  - Maturity: GitHub created 2021-03-09, ~12k stars [gh]; `@milkdown/core` v7.23.0 published **2026-10-27**, 175 versions, very active [npm]; ~2.0M downloads/month [dl].
  - Bundle: `@milkdown/core` 97 KB gzip; `@milkdown/crepe` 464 KB gzip main [bp].
- **Known weaknesses.** I did not find a self-acknowledged limitations section (the README and docs pages I could read are thin). Hence none listed. No official Svelte; the batteries-included UI is Vue-based.

### 1.9 Svelte-specific options

None of these is a *Svelte-native engine with a CRDT*; all but Svedit wrap another engine.

| Project | What it is | Version / last publish | Stars / licence | Svelte | Notes |
|---|---|---|---|---|---|
| `svelte-tiptap` | Svelte components for Tiptap (`createEditor`, `EditorContent`, `BubbleMenu`, `FloatingMenu`, `SvelteNodeViewRenderer`). https://github.com/sibiraj-s/svelte-tiptap | 3.0.2 (2026-10-02), peers `@tiptap/core ^3`, `svelte ^5` [npm] | 337 stars, MIT [gh]; ~156k downloads/month [dl] | Wrapper | One maintainer. Node views mount outside the component tree (context must be passed explicitly); `NodeViewContent` tag cannot change at runtime (README). GitHub description still says "tiptap v2" **[contradiction]** with npm peer `^3`. |
| Edra | Block-styled editor on Tiptap, shadcn-svelte styled or headless; slash menu, drag handles, math, mermaid, callouts. https://github.com/Tsuzat/Edra | 3.1.3 (2026-08-09) [npm] | 682 stars, MIT [gh]; ~800 downloads/month because it is installed via the shadcn registry (copy into your project) | Svelte 5 | README badge says Tiptap 2.x but npm deps are `@tiptap/* ^3.29` and `yjs`/`@hocuspocus/provider` **[contradiction]**; README does not mention collaboration or markdown. |
| Tipex | "Goto styled" editor for SvelteKit on Tiptap. | `@friendofsvelte/tipex` 0.3.1 (2026-09-23) [npm] | 432 stars [gh]; GitHub licence field null, npm says MIT **[contradiction]** | Svelte 5 | ~21k downloads/month [dl]. |
| `svelte-lexical` | Svelte bindings for Lexical + plugin components. https://github.com/umaranis/svelte-lexical | 0.6.5 (2026-07-15) [npm] | 599 stars, MIT [gh] | Svelte 5 peer | Community project (personal account); README names no Lexical version or collab status. |
| `@prosemirror-adapter/svelte` | Render ProseMirror node views / plugin views with Svelte components | 0.5.5 (2026-07-24) [npm] | repo `prosekit/prosemirror-adapter` | Svelte 4 or 5 | ~86k downloads/month [dl]. |
| ProseKit | Headless ProseMirror framework with adapters for React, Vue, Preact, **Svelte**, Solid; collab "through Yjs or Loro"; MIT. https://prosekit.dev/ | 0.22.4 (2026-10-09), pre-1.0 [npm] | 1.2k stars, MIT [gh]; ~85k downloads/month [dl] | Official adapter | Closest "ProseMirror for Svelte" option. Note the Loro mention. |
| **Svedit** | "Editing for Svelte": Svelte 5 library; content as JSON graph of typed nodes; own components; marks and annotations. https://github.com/michael/svedit , https://svedit.dev | **0.15.1 (2026-10-02)** [npm]; created 2025-08-19 | 684 stars, MIT [gh]; ~1.5k downloads/month [dl] | **Svelte-native** | **Closest peer to Nabu.** README: "Svedit can only work reliably when there's one `contenteditable="true"` at root"; DOM selection is the source of truth. Self-described alpha: "Expect bugs. Expect missing features." Mobile described as experimental (works on latest iOS/Android since 0.3.0; new mobile UX in 0.13.0). Collaboration not addressed. Tables not supported in HTML paste import. Markdown not mentioned. Plain-text-only copy/paste noted. Best in Chrome, Safari 26+, Firefox 157+ (svedit.dev). 83 open issues [gh]. |

Also seen but not evaluated (all wrap other engines or are commercial): `@rozie-ui/tiptap-svelte` (0.5.4, ~1k downloads/month), `editable-kit`, Valiant Rich Text, CKEditor 5 Svelte guide, commercial `richtexteditor`. https://www.npmjs.com/search?q=svelte%20rich%20text (searched via the npm registry API).

---

## 2. Fact sheet: Nabu (from the repo)

Source files: `/home/killiandvcz/workspace/@aionbuilders/nabu/README.md`, `docs/getting-started/*`, `docs/guides/*`, `docs/adr/*`, `CHANGELOG.md`, `package.json`, `docs/audit/2026-10.md`.

- **Model.** A block **tree** stored in a Loro `LoroTree` named `blocks` (`src/lib/blocks/nabu.svelte.js:244`); text in each text block is a Loro text with **marks** for inline formatting (ADR 004: rich text is `LoroText` + marks, never nested blocks). Blocks are Svelte classes (`.svelte.js`, ADR 002) with fine-grained runes reactivity; rendering is recursive Svelte components (ADR 003). Blocks shipped (tour of the blocks): paragraph, heading, blockquote, divider, code, callout, toggle, image, video, file, lists (bullet, numbered, to-do), dialogue, regions. Exports: `serialize('markdown')` and `serialize('json')` (JSON is the exact tree and round-trips everything; markdown is lossy by nature); whole-document `serialize('html')` is **not done yet** (audit P-122, open).
- **Relation to contenteditable.** **One** `contenteditable` at the root (ADR 001); every `beforeinput` is intercepted and redirected into Loro; a "selection bridge" maps DOM positions to (block id, text offset). Blocks are inert DOM inside it. Cross-block selection is the native browser selection.
- **Collaboration and offline.**
  - Source of truth is a **Loro CRDT** (`loro-crdt` ^1.17.1).
  - **Local persistence:** `createPersistedEditor({ docId })` saves a binary snapshot to **IndexedDB** (debounced 2 s, max wait 3 s, plus on `visibilitychange`/`pagehide` with a synchronous `localStorage` tail of up to 256 KB as best effort); backup of the previous snapshot; quarantine of unreadable records; file bytes in a separate content-addressed store (SHA-256). Undo history is not saved across reloads. Docs: `docs/guides/persistence-and-sync.md`.
  - **Cross-tab sync:** `BroadcastChannel` live sync plus merge-at-save across tabs of the same `docId`.
  - **No network collaboration transport is shipped.** Docs state "Sync does not cross browsers or machines. For that, use your own transport", via public `nabu.doc` (`LoroDoc`), `doc.subscribeLocalUpdates(...)` out and `engine.importRemote(bytes)` in (caret preserved, not an undo step, IME composition not disturbed). Two peers need to start from the same snapshot, otherwise each has its own first paragraph.
  - **History:** keeps all Loro history by default (`history: 'full'`); opt-in compaction with a retention window. Ctrl+Z restores the selection from before the action; stable Loro cursors, tested with two synced documents (audit P-70).
  - Nothing is paid; no hosted service.
- **Framework support.** **Svelte 5 only** (`peerDependencies.svelte ^5.20.0`); not React/Vue. Needs Vite with WebAssembly support (`nabu()` helper from `@aionbuilders/nabu/vite` registers `vite-plugin-wasm` and sets `build.target: 'esnext'`); "Without this setup, Nabu fails to load" (README). Entry points: `.`, `./ui`, `./extend`, `./vite`.
- **Capabilities.**
  - **Tables: none.** "Bloc Tableau: expected, hard" on the roadmap (audit §6); pasted tables become tab-separated rows, with a low-priority rule ready for a future table block.
  - **Mobile: untuned.** "P-74: Mobile never tested (Android/iOS virtual keyboards: composition, autocorrect, deletion)" (audit). `docs/guides/ime-and-languages.md`: Firefox, Safari and mobile virtual keyboards "are not covered… a planned workstream of its own, not a current promise."
  - **Browser testing is Chromium only.** Playwright projects use `devices['Desktop Chrome']` only (`playwright.config.js`). IME is tested by driving real IME events through the Chrome DevTools Protocol, which is "a simulation", "not a real operating-system IME".
  - Markdown: import (paste and `importMarkdown`) CommonMark + GFM subset; export; round-trip idempotent (audit P-59, P-62). Clipboard writes three formats (`application/x-nabu+json`, clean `text/html`, `text/plain`); HTML paste handles Google Docs and Word lists and fixes the "everything bold" Docs wrapper (audit P-56). Drag and drop of files and selections.
  - Extension API: `extension(name, init)` (`@aionbuilders/nabu/extend`) with `block`, `component`, `actions`, `commands` (keys, `when`, confirmation strategies `hold`/`invite`/`choose`), `inputRules`, `hooks`, `slashCommands`, `serializers`, `pasteInterpreters`, `pasteFileHandlers`. A "generous stable contract" of 194 `@public` members; `nabu.internals` is explicitly unstable (audit P-119, 2026-10-27).
  - Accessibility: one native contenteditable, named via `label`/`labelledby`; slash menu ARIA; focus ring contrast; read-only mode; documented limits (`docs/guides/accessibility.md`).
  - Built-in UI (optional): `FloatingToolbar`, `SlashMenu`, `DragHandle`, `CommandInvite`, `CommandChooser`; new UI waits for design sessions (so the UI layer is deliberately thin).
- **Project facts.**
  - **Licence MIT** (`package.json`, README). No paid tier.
  - **Maturity:** **0.1.0-beta.0**, the latest on npm; first publish `0.1.0-alpha.0` on 2026-03-12; beta.0 on **2026-06-14** (12 pre-releases in three months) [npm]. The README says: "The editing core is complete and tested, but the API may still change before 1.0." Single author (Killian Di Vincenzo, `package.json`). **~45 npm downloads in the last month** [dl]; no notable external users known.
  - **Tests (audit log, 2026-10-27):** unit 2,296 and e2e 1,178 (Playwright, Chromium); `svelte-check` still reports type errors in `src/lib` (122 on 2026-10-16, audit §1).
  - **Bundle:** I have no measured Nabu bundle size. Its dependency `loro-crdt` 1.17.1 ships a WebAssembly file of **3.6 MB raw, 1.2 MB gzip**, and the JS glue 15 KB gzip [bp, and local `node_modules/loro-crdt/bundler/loro_wasm_bg.wasm`]. (For reference, Yjs is 28 KB gzip [bp].) Local `dist/` is 2.6 MB unminified including type declarations; not a meaningful figure.
  - **Performance (honest numbers).**
    - The brief says typing latency at 10,000 blocks is **88 ms p50 and is being fixed**. **I could not find "88 ms" in the repo docs.** What the audit records: engine-side typing is ~3 ms regardless of size after P-104..P-106 (2026-10-26); the remaining cost is browser-side: "P-107: `setBaseAndExtent` forces a layout (~30 ms/keystroke at 5k), display latency 16 -> 114 ms (1k -> 10k), 15 KB memory and ~14 DOM nodes per block -> lazy rendering / `content-visibility`", open, P2. The 88 ms figure is presumably a later measurement of the same effect; confirm with the owner before publishing.
    - `tests/e2e/large-docs.spec.ts` guards typing in 1,000 blocks: median key-to-DOM under 8 ms (measured ~2.5 ms).
  - Dev history note: in audit the Loro upgrade 1.10.6 -> 1.17.1 cut save size 39-88 % but doubled the cost of `tree.roots()` on a 5,000-block flat document before the later fix (audit 2026-10-26).
- **Known gaps (stated in the repo).**
  1. Beta; API may change before 1.0.
  2. Chromium-only test coverage; Firefox and Safari unverified; Safari/Firefox fire composition events in a different order.
  3. Mobile keyboards (Gboard, iOS) not tuned or tested; press-and-hold accents not covered.
  4. No table block.
  5. No network collaboration transport; only cross-tab. Two tabs creating the same *new* document at once get two initial paragraphs. Remote changes are not undoable.
  6. Large-document display latency (above).
  7. Requires a WASM-capable Vite setup; Svelte 5.20+ only.
  8. Persistence on page close is "best effort, not a guarantee"; mobile browsers may not fire the events.
  9. Browser extensions that inject DOM (Grammarly, LanguageTool) are "not supported" (spellcheck:false adds opt-out hints for Grammarly).
  10. Open items: block-selection primitive, embed block, `serialize('html')` for the whole document, `components` option (audit §6, P-122), callout-as-container, smart typography per language.

---

## 3. Comparison table

Legend: "yes (paid)" = needs a paid product. "n/s" = not stated on the pages I read. **[unv]** = unverified.

| | ProseMirror | Tiptap | Lexical | Slate / Plate | BlockNote | Editor.js | Quill | Milkdown | Svedit | **Nabu** |
|---|---|---|---|---|---|---|---|---|---|---|
| **Model** | Schema + immutable tree | Same (PM) | Immutable node tree + selection | Schema-less tree (JSON) | Block JSON on PM/Tiptap | Block JSON | Delta ops (OT-friendly) | PM + remark; markdown-first | JSON node graph | Loro tree of blocks + Loro text with marks |
| **Contenteditable** | One; browser types, DOM re-parsed | One | One | One (React-managed) | One | **One per block** | One root [unv] | One | One root | **One; all `beforeinput` redirected into the CRDT** |
| **CRDT / collab** | Central-authority OT (`prosemirror-collab`); Yjs and Loro via 3rd-party bindings | Yjs; Hocuspocus OSS; **Tiptap Collaboration cloud/on-prem paid** | Yjs (`@lexical/yjs`); one official provider (`y-websocket`) | None in Slate; Yjs via `@slate-yjs` (last 2023) / `@platejs/yjs` | Yjs, free (providers: WebRTC, Liveblocks, Y-Sweet) | None (planned) | None built in (OT-friendly format) | Yjs plugin | n/s | **Loro CRDT is the source of truth. Network transport: BYO (`importRemote`); cross-tab built in** |
| **Offline / local persistence** | None built in | `y-indexeddb` guide | Via provider (n/s) | Plate: IndexedDB provider | `y-indexeddb` listed | None | None | n/s | n/s | **Built in: IndexedDB snapshot, cross-tab merge, backup/quarantine, asset store** |
| **Svelte** | No official; `@prosemirror-adapter/svelte` | Official **guide** (core in `onMount`); no wrapper package; `svelte-tiptap` (community) | No official; `svelte-lexical` (community) | None (React only) | None (React-first) | Vanilla; Svelte wrapper [unv] | Vanilla; wrapper [unv] | No official; Crepe has a Vue dependency | **Svelte 5 native** | **Svelte 5 native (and only Svelte)** |
| **React-first?** | No | Mostly (UI) | Yes (official bindings) | Yes (React only) | Yes | No | No | React/Vue packages | n/a | n/a |
| **Tables** | `prosemirror-tables` | Official extension (MIT) | `@lexical/table` (no nesting) | Plate table plugin | Built-in block | `@editorjs/table` tool | `table` module in repo; #117 open since 2014 | GFM preset | Not in paste import | **No** |
| **Mobile** | No claim; ongoing Android fixes | n/s | 0.52.0 = mobile input fixes | Android added later, "more bugs" | Mobile toolbar experimental | n/s | "modern browsers on desktops, tablets and phones" | n/s | Experimental | **Untuned, untested** |
| **Markdown** | `prosemirror-markdown` | `@tiptap/markdown` (early release) | `@lexical/markdown` | `@platejs/markdown` | Lossy | none official [unv] | none official [unv] | Native | n/s | **Import + export, CommonMark/GFM subset, round-trip idempotent; also paste** |
| **Extension API** | Plugins | Extensions (100+) | Extensions, nodes, commands | Plugins (functions) | Custom blocks | Tools / tunes | Modules, blots | Plugins | Svelte components | **`extension()` with blocks, commands, input rules, hooks, paste handlers; 194 `@public` members** |
| **Licence** | MIT | MIT core; paid platform | MIT | MIT (Plate Plus paid) | MPL-2.0; XL = GPL-3 or commercial | Apache-2.0 | BSD-3 | MIT | MIT | **MIT** |
| **Paid** | No | Yes (collab, AI, history, conversion) | No | Plate Plus (EUR 299 / 799 one-time) | Business for XL | No | No | No | No | No |
| **Version / age** | `prosemirror-view` 1.42.8; since 2016 | 3.32.0; since 2020 (repo 2018) | 0.52.0 (pre-1.0); repo 2020 | 0.147.4 (beta); repo 2016 | 0.56.0 (pre-1.0); repo 2022 | 2.31.7 (+ 2.32 rc); repo 2015 | 2.0.3 (2024-11); repo 2012 | 7.23.0; repo 2021 | 0.15.1 (alpha); repo 2024 | **0.1.0-beta.0; first alpha 2026-03** |
| **GitHub stars (order)** | ~9k (umbrella) | ~39k | ~24k | ~32k / ~17k | ~10k | ~32k | ~47k | ~12k | ~0.7k | **n/s (not in repo data)** |
| **npm downloads / month** | ~95M (transitive) | ~85M (transitive) | ~23M | ~11M / ~1.9M | ~2.9M | ~1.2M | ~24M | ~2.0M | ~1.5k | **~45** |
| **Bundle gzip [bp]** | view 55 KB (+ deps) | core 37 KB (+PM); starter-kit 106 KB | core 63 KB; rich-text 80 KB | slate 32 KB + slate-react 26 KB | core 188 KB | 64 KB | 57 KB | core 97 KB; Crepe 464 KB | n/s | **Loro WASM 1.2 MB gzip (3.6 MB raw) + Nabu code (not measured)** |
| **Maturity signals** | Sponsored by NYT, Guardian, etc. | Notion, GitLab, Substack… (logos) | Meta, Bloomberg, Payload | Beta, no 1.0 date | Used in govt "Docs" apps | Long-lived; slow cadence | Slowed since 2024 | Active | Alpha | **Beta, single author, no known external users** |
| **Self-acknowledged weakness** | Low-level; Android | Paid features; early markdown | Pre-1.0 breaking changes | Beta; React-only | Pre-1.0; React-first; lossy md | Cross-block selection planned | Tables; slow release cadence | Thin docs, no official Svelte | Alpha | **See §2 list** |

---

## 4. Lists for the page

### 4.1 Where Nabu is different (facts)

1. **Svelte 5 native, with no wrapper.** Of the editors above, only Nabu and Svedit are Svelte 5-native engines; everything else is vanilla, React-first, or a wrapper around another engine (svelte-tiptap, Edra, Tipex, svelte-lexical, `@prosemirror-adapter/svelte`, ProseKit's Svelte adapter). The engine state is Svelte runes classes (ADR 002).
2. **A Loro CRDT is the source of truth, not an add-on.** Collaboration libraries for the others are bindings (Yjs, Loro) that sync an *external* document model with a CRDT; Nabu's tree and text *are* the CRDT. (A Loro-ProseMirror binding exists: `loro-prosemirror`, and ProseKit mentions Loro.)
3. **Local-first persistence is in the box.** IndexedDB snapshot with debounce, page-close tail, backup, quarantine, cross-tab live sync, content-addressed asset store, opt-in history compaction; in Tiptap, BlockNote and Plate the equivalent is `y-indexeddb` plus your own wiring (Tiptap's own docs have a guide for it).
4. **Single contenteditable *and* block structure.** Native cross-block selection like a document editor, with blocks like Notion. Editor.js (one contenteditable per block) lists cross-block selection as planned. BlockNote, Tiptap, Milkdown and Lexical also use one contenteditable; the difference is that Nabu's model is a block tree (nested blocks, toggles, regions) rather than a flat ProseMirror schema.
5. **Nothing paid, MIT.** No paid tier, no GPL packages (BlockNote XL) and no cloud product. (Also true of ProseMirror, Lexical, Slate, Milkdown, Quill.)
6. **Undo restores the selection, stays correct with remote edits** (stable Loro cursors, two-document test, audit P-70), and remote changes keep the caret on the same character without interrupting an IME composition.
7. **Extension-first with a declared stable contract** (`extension()`, 194 `@public` members, explicit unstable `nabu.internals`). Engine knows no block type.
8. **Heavy automated testing for a young project:** ~2.3k unit and ~1.2k e2e tests; real IME events via CDP; accessibility and read-only suites; large-document guards.
9. **Regions (container blocks with seams and a locked title field)**, dialogue lines, to-dos, toggles as shipped blocks; markdown round-trip tests (idempotent export -> import -> export).

### 4.2 Where others are clearly ahead

1. **Maturity and trust.** ProseMirror (2016), Tiptap, Slate, Quill, Editor.js, Lexical have years in production and tens of thousands of stars; Lexical runs at Meta, ProseMirror is sponsored by NYT and Guardian, Tiptap lists Notion, GitLab, Substack. Nabu is 0.1.0-beta, one author, first alpha March 2026, ~45 downloads last month.
2. **Browser and mobile coverage.** Nabu is tested only in Chromium; mobile keyboards untouched. ProseMirror has years of Android fixes; Lexical is actively fixing mobile; Quill claims phones; Svedit says it works on iOS/Android (experimental).
3. **Tables.** Tiptap, ProseMirror, Lexical, BlockNote, Plate, Editor.js (tool) all have them; Nabu has none.
4. **Real-time network collaboration.** Tiptap (paid cloud or self-hosted Hocuspocus), BlockNote (free, Liveblocks/Y-Sweet), Plate and Lexical ship ready providers; Nabu gives you the CRDT bytes and you write the server.
5. **Ecosystem breadth.** Tiptap has 100+ extensions and a paid conversion/AI/comments platform; BlockNote has AI and DOCX/PDF export (XL, licence-gated); Plate has 100+ components; none of this exists for Nabu.
6. **Docs, answers and community.** Years of forum threads, StackOverflow, Discord (Tiptap ~6k Discord members claimed). Nabu's knowledge base is its own docs.
7. **Performance at scale.** Nabu's display latency on very large documents (10k blocks) is currently high (88 ms p50 per the brief; repo says 114 ms for P-107 at the time of the audit) and under work; no comparable numbers found for the others, so no claim that they are faster **[unverified]**.
8. **Bundle weight.** Nabu carries a 1.2 MB gzip WASM file that none of the others needs (Yjs is 28 KB gzip). Whether that matters depends on the app; the page should say it.
9. **Framework reach.** Nabu is Svelte 5 only. Tiptap/ProseMirror/Lexical/ProseKit also serve React and Vue and other frameworks.
10. **Setup friction.** Nabu needs a Vite WASM setup (`nabu()` plugin, `esnext` target). Most others install without a build step.

### 4.3 Fairness notes for whoever writes the copy

- The honest competitor for a Svelte developer is **not** only "Tiptap vs Nabu": it is Tiptap (via svelte-tiptap or the official Svelte guide), ProseKit, svelte-lexical, and Svedit (the one that shares Nabu's Svelte-native, single-contenteditable approach).
- Several of the "others" also have caveats worth stating in the same breath: Slate is beta with no 1.0 date; Lexical and BlockNote are pre-1.0; Quill has been quiet since late 2024; Svedit calls itself alpha; Edra's README and npm disagree about Tiptap 2 vs 3.
- Do not claim Nabu is faster, lighter, or more reliable than any of them; no benchmark against them was run.
- "CRDT-native" is an architectural fact, not a quality claim: Yjs-based editors already do production collaboration at scale.

---

## 5. Open items (could not verify or should be re-checked before publishing)

1. The "88 ms p50 at 10k blocks" figure: not in the repo docs I read; confirm the measurement and its protocol.
2. Tiptap pricing numbers were read through a summarising fetch of https://tiptap.dev/pricing; a third-party page shows the same Start/Team figures, but check the live page before quoting.
3. BlockNote's pricing page displays a struck-through $390/month with $195/month; check which is the real price.
4. Plate docs (platejs.org) returned HTTP 500; Plate's self-acknowledged limits, mobile and collaboration details were not read from the official docs. Plate Plus prices are from https://pro.platejs.org/pricing .
5. Slate's 6 open GitHub issues and the Android FAQ text (search snippet only).
6. Milkdown: docs pages returned little; mobile, tables UI and offline are not verified.
7. Editor.js markdown and Svelte wrappers; Quill markdown, Yjs bindings and Svelte wrappers; Slate/Plate Svelte wrappers: not checked.
8. Mobile status of Tiptap and Milkdown: no statement found.
9. Nabu: no measured bundle size of the library itself; no GitHub star count for the Nabu repo was collected (repo URL `https://github.com/aionbuilders/nabu` in `package.json`); download figure is 45 for 2026-09-27 to 2026-10-26.
10. The ProseMirror GitHub repo being a mirror (development on Forgejo, per https://prosemirror.net/) explains its stale `pushed_at`; the npm timeline (view 1.42.8 on 2026-10-24) is the better activity signal.
