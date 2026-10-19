# HTML paste corpus

Hand-written snippets that reproduce the *structure* each source puts on the clipboard as `text/html`
(text is invented and neutral). They feed `tests/unit/html-paste-corpus.test.js` and
`tests/e2e/paste-external.spec.ts`. They are reconstructions from the public shape of each format, not captures.

| File | Reproduces |
| --- | --- |
| `google-docs.html` | Google Docs multi-paragraph copy: `<meta charset>` + `<b style="font-weight:normal;" id="docs-internal-guid-…">` wrapper around block children, `<h1 dir="ltr">`, `<p dir="ltr" style="line-height…">`, spans carrying `font-weight:700` / `400`, `font-style:italic`, `white-space:pre-wrap`, `&nbsp;` runs, a `<br />` spacer between paragraphs, an `&nbsp;`-only paragraph, a `https://www.google.com/url?q=…&sa=D…` redirect link, a flat `<ul>` whose `<li aria-level>` holds `<p role="presentation">`. |
| `google-docs-inline.html` | Google Docs copy of part of a single line: the `font-weight:normal` `<b>` wrapper directly around spans (no block element). |
| `word.html` | Microsoft Word: full `<html xmlns:o…>` document with `<style>`, `<!--StartFragment-->` / `<!--EndFragment-->`, `<p class=MsoNormal>`, `<o:p></o:p>`, `<b style='mso-bidi-font-weight:normal'>`, `mso-*` styles, an empty `<o:p>&nbsp;</o:p>` paragraph, and list paragraphs `class=MsoListParagraphCxSp… style='mso-list:l0 level1 lfo1'` with `<![if !supportLists]>…<![endif]>` bullet markers. |
| `notion.html` | Notion-like: bare `<meta charset>` then semantic blocks (h1/h2, p with strong/em/code/a, nested `ul`, blockquote, to-do list with checkboxes, `hr`, `pre > code`). Shape is plausible, not a faithful capture. |
| `wikipedia.html` | Wikipedia article fragment: `.mw-parser-output` wrapper, `mw-heading` div with `[edit]` section span, `<sup class="reference">` citation, an inline `<style>` between blocks, a `wikitable`, `&nbsp;` after a full stop, trailing newline inside `<p>`. (A real Chrome / Firefox copy leaves the `[edit]` span out because MediaWiki gives it `user-select:none`; it is kept here to exercise loose inline siblings of a heading.) |
| `github-readme.html` | GitHub README: `<article class="markdown-body">`, heading with an anchor + `<svg>` octicon, `div.highlight > pre` (no `<code>`), `pre > code.language-js`, `ul.contains-task-list` with `input.task-list-item-checkbox`. |
| `sheets.html` + `sheets.txt` | Google Sheets / Excel range: `text/html` table (with `<google-sheets-html-origin>`, `<colgroup>`, `<style>`) and the matching `text/plain` TSV. |
| `web-page.html` | Generic web page "div soup": loose text and `<br>` inside a `div` next to `<script>` / `<style>` (P-47), nested inline styles, `font-weight:normal` over `<b>`, `<strong style="font-weight:400">`, `<em style="font-style:normal">`, empty / `&nbsp;` paragraphs, a `javascript:` link, a Google redirect link, `<noscript>`. |
