# Home Books

Home Books is a private, Apple Books-inspired web library and reader hosted
on a Raspberry Pi. It combines a searchable catalogue with EPUB, PDF and comic
readers, reading progress, themes, bookmarks, search and Read Aloud.

This repository is the canonical source for the application and its Pi
operations. The private GitHub repository is the code backup; the book library
and runtime state are backed up separately.

## Repository map

- `app/` — React UI, library, readers and reading controls.
- `server/` — standalone Pi server and APIs.
- `overrides/` — service worker and version counter;
  no runtime UI override scripts or stylesheets are loaded.
- `deploy/` — build, validation, deployment, rollback and live-audit tooling.
- `ops/pi/` — sanitized snapshot of the current Pi services and maintenance
  programs, with their installed paths documented in `ops/pi/README.md`.
- `docs/` — deployment history and historical migration notes.
- `tests/` — regression coverage.

The historical hand-maintained Pi repository through v53 is preserved in the
GitHub branch `archive/pi-hand-maintained-v53`. It is retained for archaeology,
not used as the current deployment source.

## Development

Requires Node.js 22.13 or newer.

Use pnpm 10 and the single `pnpm-lock.yaml` lockfile. The old npm lockfile,
ChatGPT-host authentication helpers, Drive URL helper, D1 examples/schema and
migration generator were retired. Runtime authentication and storage belong to
the Pi server, not the build worker. Historical code is recoverable from Git.
The Cloudflare/Vinext build tooling is still required to render the React
startup document; it is not a second production server.

```bash
pnpm install
pnpm dev
pnpm test
pnpm test:browser
pnpm build
```

`tests/browser/reliability.test.mjs` runs the candidate's critical mobile flows
in Chromium and WebKit against an isolated, read-only preview. Book fixtures,
settings and saves are mocked; these tests do not modify the real library.
Install Playwright in the test environment, or set `HOME_BOOKS_PLAYWRIGHT` to its
module path; `READING_ROOM_CHROME` optionally selects an installed Chrome binary.
The other browser audits accept `READING_ROOM_BASE_URL` and may target the Pi.

### EPUB reading pages

The footer shows continuous whole-book **reading pages**, each representing
1,500 text characters. These are not a printed edition's page numbers or a
count of screenfuls. They remain stable across section boundaries, font sizes,
reading modes and reopening; a Complete Works file has one continuous count.
`epubPageIndex.ts` lazily counts preceding detached archive documents, yields
between them and cancels on close. It never loads/unloads live reader sections
or adjusts scrolling. Optional cached lengths are invalidated by the archive's
text/manifest CRCs; no book text is stored in this cache. Opening does not wait
for indexing. Image-only opening covers show page 1.

## Deployment

The Mac builds the app and deploys to the Pi using `deploy/deploy.sh`. The
script increments `overrides/VERSION`, validates the built app, captures a
rollback, and installs through the restricted Pi helper. Both LAN and the actual
authenticated public HTTPS origin are required release checks. A failed or
unavailable check blocks release and restores the previous candidate.

There is one editable web source (this repository) and one native source
(`/Users/anuj-mac/Developer/readingroom-ios-src`). The disposable Mac SSD cache
at `~/Library/Caches/home-books-build` contains dependencies and build outputs,
not a second source. `deploy/render-index.mjs` generates startup HTML from the
current React server render; there is no maintained HTML template. The restricted
Pi installer copies the complete candidate to `/opt/reading-room/current`.
Books, artwork, voices and user state remain independently configured data.

Before deployment, provide private `READING_ROOM_CURL_COOKIE_FILE` and
`READING_ROOM_COOKIE_FILE` session files for the public-origin checks. They must
never enter this repository. A helper lacking a staged server module causes a
pre-install failure, not a partial server/client release.

```bash
./deploy/deploy.sh
```

Deployment tags use `deploy-vN`. The deployed version also appears in the
application's About page.

## Additional local narration voices

Piper remains available and remains the default. Kokoro adds 28 English voices
to the same `/api/tts/voices` catalogue, so both the web reader and the iOS
summary player use their existing voice menus and playback controls. It runs
locally on the Pi; there are no hosted API fees and no additional public port.

The source-owned `server/kokoro-worker.py` uses the pinned `kokoro-pi` runtime
and an optimized Kokoro v1.0 model. One persistent worker shares its model
across voices, limits inference to two CPU threads, and releases itself after
two idle minutes. Kokoro has its own single-lane priority/deduplication queue;
Piper keeps its existing two lanes. Both use the existing bounded WAV cache.

Provision once with `sudo bash ops/pi/install-kokoro.sh` on the Pi. This creates
`/opt/reading-room/kokoro` from `ops/pi/kokoro-requirements.txt`, downloads
checksum-verified upstream weights and builds/validates optimized models.
Alternatively pass a previously validated model-build directory as the first
argument. Voices stay hidden until the installer verifies the model and writes
`READY`. Runtime dependencies/models are reproducible installation artefacts,
not another editable source. Keep them separate from the book library.

On the user's Pi 5, paragraph tests with Heart, Emma and George generated audio
at approximately 1.8–1.9× playback speed using two CPU threads. First use also
loads the model (~2.5 seconds); cache hits avoid synthesis. Very high playback
speeds, multiple listeners or other heavy Pi workloads can exhaust that margin.
Keep Piper available for those cases. Voice quality remains a listening judgment,
not a claim of parity with commercial narrators.

Upstream attribution: [Kokoro model (Apache-2.0)](https://huggingface.co/hexgrad/Kokoro-82M),
[kokoro-onnx (MIT)](https://github.com/thewh1teagle/kokoro-onnx),
[kokoro-pi (MIT)](https://github.com/zreecespieces/kokoro-pi).

## Not stored in Git

- books, scripts and other copyrighted library files;
- Google Drive/rclone credentials, SSH keys, tokens and `.env` files;
- generated catalogue and local-file maps;
- cover art, TTS voices and synthesized audio caches;
- reading progress, bookmarks and other user state;
- build output, dependencies and deployment rollback archives.

These are data or secrets rather than source code and require a separate data
backup.
