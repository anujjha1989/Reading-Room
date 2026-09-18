# Changelog

User-visible Reading Room changes are documented here. Git remains the detailed source history, while machine-readable deployment manifests live in `/Volumes/Seagate/ReadingRoom/deployment-history/`.

## Unreleased

No unreleased user-visible changes are currently documented.

## v90 — 18 September 2026

### Fixed

- Restored visible table-of-contents rows in the reading sheet.
- Made the reader derive its theme directly from the active app theme.
- Added checks that catch an unwired reader-theme integration before deployment.

### Changed

- Began versioning the application bundle on every deployment instead of leaving it fixed at `v=33`.

## v82–v89 — 18 September 2026

### Fixed

- Corrected Read Aloud speed, stalls, blue text, and page-mode behaviour.
- Fixed blank Pages mode and several stale or illegible reader themes.
- Made reading controls, settings overlays, and theme swatches follow the app theme.

### Added

- Added motion refinements to the reader.
- Brought the standalone server into source control and added the quarantine API.

## v79–v81 — 16–17 September 2026

### Fixed

- Prevented Read Aloud from looping back to the beginning in Scroll mode.
- Applied the same continuity fixes to Pages mode.
- Corrected book-card menu placement and clipping.

### Changed

- Moved per-book actions into a compact `⋯` menu and removed the card progress bar.

## v71–v78 — 16 September 2026

### Changed

- Rebuilt the library header as an iOS Books-style icon rail.
- Refined the Home shelves, Continue card, filters, card sizing, and shelf gradients.
- Moved destructive book actions behind the per-book menu.

### Fixed

- Corrected reader font controls, reader themes, edition counts, header alignment, and settings-gear placement.
- Removed an unattended deployment prompt that could pause releases.

## v65–v70 — 16 September 2026

### Added

- Reconciled the previously deployed override layer with the source repository.
- Added deployment rollback capture for the live HTML, settings page, service worker, and server.
- Brought the standalone Settings page into the deployment pipeline and displayed the deployed version in About.

### Fixed

- Corrected deployment version drift between rendered HTML and versioned override files.
- Added JavaScript/CSS MIME validation and public Tailscale verification.
- Prevented service-worker navigation caching from preserving an older interface.
- Prevented macOS AppleDouble sidecars and unreadable override permissions from breaking deployments.

## v65 recovery snapshot — 16 September 2026

- Preserved the then-running application on `recovery/deployed-v65` before reviewing the reconciled source.
- Labelled the snapshot unreviewed so it remains distinct from later production history.
