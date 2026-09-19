import { readFileSync } from "node:fs";
const js  = readFileSync("overrides/book-art/fullscreen-bundle.js","utf8");
const css = readFileSync("overrides/book-art/fullscreen-bundle.css","utf8");
let fail = 0;
const check = (ok, label, detail="") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "\n        "+detail : ""}`);
  if (!ok) fail++;
};

// 1. Every go() target must have a matching view branch.
const targets = [...js.matchAll(/go\('([^']+)'\)/g)].map(m=>m[1]);
const branches = new Set([...js.matchAll(/view === '([^']+)'/g)].map(m=>m[1]));
branches.add('menu');
const orphans = [...new Set(targets)].filter(t => !branches.has(t) && t !== 'Link copied');
check(orphans.length===0, "every go() target has a view branch", orphans.length?`orphans: ${orphans}`:"");

// 2. No feature lost: things that existed in the old More view must exist somewhere.
check(js.includes("Share book"), "Share book still reachable");
check(js.includes("rr-text-mode"), "text-mode toggle still reachable");
check(js.includes("'Bold Text'"), "Bold Text still present");
check(/aria-label','Font'/.test(js), "Font select still present");

// 3. Voice view must be styled — the base panel rule predates it.
check(/\[data-view="Voice"\]/.test(css), "Voice view has a panel background");

// 4. Classes emitted by JS must all be styled.
const emitted = [...js.matchAll(/className=['"]([a-z- ]*rr-books[a-z- ]*)['"]/g)]
  .flatMap(m=>m[1].split(/\s+/)).filter(Boolean);
const also = [...js.matchAll(/classList\.add\('(rr-[a-z-]+)'\)/g)].map(m=>m[1]);
const unstyled = [...new Set([...emitted, ...also])].filter(c => !css.includes("."+c));
check(unstyled.length===0, "every emitted class is styled", unstyled.length?`unstyled: ${unstyled}`:"");

// 5. Swatch circles hide their label via font-size:0 — title must be set or the
//    control becomes unlabelled for everyone, not just screen readers.
check(/b\.title=name/.test(js), "swatches keep an accessible name (title)");
check(/aria-label/.test(js), "buttons carry aria-label from button()");

// 6. The segmented control must refresh, and must do so by invalidating the
//    signature rather than calling render() directly - render() alone would not
//    pick up the reader's own state change.
// Scope to the Pages/Scroll segment only. A second segment (Page animation)
// exists further down and legitimately calls render(), because the signature
// key tracks pageTurnState directly.
const segStart = js.indexOf("rr-books-segment");
const segBlock = js.slice(segStart, js.indexOf("host.append(modes)", segStart));
check(/signature='';\s*sync\(\)/.test(segBlock), "segment refreshes via signature reset + sync");
check(!/setTimeout\(render\b/.test(segBlock), "segment does not call render() directly");
// 6b. It must exclude the page-turn group, or that group's buttons leak in.
check(/reader-modes:not\(\.reader-page-turn\)/.test(js), "segment excludes the page-turn group");

// 7. Read Aloud toggle DOES need its own render (signature ignores aria-pressed).
const raBlock = js.slice(js.indexOf("view === 'Read Aloud'"), js.indexOf("view === 'Voice'"));
check(/setTimeout\(render/.test(raBlock), "Read Aloud toggle refreshes itself");

// 8. Voice list writes through change() so React sees it.
check(/change\(voice,\s*opt\.value\)/.test(js), "voice selection goes through change()");

// 9. No stray 'More' entry point left in the root menu.
const menuBlock = js.slice(js.indexOf("if (view === 'menu')"), js.indexOf("view === 'Contents'"));
check(!/go\('More'\)/.test(menuBlock), "root menu no longer offers 'More'");

// 10. Toolbar must have 4 tiles max and each guarded.
const tiles = (menuBlock.match(/actions\.append/g)||[]).length;
check(tiles===4, `toolbar builds 4 tiles (found ${tiles})`);

console.log(`\n${fail ? fail+" FAILED" : "all checks passed"}`);
process.exit(fail?1:0);
