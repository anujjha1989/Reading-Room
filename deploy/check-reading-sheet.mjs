// Structural checks on the React reading sheet (step 1 of the override collapse).
//
// The point of the rewrite is that the sheet no longer reaches into the DOM or
// shouts over other stylesheets. These assertions encode that, so a future edit
// cannot quietly reintroduce either habit.
import { readFileSync, existsSync } from "node:fs";

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
  t(!tsx.includes(pattern), `no ${pattern} in the component`);
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

// 12. Not yet wired in: this step adds the component, it does not switch to it.
t(!readFileSync("app/BookReader.tsx", "utf8").includes("ReadingSheet"),
  "BookReader does not use it yet (wiring is the next commit)");

console.log(`\n${fail ? fail + " FAILED" : "all checks passed"}`);
process.exit(fail ? 1 : 0);
