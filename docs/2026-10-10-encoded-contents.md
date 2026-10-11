# Dickens encoded contents navigation — deployed v219

Released 11 October 2026 through the canonical deployment pipeline. Source:
`deb9dbabce038186838d5c89a690db45b90ef6d6`, tag `deploy-v219`.
The correction is live on LAN and the authenticated public HTTPS origin.

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
is now corrected and has its own regression check. That attempt left v218 intact.

The Pi read the 56,118,588-byte file locally in 0.17 seconds. A Mac LAN download
received only 14,415,993 bytes in 60 seconds; one-MiB samples took 2.7–5.5 seconds.
The LAN route is en0 to 192.168.68.112, and the Pi was idle. The user was asked
to check the Mac's Wi-Fi. After the connection recovered, the full file downloaded
in 3.98 seconds on LAN and 27 seconds through the public address.

Native iPhone book reading inherits the web correction. Native BookText already
decodes percent-encoded links; a real Dickens navigation test was added for TV
and the shared native parser. No native runtime or app version changed, and no
new physical app installation was needed.

Failed gate evidence: `/tmp/home-books-reader-parity.P1rvOr/web.log` and
`/tmp/home-books-dickens-parity.log`.

## Completed verification

- Full parity: 10 web unit checks, 64 browser checks, 53 TV unit/live checks,
  14 TV remote/UI checks, and 5 iPhone library/summary checks; zero failures/skips.
  Receipt: `/tmp/home-books-reader-parity.nEiSpT/passed.json`.
- TV's existing decoding opened A Child's History of England with 42 sections;
  its 53,093 collection pages retained stable identities. Christie and Trevor
  collection checks and live Piper/Kokoro playback also passed.
- Official release: 51 unit checks, 64 candidate browser checks, static checks,
  complete candidate/live hashes, public asset MIME/hash checks, and playable
  narration checks on both origins passed.
- Both live origins passed Chrome/WebKit hydration, library menus, Settings and
  light/dark checks, followed by all four encoded-contents checks per origin.
  Real Dickens navigation changed Pickwick to A Child's History of England.
  Progress/catalogue writes were isolated. Screenshots were visually inspected.
- A first installation encountered a live browser navigation timeout and restored
  v218. The same timeout affected the restored version. Fresh checks then verified
  v218 on both origins, and a complete normal pipeline retry passed for v219.
  No checks were bypassed and no timeout limits were loosened.

Successful deployment log: `/tmp/home-books-dickens-deploy-retry.log`.
Release manifest: `/Volumes/Seagate/ReadingRoom/deployment-history/v219.json`.
Rollback: `/Volumes/Seagate/ReadingRoom/deployment-backups/20261011-073640-before-v219`.
Native test source: `3934570252fb715b399ae98be5f104043edc390d`.
The npm registry override used during verification was command-scoped; global
Mac configuration was not changed.
