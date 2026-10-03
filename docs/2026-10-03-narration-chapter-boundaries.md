# EPUB narration chapter boundaries

## Reproduced fault

The Demons and Druids EPUB preloads several sections in continuous scroll.
The old narration selector ranked iframes by their entire width × height,
without clipping to the screen. Its tall prologue could therefore win after
the reader had moved to later, shorter chapters. At sentence-queue exhaustion,
the old handoff clicked the footer's page-down button and waited for that
size-based selector to detect a different document. Page-down is not chapter
navigation, so this could stall or select the wrong section.

The same selection logic exists in commit `68df3cf`, before v182. Removing the
continuous manager's trim override in v182 changed frame lifetimes, but no
historical-device test establishes it as the trigger. The regression test
reproduces the stall against live v184. The recent shelf CSS did not change
the narration engine.

## Source-owned correction

`BookReader` registers a typed EPUB narration adapter while its rendition is
mounted. The adapter supplies document/spine identity and advances directly
to the next linear spine section. Narration starts at the visible reading edge,
pins its queue to that chapter, and hands off only when that queue is exhausted.
Explicit reader jumps invalidate that pin. Cleanup unregisters the adapter,
including when switching reading modes. No generated bundle, library override,
EPUB file, or UI styling is manually patched.

## Verification scope

The new browser test loads the actual Demons and Druids EPUB, isolates catalogue
and reading state, and accelerates audio completion callbacks. It checks ordered
prologue → part heading → Chapter 1 → Chapter 2 narration, heading retention,
pause, explicit chapter jumps and uncaught exceptions, in Scroll and Pages. This verifies navigation and
playback state, not physical iPhone audio quality, lock-screen behavior or actual
Piper synthesis. Existing Christie recovery/manual-scroll, phrase-boundary and
reader-control checks protect the adjacent reader behavior.

Candidate checks: 12 focused browser checks passed; the two actual-book
narration cases passed again with explicit chapter-jump assertions added.
The production build passes. Whole-project typechecking still reports the
pre-existing Cloudflare worker environment types, with no errors in the changed
reader/narration modules.
