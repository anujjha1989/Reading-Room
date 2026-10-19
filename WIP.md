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

Validation pending: build, focused asset/title tests, actual LAN/public light/dark
screenshots, MIME/hash checks, native title assessment. No release installed yet.
