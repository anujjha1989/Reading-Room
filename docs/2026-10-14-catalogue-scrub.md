# Catalogue scrub — 14 October 2026

Status: partial, not a completed professional review of every book.

The raw 9,370-entry catalogue was audited against local files. Public bibliographic
searches covered 2,197 missing-author labels; ambiguous exact-title matches were
not automatically applied. 349 PDFs were checked for printed ISBNs; 44 returned
online records. Printed titles and creator names were cross-checked before repair.
1,808 comic archives had no usable embedded ComicInfo writer credits. Publisher
records support narrowly bounded regular-series writer corrections; variable-writer
series must be reviewed issue by issue.

Applied and verified centrally:

- 566 embedded covers added without overwriting existing artwork.
- 419 entries received metadata corrections (some receive both title and author).
- 11 download notices hidden with explicit user approval; original files retained.
- Prior title/author/hidden-ID edits preserved.
- Live cover responses verified as JPEG with matching SHA-256 contents.

Remaining missing authors in visible catalogue: EPUB 3, MOBI 2, PDF 286,
CBR 1007, CBZ 430, TXT 20, RTF 5, DOC 14, DOCX 23. These remain unresolved,
not silently assigned to a best-guess search result. Complete title and artwork
quality review beyond automated flags is still pending.

Evidence, applied change log, and backups:
`/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13/`.
Corrections use the existing metadata API; covers use the existing local cover
directory. No book contents, paths, or reading history were modified.

Separate header branding release v227 restores the original red house/book SVG
beside Books on web/iOS. Installable app artwork is unchanged. Branding-focused
release checks passed on LAN and public HTTPS; the extra public header test passed
for light/dark themes, scrolling, hydration and Settings. TV already has the red mark.
