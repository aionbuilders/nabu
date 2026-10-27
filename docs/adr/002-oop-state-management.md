# ADR 002 — State Management with Svelte 5 Classes (OOP)

**Status:** Accepted
**Date:** 2026-02-19
**Original:** [French](fr/002-oop-state-management.md)

## Context
Svelte 5 introduces Runes (`$state`, `$derived`). Although Svelte is often used in a functional style, the complexity of an editing engine (CRDT synchronization, hierarchy, transformation methods) calls for strong encapsulation.

## Decision
Systematic use of **Svelte classes (`.svelte.js`)** to represent the engine's entities (`Nabu`, `Block`, `MegaBlock`).

## Consequences
*   **Encapsulation:** Each block owns its Loro synchronization logic and its reactive state.
*   **Extensibility:** Inheritance (`MegaBlock extends Block`) is used to share structural logic.
*   **Readability:** Mutation methods (e.g. `block.updateText()`) are grouped with the data they act on, which makes the flow easier to maintain and understand.
*   **Performance:** Runes inside classes give fine-grained reactivity (only the modified property triggers a re-render, not the whole object).
