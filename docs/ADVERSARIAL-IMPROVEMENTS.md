# Home Books reliability and consolidation work

This is an implementation checkpoint, not a release-completion claim.
Canonical web source: this repository. Native source:
`/Users/anuj-mac/Developer/readingroom-ios-src`. SSD build staging is disposable.
Release v186 was deployed on 4 October 2026 from web commit `b6bcca5`, with native
build 8 from `892cdb6` installed and launched on the connected iPhone. This does not
claim every historical CSS/bridge or long-session audit is finished.

## Accepted workstreams and evidence

1. **Regression coverage — candidate verified.** 26 root tests, 21 mobile-browser
   reliability/list checks and two real-MOBI narration checks pass. Broader audits
   include Christie collections, real Demons and Druids chapter boundaries,
   branding, glass controls, shelves, title corrections and native Summary buttons.
   Twelve distinct native simulator cases pass with the correct server fixture.
   The live authenticated public route opens real EPUB/MOBI covers, chapters and
   Close in both engines. Three physical-iPhone library/queue cases pass, including
   both themes. Remaining: long-session observation and a full manual device matrix.
2. **Narration reliability — in progress.** EPUB Previous crosses into the previous
   chapter's last sentence. Failed audio pauses at the same sentence with Retry.
   Empty-section traversal is bounded; EPUB/MOBI chapter boundaries and paused mode
   changes have browser coverage. Remaining: rapid navigation and long-session
   recovery on a physical phone.
3. **Loading/recovery — implemented, candidate verified.** Bounded EPUB fetch/open/
   display, malformed-archive errors, Retry and independent Close for EPUB, MOBI,
   PDF, CBZ and CBR. Both browser engines pass. CBR's synchronous extraction is
   not claimed to be worker-cancellable. Native real-route parity still required.
4. **Durable save sync — implemented, candidate verified.** Persistent retry
   outbox; failed responses are never acknowledged; newer edits survive older
   acknowledgements. Five tests pass. Reconnect/device parity still required.
5. **Canonical source ownership — in progress.** Startup HTML now generated from
   current SSR output. Native Summary buttons are React-owned; private React
   Fiber injection removed. Obsolete Drive/D1 API implementations removed.
   Subsequent cleanup removes unused hosted auth/Drive helpers, D1 scaffold,
   three unused dependencies and the second lockfile; current ownership is in
   `docs/override-collapse.md`. v190 completed full web release verification.
6. **CSS consolidation — in progress.** Card menus/buttons now have one stylesheet
   owner and 44-point touch targets; competing historical rules removed.
   Shared theme/motion tokens own common controls. Removed 97 overwritten CSS
   declarations and legacy reader style/meta/hidden-button injection. Canonical
   light typography retains explicit user choices; both engines verify font,
   bold and justification. Subsequent cleanup removes the retired reader-mode
   CSS and hidden text-mode button, and replaces stale narration DOM queries
   with typed state. Mixed library/reader stylesheet organization remains;
   retained iframe gestures/font normalization are intentional compatibility.
7. **Catalogue startup — implemented, candidate verified.** Worker preprocessing,
   normalized alias maps, bounded fallback, placeholder-cover handling. No measured
   production speedup is claimed yet.
8. **Speech scheduling — implemented, candidate verified.** Server concurrency and pending work bounded;
   playback outranks prefetch; disconnected queued work is dropped. Browser warm
   cache/cancellation bounded. Two retained Piper models, crash recovery and idle
   retirement tested. Read-only Pi bench: 1,086 ms cold, 665/705 ms warm; two voices
   concurrently passed (~136 MB per model). WAV cache has a 2 GB soft budget,
   active-stream protection and age restrictions. This does not claim expressive
   longer clips or measured end-to-end production improvement.
9. **Detailed-summary efficiency — in progress.** Text preparation/fingerprinting
   moved off the UI thread. Changed-input checkpoints are invalidated. FIFO and
   per-work selection retained. Remaining: device timing/quality checks and extraction
   reuse measurements. Legacy checkpoints without fingerprints cannot prove unchanged
   input and are not claimed to have that guarantee.
10. **Accessibility/polish — in progress.** Theme-aware ticks, touch targets,
    Settings/editor focus isolation, fallback-cover text and corrected metadata.
    All four library dialog paths now use the shared focus hook. Candidate phone
    screenshots inspected in both themes/engines; native queue interactions also
    pass on the physical phone. Wider manual inspection remains.
11. **Release/security — implemented and release-verified.** Origin/JSON mutation guards with tests;
    deploy script requires authenticated public checks, typecheck, units, browser
    tests and post-install smoke checks. Longer operational observation remains.
    Complete v186 assets/server
    hashes, LAN/public MIME and branding hashes, rendered hydration, menus/Settings
    in both themes and release provenance all passed. Complete previous release and
    flat rollback inputs are backed up; rollback checks both origins after restore.
    The upgraded restricted helper is installed and checksum verified;
    its previous version is backed up. Current authenticated public v185 smoke
    and released v186 smoke passes both engines/themes. Failed/unavailable required
    checks block release. Live Piper WAV/Range checks pass (984 ms cold, 529 ms
    second clip); cross-origin mutation is refused without changing library data.
12. **Storage — read-only check complete; relocation not done.** Pi currently
    exposes its SD root and two NTFS external drives, not an SSD mount. Do not move
    the library or claim SSD gains without confirming suitable hardware.

## Native test investigation

After restoring simulator audio, six queue/settings cases passed. Five of six
details/library/playback cases passed against the local Summary fixture; the Pi
voice case correctly failed because that fixture does not serve real voices.
That case passed when rerun against the actual Pi. Thus twelve distinct native
cases passed; no failed required test was waived. Physical-device Library and two
Summary Settings cases subsequently passed against v186. Build 8's signed Release
was then installed in place and launched; signed build 7 is retained for recovery.
Explicit Summary sentence navigation reveals near the top; ordinary playback
waits for the edge. Details-close waits for actual native and web dismissal.

## Temperature report

The user reports a hot phone during on-device summary generation. Source inspection
finds sequential AI calls and immediate FIFO continuation, with cooldown only after
model failures. No ProcessInfo thermal-state gating exists. No temperature is
measured or safety diagnosis claimed. Automatic thermal pauses were proposed and
await explicit user approval; no such behaviour is included in this candidate.

## Release constraint

The native Summary-injection removal depends on the new source-owned web buttons.
Never install that native candidate against the old web release. Release and verify
the compatible complete web candidate first, then the native app, with recovery
artifacts retained. No production-only edits or generated-bundle patches.

Release record: `/Volumes/Seagate/ReadingRoom/deployment-history/v186.json`.
Complete rollback: `/Volumes/Seagate/ReadingRoom/deployment-backups/20261004-120938-before-v186`.
Physical result: `/Users/anuj-mac/Library/Caches/home-books-ios-device-audit/Logs/Test/Test-ReadingRoom-2026.10.04_12-11-06-+0530.xcresult`.

Two preliminary ad-hoc public-reader assertions were corrected: an image-only
cover has no text, and Demons and Druids labels its opening TOC entry Prologue,
not Chapter 1. Corrected real-cover/TOC/chapter/Close checks passed in both engines;
no application failure or required gate was waived.
