import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("retired hosting and UI paths cannot silently return", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const name of ["drizzle-orm", "drizzle-kit", "react-loading-skeleton"]) {
    assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined);
  }
  for (const file of ["app/drive.ts", "app/chatgpt-auth.ts", "package-lock.json", "drizzle.config.ts", "build/sites-vite-plugin.ts"]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, file);
  }
  const bridge = read("app/readerChromeBridge.js");
  assert.ok(bridge.includes("getReadAloudSnapshot()"));
  assert.doesNotMatch(bridge, /rr-rate|rr-listen|rr-text-mode|rr-sheet-open/);
  assert.doesNotMatch(read("app/reader-chrome.css"), /:not\(\.rr-books-controls\)|rr-sheet-open|rr-text-mode/);
});
