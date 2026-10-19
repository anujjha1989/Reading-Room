# Transparent title/bookmark mark

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
visually inspected. Public SVG MIME and exact contents passed; public browser
checks finishing. Native installable artwork unchanged; shared web/iOS title
receives this release. Native TV title/bookmark surface was not changed by this
web-specific request; no TV rebuild or installation claimed.

Canonical editable clone: /Users/anuj-mac/Developer/home-books-web. Preserved
source archive: ~/app-restore/home-books-source-fd090c2.tar.gz on Pi.
Image edit prompt: remove only green backdrop/shadow from iOS book, preserve
silhouette/proportions; built-in image tool. Cutout source kept in assets/branding.
