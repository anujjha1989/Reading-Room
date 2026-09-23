# Reading Room

Reading Room is a private, Apple Books-inspired web library and reader hosted
on a Raspberry Pi. It combines a searchable catalogue with EPUB, PDF and comic
readers, reading progress, themes, bookmarks, search and Read Aloud.

This repository is the canonical source for the application and its Pi
operations. The private GitHub repository is the code backup; the book library
and runtime state are backed up separately.

## Repository map

- `app/` — React UI, library, readers and reading controls.
- `server/` — standalone Pi server and APIs.
- `overrides/` — deployment HTML template, service worker and version counter;
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

```bash
pnpm install
pnpm dev
pnpm test
pnpm test:browser
pnpm build
```

`pnpm test:browser` runs the critical mobile flows against the deployed Pi app
(`http://anujrpi.local:4311` by default) in an isolated Chromium profile. Set
`READING_ROOM_BASE_URL` to audit another origin. Screenshots are written to the
system temporary directory, not committed to the repository.

## Deployment

The Mac builds the app and deploys to the Pi using `deploy/deploy.sh`. The
script increments `overrides/VERSION`, validates the built app, captures a
rollback, and installs through the restricted Pi helper. LAN verification is
required; the Tailscale endpoint is checked when reachable from the deploying
machine.

```bash
./deploy/deploy.sh
```

Deployment tags use `deploy-vN`. The deployed version also appears in the
application's About page.

## Not stored in Git

- books, scripts and other copyrighted library files;
- Google Drive/rclone credentials, SSH keys, tokens and `.env` files;
- generated catalogue and local-file maps;
- cover art, TTS voices and synthesized audio caches;
- reading progress, bookmarks and other user state;
- build output, dependencies and deployment rollback archives.

These are data or secrets rather than source code and require a separate data
backup.
