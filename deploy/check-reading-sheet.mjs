// Structural checks on the React reading sheet (step 1 of the override collapse).
//
// The point of the rewrite is that the sheet no longer reaches into the DOM or
// shouts over other stylesheets. These assertions encode that, so a future edit
// cannot quietly reintroduce either habit.
import { readFileSync } from "node:fs";

/**
 * Strips comments before scanning. Three separate checks tonight reported false
 * failures by matching the very comment that documented the thing's absence, so
 * this is applied everywhere rather than remembered case by case.
 */
const code = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const tsx = readFileSync("app/ReadingSheet.tsx", "utf8");
const css = readFileSync("app/reading-sheet.module.css", "utf8");
let fail = 0;
const t = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "\n        " + detail : ""}`);
  if (!ok) fail++;
};

// 1. No !important. The 440 in fullscreen-bundle.css exist because an outside
//    layer had to out-shout rules it did not own; scoped styles have no such need.
// Strip comments first: an earlier audit of mine counted a declaration named
// inside the comment that explained its absence, and reported a false failure.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
const bangs = (cssCode.match(/!important/g) || []).length;
t(bangs === 0, "no !important in the scoped stylesheet", bangs ? `${bangs} found` : "");

// 2. No DOM queries. Every value arrives as a prop; reading the DOM is what made
//    the old sheet fail silently when a class or aria-label changed.
for (const pattern of ["querySelector", "getElementById", "getAttribute(", "classList"]) {
  t(!code(tsx).includes(pattern), `no ${pattern} in the component`);
}

// 3. No aria-label string matching. native()/proxy() looked buttons up by label
//    text, which broke the moment React interpolated a percentage into it.
t(!/aria-label'\]|\[aria-label=/.test(tsx), "no aria-label selector matching");

// 4. Read Aloud is reached through an injected API, not globals, so the component
//    stays testable and does not depend on load order.
t(!/window\.rr[A-Z]/.test(tsx), "component does not call window.rr* directly");
t(/readAloud\?:\s*ReadAloudApi/.test(tsx), "Read Aloud arrives as a typed prop");

// 5. Optional surfaces must be guarded: a PDF has no reflowable text, no TTS and
//    no table of contents, and previously rendered a sheet full of dead rows.
t(/props\.mode !== undefined/.test(tsx), "reflowable-only controls are guarded");
t(/props\.toc && props\.toc\.length > 0/.test(tsx), "contents row is guarded");
t(/view === "aloud" && aloud/.test(tsx), "read-aloud view is guarded");

// 6. Tokens declared once and actually used, rather than values sprinkled inline.
for (const token of ["--row-h", "--tile-h", "--radius", "--text", "--fill"]) {
  const declared = (css.match(new RegExp(`\\${token}:`, "g")) || []).length;
  const used = (css.match(new RegExp(`var\\(\\${token}`, "g")) || []).length;
  t(declared >= 1 && used >= 2, `${token} declared (${declared}) and used (${used})`);
}

// 7. The in-reader sheet follows the BOOK signal. A reader may deliberately
//    differ from Home, so app-level dark mode is not enough to keep it legible.
t(/data-book-theme="dark"/.test(css), "dark sheet keys off its explicit book theme");
t(/data-book-theme=\{theme\}/.test(tsx), "book theme is published on the sheet root");
t(!/html\[data-rr-theme="dark"\]/.test(css), "sheet does not inherit Home's theme by accident");

// 8. Reduced motion covers the animations this file introduces.
const rm = css.slice(css.indexOf("prefers-reduced-motion"));
for (const name of ["deal-in", "fan-right", "fan-left"]) {
  t(css.includes(`@keyframes ${name}`), `${name} keyframes defined`);
}
t(/animation: none/.test(rm), "animations disabled under reduced motion");

// 9. A long contents list must not stagger, or it takes seconds to appear.
t(/\.scroller > \* \{ animation: none/.test(css), "scroller children do not stagger");

// 10. Escape must step back before closing, matching the ‹ button.
const tsxCode = tsx.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
t(/if \(view === "menu"\) close\(\); else go\("menu"\)/.test(tsxCode),
  "Escape steps back then closes");

// 11. Every view in the union is rendered somewhere.
const views = ["menu", "contents", "text", "advanced", "aloud", "voice"];
const missing = views.filter((v) => !tsx.includes(`view === "${v}"`));
t(missing.length === 0, "every view has a render branch", missing.length ? `missing: ${missing}` : "");

// 12. The parity-complete React sheet is the default, with an explicit legacy
//     recovery switch until the override is physically removed.
const reader = readFileSync("app/BookReader.tsx", "utf8");
t(reader.includes("<ReadingSheet"), "BookReader renders the component");
t(/reactSheetEnabled &&/.test(reader), "render is gated on the flag");
t(/removeItem\("rr-react-sheet"\)/.test(reader),
  "stale persisted legacy preference is removed from existing devices");
t(/param !== "legacy"/.test(reader) && !/setItem\("rr-react-sheet"/.test(reader),
  "React sheet is default and legacy is a one-load recovery path only");

// 13. Every prop the component declares as required must actually be passed.
const required = ["open=", "onClose=", "theme=", "onThemeChange="];
const missingProps = required.filter((prop) => !reader.includes(prop));
t(missingProps.length === 0, "all required props passed",
  missingProps.length ? `missing: ${missingProps}` : "");

// 14. Optional props must be undefined for non-reflowable formats, or a PDF gets
//     text controls that cannot work.
t(/isReflowable \? fontSize : undefined/.test(reader), "fontSize gated on reflowable");
t(/isReflowable \? readAloud : undefined/.test(reader), "readAloud gated on reflowable");

// 15. The hook must be called unconditionally — React's rules of hooks — with
//     only its polling gated.
t(/useReadAloud\(reactSheetEnabled && reactSheetOpen\)/.test(reader),
  "hook called unconditionally, polling gated by argument");

// 16. The adapter is the only place touching globals.
const hook = readFileSync("app/useReadAloud.ts", "utf8");
t(/window as unknown as ReadAloudGlobals/.test(hook), "globals accessed through one typed shim");
t(!/window\.rr/.test(code(tsx)), "component still free of window.rr* access");

// 17. read-aloud.js must expose voices as data, not a DOM node to clone.
const aloud = readFileSync("overrides/book-art/read-aloud.js", "utf8");
t(/window\.rrGetVoices/.test(aloud), "read-aloud exposes rrGetVoices");
t(/window\.rrSetVoice/.test(aloud), "read-aloud exposes rrSetVoice");

// 18. The controls requested before the migration must exist in the React
//     surface too; otherwise enabling the new sheet makes a working feature
//     appear to vanish even though it still exists in the legacy override.
t(/aloud\.previous/.test(tsx) && /Previous sentence/.test(tsx),
  "previous sentence is rendered by the React sheet");
t(/aloud\.skip/.test(tsx) && /Next sentence/.test(tsx),
  "next sentence is rendered by the React sheet");
t(/aloud\.adjustSleep\(-30\)/.test(tsx) && /aloud\.adjustSleep\(30\)/.test(tsx),
  "sleep timer has separate minus and plus controls");
t(/rateHeader/.test(tsx) && /rateBounds/.test(tsx),
  "reading speed has a header, current value and endpoint row");
t(/onFontFamilyChange/.test(tsx) && /onBoldChange/.test(tsx)
  && /onJustifyChange/.test(tsx) && /onReset/.test(tsx) && /onShare/.test(tsx),
  "advanced typography, reset and share are present");
t(/rr-react-sheet-open/.test(reader) && /rr-react-sheet-enabled/.test(reader),
  "React sheet publishes open and enabled state for chrome coordination");
t(/rrAdjustSleepTime/.test(hook) && /rrSkipSentence\?\.\(-1\)/.test(hook),
  "adapter exposes sleep adjustment and previous sentence without DOM queries");

// 19. The production trigger must be a neutral glass control with a real touch
//     path. v105 accidentally shipped the bright-blue comparison trigger and
//     relied solely on a synthetic click, which was unreliable in standalone iOS.
const globalCss = readFileSync("app/globals.css", "utf8");
t(/onTouchEnd=/.test(reader) && /menuTouchAtRef/.test(reader),
  "menu trigger has an explicit, de-duplicated touch path");
t(/rr-toggle-reading-sheet/.test(reader) && /setReactSheetOpen\(\(open\) => !open\)/.test(reader),
  "BookReader accepts the native iOS menu bridge");
t(/createPortal\(<[\s\S]*readingSheetHost\)/.test(reader)
  && /setReadingSheetHost\(document\.body\)/.test(reader),
  "trigger and sheet escape the reader stacking context through a body portal");
const fullscreen = readFileSync("overrides/book-art/fullscreen-bundle.js", "utf8");
t(/\.rr-react-sheet-trigger/.test(fullscreen)
  && /addEventListener\("touchend"[\s\S]*?capture: true, passive: false/.test(fullscreen)
  && /rr-toggle-reading-sheet/.test(fullscreen),
  "fullscreen bridge claims the menu control in native capture phase");
t(/!root\.classList\.contains\("rr-react-sheet-open"\)/.test(fullscreen),
  "transparent page-turn layer is disabled while the React sheet is open");
t(/\.rr-react-sheet-trigger[\s\S]*?width:\s*46px[\s\S]*?height:\s*46px/.test(globalCss),
  "menu trigger uses the standard 46px control geometry");
t(!/#007aff|rgba\(0,\s*122,\s*255/.test(globalCss),
  "production menu trigger contains no developer-blue styling");

// 20. Legacy chrome remains available while migration settles, so keep its
//     compact playback rail and library control geometry coherent too.
const overrideCss = readFileSync("overrides/book-art/fullscreen-bundle.css", "utf8");
t(/\.rr-read-transport\{[^}]*flex-direction:column/.test(aloud),
  "collapsed read-aloud controls form a vertical rail");
t(/#rr-settings-link svg\s*\{\s*width:26px[^}]*height:26px/.test(overrideCss),
  "library gear glyph is optically balanced inside its halo");

// 21. First-sentence warming should happen immediately after the reader is
//     stable, not nearly half a second later.
const warmDelay = aloud.match(/delay == null \?\s*(\d+)\s*: delay/)?.[1];
t(Boolean(warmDelay) && Number(warmDelay) <= 100,
  "Read Aloud warm-up starts within 100ms", warmDelay ? `${warmDelay}ms` : "not found");

// 22. Search and Bookmarks are subviews: their affordance goes back to the
//     reading menu instead of dismissing an apparently stuck modal.
t(/aria-label="Back to reading menu"/.test(tsx)
  && /aria-label="Back to reading menu"/.test(reader)
  && /backToReadingMenu/.test(reader),
  "Search and Bookmarks expose the shared Back path");

// 23. Rendering must reconcile the stale serialized root metadata as well as
//     the visible meta element, or iOS restores a light status bar on hydration.
const renderer = readFileSync("deploy/render-index.mjs", "utf8");
t(/serialized status-bar metadata/.test(renderer) && /black-translucent/.test(renderer),
  "renderer reconciles iOS status-bar metadata to translucent safe-area mode");

// 24. Home and Reader are independent. Verify every colour in the 2 × 3
//     matrix is present rather than fixing the reported dark-reader case with
//     a global black bar that would regress a light Home or light book.
t(/homeTheme===['"]dark['"]\?['"]#000000['"]:['"]#f7f3ec['"]/.test(fullscreen),
  "Home status area maps both dark and light themes");
for (const [theme, colour] of [["dark", "#181b1a"], ["light", "#fffdf7"], ["sepia", "#f3ead7"]]) {
  t(fullscreen.includes(`theme==='${theme}'?'${colour}'`)
    || fullscreen.includes(`theme==='${theme}'?'${colour}':`),
  `reader status area maps ${theme} independently`);
}

console.log(`\n${fail ? fail + " FAILED" : "all checks passed"}`);
process.exit(fail ? 1 : 0);
