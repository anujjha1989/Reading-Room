# Embedded EPUB text contrast and slow archive downloads

The Dickens collection's inline contents and chapter headings explicitly set
black/windowtext on nested spans. The reader now themes HTML text and link
descendants with its existing ink/link tokens, without changing artwork fills,
typography, scrolling or narration. Identical selectors in each theme avoid
stale dark colours when EPUB.js appends updated theme rules.

The first v220 release attempt passed candidate and LAN checks, but was rolled
back after the public real-book checks timed out before the reader appeared.
Investigation then found the application itself capped archive body downloads
at 30 seconds. A public 1 MiB range succeeded at about 0.43 MB/s; the complete
Dickens file is 56,118,588 bytes. Extending only the test would not fix that.

EPUB/MOBI body transfers now get a size-based allowance (30 seconds plus size
at 128 KiB/s, capped at 10 minutes; two minutes for unknown lengths). Response
headers and parsing/rendering retain their separate 30-second deadlines;
closing still cancels the work. No scrolling, sentence or audio code changed.
Live regression checks record HTTP status, declared bytes and completion timing,
and use the body allowance plus one minute for rendering. Bad HTTP responses
still fail immediately; stalled transfers remain bounded.

Local books already send private cache headers, ETags and Last-Modified and
honour conditional requests. Browser storage may evict cached copies; no new
persistent/offline cache or service-worker book interception is introduced.

Coverage: download budget/timeout/cancellation unit tests; both browser engines
and actual Dickens contents/Chapter I; existing mandatory candidate and live
release gates. iOS shares the web reader. TV uses native text/theme rendering,
not these EPUB CSS rules or JavaScript download deadlines; no native source
changes or installations are required for this release.

Released as v222 from commit 743e680 using the explicitly authorised
`--focus=epub-loading-contrast` scope. All 14 selected unit checks and four
candidate browser checks passed. Both actual origins passed rendered-route,
theme, asset MIME/hash and four Dickens navigation/contrast tests each.
The final public Chromium archive transfer took 31.764 seconds (past the old
30-second body limit) and the complete reader check passed in 42.106 seconds.
Light/dark switching and phone/desktop sizing passed in both engines.

Release record: `/Volumes/Seagate/ReadingRoom/deployment-history/v222.json`.
Rollback backup:
`/Volumes/Seagate/ReadingRoom/deployment-backups/20261011-101540-before-v222`.
The blanket v221 run was interrupted before installation at Anuj's request;
the first focused candidate failed before installation on the preview proxy's
own buffering timeout. That proxy now streams with backpressure and its own
size-aware deadline; early/streamed failure and first-chunk tests passed.
