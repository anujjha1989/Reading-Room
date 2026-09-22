import { readFileSync } from "node:fs";

const engine = readFileSync("app/readAloudEngine.js", "utf8");
const controller = readFileSync("app/readAloudController.ts", "utf8");
const hook = readFileSync("app/useReadAloud.ts", "utf8");
const reader = readFileSync("app/BookReader.tsx", "utf8");
const transport = readFileSync("app/ReadAloudTransport.tsx", "utf8");
const template = readFileSync("overrides/index.template.html", "utf8");
const deploy = readFileSync("deploy/deploy.sh", "utf8");

let failures = 0;
const check = (condition, label) => {
  console.log(`${condition ? "ok  " : "FAIL"}  ${label}`);
  if (!condition) failures += 1;
};

check(/import "\.\/readAloudEngine\.js"/.test(reader), "narration engine is bundled by BookReader");
check(!/read-aloud-v|read-aloud\.js/.test(template + deploy), "no separately deployed narration script remains");
check(/registerReadAloudEngine/.test(engine + controller) && /useSyncExternalStore/.test(hook),
  "React and the engine share a typed store");
check(!/window\.rr/.test(engine + controller + hook), "no narration browser-global API remains");
check(/0\.88/.test(engine) && !/\* 0\.5\b/.test(engine), "automatic following uses the lower viewport band");
check(/PAGE_TURN_SETTLE\s*=\s*5\d\d/.test(engine) && /await sleep\(PAGE_TURN_SETTLE\)/.test(engine),
  "paginated turns settle before another turn");
check(/rr-reading-mode-change/.test(engine) && /rr-reading-mode-change/.test(reader)
  && /anchorText/.test(engine) && /restoreAfterModeChange/.test(engine),
  "active narration is restored across mode changes");
check(/rr-reading-highlight-overlay/.test(engine) && /lines\.forEach/.test(engine)
  && !/CSS\.highlights/.test(engine), "highlight rectangles are merged per visual line");
check(/function highlight\(doc, range\)\s*{[\s\S]{0,500}?clearHighlights\(\);/.test(engine)
  && /querySelectorAll\("\.rr-reading-highlight-overlay"\)/.test(engine)
  && !/function highlight\(doc, range\)\s*{\s*clearHighlights\(doc\)/.test(engine),
  "each sentence replaces every previous narration highlight");
check(/STALL_TIMEOUT/.test(engine) && /armStallWatchdog/.test(engine) && /stallRetries <= 2/.test(engine),
  "stalled clips have bounded automatic recovery");
check(/playbackState\s*=\s*["']paused["']/.test(engine)
  && /setActionHandler\(["']play["']/.test(engine), "iOS media resume retains an actionable paused session");
check(/rr-read-transport/.test(transport) && /ReadAloudTransport/.test(reader),
  "floating transport is React-owned");

console.log(`\n${failures ? `${failures} FAILED` : "read-aloud integration checks passed"}`);
process.exit(failures ? 1 : 0);
