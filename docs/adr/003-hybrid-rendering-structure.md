# ADR 003 — Hybrid Structure (Flat Map and Recursive Rendering)

**Status:** Accepted
**Date:** 2026-02-19
**Original:** [French](fr/003-hybrid-rendering-structure.md)

## Context
The engine must reach blocks in two ways: by ID for updates (input), and by hierarchy for display (UI). Traversing a recursive tree on every keystroke is inefficient.

## Decision
Maintain a **flat Map** (`nabu.blocks`) for storage and fast access, while using **recursion in the Svelte components** for visual rendering.

## Consequences
*   **O(1) performance:** Instant access to any block through its ID, regardless of depth.
*   **Modularity:** Components only know their direct children through their IDs, which limits the propagation of reactive changes.
*   **Simplicity:** Going from Loro (a flat list of nodes) to Svelte is direct and does not require rebuilding a complex tree in memory in JS.
