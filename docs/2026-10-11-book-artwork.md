# Green/gold book branding

Anuj supplied `assets/branding/book-icon-master.png` on 11 October 2026 and
requested deployment in all formats. This is the single original artwork.
`scripts/build-brand-icons.mjs` generates web PNGs, self-contained SVG wrappers
and the optional native 1024px icon. It waits for raster decoding before capture.
The homepage retains its existing SVG sizing and Books wordmark, with the new
artwork inside. No reader or library interaction changes.

Native source: `/Users/anuj-mac/Developer/readingroom-ios-src`. The iOS icon is a
generated derivative; TV's source-owned asset generator derives its 5:3 icon
and header mark from that same derivative. Aspect-fill crops green margins only,
not the book. TV's transparent foreground layer avoids inventing parallax parts
or redrawing the supplied artwork. iOS build 10; TV build 15.

Focused web deployment uses `--focus=branding`: clean fresh build, hydration
and scope unit checks, artwork pixel/dimension/embedding tests, source-owned
reader consolidation check, complete backup/install/hash/MIME verification,
then actual LAN/public rendered light/dark/library/Settings checks. Unrelated
large-book, narration and shelf suites are excluded. Default releases remain
full-scope; build reuse is still prohibited. Native checks cover asset geometry,
opaque background, signing, version and device installation/launch.

Release status: pending.
