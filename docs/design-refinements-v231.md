# Design refinements v231 — implementation checkpoint

Approved by Anuj on 20 October 2026: implement and deploy all written design-review refinements across formats; preserve aesthetics and functionality. Mockups are illustrative, not a pixel or feature specification.

Baseline web aebe6c2 (live code fd090c2 v230); native 2f285211 build21. Both trees clean before work. Canonical native checkout /Users/anuj-mac/Developer/readingroom-ios-src. Original release directories and installed-device candidates must remain recoverable.

Scope: optional comfortable/compact library density with persistence; My Books heading/empty-state cleanup without removing existing shelves/actions; bounded desktop Settings; bounded wide-screen prose and intrinsic image aspect ratios; TV shelf spacing/secondary text; identical transparent proportional book title mark on TV. No narration, syncing, pagination, parser, storage or catalogue rewrites. Native iOS unchanged unless required by shared UI.

Risk/coverage: presentation and one persisted preference. Check responsive grids, long titles, author/menu alignment, list/compact persistence, My Books filters and empty state, Settings open/back/close/focus in both themes; reader image proportions and text measure at mobile/desktop widths plus existing controls, desktop inputs and page navigation. Run relevant unit tests and clean production build. TV build, unit tests and dedicated simulator remote navigation, screenshot inspection. Actual LAN/public release assets and flows, native installation/version checks. No paid summaries or real reading-history writes in automated tests. Reader typography coverage escalates if a layout/position issue is found.

Status: implementation in progress. Not yet built, tested or deployed. Use existing release pipeline; do not bypass gates or call an unverified build deployed. If a device is asleep/unavailable, report that platform as pending rather than claiming completion.
