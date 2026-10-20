# Seamless shelves v232

Approved 20 October 2026: deploy the proposed Mac Home refinement without any
shelf separator. Baseline b867ffa/live v231. Candidate source47c1c93.

Changed the owning shelf rules: shared page surface, no gradient, border or
inset separator shadow. Removed obsolete shelf-gradient tokens instead of
adding a second visual override. Existing shelf vertical spacing, serif
headings, cover shadows, percentages and inline menus retained. Mac Home uses
40px gutters, 164px cards and 24px card gaps, with 14px title/13px author text.
Phone geometry and 44px action targets unchanged. Sidebar, glass controls and
branding retained; no additional interface controls or catalogue edits.

Web and iOS use the same source/bundle. No native iOS changes or reinstall.
Native tvOS assessed and its shelf gradient/divider removed in build23;
see canonical native tvos/RELEASE-1.1-build23.md for device/test details.
No dependency, state, reader, narration, parser, cache or server changes.

Validation: clean build/typecheck; complete canonical candidate gates including
unit tests, four design browser tests and 66 existing browser checks passed.
Shelf regression now asserts flat light/dark surfaces with no lines/shadows at
320/393/768/1717px, retains long-title/author/menu geometry and menu actions.
Actual candidate screenshots inspected. Additional live LAN/public checks in
Chrome/WebKit passed both themes and phone/Mac sizes, including surface styles,
desktop geometry, card menu and Library/Settings navigation; screenshots inspected.
Automated saves intercepted; no real reading-history mutations or paid calls.

Canonical installer retains complete release/hash/MIME/voice/rendered/TOC checks
and automatic rollback; no test bypass or reuse of v231 build. Previous v231
release retained intact, plus rollback capture:
/home/anujjha1989/app-restore/release-rollback/20261020-172415-before-v232.
All final canonical live gates passed, including real Dickens navigation on both
origins and both engines. Deployment provenance saved to
~/.home-books/deployment-history/v232.json and Pi
/mnt/seagate/ReadingRoom/deployment-history/v232.json; deploy-v232 binds the app
candidate47c1c93. Complete source backups retained locally and on Pi app-restore.
