# Christie reader and local cover release

Released as **v182**, source commit `e25c5b7`, tag `deploy-v182`.
Installer checks passed on LAN and tailnet. Additional authenticated checks on
`https://anujrpi.tail549492.ts.net:8443` confirmed version 182, Settings, JPEG
cover delivery, compact Home branding/glass controls and both Christie EPUBs'
Scroll/Pages recovery, visual scroll deltas and hierarchical themed contents.
Test catalogue and reading state were isolated from the user's saved progress.
The live cover extractor checksum matches the committed source. Both configured
library sources are local. The deployment manifest remains unmodified.

## Source changes

- Home's wordmark is `Books`, retaining the current icon and theme styling.
- EPUB.js owns continuous-scroll position compensation; native browser
  anchoring is disabled on its scroll container. Removed the old trim override.
- Validate persisted CFIs before display. Invalid offsets recover within their
  original spine chapter instead of leaving EPUB.js's display promise pending.
- Do not reapply an unchanged spread layout on height-only viewport changes.
- Preserve hierarchical Contents in React. Collection groups become books at
  the root; books open chapter submenus with Begin reading and Back to books.
  Generated contents pages and explicit per-book contents supply omitted links.
- Local imports use the local file registry for cover extraction. An EPUB's
  declared outer cover wins over larger constituent covers. Local-only scans
  skip Drive and launch local cover extraction after catalogue installation.
- Reader errors and download actions use Home Books. Missing artwork keeps a
  visible title rather than an empty thumbnail.

## Candidate checks

- Reproduced the recorded Christie jump with the original bundle. Measured
  duplicate browser/renderer compensation, then verified visual scroll deltas
  across prepended sections with both real Christie EPUB files.
- Both EPUBs: stale CFI recovery, Scroll/Pages, chapter navigation, book-first
  Contents, scrollable chapter menus, Back, Light/Sepia/Dark. Seven focused
  browser tests (including Home branding/settings and glass controls) pass.
- Three local cover extraction tests pass (EPUB 2/3 outer cover, retry of an old
  Drive failure, missing local mapping never contacts Drive).
- Local drop-folder scanner and metadata correction tests pass.
- Production build, rendered HTML test and all thirteen release gates pass.
- The full browser suite exposed `cw-blob:` image references in the William
  Trevor EPUB. Re-running its eight critical flows against live v181 reproduced
  the same two image errors. This is a pre-existing issue, not a clean full-suite
  result. No manual iPhone regression pass is claimed by these browser tests.
- Whole-project typechecking still reports the pre-existing Cloudflare worker
  environment types; it reports no errors in the changed reader modules.

## Bourdain artwork

The imported EPUB had a declared cover, but the old extraction job attempted
Drive lookups for its local ID. Its embedded cover also had overlapping type.
Reused the existing collection cover template (`work/bulk/cover.py` in the
Complete Works project) with Anthony Bourdain's name. Saved the generated cover
on Seagate, verified the served JPEG MIME type and SHA-256 against that asset.
The EPUB itself and its chapters were not rewritten.

## Rollback

The release installer captures the old HTML, server modules, public assets,
scanner and cover extractor before replacement. Assets remain additive.
Rollback is required if either Christie book cannot open, manual scrolling
skips chapters, or the requested Contents/Settings controls fail after release.
