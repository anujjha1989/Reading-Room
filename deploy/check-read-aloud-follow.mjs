// The scroll-mode "return to the spoken sentence" button.
//
// It was visible and inert. Every guard in snapToSpokenSentence was satisfied -
// the button's own visibility condition proves playing, scroll mode and a
// non-empty queue - so reveal() was running and doing nothing. The cause was in
// how it called foliate:
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
t(/activeRange\s*\|\|/.test(code),
  "follows the sentence that is actually highlighted, not a cursor that may already have advanced");

const frameReveal = code.slice(code.indexOf("function revealInFrame"), code.indexOf("function scrollableAncestor"));
t(/scrollTop\s*=\s*[^;]*scrollTop\s*\+/.test(frameReveal),
  "moves the EPUB scroller with an observable scrollTop assignment on iOS");
t((frameReveal.match(/requestAnimationFrame/g) || []).length >= 2,
  "re-measures both EPUB scrolling arrangements and corrects a silent no-op");
t(frameReveal.indexOf("hostScrolls") < frameReveal.indexOf("!hostScrolls && scroller"),
  "prefers epub.js's visible outer scroll container over its inert iframe scroller");

// snapToSpokenSentence must not double-call reveal: reveal now self-corrects on
// the next frame, so a second call fires mid-correction from a stale rect.
const snap = code.slice(code.indexOf("function snapToSpokenSentence"));
const snapBody = snap.slice(0, snap.indexOf("\n  }"));
t((snapBody.match(/state\.reveal\(/g) || []).length === 1,
  "calls reveal exactly once, so the self-correction is not fought");

console.log(`\n${fail ? `${fail} FAILED` : "follow button wired to a measured scroll"}`);
process.exit(fail ? 1 : 0);
