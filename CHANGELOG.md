# Changelog

User-visible Reading Room changes are documented here. Git remains the detailed source history, while machine-readable deployment manifests live in `/Volumes/Seagate/ReadingRoom/deployment-history/`.

## v207 — 2026-10-05

- Read Aloud no longer pauses in the middle of sentences in books whose source file is hard-wrapped (a line break every ~80 characters, common in converted EPUBs). Those invisible line breaks were being treated as sentence ends, so clips began and ended wherever the file happened to wrap. They are now read as the spaces they are; blocks that really display their line breaks (verse, preformatted text) keep them.
- A sentence too long for one clip is now cut at the last comma, semicolon, colon or dash, and between two plain words only when it has no such pause at all.
- Measured on Atonement: clips ending mid-phrase fell from 1,487 of 4,595 to 5 of 4,913. Affects every voice (Pi and iPhone). Highlight positions are unchanged.
- Release tooling: the deploy script can reach the Pi by its Tailscale name (`READING_ROOM_PI_HOST`) when away from the home network; the default and every check are unchanged.

## v206 — 2026-10-05

- Library thumbnails: author names get about three times the width before truncating. The name was still reserving space for a ⋯ button that used to overlap it, on top of the button's own touch area; the ⋯ pill now lines up with the cover's right edge. Its 44px touch target is unchanged.

## v205 — 2026-10-05

- Desktop Library: the search field no longer runs off the right edge of the window. The frozen header kept a full-window width after being moved beside the sidebar; it now ends where the book grid ends, at every desktop width. Phone and tablet layouts are unchanged.

## v204 — 2026-10-05

- The sandbox-safe page input surface now supports mouse as well as touch:
  click page edges, click the centre to show/hide controls, drag to select
  text, or double-click a word for the existing highlight menu.
- Desktop arrows, Page Up/Down and Space/Shift+Space move through the reader;
  Scroll mode advances the viewport rather than skipping a chapter. M opens
  reading settings. Editing fields, selected text and focused controls retain
  their normal keyboard behaviour. Escape returns from search/marks to the
  reading menu, closes it, then closes the book.
- The sleep timer also supports Enter to extend and Shift+Enter to cancel.
  All existing visible controls, themes, narration and touch gestures remain.
- Added Chrome/WebKit desktop input checks in Pages/Scroll modes and timer
  keyboard checks to the required release gates. Book scripts remain disabled.
- The release check exposed a MOBI iframe-readiness race during mode changes.
  A pinned, reproducible dependency patch defers layout until the chapter body
  exists; its normal load handler then renders it. No dependency upgrade.
- Verified 44 browser checks, LAN/public asset and hydration gates, and real
  Amsterdam mouse/keyboard/search/wheel input on public HTTPS in WebKit,
  in Pages/Scroll and light/dark themes. Test saves were isolated from the
  user's progress and annotations; no physical iPhone retest was required.

## v203 — 2026-10-05

- Corrected desktop navigation to centred icon-and-label rows with 44px
  targets, consistent spacing, a softly tinted sidebar and theme-aware
  selection/hover states. Mobile and tablet keep the existing bottom dock.
- The desktop header and control rail now share the shelves' content inset
  and clear the sidebar, including on wide monitors. Reader and narration
  code are unchanged.
- Added Chrome/WebKit desktop alignment, mouse/keyboard navigation and
  mobile-breakpoint regression checks to the release pipeline.

## v202 — 2026-10-05

- The Home catalogue-failure notice now clears the fixed header instead of sitting directly beneath it.

## v201 — 2026-10-05

- Home now says so when the catalogue cannot be loaded, with a Retry button, instead of showing an empty page (the message previously lived only on the Library tab).
- Opening the reading menu moves keyboard and VoiceOver focus into it, and closing it hands focus back to the ≡ button.
- Reading-state records that carry nothing except a book id are no longer stored.
- Library data (no code): 360 EPUB records had their title and/or author corrected through the reversible metadata overlay — the Star Wars import now carries series, number, title and author; publisher, year, version and file-type debris was removed from titles. Previous values are kept in `library-repair-backups/meta-cleanup-20261005/` on the Pi.

## v200 — 2026-10-05

- Narration from the Pi now travels as MP3 (about a seventh of the WAV) when
  the reader asks for it; the WAV remains the source and the fallback. The
  iPhone's own voices are unchanged.
- Piper's "high" voices are synthesised one at a time. Measured on the Pi 5,
  two at once gave no more audio per second (1.06x real time against 1.16x)
  and doubled the wait for each sentence (25 s against 11 s).
