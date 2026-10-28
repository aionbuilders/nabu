# ADR 013: Syntax Highlighting for Code Blocks with a Pluggable Highlighter

**Status:** Proposed: **deferred** (after the beta critical path). The v1 `CodeBlock` renders plain monospace text; the seam described here is not yet implemented.
**Date:** 2026-06-14
**Original:** [French](fr/013-code-syntax-highlighting.md)

## Context

The `CodeBlock` (shipped in v1, with no dependency) stores text only (a multi-line `LoroText`). In the long run, we want editor-grade syntax highlighting.

Initial intuition (validated): highlighting follows the same rendering principle as our `bold`/`italic` marks: turn a string into a sequence of styled segments, then render colored `<span>` elements. And since the cursor mapping (`getDOMPoint` / `calculateOffset`) walks the **text nodes** while counting characters, it works **for free** across these spans, exactly as RichText does today.

### Key conceptual correction: derived, not stored

A fundamental difference from marks:
- The bold/italic marks are **stored in Loro** (CRDT data, applied by the user, persisted).
- The highlighting tokens are a **pure function of `(text, language)`**, **recomputed at render time**, **never persisted**. Storing them would be redundant and a source of desynchronization.

→ The `CodeBlock` keeps its raw `LoroText`. Highlighting is a **purely presentational** layer: `segments = $derived(highlighter(text, language))`.

### Invariant contract

The colored rendering must preserve the text **verbatim**:

```
tokens.map(t => t.text).join('') === sourceText
```

No character added or removed, no whitespace reflow, no injected block element, no zero-width character. Otherwise the cursor mapping breaks. Most tokenizers respect this (Prism, TextMate, tree-sitter), to be validated library by library.

## Tokenizer options evaluated

### Prism (chosen for v1)
Pure JS, **synchronous**, `Prism.tokenize(text, grammar)` directly returns an `Array<string | {type, content}>`. Plugs into a `$derived`. Lightweight. Decent accuracy. → best match for a simple synchronous integration.

### Shiki (= the VS Code tokenizer)
TextMate grammars + oniguruma (WASM), VS Code themes. Maximum fidelity. But **async + WASM + heavy**, designed for one-shot highlighting (build/server), poorly suited to recomputation on each keystroke. → a "VS Code fidelity" option for later, as an alternative highlighter.

### tree-sitter / Lezer (CodeMirror)
**Incremental** parsers (re-parse only the changed region), editor-grade. Powerful, but the integration is a heavy commitment. → reserved for the "very large code blocks" case, endgame.

## Decision

**A pluggable, opt-in highlighter; the core stays dependency-free.**

> The `CodeBlock` stays *dumb*: it exposes `segments = $derived(highlighter(text, language))`. The `highlighter` is an **injectable function** `(text: string, language: string | null) => Array<{ text: string, scope?: string }>`, whose **default is the identity** (a single segment, no color: the current plain rendering). An **opt-in** `PrismHighlightExtension` provides the highlighter and the CSS of the scopes (wired to the `--nb-*` tokens). Anyone who wants Shiki plugs in their own.

This is consistent with the beta's opt-in invariant and the extension-first dogma: highlighting is an add-on, never part of the core.

## Architecture (to be implemented)

1. **Rendering seam**: `Code.svelte` renders from `block.segments` (and no longer from `{block.text}`), each segment as a `<span class="nabu-tok-{scope}">`. The verbatim invariant guarantees that the cursor lands correctly.
2. **Highlighter injection**: resolved through a registry (e.g. `nabu.codeHighlighter`) fed by the opt-in extension; default = identity. `CodeBlock.segments` reads that highlighter.
3. **`PrismHighlightExtension`**: opt-in (never in MinimalPreset). Loads Prism and the language grammar on demand, provides the highlighter, and ships the themed scope CSS.
4. **IME guard**: do NOT re-tokenize or re-render during an active composition (`#composing`, see ADR/issue #6), so as not to break CJK typing.
5. **Cursor**: no new machinery: the existing post-mutation `tick().then(() => setCursor(block, offset))` repositions the caret by model offset on the new spans.
6. **Performance**: v1: full re-tokenization on change (negligible for normal blocks). Incremental parsing (tree-sitter/Lezer) is reserved for very large blocks, later. Debouncing is possible if needed (plain rendering is instantaneous, colors arrive one tick later).

## Consequences

✅ The core `CodeBlock` has no dependency; highlighting is a choice for the integrator (Prism / Shiki / none).
✅ Fully reuses the existing span-aware cursor mapping, with no new selection logic.
✅ Nothing in Loro: no CRDT pollution, no possible desynchronization.
✅ An ideal "wow" candidate for the beta launch demo.
⚠️ The `join === source` invariant must be verified for each tokenization library adopted.
⚠️ Re-tokenizing on each keystroke costs O(n) per block; acceptable in v1, to be watched on very large blocks.
⚠️ Must coexist with the IME guard so as not to disturb composition.
