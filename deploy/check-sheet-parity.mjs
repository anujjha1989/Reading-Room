// Parity gate: the legacy sheet must not be deleted while it is the only place a
// feature exists.
//
// Step 1c was going to delete it. This check, written before doing so, found six
// typography features whose state lives ONLY in the override - bold, justify,
// character spacing, word spacing, font family - plus Reset Theme and Share. They
// are not displayed by the override, they are implemented by it: persisted to
// rr-books-type and applied by injecting a stylesheet into the book's iframe.
//
// So this runs on every deploy and fails if the legacy sheet is removed while any
// of them is still missing from the React one.
import { readFileSync, existsSync } from "node:fs";

const legacy = readFileSync("overrides/book-art/fullscreen-bundle.js", "utf8");
const sheet = existsSync("app/ReadingSheet.tsx") ? readFileSync("app/ReadingSheet.tsx", "utf8") : "";
const reader = readFileSync("app/BookReader.tsx", "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let fail = 0;
const t = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "\n        " + detail : ""}`);
  if (!ok) fail++;
};

const legacyPresent = /rr-books-menu/.test(code(legacy));

// Each entry: the feature, a marker proving it exists in React, and the state it
// needs to live in BookReader rather than the override.
const features = [
  { name: "Bold text",         sheet: /onBoldChange|bold=/,       state: /typography\.bold/ },
  { name: "Justify text",      sheet: /onJustifyChange|justify=/, state: /typography\.justify/ },
  { name: "Character spacing", sheet: /onCharSpacingChange/,      state: /typography\.charSpacing/ },
  { name: "Word spacing",      sheet: /onWordSpacingChange/,      state: /typography\.wordSpacing/ },
  { name: "Font family",       sheet: /onFontFamilyChange/,       state: /fontFamilyKey/ },
  { name: "Reset theme",       sheet: /onReset/,                  state: null },
  { name: "Share book",        sheet: /onShare/,                  state: null },
  { name: "Previous sentence", sheet: /previous:\s*\(\)|onPrevious|aloud\.previous/, state: null },
];

const missing = features.filter((f) => !f.sheet.test(code(sheet)));

if (legacyPresent) {
  console.log("Legacy sheet still present — parity not yet required.\n");
  for (const f of features) {
    const has = f.sheet.test(code(sheet));
    console.log(`  ${has ? "ported " : "pending"}  ${f.name}`);
  }
  t(true, `${features.length - missing.length}/${features.length} features ported so far`);
} else {
  // The legacy sheet is gone, so everything must have a home.
  t(missing.length === 0, "every legacy feature exists in the React sheet",
    missing.length ? `still missing: ${missing.map((f) => f.name).join(", ")}` : "");
  for (const f of features) {
    if (!f.state) continue;
    t(f.state.test(reader), `${f.name} state lives in BookReader`);
  }
  // The stored preferences must be migrated, not silently dropped.
  t(/rr-books-type/.test(reader), "existing rr-books-type preferences are migrated");
}

console.log(`\n${fail ? fail + " FAILED" : "parity gate satisfied"}`);
process.exit(fail ? 1 : 0);