- The voice menu marks each Pi voice Fast or Slower from the Pi's own measured
  speed (medium Piper about 5x real time, Kokoro about 1.6x, high Piper about
  1.1x), so a voice that can leave gaps is visible before it is chosen.
- The library loads more books as you scroll; "Show more books" remains for
  keyboards.
- Saved reading state is validated on the server: malformed records and
  fields are dropped instead of being stored and served to every device.
- An empty My Books shelf says so, instead of "No books found"; filter and
  sort labels and the cover progress badge are larger (9-11px, were 7-9px).

## v199 — 2026-10-05

- Read Aloud now hands downloaded lookahead audio directly to the existing
  player, avoiding a second network load between sentences. Preserves natural
  voice pacing, sentence highlights, transport controls and background audio.
- Bounds buffered clips to 24 entries and 16 MiB, releases obsolete URLs and
  clears audio buffers on Stop. No added dependencies or reader layout changes.
- Added real-media Chrome/WebKit regression checks for delayed network loads,
  sentence handoffs, pause/resume and buffer cleanup to the release gates.
- Public browser verification can use an explicit HTTPS proxy when competing
  VPNs prevent direct access; it retains the actual HTTPS URL and certificate.
- Passed 39 root tests, 38 browser checks, and live LAN/public release gates.
  In the actual Trevor collection at 1x, public WebKit clip handoffs improved
  from 1.8–1.9 seconds to 88–101 ms with Ryan and HFC Female. Natural audio
  pauses remain; light/dark modes and pause/resume passed. Physical iPhone
  listening and locked-screen playback were not independently tested.

## v198 — 2026-10-04

- Pausing Read Aloud no longer relocates the page. Added a glass “return to
  current reading” button above the transport; it follows the spoken sentence
  only when tapped, even after scrolling ahead or behind.
- Added the remaining sleep timer chip above the transport: tap adds 30 minutes;
  hold for three seconds to cancel. The timer keeps the existing countdown and
  does not stop playback when cancelled.
- Passed 39 root tests and 36 browser regression checks, including Chrome and
  WebKit pause/return/timer tests, then verified hydration, assets, Settings,
  voice playback and rendered routes on LAN and authenticated public HTTPS.

## v196 — 2026-10-04

- Added crisp, theme-aware one-pixel dividers between home shelf bands. Kept
  the approved grey/background/grey gradients and shelf geometry unchanged.
- Passed 39 root tests, 34 browser regression checks and the dedicated
  light/dark/system shelf test. Verified all eight live shelf dividers,
  unchanged gradients and menu open/close on LAN and public HTTPS in both
  themes, with no runtime errors. Asset, hydration, Settings and voice gates
  passed. No physical iPhone test was performed for this CSS-only release.

## v195 — 2026-10-04

- Added 28 English Kokoro voices alongside all existing Piper and native iPhone
  voices through the shared narration catalogue used by reading and summaries.
  Generation stays local on the Pi, with no paid API or Mac dependency.
- Reused the persistent-worker architecture, playback cache and priority queue.
  Kokoro has one bounded worker shared across its voices; the existing two Piper
  workers are unchanged. Added a pinned, reproducible Pi runtime installer.
- Optimized Pi runtime generated sampled narration at 1.8–1.9 times real time;
  model loading took about 2.5 seconds. Start at normal playback speed: high
  speeds or heavy server load can still exhaust the prefetch buffer.
- Passed 39 root tests and 34 browser regression checks, live Piper/Kokoro WAV
  and cached-range checks on LAN and public HTTPS, and real public-site Kokoro
  playback/pause/resume in both themes. Hydration, Settings and release asset
  checks passed. Physical iPhone playback was not independently retested.

## v194 — 2026-10-04

- Home shelf bands now fade grey → black/white at the midpoint → grey, matching
  the approved preview. Reused the existing theme tokens; no layout, reader,
  progress or control changes.
- Passed the full release gates (36 root tests, 34 browser regression checks),
  plus the dedicated light/dark/system gradient test. Exact computed gradients
  and shelf-menu open/close passed on LAN and authenticated public HTTPS in both
  themes with no runtime errors. Live mobile screenshots matched the preview;
  asset hashes/MIME, hydration and Settings checks also passed.

## v193 — 2026-10-04

- Handle image-only EPUB covers whose text CFI cannot resolve: show reading
  page 1 instead of hiding the chip. Added cover checks in both browser engines.
