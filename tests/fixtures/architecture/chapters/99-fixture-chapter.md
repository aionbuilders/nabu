---
title: A fixture chapter
description: A chapter that exists only in the e2e build, to test the chapter route before the real chapters are written.
chapter: 99
adrs: [7, 16, 12]
xray: e2e-probe
---

# A fixture chapter

This is the first paragraph, the lead of the chapter: the widget of the chapter sits right after it, and it says that [ADR 007](../../adr/007-event-ascension.md) is behind it.

## A first section

A paragraph with `inline code` and a [link to the limits](/architecture/limits). The record [ADR 016](../../adr/016-regions.md#1-context) is linked relatively, and so is a [design note](../../design/copy-paste.md).

```js
const answer = 42;
```

> [!TIP]
> A new block type is one extension. The engine never grew a `switch (type)`.

> [!WARNING]
> Today, at 10,000 blocks, typing takes far too long. [The limits](/architecture/limits)

## A second section

Another paragraph, so that the chapter has some length.
