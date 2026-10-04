# Home Books reliability and consolidation work

This is an implementation checkpoint, not a release-completion claim.
Canonical web source: this repository. Native source:
`/Users/anuj-mac/Developer/readingroom-ios-src`. SSD build staging is disposable.
No candidate has been committed or deployed as of this checkpoint (4 October 2026).

## Accepted workstreams and evidence

1. **Regression coverage — candidate verified.** 26 root tests, 21 mobile-browser
   reliability/list checks and two real-MOBI narration checks pass. Broader audits
   include Christie collections, real Demons and Druids chapter boundaries,
   branding, glass controls, shelves, title corrections and native Summary buttons.
   Twelve distinct native simulator cases pass with the correct server fixture.
   Remaining: long-session observation, released public route and physical device.
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
   Remaining: dependency/documentation cleanup and complete release verification.
6. **CSS consolidation — in progress.** Card menus/buttons now have one stylesheet
   owner and 44-point touch targets; competing historical rules removed.
   Shared theme/motion tokens own common controls. Removed 97 overwritten CSS
   declarations and legacy reader style/meta/hidden-button injection. Canonical
   light typography retains explicit user choices; both engines verify font,
   bold and justification. Remaining: broader historical reader CSS/bridge cleanup.
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
    screenshots inspected in both themes/engines. Remaining: physical inspection.
11. **Release/security — in progress.** Origin/JSON mutation guards with tests;
    deploy script requires authenticated public checks, typecheck, units, browser
    tests and post-install smoke checks. Remaining: installer upgrade, authenticated
    integration checks, complete-candidate review, provenance, deployment and rollback
    verification. The upgraded restricted helper is installed and checksum verified;
    its previous version is backed up. Current authenticated public v185 smoke
    passes both engines/themes. Failed/unavailable required checks block release.
12. **Storage — read-only check complete; relocation not done.** Pi currently
    exposes its SD root and two NTFS external drives, not an SSD mount. Do not move
    the library or claim SSD gains without confirming suitable hardware.

## Native test investigation

After restoring simulator audio, six queue/settings cases passed. Five of six
details/library/playback cases passed against the local Summary fixture; the Pi
voice case correctly failed because that fixture does not serve real voices.
That case passed when rerun against the actual Pi. Thus twelve distinct native
cases passed; no failed required test was waived. Build 8 has a successful signed
Release build but is not installed yet; signed build 7 is retained for recovery.
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
