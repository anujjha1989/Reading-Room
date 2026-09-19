// WCAG contrast for the icon rail. The glyph sits on a translucent disc over the
// page, so the effective background is the disc composited onto the page colour.
const lin = c => { c/=255; return c<=.03928 ? c/12.92 : ((c+.055)/1.055)**2.4; };
const L = ([r,g,b]) => .2126*lin(r) + .7152*lin(g) + .0722*lin(b);
const ratio = (a,b) => { const [x,y]=[L(a),L(b)].sort((p,q)=>q-p); return (x+.05)/(y+.05); };
const over = (fg, alpha, bg) => fg.map((c,i) => Math.round(c*alpha + bg[i]*(1-alpha)));

const disc = [120,120,128], discDark = [142,142,147];
const cases = [
  // label,                page bg,        disc,     alpha, glyph
  ["light mode, on paper", [255,255,255],  disc,     .20,   [28,28,30]],
  ["light mode, on cover", [140,140,140],  disc,     .20,   [28,28,30]],
  ["dark mode, on black",  [0,0,0],        discDark, .30,   [255,255,255]],
  ["dark mode, on cover",  [90,90,90],     discDark, .30,   [255,255,255]],
  // what it WAS in dark mode: color-mix(--ink 10%) where --ink = #f5f5f7
  ["BEFORE dark, on black",[0,0,0],        [245,245,247], .10, [245,245,247]],
];

let fail = 0;
console.log("target: 3.0 for a large glyph (WCAG non-text/large), 4.5 preferred\n");
for (const [label, page, d, a, glyph] of cases) {
  const bg = over(d, a, page);
  const r = ratio(glyph, bg);
  const ok = r >= 3.0;
  const isBefore = label.startsWith("BEFORE");
  if (!ok && !isBefore) fail++;
  console.log(`${isBefore ? "    " : ok ? "PASS" : "FAIL"}  ${label.padEnd(24)} ratio ${r.toFixed(2)}  (disc renders as rgb(${bg}))`);
}
console.log(`\n${fail ? fail+" contrast failures" : "all live cases meet 3.0"}`);
process.exit(fail?1:0);
