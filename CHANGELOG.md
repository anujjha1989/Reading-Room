# Changelog

User-visible Reading Room changes are documented here. Git remains the detailed source history, while machine-readable deployment manifests live in `/Volumes/Seagate/ReadingRoom/deployment-history/`.

## Unreleased

### Changed

- Gave the drawn covers real variety. There were six palettes, but all of them
  sat in the same narrow band of darkness, so at thumbnail size they read as one
  colour. There are now twelve spanning near-black to parchment.

### Fixed

- The title on a drawn cover now takes its colour from the cover, instead of
  always being white — which was illegible on the two light grounds.

### Added

- Completed the rebuilt reading menu as a proper React component. It now includes
  sentence back/pause/forward controls, a 30-minute `−`/`+` sleep timer, voice
  selection, a clearly labelled speed slider, reading-mode and page-animation
  controls, full typography settings, Reset and Share.
- Added permanent parity checks for the React and legacy reading menus. A deploy
  now fails if a working control silently disappears during the migration.

### Fixed

- Removed the white bar across the top of the screen in dark mode. Two causes: a
  single cream status-bar colour for both themes, and React reapplying its own
  cream value on hydration, which overwrote the corrected tags.
- Stopped Themes & Settings flickering twice when a theme is picked.
- Fixed the back button in Bookmarks and Search, which closed the panel and left
  you stuck with nothing open.
- Made the library gear, filter and sort buttons legible in dark mode — the disc
  behind them was almost invisible, so they read as bare marks on black — and
  brought the glyphs up to the size used in the reader.
- Gave the library settings page an entrance; it appeared instantly before.
- Fixed v104 showing an incomplete reading menu on devices where Claude's
  `rr-react-sheet` comparison flag had been saved. The parity-complete React menu
  is now the default; `?sheet=legacy` remains as a temporary recovery switch.
- Made Search and Bookmarks return to the active React reading menu instead of
  crossing back into the legacy implementation.
- Kept the book theme following the Home theme by default. A book becomes
  independent only after the reader explicitly chooses Light, Sepia or Dark;
  Reset returns it to following Home.

### Changed

- Made panels arrive rather than appear. Menus and sheets now fly in from an
  edge, overshoot slightly as they land, and settle; rows fan out in sequence
  behind them. Everything previously moved 8-14px, which at phone scale was
  indistinguishable from a fade.
- Gave menu navigation a direction: going deeper enters from the right, coming
  back enters from the left, so movement tells you where you are.
- Made the close and menu buttons slide off the right edge of the screen when
  you centre-tap, and fly back in when you tap again, instead of blinking out.
- Removed the legacy reading-menu chrome whenever the React menu is active, so
  the two implementations cannot overlap or intercept the same tap.

## v95 — 19 September 2026

### Changed

- Added Previous sentence, Pause/Resume and Next sentence as one compact Read
  Aloud transport in both the reading sheet and the collapsed view.
- Added a 30-minute sleep timer to Read Aloud. Each tap adds another 30 minutes
  and the remaining time stays visible in the sheet.
- Made continuous EPUB scrolling unload distant chapter contents while keeping
  their measured placeholders. Large collected works no longer accumulate a
  live iframe for every chapter as you scroll.

### Fixed

- Fixed Pause occasionally ending the entire Read Aloud session and removing
  its collapsed controls.
- Cancelled stale Read Aloud page navigation immediately on Pause or Skip, so
  an old sentence can no longer keep turning Pages in the background and leave
  the reader on a blank page.
- Fixed paginated EPUBs clipping every text column after the first, which made
  the page counter advance over an otherwise blank screen.
- Refreshed Read Aloud controls only after the sentence queue and cursor are
  current, so Previous/Next no longer lag one sentence behind playback.
- Stopped automatic narration following from fighting a manual scroll; it now
  waits for the reader's gesture to settle before bringing spoken text back
  into view.

### Validation

- Rebuilt and deployed the complete application, then verified the live v95
  assets and Settings/About version on the Pi.
- Exercised William Trevor in Pages mode from pages 6–9 and across the next
  chapter, with visible text on every page.
- Scrolled through the Chapter 1 boundary in both directions with no position
  jump and no more than two live chapter frames.
- Verified collapsed and expanded Read Aloud controls, persistent Pause,
  sentence skipping while paused, and two timer taps producing 60 minutes.

## v92 — 18 September 2026

### Changed

- Rebuilt the reading menu as a toolbar: Contents keeps a full-width row because
  it carries your position, and Search, Read Aloud, Bookmarks and Text became
  four equal icon tiles with larger icons.
- Grouped Themes & Settings into four distinct shapes instead of eight identical
  rows — a text-size stepper, six round colour swatches, a Pages/Scroll segmented
  control, and one row through to the rest.
- Made Read Aloud's Start/Stop the dominant control, replaced the voice dropdown
  with a row that opens a proper voice list, and gave the speed slider endpoint
  labels. The dropdown was where the empty space came from.
- Removed the "More" menu. Share and the text-mode toggle moved into More
  options, where the rest of the advanced settings already lived.

### Fixed

- Stopped the reading sheet fluttering on every tap. The sheet rebuilds its rows
  whenever anything is pressed, and the entrance animation was replaying each
  time; it now runs only when the sheet opens.
- Narrowed the Bookmarks panel, which filled the screen edge to edge for a list
  that is usually empty. It now matches the reading sheet's width and corner, so
  the two panels read as one family, and an empty list no longer reserves space.

### Deployment

- Git commit: `db99019`
- Previous version: v91
- Mode: full build
- Verification: LAN passed; Tailscale advisory not confirmed

## v91 — 18 September 2026

### Changed

- Rebuilt the reading sheet on one type and spacing system. It had accumulated
  nine different row heights, five font sizes and seven corner radii; these are
  now a single scale, so rows share a height and labels share a size.
- Split the sheet's typography into two voices with one job each: a serif for the
  panel title and the theme swatches, which preview a reading surface, and the
  UI face for everything operational.
- Made row layout give the label the space and the icon a fixed column, so a
  short label and its icon no longer sit at opposite edges of a wide row.

### Fixed

- Made the sheet's entrance visible. It previously moved 18px behind a heavy
  blur, which read as no animation at all; it now scales up with a slight
  overshoot and its rows arrive in sequence. Presses give visible feedback.
  All motion is disabled under `prefers-reduced-motion`.

### Deployment

- Git commit: `72ded3a`
- Previous version: v90
- Mode: `--no-build` (override CSS only)
- Verification: LAN passed; Tailscale advisory not confirmed

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
