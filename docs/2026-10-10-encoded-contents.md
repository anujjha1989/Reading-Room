# Dickens encoded contents navigation — implementation ready, release pending

The phone recording showed A Child's History of England closing the contents
panel without leaving Pickwick. Read-only WebKit reproduction reported
`No Section Found`: the NCX uses `CR%21…_1509.html`, while the manifest/archive
uses `CR!…_1509.html`. Decoding the link loaded the intact book text.

`readerToc.ts` now resolves every parent/nested contents link against the
manifest, preferring an exact match before a single safe decode. It retains
fragments and leaves malformed/missing optional links unchanged. No prose,
scroll manager, narration, saved-position or styling code changed.

Five focused unit checks and all four targeted Chromium/WebKit checks passed,
including navigation from Pickwick to the real A Child's History of England.
Evidence: `/tmp/home-books-dickens-targeted-final.log`.

The full cross-platform gate then stopped in its web phase: 62/64 browser checks
passed, with the two real Dickens checks failing during download. The preview
committed response headers before the upstream body finished, masking its
30-second download timeout with `ERR_HTTP_HEADERS_SENT`; this test-helper error
is now corrected and has its own regression check. Live v218 is unchanged.

The Pi read the 56,118,588-byte file locally in 0.17 seconds. A Mac LAN download
received only 14,415,993 bytes in 60 seconds; one-MiB samples took 2.7–5.5 seconds.
The LAN route is en0 to 192.168.68.112, and the Pi was idle. The user was asked
to check the Mac's Wi-Fi. Do not bypass the failed gate or deploy this candidate
until the required checks can complete on a stable connection.

Native iPhone book reading inherits the web correction. Native BookText already
decodes percent-encoded links; a real Dickens navigation test was added for TV
and the shared native parser. The full native phases have not yet run in this
attempt because the web gate failed first. No native runtime or app version was
changed, and no new app was installed. Retry the complete parity script, then
the official deployment pipeline and both live-origin Dickens UI checks.

Failed gate evidence: `/tmp/home-books-reader-parity.P1rvOr/web.log` and
`/tmp/home-books-dickens-parity.log`. A successful deployment must replace this
pending status with source/version, verification and rollback evidence.
