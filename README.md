# 🖋️ NABU — Next-Generation Block Engine

Nabu is a modular, local-first block editor engine built on a **Single ContentEditable** architecture. It bridges the gap between the intuitive selection of document-based editors (Google Docs, ProseMirror) and the structural flexibility of block-based editors (Notion).

## 🏗️ Core Architecture

### Single ContentEditable Root
Unlike traditional block editors that use isolated editable zones, Nabu manages a single native selection at the root. This guarantees seamless cross-block selection, native copy-paste, and superior browser performance.

### Reactive CRDT Core (Loro-CRDT)
Nabu treats the UI as a pure reflection of a distributed state. Built on **Loro-CRDT (WASM)**, it provides out-of-the-box support for:
- **Local-First:** High-performance local state with offline-first capabilities.
- **Collaboration:** Conflict-free merging of concurrent edits.
- **Rich Text:** Native support for spans and marks via Loro Deltas.

### Svelte 5 Integration
Leveraging Svelte 5's Runes (`$state`, `$derived`), Nabu achieves fine-grained reactivity. Only modified blocks or selection states trigger re-renders, ensuring a fluid 60fps experience even in massive documents.

## 🛠️ Key Technical Features

- **Selection Bridge:** A high-precision mapping engine between DOM Nodes/Offsets and Model IDs/Indexes, enabling stable cursor restoration and robust cross-block ranges.
- **Event Ascension:** A modular "Chain of Responsibility" pattern. Blocks handle local interactions while structural changes (split, merge) are escalated to parents or engine-level hooks.
- **Delta-Based Mutations:** All structural operations (splitting, merging) utilize Loro Deltas to preserve formatting and metadata integrity during transformation.
- **Block Registry:** A highly decoupled extension system allowing developers to define custom logic and UI for any block type.

## 🚀 Tech Stack

- **UI Framework:** Svelte 5
- **State/CRDT:** Loro-CRDT (WASM)
- **Typing:** Strict JSDoc
- **Architecture:** OOP-based Block Registry & Extensions

---
*Architected for performance, built for the future of collaborative writing.*