- Complete release checks passed: 36 root tests and 34 mandatory browser checks;
  full asset/server hashes, MIME checks, hydration, Settings and both themes on
  LAN and authenticated public HTTPS. A read-only real Trevor/After Rain audit
  crossed sections 194–196 with increasing/decreasing whole-book pages and no
  runtime errors. The real image-only opening cover reports page 1.
- Physical iPhone check passed: 30 forward/backward/forward native swipes,
  direction-correct book pages, three pixel-identical resting-text pairs,
  unchanged chip geometry and independent Close. The original reading record
  was restored and verified; native test details are recorded in
  `docs/web-v193-physical-check.md` in the iOS repository.

## v192 — 2026-10-04

- EPUB page chip now uses continuous whole-book reading pages (1,500 text
  characters per page), not section-local screen-page numbers. Forward section
  crossings no longer reset the number; reverse navigation/reopening return to
  the same number independently of font size or scroll/page mode. These are
  virtual reading pages, not a printed edition's pagination.
- Count preceding text in detached documents only, yield between sections,
  cancel on close and optionally cache lengths with archive-text/manifest CRC
  invalidation. Never load/unload the live reader sections or change the
  scrolling manager. Book opening does not wait for this calculation.
- Added three index tests and four required rendered cross-section/reopen
  checks in Chrome/WebKit and both reading modes.

## v191 — 2026-10-04

### Regressions

- Saved whole-book EPUB/MOBI fractions independently of chapter labels. EPUB
  estimates use archive spine weights and the visible text offset, without a
  full-book location-generation delay. Legacy unmeasured positions show
  “In progress” rather than a fabricated zero, and refresh on reopening.
- Continuous scrolling keeps measured section placeholders, avoids scroll
  rebasing from trimming, and releases distant iframes only after scrolling
  settles. Nearby sections remain loaded for direction reversals.
- Increased shelf-title top padding and heading-to-cover spacing in both themes.

### Added

- Glass page-number indicator centered on the menu-button baseline, and a
  matching top-left title chip aligned with Close. Long titles truncate without
  covering Close. Both follow chrome visibility, theme and reduced-motion
  preferences and do not intercept book gestures. EPUB numbers are current
  section display pages; MOBI uses its renderer's numbered reading locations.

### Cleanup

- Removed unused hosted authentication/Drive helpers, D1 schema/examples and
  migration generator, three unused packages and the stale npm lockfile. pnpm
  is the one dependency-lock/build path; Vinext's rendering tools remain.
- Removed retired reader-mode CSS and the permanently hidden text-mode button.
  Volume-key routing reads the current typed narration state rather than
  querying deleted UI. Necessary iframe gestures and annotations remain.
- Replaced obsolete migration checkboxes with current ownership documentation.
  Replaced an isolated legacy panel-return simulation with real browser checks
  for Search/Marks return paths, reader controls, themes and chip geometry.

### Release verification

- Deployed complete source `30fe983` through the full build pipeline. Typecheck,
  root tests, static checks and all 28 mandatory browser checks passed.
- Complete client/server hashes and branding MIME/content checks passed on LAN
  and authenticated public HTTPS; hydration, Settings and menus passed in both
  engines and themes. Backup: `deployment-backups/20261004-194037-before-v191`.
- The deployed Trevor collection's After Rain forward/reverse audit passed on
  both origins: no visible destructions, unloaded visible placeholders or sampled
  resting-paragraph shifts. Physical touch checks are recorded separately;
  this is not a claim of perfect scrolling on every device or book.
- Physical iPhone 17 Pro checks passed: reader chip alignment, Close, 30 native
  fast forward/reverse swipes in After Rain and three pixel-identical resting
  book-text screenshot pairs. Home shelf spacing/progress was visually checked;
  the tested book's original reading record was restored and verified. An
  initial accessibility-anchor test defect was corrected, not patched in app
  code. Native test details are in the iOS repo's `docs/web-v191-physical-check.md`.

## v190 — 2026-10-04

### Fixed

- Continuous EPUB scrolling uses a source-owned manager that checks visibility
  and unloads offscreen sections in the same operation. EPUB.js's deferred
  cleanup could destroy sections after the reader scrolled back into them.
- Concurrent section loads are deduplicated; delayed loads cannot show content
  after the reader has closed. Bounded upstream trimming remains in place.
- Removed the ineffective v188/v189 trim patches: they ran before EPUB.js had
  created its asynchronous manager. Scrollbar movement alone was not evidence
  of a visible jump; tests now measure actual paragraph positions.

### Verification

- Release gates now include long forward/reverse scrolling in WebKit and
  Chromium, visible-section cleanup checks, blank-frame detection, resting
  paragraph position and bounded iframe counts. Unit tests cover load races,
  close-during-load and retries. Existing narration/mode-switch tests remain.
