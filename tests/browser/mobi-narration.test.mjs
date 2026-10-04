import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { reliabilityPreview } from "./reliability-preview.mjs";
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");
// Real locally stored MOBI bytes; catalogue/progress and audio are isolated.
const id = "L091b7166ee02f38cbf7db2f249d9844a9873077c";
for (const engine of ["chromium", "webkit"]) test(`${engine}: MOBI Previous crosses a section boundary and preserves paused mode changes`, { timeout: 60_000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(engine === "chromium" && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: "block" });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/catalog.json", r => r.fulfill({ json: [{ id, title: "Season of the Machete", format: "MOBI", source: "Local", url: `/api/book/${id}` }] }));
  await page.route("**/api/library-state", r => r.fulfill({ json: { states: [] } }));
  await page.route("**/api/tts?**", r => r.fulfill({ body: "fixture" }));
  await page.addInitScript(() => {
    localStorage.setItem("reading-room-reader-mode", "scroll"); window.mobiSentences = [];
    // Setting src itself starts native media loading, even with load/play mocked.
    // Keep the fake clip out of the decoder so a synthetic audio error cannot
    // race chapter navigation. Playback-error recovery has its own test.
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true, get() { return this.fixtureSrc || ""; }, set(value) { this.fixtureSrc = value; },
    });
    HTMLMediaElement.prototype.load = function () {};
    HTMLMediaElement.prototype.play = function () { this.onplaying?.(); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () {};
    window.addEventListener("rr-narration", e => {
      if (e.detail.kind !== "sentence") return;
      const view = document.querySelector("foliate-view");
      const item = view?.renderer?.getContents?.().find(item => item.doc === e.detail.doc);
      window.mobiSentences.push({ index: item?.index, text: e.detail.range.toString() });
    });
  });
  await page.goto(preview.url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
  await page.locator(".book .cover").click();
  await page.waitForFunction(() => document.querySelector("foliate-view")?.renderer?.getContents?.().length);
  await page.locator(".rr-react-sheet-trigger").click();
  await page.locator('[data-view="menu"] button').filter({ hasText: /^Contents/ }).click();
  await page.locator('[data-view="contents"] button').filter({ hasText: /^CHAPTER TWO$/ }).click();
  await page.locator('[data-view="contents"]').waitFor({ state: "detached" });
  await page.locator(".rr-react-sheet-trigger").click();
  await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
  await page.getByRole("button", { name: "Start reading", exact: true }).click();
  await page.waitForFunction(() => window.mobiSentences.length > 0);
  const start = await page.evaluate(() => window.mobiSentences.at(-1).index);
  assert.ok(start > 0);
  await page.getByRole("button", { name: "Previous sentence", exact: true }).click();
  try {
    await page.waitForFunction(start => window.mobiSentences.at(-1).index < start, start, { timeout: 8000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      sentences: window.mobiSentences,
      contents: document.querySelector("foliate-view")?.renderer?.getContents?.().map(item => ({ index: item.index, text: item.doc.body.textContent?.slice(0, 300) })),
      sheet: document.querySelector('[data-view="aloud"]')?.textContent,
      statuses: [...document.querySelectorAll('[role="status"]')].map(item => item.textContent),
    }));
    throw new Error(JSON.stringify(diagnostic), { cause: error });
  }
  await page.getByRole("button", { name: "Pause reading", exact: true }).click();
  await page.getByRole("button", { name: "Back to reading menu", exact: true }).click();
  await page.locator('[data-view="menu"] button').filter({ hasText: /^Text$/ }).click();
  for (const mode of ["Pages", "Scroll"]) {
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await page.waitForFunction(() => document.querySelector("foliate-view")?.renderer?.getContents?.().some(item => item.doc.querySelector('.rr-reading-highlight-overlay')));
  }
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "Close book", exact: true }).last().click();
});
