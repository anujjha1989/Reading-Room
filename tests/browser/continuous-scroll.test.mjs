import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { reliabilityPreview } from "./reliability-preview.mjs";
import { narrationEpub } from "./epub-fixture.mjs";
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");

for (const engine of ["webkit", "chromium"]) test(`${engine}: long continuous scrolling never unloads visible text or shifts resting text`, { timeout: 90_000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(engine === "chromium" && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const fixture = await narrationEpub({ chapterCount: 12, paragraphCount: 65 });
  await page.route("**/catalog.json", r => r.fulfill({ json: [{ id: "scroll-fixture", title: "Scrolling collection", author: "Home Books", format: "EPUB", source: "Local" }] }));
  let saved = [];
  await page.route("**/api/library-state", async r => {
    if (r.request().method() === 'POST') {
      const records = r.request().postDataJSON();
      for (const record of Array.isArray(records) ? records : [records]) {
        saved = [...saved.filter(item => item.bookId !== record.bookId), record];
      }
      await r.fulfill({ json: { saved: true } });
    } else await r.fulfill({ json: { states: saved } });
  });
  await page.route("**/api/book/**", r => r.fulfill({ contentType: "application/epub+zip", body: fixture }));
  await page.addInitScript(() => localStorage.setItem("reading-room-reader-mode", "scroll"));
  await page.goto(preview.url);
  await page.locator('.rr-library-dock button[data-view="Library"]').click();
  await page.locator(".book .cover").click();
  await page.locator(".epub-viewer iframe").first().waitFor();
  await page.waitForTimeout(1000);
  await page.locator(".epub-viewer").evaluate(el => {
    // Test-only observation of the renderer: never replace its update/trim code.
    let fiber = el[Object.keys(el).find(k => k.startsWith("__reactFiber"))];
    for (; fiber; fiber = fiber.return) {
      let state = fiber.memoizedState;
      for (let i = 0; state && i < 100; i++, state = state.next) {
        const value = state.memoizedState?.current;
        if (value?.manager) window.scrollAuditManager = value.manager;
      }
    }
    const manager = window.scrollAuditManager;
    window.visibleDestructions = [];
    function observe(view) {
      const destroy = view.destroy;
      view.destroy = function () {
        const rect = this.element.getBoundingClientRect(), bounds = manager.container.getBoundingClientRect();
        if (this.displayed && rect.top < bounds.bottom && rect.bottom > bounds.top) window.visibleDestructions.push(this.section.index);
        return destroy.call(this);
      };
    }
    manager.views.all().forEach(observe);
    const create = manager.createView;
    manager.createView = function (...args) { const view = create.apply(this, args); observe(view); return view; };
  });
  let blanks = 0, maxFrames = 0;
  for (const direction of [1, -1, 1, -1]) {
    for (let i = 0; i < 45; i++) {
      await page.locator(".epub-container").evaluate((el, d) => { el.scrollTop += d * 1000; }, direction);
      await page.waitForTimeout(80);
      const state = await page.evaluate(() => {
        const manager = window.scrollAuditManager, bounds = manager.container.getBoundingClientRect();
        const visible = manager.views.all().filter(v => { const r = v.element.getBoundingClientRect(); return r.top < bounds.bottom && r.bottom > bounds.top; });
        return { blank: visible.some(v => !v.displayed || !v.iframe?.contentDocument?.body), frames: document.querySelectorAll(".epub-viewer iframe").length };
      });
      if (state.blank) blanks++;
      maxFrames = Math.max(maxFrames, state.frames);
    }
    // Measure actual text as idle cleanup runs, not only scrollTop.
    const anchor = await page.evaluate(() => {
      for (const f of document.querySelectorAll(".epub-viewer iframe")) {
        const top = f.getBoundingClientRect().top;
        for (const p of f.contentDocument?.querySelectorAll("p") || []) {
          const y = top + p.getBoundingClientRect().top;
          if (y > 60 && y < 700) return { text: p.textContent, y };
        }
      }
    });
    assert.ok(anchor, "a readable paragraph must remain visible");
    await page.waitForTimeout(700);
    const y = await page.evaluate(text => {
      for (const f of document.querySelectorAll(".epub-viewer iframe")) for (const p of f.contentDocument?.querySelectorAll("p") || []) {
        if (p.textContent === text) return f.getBoundingClientRect().top + p.getBoundingClientRect().top;
      }
    }, anchor.text);
    assert.ok(Number.isFinite(y) && Math.abs(y - anchor.y) < 3, `resting text moved: ${anchor.y} → ${y}`);
    assert.ok(await page.locator('.epub-viewer iframe').count() <= 6, 'idle cleanup must release distant live documents');
  }
  assert.deepEqual(await page.evaluate(() => window.visibleDestructions), [], "cleanup must never destroy an on-screen section");
  assert.equal(blanks, 0, "scroll reversal must not expose unloaded placeholders");
  assert.ok(maxFrames <= 12, `active scrolling must not duplicate sections: ${maxFrames}`);
  assert.deepEqual(errors, []);
  await page.locator('.epub-container').evaluate(el => { el.scrollTop += 5000; });
  await page.waitForTimeout(1800);
  assert.ok(saved[0]?.progress > 0 && saved[0].progress <= 1, 'reading saves a whole-book fraction');
  assert.match(saved[0].progressLabel, /^\d+%$/);
  await page.getByRole("button", { name: "Close book", exact: true }).last().click();
  await page.locator(".reader-shell").waitFor({ state: "detached" });
  await page.locator('.rr-library-dock button[data-view="Home"]').click();
  const expected = Math.max(1, Math.round(saved[0].progress * 100)) + '%';
  assert.equal((await page.locator('.rr-continue-meta').first().textContent()).trim(), expected);
  await page.reload();
  await page.locator('.rr-continue-meta').first().waitFor();
  assert.equal((await page.locator('.rr-continue-meta').first().textContent()).trim(), expected, 'the shelf retains progress after reload');
});
