// Model the three implementations of the back-from-panel flow against how the
// sheet actually decides it is open, to show why the first two failed.
function makeSheet() {
  const cls = new Set();
  let rendered = null, lastOpen = false;
  const open = () => cls.has('rr-sheet-open');
  const render = () => { rendered = 'menu'; };
  const sync = () => {                       // only renders on a transition
    const isOpen = open();
    if (isOpen && !lastOpen) render();
    lastOpen = isOpen;
  };
  return { cls, open, render, sync, get rendered(){return rendered;},
           openSheet(){ cls.add('rr-sheet-open'); } };
}

// v1: set view then sync(). The sheet is closed, so no transition, no render.
function v1(s, clickLands) { if (clickLands) s.openSheet(); s.sync(); }
// v2: click .rr-sheet-btn. In the real app that button belongs to the reader and
// does not set rr-sheet-open, so model it as a no-op.
function v2(s) { /* trigger.click() -> does not set the class */ s.sync(); }
// v3: set the class the sheet reads, then render explicitly.
function v3(s) { s.cls.add('rr-sheet-open'); s.sync(); s.render(); }

const cases = [
  ['v1, click lands in time',    s=>v1(s,true),  'menu'],
  ['v1, click does NOT land',    s=>v1(s,false), null],
  ['v2, clicking the wrong btn', v2,             null],
  ['v3, sets the class directly',v3,             'menu'],
];
let fail=0;
for (const [label, fn, want] of cases) {
  const s = makeSheet();
  fn(s);
  const got = s.rendered;
  const ok = got === want;
  const expectedToWork = label.startsWith('v3') || label.includes('lands in time');
  if (!ok) fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${label.padEnd(30)} rendered=${String(got).padEnd(6)} open=${s.open()}${expectedToWork?'':'   <- this is the reported bug'}`);
}
console.log(`\n${fail?fail+' modelling errors':'model matches the reported behaviour'}`);
process.exit(fail?1:0);
