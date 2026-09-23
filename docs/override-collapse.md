# Collapsing the override layer into React

> Historical planning note. By v145 the runtime UI overrides described below
> had been removed. Reader controls, library chrome, Settings, metadata editing,
> Read Aloud and their styles now ship with `app/`. The remaining `overrides/`
> files are the deployment template, service worker and version counter. The
> EPUB iframe gesture bridge is app-owned compatibility code, not a separately
> deployed override. This document preserves the original rationale and plan.

## Why

The override layer is 6,538 lines styling and re-wiring a 2,611-line React app —
2.5× the size of the application it decorates. Inside it: **440 `!important`
declarations** and **27 stacked versioned patch blocks** in one 3,259-line CSS
file.

The problem is not code quality. It is that the UI is built by a layer that does
not own the DOM it operates on. Every change is a remote-control operation:
match an element by class, override it with `!important`, hope React does not
re-render it away. The observed costs, all from one evening:

- A CSS rule lost a specificity contest and made theme swatches unreadable.
- A function was defined and never called — valid JS, silently absent.
- The app bundle was pinned at `?v=33` for ~54 deploys, so fixes never reached
  the phone.
- One bug (reader theme) was misdiagnosed three times because the state lived in
  two places that disagreed.

A rewrite that keeps this architecture reproduces the problem. The fix is to
**collapse the two layers into one**: components that own their own markup and
style themselves.

## Method: strangle, do not big-bang

Each step ships independently and is revertible in one commit. The old code is
deleted only once the replacement is confirmed working on the device.

| Step | Moves into React | Deletes from overrides | Status |
|---|---|---|---|
| 1 | Reading sheet | ~1,200 CSS + ~430 JS | parity complete; live validation pending |
| 2 | Library chrome (gear / filter / sort) | ~400 | todo |
| 3 | Card ⋯ menu CSS | ~200 | todo |
| 4 | Reader chrome (≡ / ✕, page turns) | ~500 | todo |
| 5 | **One theme signal** | ~300 of `!important` | todo |

Step 5 carries the most value. `data-rr-theme` (app) and `rr-theme-dark` (book)
are currently applied to the same elements, which is the direct cause of most of
the recurring theme bugs.

## Step 1 — the reading sheet

### What it is

`fullscreen-bundle.js` lines 691–1118 (428 lines) plus roughly 1,200 lines of
CSS. It renders a bottom-right panel with views: `menu`, `Contents`,
`Themes & Settings`, `Customise Theme`, `Read Aloud`, `Voice`, `Search`.

### Its current contract

It reaches into the page through:

**React elements** (these are real and stable):
`.reader-shell`, `.reader-settings`, `.reader-modes`, `.reader-page-turn`,
`.theme-options`, `.reader-actions`

**Classes that do NOT exist in React** — created by `read-aloud.js`, another
override:
`.rr-listen`, `.rr-rate`, `.rr-voice`

**`aria-label` string matching** via `native()` / `proxy()`:
`Search inside book`, `Decrease text size`, `Increase text size`

**A `window.*` API** that `read-aloud.js` exposes, which is the one part of this
that is already sound:
`rrToggleReadAloud`, `rrStopReadAloud`, `rrSkipSentence`, `rrSetReadingRate`,
`rrGetReadingRate`, `rrGetReadAloudState`, `rrAddSleepTime`, `rrAdjustSleepTime`

### Why this is the right first step

- It is the surface with the most reported bugs.
- It is genuinely self-contained: one panel, one state machine.
- Its dependency on `read-aloud.js` is already a clean function API, so the
  sheet can call it directly rather than clicking hidden buttons.
- The `aria-label` matching disappears entirely, because the component will hold
  the state those buttons proxy to. That alone removes a class of silent
  failure — `native()` returning `undefined` produced no error, just a dead
  control.

### Plan

1. `app/ReadingSheet.tsx` — one component, props for state, no DOM queries.
2. `app/reading-sheet.module.css` — scoped styles, **no `!important`**.
3. Rendered by `BookReader.tsx`, which already owns theme, reading mode,
   font size, line height and margins as React state.
4. React is now the default; `?sheet=legacy` is retained as a recovery switch
   until live phone validation is complete.
5. Only then delete the override block and its CSS.

### What must not regress

Verified working today and easy to lose:

- Read Aloud transport, including the cancellation guards tied to the epoch
- Pages/Scroll switching without a double render
- Page-animation segment (a second `.reader-modes` group — must stay excluded
  from the mode segment)
- The reading-chrome escape hatch: the `≡` stays reachable at opacity .22 when
  chrome is hidden in the older reader path
- Bookmarks / Search return path
- `prefers-reduced-motion` on every animation

## Step 1c — parity reached

Step 1c was meant to delete the legacy sheet. A parity audit before deleting it
found **seven features the first React version did not have**, and the reason
matters more than the list:

| Feature | Where its state lives |
|---|---|
| Bold Text | override only |
| Justify Text | override only |
| Character spacing | override only |
| Word spacing | override only |
| Font family | override only |
| Reset Theme | override only |
| Share book | override only |

`bold`, `justify`, `chars` and `words` appear **0 times in BookReader.tsx** and
7 times each in `fullscreen-bundle.js`. The override does not merely *display*
these — it owns them, persists them to `rr-books-type`, and applies them by
injecting a stylesheet into the book's iframe from `applyType()`.

So the sheet is not a thin skin over React state, as step 1a assumed. It is
**two-thirds a skin and one-third the only implementation** of six typography
features. Deleting it would delete those features.

### Resolution

1c is split:

- **1c-i — complete** — moved `bold`, `justify`, `chars`, `words`, `font` into `BookReader`
  as real state, applied through `epubStyles()` / `mobiStyles()`, which already
  take `lineHeight` and `margin` and are the correct home for this. Add
  `rrPreviousSentence` to the read-aloud API for the transport's back button.
  Migrate the stored `rr-books-type` value so existing preferences survive.
- **1c-ii — complete** — added the six controls plus Share, Reset, complete
  Read Aloud transport, speed layout and timer controls to `ReadingSheet`.
- **1c-iii — pending live validation** — React is the default and the legacy
  implementation is hidden, but remains available through `?sheet=legacy`.
  Delete it only after the production phone and iPad checks pass.

This is the right lesson from the evening: the parity check had to come *before*
the deletion, not after. Had 1c run as planned, six working features would have
disappeared and the cause would have been hard to see.
