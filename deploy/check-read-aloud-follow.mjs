// Automatic scroll-mode narration following. The old down-arrow button was
// removed once automatic following became reliable; these checks preserve the
// measured scrolling behavior without reintroducing that redundant control.
//
//   * scrollToAnchor is async, wrapped in a synchronous try/catch, so a rejection
//     escaped rather than being handled;
//   * paginator's #scrollToAnchor returns silently when the range has no rect
//     with width and height;
//   * its #scrollTo early-returns when the target offset equals the current one.
//
// Any of those three makes the click a no-op with no error. So the fix cannot be
// "call the API"; it has to measure the outcome. These checks assert that.
import { readFileSync } from "node:fs";

const js = readFileSync("overrides/book-art/read-aloud.js", "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const code = strip(js);
let fail = 0;
const t = (ok, label) => { console.log(`${ok ? "ok  " : "FAIL"}  ${label}`); if (!ok) fail++; };

t(/scrollToAnchor\([^)]*\)/.test(code), "still asks foliate first, rather than scrolling behind its back");

// The async rejection must be handled, not left to escape a sync try/catch.
t(/typeof\s+p\.catch\s*===\s*"function"/.test(code) || /\.catch\(/.test(code),
  "handles scrollToAnchor's promise rejection");

// The outcome must be re-measured, since the API can no-op silently.
const reveal = code.slice(code.indexOf("reveal: function"), code.indexOf("turn:", code.indexOf("reveal: function")));
t(/requestAnimationFrame/.test(reveal), "re-measures on the next frame instead of trusting the call");
t(/getBoundingClientRect/.test(reveal), "checks where the sentence actually landed");
t(/headerBottom\(\)/.test(reveal), "targets the band below the reader header");
t(/scrollContainerBy/.test(reveal), "has a fallback that scrolls when foliate did not");

// The fallback needs foliate's shadow container; assert the coupling is explicit
// and defensive rather than assumed.
t(/shadowRoot\s*&&\s*[\w.]*shadowRoot\.getElementById\("container"\)/.test(code),
  "reaches foliate's scroll container defensively");
t(/window\.scrollBy/.test(code), "falls back again to the host window");
t(!/rr-read-follow|snapToSpokenSentence|Return to the sentence being read/.test(code),
  "manual follow button is fully removed");

const frameReveal = code.slice(code.indexOf("function revealInFrame"), code.indexOf("function scrollableAncestor"));
t(/scrollTop\s*=\s*[^;]*scrollTop\s*\+/.test(frameReveal),
  "moves the EPUB scroller with an observable scrollTop assignment on iOS");
t((frameReveal.match(/requestAnimationFrame/g) || []).length >= 2,
  "re-measures both EPUB scrolling arrangements and corrects a silent no-op");
t(frameReveal.indexOf("hostScrolls") < frameReveal.indexOf("!hostScrolls && scroller"),
  "prefers epub.js's visible outer scroll container over its inert iframe scroller");

t(/state\.mode\s*===\s*"scroll"\s*&&\s*state\.reveal/.test(code)
  && /state\.reveal\(item\.range\)/.test(code),
  "automatic scroll-mode playback reveals each spoken sentence");

console.log(`\n${fail ? `${fail} FAILED` : "automatic narration following is measured and button-free"}`);
process.exit(fail ? 1 : 0);
