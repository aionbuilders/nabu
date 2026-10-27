# ADR 005 — Typing with Strict JSDoc

**Status:** Accepted
**Date:** 2026-02-19
**Original:** [French](fr/005-jsdoc-typing-strategy.md)

## Context
The project aims at a high-level DX (developer experience) while keeping a codebase that is flexible and quick to iterate on.

## Decision
Use **strict JSDoc** instead of TypeScript (`.ts`).

## Consequences
*   **Build performance:** No TS-to-JS compilation step is needed during development.
*   **Robust typing:** With `checkJs: true` and rigorous JSDoc typing, the IDE provides the same safety and autocompletion as TS.
*   **Modularity:** It is easier to inject dynamic blocks without fighting complex TS interfaces.
*   **Standard:** `@typedef`, `@property` and `@import` (TS syntax inside JSDoc) are used, so that the documentation also serves as typing.
