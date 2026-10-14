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
- 1,961 entries received metadata corrections (some receive both title and author).
- 17 confirmed non-book notices hidden; original files retained.
- Prior title/author/hidden-ID edits preserved.
- Live cover responses verified as JPEG with matching SHA-256 contents.

Remaining missing authors in visible catalogue: EPUB 1, MOBI 0, PDF 125,
CBR 68, CBZ 10, TXT 8, RTF 2, DOC 14, DOCX 11. These remain unresolved,
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

Latest verification: 566 local cover MIME/content checks, 1,961 metadata identities,
zero preservation/mismatch errors. Fifteen corrected duplicate copies merge into
existing work entries without removing source files. The bogus Other Worlds
EPUB contains an HTTP 416 HTML error rather than book content; it was hidden as
a confirmed non-book error document, not assigned an unrelated anthology's author.
