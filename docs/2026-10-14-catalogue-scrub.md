# Catalogue scrub — 14 October 2026

Status: partial, not a completed professional review of every book.

The raw 9,370-entry catalogue was audited against local files. Public bibliographic
searches covered 2,197 missing-author labels; ambiguous exact-title matches were
not automatically applied. 349 PDFs were checked for printed ISBNs; 44 returned
online records. Printed titles and creator names were cross-checked before repair.
1,808 comic archives had no usable embedded ComicInfo writer credits. Publisher
records support narrowly bounded regular-series writer corrections; variable-writer
series initially required issue review. The user subsequently approved creator-
level credits for comics and graphic novels, and requested online records instead
of scanning images. Image/OCR work was stopped; partial intermediate files remain.

Applied and verified centrally:

- 566 embedded covers added without overwriting existing artwork.
- 2,417 entries received metadata corrections (some receive both title and author).
- 23 confirmed non-book notices/items hidden; original files retained.
- 101 encoded comic titles cleaned; series-creator credits used as requested.
- Prior title/author/hidden-ID edits preserved.
- Live cover responses verified as JPEG with matching SHA-256 contents.

Remaining missing authors in visible catalogue: EPUB 1, PDF 2, TXT 2.
These remain unresolved,
not silently assigned to a best-guess search result. Complete title and artwork
quality review beyond automated flags is still pending.

Evidence, applied change log, and backups:
`/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13/`.
Corrections use the existing metadata API or an atomic, backed-up batch installer;
the batch pauses the service, preserves existing fields, restarts and verifies,
and restores its backup if required checks fail. Covers use the existing local cover
directory. No book contents, paths, or reading history were modified.

Separate header branding release v227 restores the original red house/book SVG
beside Books on web/iOS. Installable app artwork is unchanged. Branding-focused
release checks passed on LAN and public HTTPS; the extra public header test passed
for light/dark themes, scrolling, hydration and Settings. TV already has the red mark.

Release v228 classifies actual screenplays imported under Books as Script at
catalogue load, including corrected titles. Six entries now join the existing
332 Scripts entries. Screenwriting instruction and unrelated manuscript titles
are excluded. Nine catalogue regression tests pass; supported release gates and
LAN/public checks passed. Public authenticated catalogue confirms Gatsby,
Lincoln, Hamlet and Never Let Me Go categories. No native rebuild was needed.

Latest verification: 566 local cover MIME/content checks, 2,417 metadata identities,
zero preservation/mismatch errors. Thirty-two corrected duplicate copies merge into
existing work entries without removing source files. The bogus Other Worlds
EPUB contains an HTTP 416 HTML error rather than book content; it was hidden as
a confirmed non-book error document, not assigned an unrelated anthology's author.

The user subsequently permitted inspection of only unresolved title/credit pages.
Local first-page reading identified twelve more records, including the specific
Alien 3 draft (Walter Hill/David Giler), Lenin's The Teachings of Karl Marx,
Journey to the End of the Night and short stories confirmed against the originating
Short Story website. No full-book OCR or document upload was performed. Adobe
initialization required authentication, so local rendering/recognition was used.

Cached-artwork integrity audit: 8,457 readable JPEGs, zero invalid files, 268 missing
local images and 36 unusually small images flagged for review. Missing local
images are not proof of missing displayed art: the app also resolves remote covers
or uses its existing designed fallback. A separate endpoint check records those
outcomes. This is not a claim that every edition's artwork has been visually verified.
Reference Room, original book files and reader/playback code were not changed.
