# Reading Room — working notes

## Frontend aesthetics

<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>

## Project-specific constraints these principles must respect

- **This is a reading app.** The book page is content, not canvas. Atmosphere belongs
  in the library, the shelves and the chrome; the reading surface stays quiet.
- **It runs on a Raspberry Pi over Tailscale.** Webfonts must be self-hosted and
  subset, not fetched from a CDN the Pi cannot reach when offline.
- **Two theme signals already exist** — `data-rr-theme` (app) and `rr-theme-dark`
  (the book's own theme). Any new colour work keys off the app signal for chrome
  and the book signal for the page. Never both on one element.
- **The override layer styles a React app it does not own.** Prefer CSS variables
  over `!important`; the latter has already cost several rounds of specificity
  fights in `fullscreen-bundle.css`.

## Release documentation — follow this for every change

Three layers, each with one job. Do not collapse them.

1. **Git commits** — the technical record. Why, not just what: the cause, the
   mechanism, and what was ruled out. These are already the most useful artefact
   in the project and should stay that way.
2. **`CHANGELOG.md`** — user-visible summary grouped by deployed version, newest
   first, with `### Fixed` / `### Changed` / `### Added` and a `### Deployment`
   block naming the commit, previous version, build mode and verification result.
   **Update this in the same commit as the change**, not afterwards — a changelog
   written from memory later is a changelog that drifts.
3. **`/Volumes/Seagate/ReadingRoom/deployment-history/vNN.json`** — written
   automatically by `deploy/record-deployment.mjs`. Never hand-edited. Lives
   outside the repo so a deploy does not dirty the tree.

Plus an annotated `deploy-vNN` tag per deployment, created by the deploy script
only when the tree is clean — an untagged deploy is the honest signal that what
shipped was not fully committed.

### Practical rules

- Bump `CHANGELOG.md` under `## Unreleased` while working; promote it to a
  version heading when that version actually deploys.
- Read `overrides/VERSION` to learn the last deployed number. Never infer it.
- If `git status` is dirty at deploy time, the tag is skipped deliberately. Fix
  the tree rather than forcing the tag.
- The changelog describes what a *reader of the app* would notice. Specificity
  fights and rsync hazards belong in the commit message, not here.
