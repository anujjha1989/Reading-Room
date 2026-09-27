// Every button taps back: one document-level listener installed by the library,
// posting to the app's rrHaptic handler. Fails if the listener is not
// installed, or if the long press stops using it.
import { readFileSync } from "node:fs";
let failed = 0;
const t = (ok, name) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed += 1; };
const haptics = readFileSync("app/haptics.ts", "utf8");
const client = readFileSync("app/LibraryClient.tsx", "utf8");
const notes = readFileSync("app/ReaderAnnotations.tsx", "utf8");
t(/messageHandlers\?\.rrHaptic/.test(haptics), "haptics posts to the app's rrHaptic handler");
t(/addEventListener\("pointerup"/.test(haptics) && /> 12\) return/.test(haptics), "fires on release, not on a scroll or swipe");
t(/installHaptics\(\);/.test(client), "the library installs the listener");
t(/haptic\("firm"\)/.test(notes) && !/navigator\.vibrate/.test(notes), "press-and-hold uses the same haptics");
if (failed) process.exit(1);