- Candidate WebKit traversal of both After Rain and the corresponding part of
  William Trevor Complete Works reported no visible-section destruction or
  unloaded visible sections. Automated browser checks are not a claim of a
  completed physical-iPhone touch/momentum test.

### Deployment

- Source `af93c59`, v190: 26 required browser checks passed; built assets and
  rendered light/dark routes verified on LAN and public HTTPS. Post-install
  Trevor Complete Works / After Rain forward-and-reverse traversal on both
  origins reported zero visible destructions, blank sections or resting-text
  position shifts. The connected iPhone has native build 8; no native code or
  app reinstall is required for this web-reader release.

## v185 — 2026-10-03

### Fixed

- EPUB Read Aloud stays with the narrated chapter and advances in spine order
  at its end, rather than choosing the tallest preloaded iframe or using a
  page-down button as chapter navigation. This fixes the reproduced chapter-end
  stall/rewind in Demons and Druids. Explicit reader jumps reset chapter selection.
- Added an actual-book regression test with accelerated audio callbacks; it
  fails on v184 and passes with the chapter-owned narration adapter.

### Deployment

- Source `16f9e59`, previous v184. Fresh SSD build, all static release gates,
  supported installer and complete rollback capture passed.
- Public HTTPS v185 and client bytes verified against the build. Twelve focused
  browser checks passed on the public origin, including ordered actual-book
  narration in Scroll/Pages, pause and explicit chapter jumps. Physical iPhone
  playback and lock-screen audio are not claimed by these accelerated tests.

## v184 — 2026-10-03

### Changed

- Horizontal Home shelves use an Apple Books-style grey-to-black band in dark
  mode and a gentle grey-to-white band in light mode, including Continue.
- Replaced the competing historical shelf backgrounds with shared theme tokens;
  covers, type, spacing and interaction behavior are unchanged.

### Deployment

- Source `82d6e85`, previous v183. Fresh SSD build, supported no-build installer,
  complete rollback snapshot and all static release checks passed.
- Visually reviewed phone-size light/dark output. Public HTTPS tests passed for
  shelf gradients in light/dark/system themes, layout stability, menus, Home
  header/settings and multi-file native summary message/dismissal behavior.

## v183 — 2026-10-03

### Fixed

- Multi-file books open their native summary using catalogue IDs directly,
  independent of Google Drive or download link formats.
- Book-details and series Close buttons have theme-aware contrast, a 44-point
  touch target, safe-area spacing and remain available while scrolling.

### Deployment

- Source `8ca3496`, previous v182; fresh SSD build installed through the
  supported no-build staging path. Static release gates and asset MIME checks
  passed, as did rendered browser checks on the public HTTPS origin and a
  native iOS simulator summary/dismissal check.

## v182 — 2026-10-03

### Fixed

- Collection contents now open as a book list with each book's chapters in its
  own submenu, including the generated Christie contents pages.
- Missing library cover art retains its title instead of a blank rectangle.
- Cover extraction reads local imports without Google Drive and selects a
  merged EPUB's declared collection cover rather than a constituent cover.
- Local-only full scans no longer contact Google Drive; new local imports start
  cover extraction after scanning. Reader error messages and download links now
  point to Home Books rather than Drive.
- Prevented continuous EPUB scrolling from skipping chapters when new sections
  load; the browser no longer duplicates the reader's position compensation.
- Invalid saved EPUB positions now recover at the same chapter instead of
  leaving a readable book stuck on Loading.
- Height-only viewport changes no longer reapply an unchanged spread layout.
- Anthony Bourdain's Complete Works has the established navy/gold collection
  cover and the correct author credit.

### Changed

- Home's wordmark now reads “Books”; its icon, size, and theme styling are unchanged.
- Removed the continuous manager's trim override so large collections retain
  EPUB.js's normal bounded chapter unloading.

## Unreleased

### Added

- Haptic feedback: a light tap on every button in the library, the reader, its
  menus and sheets (a selection tick for tabs, pickers and toggles, a firmer one
  for press-and-hold). It fires on release and only when the finger didn't
  move, so scrolling and page turns stay silent. In the iPhone app it uses the
  system haptics (Settings → Home Books → Haptic feedback turns it off);
  Android browsers vibrate; desktop and Safari do nothing.
