# Home Books: risk-based testing plan

Approved by Anuj on 11 October 2026 after a small contents-link fix incurred
overlapping full suites, large-book pagination and a release retry. Preserve
working features while matching verification effort to the actual change.

## Select coverage before implementation

Record changed components, risk, affected formats, selected checks and a rough
time estimate. Assess web, iOS and TV together; assessment does not require
retesting or reinstalling every unchanged native app. Escalate coverage when the
diff, a failure, or uncertainty reveals a wider impact.

| Change | Required focused coverage | Full-suite trigger |
| --- | --- | --- |
| Copy, colour, spacing, icons | Affected screen/action, mobile and desktop sizes, light/dark, touch/focus/remote where affected; asset MIME/hash checks for branding | Shared layout/chrome refactor or widespread visual changes |
| Isolated contents/navigation bug | Unit edge cases, small EPUB fixture in WebKit/Chromium, reported real title, open/close and adjacent navigation; native parser check if relevant | Parser, chapter mapping, pagination or multiple formats change |
| Isolated library/settings issue | Changed action plus persistence, refresh/relaunch, grouped identities and failure path as relevant | Shared state schema, catalogue/scan or cache architecture changes |
| Scrolling, page identity, narration or progress | Full affected reader contracts: prose/punctuation, Unicode/limits, chapter continuity, pause/resume, saved position, voices and platform input | Broad shared reader work requires the cross-platform parity suite |
| Authentication, data/storage, dependency or release machinery | Security/data-integrity contracts, clean build, recovery tests and affected integration flows | Broad dependency/runtime changes or uncertain blast radius |
| Documentation only | Check references, consistency and diff; no app rebuild/reinstall | Documentation also changes executable configuration |

Coverage means all selected assertions pass, with no unexplained skips. Do not
chase an arbitrary global coverage percentage. Every repaired bug gets a small,
durable regression check that fails without the correction.

## Build once; test the same candidate once

The intended release path is one canonical-source build, one versioned candidate,
selected pre-install tests, complete backup/install, then short live checks.
Do not repeat an overlapping browser suite just because the workflow enters a
second script. Do not rebuild between testing and installation.

Reusing results requires a receipt binding the source/runtime inputs, lockfile,
build tool versions, selected suites/risk class, successful results and candidate
asset hashes. A relevant input change invalidates the receipt. Missing, stale,
incomplete or failed receipts must fail closed. This is verified reuse, not an
unchecked `--no-build` switch or a hand-picked mixture of release files.

Independent platform jobs may run concurrently when they use isolated build
outputs and dedicated simulators and do not compete for the same app/process.
Freeze the candidate while testing. Avoid saturating the Mac with simultaneous
large-book layout jobs. Summarise overlapping coverage rather than counting the
same test twice as extra confidence.

## Keep expensive checks purposeful

- Prefer fixture/unit checks for encoding, punctuation, parser and state rules.
- Use one reported real book for a narrow regression. A contents-link check
  should prove the selected work/chapters open, not paginate an entire 53,000-page
  TV collection unless pagination or page identity actually changed.
- Reserve full Christie/Dickens/Trevor pagination and long scrolling for changes
  affecting those systems or an explicit broad audit.
- iOS book reading shares the web bundle: WebKit coverage plus relevant wrapper
  smoke is sufficient for a web-only fix; do not rebuild the native wrapper.
- Keep native summary playback tests for summary/audio changes, not unrelated
  shelf copy or icon changes. Keep existing voices and natural pauses covered
  whenever narration is affected.
- Never mutate real reading history or trigger paid summary generation in tests.
- Preflight the required browsers, authentication and book transfer before a long
  run. Distinguish infrastructure failures from assertion failures; never retry
  assertions until they happen to pass or silently loosen timeouts.

## Safeguards that remain mandatory

Keep source provenance, a fully accounted-for tree, complete rollback backup,
candidate/live hash checks, asset MIME/content checks, health after restart and
short real-origin checks on LAN and authenticated public HTTPS. Verify the
changed flow plus library/Settings and the relevant themes/device sizes. A failed
required live check restores the previous release; verify the restoration too.
Use representative physical-device checks when hardware/input/audio risk calls
for them, not as a blanket requirement for unrelated edits.

## Current tooling gap — do not claim the speed-up is implemented

This document changes future test planning, not the release executables.
`deploy/deploy.sh` still rebuilds and runs its full fixed candidate suite, and
`scripts/check-reader-parity.sh` still runs the broad web/TV/iOS suites serially.
Before shorter release gates can be used, implement source-owned suite selection
and verified single-candidate receipts in the supported pipeline, with tests for
stale/failed receipts and rollback. Until then, use the supported installer and
do not manually skip its gates. Do not modify the pipeline during an active
release or claim that a fast path exists merely because this plan is recorded.

The target is minutes for small edits, not a promised universal duration. Measure
the focused path after implementation and report remaining bottlenecks honestly.
