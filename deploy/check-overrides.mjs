// Static checks on the override bundles, run before every deploy.
//
// These exist because a deploy shipped a function that was defined and never
// called - syntactically perfect, behaviourally absent - and four rounds of
// "no change" followed. node --check cannot catch that; this can.
import { readFileSync } from "node:fs";

const files = [
  "overrides/book-art/fullscreen-bundle.js",
  "overrides/book-art/read-aloud.js",
];

// Pre-existing dead code, left in place deliberately: removing it is a separate
// change with its own risk. The check exists to stop NEW dead code shipping.
const KNOWN_DEAD = new Set(["mkDown", "mkUp", "scrollToPart", "bookFromNode", "chosenVoice"]);

let failed = false;
const fail = (msg) => { console.error("FAILED: " + msg); failed = true; };

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // Every locally declared function should be referenced somewhere else.
  for (const m of src.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = m[1];
    const uses = [...src.matchAll(new RegExp("\\b" + name + "\\b", "g"))].length;
    if (uses < 2 && !KNOWN_DEAD.has(name)) {
      fail(`${file}: function ${name} is declared but never called`);
    }
  }

  // Balanced IIFEs: an unclosed one silently swallows everything after it.
  const opens = (src.match(/^\(function\s*\(/gm) || []).length
    + (src.match(/^\(\(\)\s*=>/gm) || []).length;
  const closes = (src.match(/^\}\)\(\);/gm) || []).length;
  if (opens !== closes) fail(`${file}: ${opens} IIFE openings vs ${closes} closings`);
}

console.log(failed ? "override checks failed" : "override checks passed");
process.exit(failed ? 1 : 0);
