# Current checkpoint: seamless shelves v232

Approved 20 October 2026: deploy the Mac mockup without its separator line.
Baseline b867ffa / live v231; native f23cf95 / build22. Scope: flat shared shelf
surface (white light / black dark), no divider, existing vertical breathing room,
roomier Mac Home cards and reduced sidebar gutter. Phone controls, book artwork,
reader, playback, saved state and dependencies remain unchanged. Native TV shelf
gradient/divider assessed and removed for parity, build23. Selected coverage:
Chrome/WebKit shelf geometry/menus at phone/tablet/Mac sizes and both themes,
live origins; native build and focused remote library test. Canonical release
script retains mandatory full gates; do not skip them. Rollback v231/build22.
Status: implementing; not deployed yet.

# Previous checkpoint: design refinements v231

Completed and deployed 20 October 2026. See docs/design-refinements-v231.md
for scope, dependency/override review, tested candidate provenance, authorized
installer-only resume and validation. Web/iOS shared UI v231 is live on LAN and
public HTTPS. Both Apple TVs have 1.1 build22 installed; Living Room launch passed,
Bedroom awake-device launch remains unverified. Physical TV remote/audio not
tested. Prior web v230 and signed TV build21 retained for rollback.

# Previous checkpoint: transparent title/bookmark mark

Baseline: exact v229 source commit804613f, recovered editable clone on Mac.
User requested the iOS open-book icon without its green background in title and
bookmark, matching Home TV. Preserve aspect ratio and all unrelated UI/features.

Implemented: background-extracted transparent PNG master (built-in image edit,
not a redraw request), deterministic proportional title/favicon asset builder,
HomeBooksMark contains the image in existing40x40 layout, versioned favicon URL.
Installable iOS and existing192/512/Apple-touch icons unchanged. Updated focused
asset/title tests, added recovered-layout complete-candidate installer with backup
and hash verification/rollback. Candidate version230.

Completed: clean build/typecheck; focused transparent asset and proportional
title/layout tests passed. Candidate installed as complete v230 release from
fd090c2 with34verified file hashes and rollback directory on Pi. Actual LAN
Chrome/WebKit light/dark Library/Settings and title tests passed; screenshots
visually inspected. Public SVG MIME and exact contents passed; public Chrome
and WebKit light/dark route, hydration, Library and Settings checks passed.
Native installable artwork unchanged; shared web/iOS title
receives this release. Native TV title/bookmark surface was not changed by this
web-specific request; no TV rebuild or installation claimed.

Canonical editable clone: /Users/anuj-mac/Developer/home-books-web. Preserved
source archive: ~/app-restore/home-books-source-fd090c2.tar.gz on Pi.
Image edit prompt: remove only green backdrop/shadow from iOS book, preserve
silhouette/proportions; built-in image tool. Cutout source kept in assets/branding.
