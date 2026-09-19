// Structural checks on the React reading sheet (step 1 of the override collapse).
//
// The point of the rewrite is that the sheet no longer reaches into the DOM or
// shouts over other stylesheets. These assertions encode that, so a future edit
// cannot quietly reintroduce either habit.
import { readFileSync, existsSync } from "node:fs";

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

// 7. Theme keys off the APP signal. Following the book's theme is what made the
//    old sheet flip to light inside a dark app.
t(/data-rr-theme="dark"/.test(css), "dark theme keys off data-rr-theme");
t(!/rr-theme-dark/.test(css), "does not key off the reader's book theme");

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
t(/if \(view === "menu"\) onClose\(\); else go\("menu"\)/.test(tsxCode),
  "Escape steps back then closes");

// 11. Every view in the union is rendered somewhere.
const views = ["menu", "contents", "text", "advanced", "aloud", "voice"];
const missing = views.filter((v) => !tsx.includes(`view === "${v}"`));
t(missing.length === 0, "every view has a render branch", missing.length ? `missing: ${missing}` : "");

// 12. Wired in, but behind a flag: the default path must be untouched so the
//     legacy sheet keeps working until step 1c deletes it.
const reader = readFileSync("app/BookReader.tsx", "utf8");
t(reader.includes("<ReadingSheet"), "BookReader renders the component");
t(/reactSheetEnabled &&/.test(reader), "render is gated on the flag");
t(/rr-react-sheet/.test(reader), "flag persists in localStorage for the PWA");

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

console.log(`\n${fail ? fail + " FAILED" : "all checks passed"}`);
process.exit(fail ? 1 : 0);
