# Dependency and override review — before v231 UI work

Inspected 20 October 2026 before app edits. No dependency upgrades or removals are part of this visual release. This is an integration/ownership review, not a vulnerability audit of every transitive package.

## Installed sources of behaviour

| Dependency / layer | Role and constraints |
|---|---|
| React / React DOM 19.2.6 | Canonical UI and hydration. Preserve source-generated HTML/RSC; never hand-edit bundles or move React-owned nodes. |
| Next 16.2.6 + vinext 0.0.50 + Vite 8.0.13 | Routing/metadata/build. Cloudflare plugin provides build-time bindings; Pi serves the generated static shell with its own Node server. Keep complete candidate assets together. |
| epubjs 0.3.93 | EPUB rendering/layout. Continuous manager adapter is app-owned. Column overflow, saved CFI and resize behaviour are sensitive; do not change managers or flow for design work. |
| foliate-js 1.0.1 | MOBI/AZW reader and archive support. pnpm-workspace.yaml applies patches/foliate-js@1.0.1.patch: body-ready guards during iframe resize/load. Preserve this patch and frozen lockfile. |
| pdfjs-dist 6.1.200 | Lazy PDF renderer/worker. Leave untouched. |
| node-unrar-js 2.0.2 + foliate zip.js | CBR/CBZ decoding, with public/unrar.wasm. Preserve WASM and lazy chunks in releases. |
| Tailwind 4.2.1 / PostCSS | Base CSS generation. Most product UI styling is source CSS, not a separate runtime overlay. |
| TypeScript / ESLint / Wrangler / workerd | Build and validation tools. Not new product UI dependencies. |
| Native iOS | WKWebView uses same web bundle. chromeWatcher reports status-bar/theme state; it does not replace library styles. Native summary, voices, look-up and haptic bridges remain separate and unchanged. |
| Native tvOS | SwiftUI views and shared iOS BookText parser, native AV playback/URLSession. No third-party Swift package lockfiles found. Assets generated deterministically from tracked artwork. |

## CSS and compatibility ownership

Root imports, in source order: globals.css (Tailwind + design-tokens.css), reader-layout.css, reader-chrome.css, library-layout.css, library-controls.css, reader-controls.css. Component CSS includes library-lists.css, settings-panel.css, reading-sheet.module.css and reader-annotations.css. Production bundler may split component CSS, so specificity and rendered checks matter as well as source order.

reader-chrome.css contains accumulated historical and final rules. Its final library selectors force 104px desktop cards / three mobile columns, overriding earlier comfortable-looking rules. Make density explicit in that owner, not by adding another last-minute stylesheet. library-controls.css owns the inline ellipsis and shelf subgrid author row: preserve those relationships.

BookReader owns EPUB/MOBI typography, image constraints, theme and margins. bookFontScale.js and readerChromeBridge.js provide bounded iframe text/gesture adaptation; they are not alternate UI implementations. Reader page geometry must not be changed by replacing these adapters. Never resurrect retired fullscreen-bundle, injected alternate toolbar or settings document paths.

Settings is React-owned, with useModalFocus trapping focus and making outside siblings inert. Desktop bounding must preserve that node and dismissal/back handlers, and must not make the content behind it interactive.

overrides/ contains only VERSION and sw.js. The service worker is network-first for shell/catalogue, immutable-cache for hashed assets, and deliberately bypasses book delivery and reading-state requests. Existing Drive wording in comments is stale documentation, not a live Drive dependency. Do not clear caches or saved positions as a visual fix.

Server title/author/hidden-ID corrections are data overrides, not CSS. Preserve them and all media/covers. Live v230 HTML loads source-generated hashed CSS/JS; no extra hand-maintained UI script/style is linked. Old backup/settings files remain on disk but are not the canonical app. Their existence alone is not evidence they execute.

## Release implications

The supported deploy script builds once from a clean committed tree, runs its required gates, stages complete browser/server candidates, uses the restored user-service installer and verifies LAN/public routes with rollback. Do not use the old branding-only installer or branding test scope for this broader UI change. Current SSH credentials/authentication must be preflighted before build. Native TV installation must preserve app identifier/history and signed previous candidate for rollback. iOS needs no binary reinstall for shared web-only changes.

## Decision

Proceed with small edits to each existing owner; no new dependencies, broad CSS consolidation, library upgrades, parser changes, cache resets or narration rewrites. Add regression checks for density persistence, empty-shelf filtering, bounded Settings and proportional images; retain existing input/navigation/reader tests. This avoids combining a visual release with unrelated technical migration.
