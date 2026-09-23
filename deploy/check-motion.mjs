// Resolves which CSS rule actually wins for the reading-chrome buttons across
// every permutation of the state classes, and asserts two invariants:
//
//   1. In the older reader (.rr-hide-chrome without .rr-books-controls) the
//      hamburger MUST stay reachable. It is a deliberate escape hatch: "without
//      it, a centre tap that failed for any reason would leave no way back to
//      the controls at all." A slide-out animation scoped too broadly removed it
//      once already.
//   2. In the current sheet era both buttons MUST be untappable when hidden,
//      since they are only moved off-screen by transform rather than removed.
//
// @media blocks are stripped and pseudo-class rules skipped, because this models
// the default resting state. Counting reduced-motion and :active declarations
// made it report false failures.
//
// Resolve which of the competing rules wins for every permutation of the state
// classes, using real CSS cascade order (later wins at equal specificity, and
// !important beats non-important).
import { readFileSync } from "node:fs";
let css = readFileSync("app/reader-chrome.css","utf8");
// Remove @media blocks: this resolver models the default context. Their contents
// are correct but conditional, and counting them produced false readings.
css = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\}\s*)*\}/g, "");

// Collect every rule that sets opacity/transform/visibility on the two buttons.
const rules = [];
const re = /([^{}]+)\{([^}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const sel = m[1].trim(), body = m[2];
  if (!/rr-sheet-btn|rr-close-btn/.test(sel)) continue;
  if (!/opacity|transform|visibility|pointer-events/.test(body)) continue;
  for (const part of sel.split(',').map(s=>s.trim())) {
    if (!/rr-sheet-btn|rr-close-btn/.test(part)) continue;
    if (/:active|:hover|:focus/.test(part)) continue;   // not the resting state
    rules.push({ sel: part, body, at: m.index,
      target: /rr-sheet-btn/.test(part) ? 'sheet' : 'close' });
  }
}

const spec = s => {
  const t = s.replace(/:not\(([^)]*)\)/g, '$1');
  return (t.match(/\.[\w-]+|\[[^\]]+\]/g)||[]).length;
};

function matches(sel, state) {
  // state = set of classes on <html>
  const neg = [...sel.matchAll(/:not\(\.([\w-]+)\)/g)].map(x=>x[1]);
  for (const n of neg) if (state.has(n)) return false;
  const pos = [...sel.replace(/:not\([^)]*\)/g,'').matchAll(/html((?:\.[\w-]+)*)/g)]
    .flatMap(x => (x[1]||'').split('.').filter(Boolean));
  for (const p of pos) if (!state.has(p)) return false;
  return true;
}

function resolve(target, state, prop) {
  let best = null;
  for (const r of rules) {
    if (r.target !== target) continue;
    if (!matches(r.sel, state)) continue;
    const decl = [...r.body.matchAll(new RegExp(prop+"\\s*:\\s*([^;]+)","g"))].pop();
    if (!decl) continue;
    const imp = /!important/.test(decl[1]);
    const key = [imp?1:0, spec(r.sel), r.at];
    if (!best || key[0]>best.key[0] ||
        (key[0]===best.key[0] && (key[1]>best.key[1] ||
        (key[1]===best.key[1] && key[2]>best.key[2])))) {
      best = { key, value: decl[1].replace('!important','').trim(), sel: r.sel };
    }
  }
  return best;
}

const perms = [
  ['reader open, chrome visible (sheet era)', new Set(['rr-books-controls'])],
  ['reader open, chrome HIDDEN (sheet era)',  new Set(['rr-books-controls','rr-hide-chrome'])],
  ['older reader, chrome visible',            new Set(['rr-strip'])],
  ['older reader, chrome HIDDEN',             new Set(['rr-strip','rr-hide-chrome'])],
  ['sheet open over reader',                  new Set(['rr-books-controls','rr-sheet-open'])],
];

let fail = 0;
for (const [label, state] of perms) {
  console.log(`\n${label}`);
  for (const t of ['sheet','close']) {
    const o = resolve(t, state, 'opacity');
    const x = resolve(t, state, 'transform');
    console.log(`  ${t.padEnd(6)} opacity=${(o?.value??'(default 1)').padEnd(12)} transform=${x?.value??'(none)'}`);
  }
  // Invariant: in the OLDER reader with chrome hidden, the hamburger must remain
  // reachable (opacity > 0).
  if (state.has('rr-hide-chrome') && !state.has('rr-books-controls')) {
    const o = resolve('sheet', state, 'opacity');
    const ok = o && parseFloat(o.value) > 0;
    console.log(`  ESCAPE HATCH intact: ${ok ? 'yes' : 'NO — hamburger unreachable'}`);
    if (!ok) fail++;
  }
  // Invariant: in the sheet era with chrome hidden, both must be untappable.
  if (state.has('rr-hide-chrome') && state.has('rr-books-controls')) {
    for (const t of ['sheet','close']) {
      const pe = resolve(t, state, 'pointer-events');
      const ok = pe && pe.value === 'none';
      console.log(`  ${t} untappable when hidden: ${ok?'yes':'NO'}`);
      if (!ok) fail++;
    }
  }
}

// Page turn must share the popovers' shape, not just their duration. It ran on
// var(--rr-spring-time) for several versions while still starting at opacity .72
// with 18px of pure translate, which reads as a twitch however long the spring
// lasts - the duration was never the thing that was wrong.
{
  const raw = readFileSync("app/reader-chrome.css", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const kf = raw.slice(raw.indexOf("@keyframes rr-page-next"));
  const block = kf.slice(0, kf.indexOf("}", kf.indexOf("to")) + 1);
  for (const [ok, label] of [
    [/opacity:\s*0\s*;/.test(block), "page turn fades from fully transparent"],
    [/scale\(\./.test(block), "page turn scales, like every other spring surface"],
    [/translateX\(-?[\d.]+vw\)/.test(block), "page turn travel scales with viewport width"],
    [!/opacity:\s*\.7/.test(block)
      && !/opacity:\s*\.7/.test(
        raw.slice(raw.indexOf("@keyframes rr-page-previous"),
          raw.indexOf("}", raw.indexOf("to", raw.indexOf("@keyframes rr-page-previous"))) + 1)),
      "page turn no longer starts near-opaque"],
  ]) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
    if (!ok) fail++;
  }
}

console.log(`\n${fail ? fail+' INVARIANT FAILURES' : 'all permutations sound'}`);
process.exit(fail?1:0);
