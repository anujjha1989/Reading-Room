# Current UI ownership and remaining compatibility

The original migration plan is preserved in Git history. Its unchecked boxes
described the pre-v145 app and must not be used as a current task list.

## Completed ownership migration

- `BookReader.tsx` owns reader state and portals the React close button,
  `ReadingSheet`, search and bookmark panels.
- `LibraryChrome.tsx`, `SettingsPanel.tsx` and `BookDetailsEditor.tsx` own library
  controls, settings and metadata edits. No injected alternate UI remains.
- `readAloudEngine.ts` and `readAloudController.ts` own narration and its typed
  state. `ReadAloudTransport.tsx` and `useReadAloud.ts` consume that state.
- `design-tokens.css` owns shared surfaces and motion. App styles are bundled,
  never deployed as manually edited overrides.
- `deploy/render-index.mjs` renders startup HTML from the current React build.
- `overrides/` contains only the service worker and deployment version counter.

## Compatibility that is intentionally retained

- `readerChromeBridge.js` connects host gestures to sandboxed EPUB documents
  and Foliate's closed shadow root. It handles taps, swipes, link routing,
  annotation selection and lifecycle cleanup. It does not own the reading sheet.
- `bookFontScale.js` normalizes absolute font sizes inside imported books so
  reader font-size controls work. This is book-format compatibility, not UI styling.
- Hidden header/footer controls still supply the reader's navigation adapter.
  Removing them requires replacing those consumers first, not merely deleting CSS.
- `continuousEpubManager.ts` prevents deferred offscreen cleanup from destroying
  a section that has become visible again. It keeps measured placeholders and
  releases distant iframes after scrolling settles, without rebasing scrollTop.
  Keep reversal, idle anchor and progress round-trip tests mandatory.

## Cleanup boundary

Unused hosted-app authentication, Drive URL helper, D1 scaffold and dependencies
are removed. Retired reader-mode fallback rules and the permanently hidden text
mode button are removed; annotation-driven selection remains.

`reader-chrome.css` still includes library presentation as well as reader rules.
Splitting/reordering that cascade is a separate structural refactor, not evidence
that the app still has a second override runtime. Do not describe all historical
CSS debt as eliminated. Protect further changes with rendered theme/geometry
checks plus real-device input checks, not only selector searches.