- The Reference Room is now a second library inside Home Books. In the Library
  page's filters, the Collection filter is replaced by Library: Reading Room
  (the default on every launch, unchanged) or Reference Room. Choosing the
  Reference Room lists its 3,776 titles (the page keeps the title Library), and Category shows its folders (Cases,
  Consulting, Danaher, HBR Articles, MBA, Test Prep and the rest). Search and
  filters follow the chosen library. Its PDFs, EPUBs and MOBIs open in the same
  reader, straight from the Seagate; slides, spreadsheets and documents
  download from the Pi. Reference books you are reading appear on Continue;
  the rest of Home stays Reading Room. Served by the Reading Room itself
  (`/reference-catalog.json`, ids prefixed `ref-`), so it is reachable wherever
  Home Books is, behind the same passphrase.
- Highlights and notes: press and hold a word to select it (drag the handles to
  extend), then pick a colour or underline, add a note, copy, look it up or
  translate. Tap a highlight to recolour, edit its note or remove it. Marks now
  has Bookmarks | Highlights tabs; each highlight jumps back to its place and
  the list exports as Markdown. Highlights sync through library state.
- Time left in the chapter (footer) and the book (Contents row), learned from
  your own page-turn pace on each device.
- In the iPhone app, Look Up opens the system dictionary, Translate the system
  translation sheet, and "Who's This?" answers from the pages read so far only
  (Apple Intelligence, or Claude when chosen in Settings) - no spoilers.
- My Books (was Favorites): Favorites, Want to Read, Finished and your own
  collections, as chips there and as shelves on Home. Every book's ⋯ menu has
  Add to Want to Read and Add to Collection…; opening a book takes it off Want
  to Read. Reading status filter gains Want to Read.
- Listening like an audiobook: the Lock Screen and CarPlay's Now Playing show
  the chapter, author and cover; skip back/forward move by a couple of
  sentences and previous/next track by chapter.
- Reading and listening hand off: the saved place follows the spoken sentence,
  pausing or stopping leaves the page there, and waking the screen brings the
  page to the sentence being read.

### Fixed

- A card's ⋯ menu opened once per shelf the book was on, stacking copies.

- Contents now marks the book or chapter you are reading and opens scrolled to
  it, including in merged Complete Works editions whose contents list only books.
- Restored the filter, sort and Settings icon foregrounds in dark mode. Their
  React SVGs now use an explicit app theme token instead of browser-default
  black fills.
- Read Aloud now waits until the active sentence reaches the lower edge before
  following in Scroll mode, and paginated reading waits for each animated turn
  to settle instead of advancing multiple pages.
- Switching between Pages and Scroll while narration is active now restores the
  same sentence and highlight in the new layout.
- Replaced fragmented word highlights with one continuous highlight per visual
  line, and added bounded automatic recovery when a Piper audio clip stalls.
- Kept the iOS media session alive while paused so AirPods and Lock Screen Play
  can resume the existing audio element instead of requiring the book to reopen.

### Changed

- New Home Books brand: one book outline drawn by a shared component
  (`HomeBooksMark`, `bookBrand.js`) is the Home heading's mark and, rendered by
  `scripts/build-brand-icons.mjs`, the favicon and install icons (white on
  #202123, which the web manifest now uses as its theme and background). The
  prerendered heading is rendered from the same component so it hydrates
  without a redraw; `tests/browser/home-brand.test.mjs` checks it in both
  themes.
- Moved the Read Aloud engine into the main application bundle. React now talks
  to it through a typed controller/store; the separately deployed narration
  override and its browser-global API have been removed.
- The floating narration transport is now React-owned and uses the same
  translucent glass treatment and reader-chrome visibility as the close and
  reading-menu controls.
- Moved pnpm's native-build allowlist into its supported workspace config so
  clean production builds no longer stop on an obsolete package setting.

## v129 — 20 September 2026

### Changed

- Moved the Home/Library/Favorites dock, library filter and sort controls, and
  the Settings overlay lifecycle into typed React components. These controls
  now update the catalogue state directly instead of injecting buttons into the
  page and remotely clicking hidden controls.
- Deleted the three superseded body-injected implementations after the React
  version passed the full browser suite against the live Pi catalogue.
- Added a deployment gate that fails if library chrome ownership drifts back to
  the override layer or the static first render no longer matches hydration.

## v127 — 20 September 2026

### Changed

- Added a repeatable mobile-browser regression suite for library menus,
  settings, opening a book, reader themes, search/bookmark return controls,
  scrolling and Read Aloud controls. This is test infrastructure only and does
  not add another runtime override.

### Fixed

- EPUBs without an optional navigation package no longer raise a browser
  exception while opening; they remain readable with an empty Contents list.

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
