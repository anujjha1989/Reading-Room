// Popover motion gate.
//
// Written after three failed attempts at one bug. The filters panel, sort menu
// and card menu each have SIX to EIGHT competing `animation` declarations in this
// stylesheet, layered over many versions, most carrying !important. Twice I edited
// a plausible-looking declaration that the browser never used - once a transition
// that an animation outranked, once an animation at line 1899 that a later
// `animation: none !important` had already killed.
//
// So this does not check "is the spring mentioned somewhere". It finds the LAST
// winning declaration for each element and asserts the three agree.
import { readFileSync } from "node:fs";

const css = readFileSync("app/reader-chrome.css", "utf8");
let fail = 0;
const t = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) fail++;
};

/** Last value of `prop` for a selector, honouring !important the way the cascade does. */
const winning = (selectorPattern, prop) => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  let plain = null, important = null;
  for (const [, sel, body] of rules) {
    if (!selectorPattern.test(sel)) continue;
    const m = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`, "g"))];
    for (const hit of m) {
      const value = hit[1].trim();
      if (/!important/.test(value)) important = value; else plain = value;
    }
  }
  return important ?? plain;
};

// 1. The card menu is portalled and unmounted, so it must animate. The other two
//    persist in the DOM and must transition. Confusing these is what caused the
//    dead edits.
const cardAnim = winning(/body\s*>\s*\.rr-card-menu\s*$/, "animation");
t(/rr-spring-menu-in/.test(cardAnim ?? ""), "card menu animates (it is unmounted, so it must)",
  `winning: ${cardAnim}`);

for (const [name, sel] of [
  ["sort menu", /#rr-sort-menu\s*$/],
  ["filter drawer", /\.rr-filters-open[^,]*\.filters\s*$/],
]) {
  const anim = winning(sel, "animation");
  t(/none/.test(anim ?? "none"), `${name} does NOT animate (it transitions)`, `winning: ${anim}`);
}

// 2. All three must use the shared spring tokens, not a literal duration.
for (const [name, sel, prop] of [
  ["card menu", /body\s*>\s*\.rr-card-menu\s*$/, "animation"],
  ["sort menu", /#rr-sort-menu\s*$/, "transition"],
  ["filter drawer", /\.filters\s*$/, "transition"],
]) {
  const v = winning(sel, prop) ?? "";
  t(v.includes("--rr-spring-time") && v.includes("--rr-spring)"),
    `${name} uses the spring tokens`, `winning ${prop}: ${v}`);
}

// 3. No superseded rule may still force its own animation. Both times I "fixed"
//    this, a later !important block was the live declaration and my edit was
//    dead. Named keyframes that were replaced must not be referenced at all.
// rr-unfold, rr-slide-in-right and rr-sheet-pop also survive as earlier layers,
// but each is neutralised by a later `animation: none !important`, so they are
// inert. Asserting their absence would fail on harmless dead code and teach us to
// ignore this gate - the thing that matters is that the WINNING declaration is
// right, which sections 1 and 2 prove. rr-filter-sheet-in is different: it was
// still winning, and it is what defeated three attempted fixes.
t(!/animation:\s*rr-filter-sheet-in/.test(css),
  "rr-filter-sheet-in no longer overrides the filter drawer's spring");

// 4. The two transition-driven popovers must have a non-identity closed
//    transform, or there is nothing for the spring to animate. Note these are
//    checked on the CLOSED rule; the open rule is correctly translate/scale
//    identity, which is what an earlier version of this gate wrongly read.
const closedSort = (winning(/#rr-sort-menu\s*$/, "transform") ?? "");
t(/scale\(\.9/.test(closedSort) || /translate/.test(closedSort),
  "sort menu has a closed offset to spring from", `got: ${closedSort}`);

// The filter drawer travels vertically on purpose: it spans the width via
// left/right insets and margin-inline:auto, so a horizontal translate would push
// a centred sheet off centre rather than offsetting it from the icon rail.
{
  // Read the whole rule body rather than a fixed character window. This assertion
  // previously sliced 700 chars from the selector and broke the moment geometry
  // was added above the transform - a self-inflicted failure, not a real one.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = [...stripped.matchAll(/html\[data-rr-library-view="library"\] \.catalog \.filters\s*\{([^{}]*)\}/g)]
    .map((m) => m[1]).join(";");
  t(/transform:\s*translateY\(-14px\)\s*scale\(\.96\)/.test(rule),
    "filter drawer springs vertically, not diagonally (it is a drawer, not a corner popover)");
}

// 5. The card menu keyframe must cap opacity early, or it fades over .46s while
//    the other two fade over .24s and looks slower despite identical movement.
const kf = css.slice(css.indexOf("@keyframes rr-spring-menu-in"), css.indexOf("@keyframes rr-spring-menu-in") + 900);
t(/5\d%\s+\{\s*opacity:\s*1/.test(kf), "card menu keyframe finishes its fade early, matching .24s linear");
t(/translate\(12px,\s*-10px\)/.test(kf), "card menu keyframe starts from the trigger corner");

// 6. A transition cannot animate an element out of display:none. app/globals.css
//    hides .expanded-filters that way at mobile widths, which silently defeated
//    every duration set on the filter drawer - the spring was correct and simply
//    never ran. The override must force it back to a laid-out box, and the panel
//    must be position:fixed so that costs no document space.
const globalsCss = readFileSync("app/globals.css", "utf8");
if (/\.expanded-filters\{display:none/.test(globalsCss)) {
  t(/\.filters\.expanded-filters[^{]*\{[^}]*display: grid !important/s.test(css),
    "filter drawer stays laid out when closed, so its transition can run");
  t(/library"\]\s\.catalog\s\.filters\s*\{[^}]*position: fixed/s.test(css),
    "filter drawer is position:fixed, so an always-laid-out grid costs no space");
}

// 7. Geometry must not live in the open state. If insets/width are set only on
//    .rr-filters-open, the panel snaps back to its base geometry the instant the
//    class is removed and slides sideways before fading - which is what "the text
//    moves right before disappearing" was. Only opacity, transform and
//    pointer-events belong to state.
{
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const openRules = [...stripped.matchAll(/([^{}]*rr-filters-open[^{}]*)\{([^{}]*)\}/g)];
  const strays = openRules.flatMap(([, , body]) =>
    [...body.matchAll(/(?:^|;)\s*(left|right|top|bottom|width|max-width|margin-inline|position)\s*:/g)]
      .map((m) => m[1]));
  t(strays.length === 0,
    "filter drawer keeps geometry out of its open state",
    strays.length ? `found in open state: ${[...new Set(strays)].join(", ")}` : "");
}

// 8. Reduced motion must still neutralise all three.
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"));
for (const nameSel of ["rr-card-menu", "rr-sort-menu", ".filters"]) {
  t(reduced.includes(nameSel), `${nameSel} is named in a reduced-motion block`);
}

console.log(`\n${fail ? `${fail} FAILED` : "popover motion consistent"}`);
process.exit(fail ? 1 : 0);
