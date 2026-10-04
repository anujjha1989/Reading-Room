import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { reliabilityPreview } from "./reliability-preview.mjs";
import { narrationEpub } from "./epub-fixture.mjs";
// Install Playwright in the test environment, or supply the desktop runtime.
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");
const row = { id: "L00b856950ddb400a2f8846ad58a4c9519a9ce687", title: "Demons and Druids", author: "James Patterson", format: "EPUB", source: "Local", url: "/api/book/L00b856950ddb400a2f8846ad58a4c9519a9ce687" };
for (const engine of ["chromium", "webkit"]) {
  async function setup(t, extra = {}) {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === "chromium" && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME, headless: true } : { headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/catalog.json", r => r.fulfill({ json: [extra.row ?? row] }));
    await page.route("**/api/library-state", r => r.fulfill({ json: { states: [] } }));
    await page.route("**/api/settings/state", r => r.fulfill({ json: { sources: [], dropFolder: "Drop", status: { state: "idle" }, gaps: { total: 0, withCover: 0, noCover: 0, noAuthor: 0, poorTitle: 0 }, catalogueModified: null } }));
    await page.addInitScript(() => localStorage.setItem("reading-room-reader-mode", "scroll"));
    if (extra.init) await page.addInitScript(extra.init);
    return { page, errors, url: preview.url };
  }
  test(`${engine}: source hydration, both themes, touch targets and Settings focus isolation`, { timeout: 60_000 }, async t => {
    const { page, errors, url } = await setup(t);
    await page.goto(url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book .cover").waitFor();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.rrTheme = theme, theme);
      const bounds = await page.locator(".rr-card-more").first().boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44);
      await page.locator("#rr-sort-btn").click(); await page.locator("#rr-sort-menu").waitFor();
      const tick = await page.locator("#rr-sort-menu svg").first().evaluate(e => getComputedStyle(e).stroke);
      assert.notEqual(tick, "none");
      await page.keyboard.press("Escape"); await page.locator("#rr-settings-link").click();
      await page.locator("#rr-settings-overlay").waitFor();
      for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement.closest("#rr-settings-overlay")), true);
      await page.locator("#close").click(); await page.locator("#rr-settings-overlay").waitFor({ state: "detached" });
    }
    assert.deepEqual(errors, []);
  });
  test(`${engine}: light reader typography has one owner and respects font/alignment choices`, { timeout: 60_000 }, async t => {
    const { page, errors, url } = await setup(t);
    await page.route("**/api/book/**", r => narrationEpub().then(body => r.fulfill({ contentType: "application/epub+zip", body })));
    await page.goto(url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book .cover").click(); await page.locator(".epub-viewer iframe").first().waitFor();
    await page.locator(".rr-react-sheet-trigger").click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Text$/ }).click();
    await page.getByRole("radio", { name: "Light", exact: true }).click();
    await page.getByRole("button", { name: "More options", exact: true }).click();
    await page.getByLabel("Font", { exact: true }).selectOption("Serif");
    await page.getByRole("switch", { name: /^Justify text/ }).click();
    await page.getByRole("switch", { name: /^Bold text/ }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.epub-viewer iframe')].some(frame => {
      const p = frame.contentDocument?.querySelector('p'); if (!p) return false;
      const style = frame.contentWindow.getComputedStyle(p);
      return style.fontFamily.includes('Georgia') && style.textAlign === 'justify' && style.fontWeight === '700';
    }));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.epub-viewer iframe')].some(f => f.contentDocument?.getElementById('rr-light-reading'))), false);
    assert.deepEqual(errors, []);
    await page.getByRole("button", { name: "Close book", exact: true }).last().click();
  });
  test(`${engine}: malformed EPUB has Retry and Close instead of endless loading`, { timeout: 60_000 }, async t => {
    const { page, errors, url } = await setup(t);
    await page.route("**/api/book/**", r => r.fulfill({ status: 200, contentType: "application/epub+zip", body: "broken archive" }));
    await page.goto(url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book .cover").click();
    await page.getByRole("button", { name: "Retry opening", exact: true }).waitFor({ timeout: 35_000 });
    await page.getByRole("button", { name: "Retry opening", exact: true }).click();
    await page.getByRole("button", { name: "Retry opening", exact: true }).waitFor({ timeout: 35_000 });
    await page.getByRole("button", { name: "Close book", exact: true }).last().click();
    await page.locator(".reader-shell").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  });
  test(`${engine}: native Summary action is source-owned and preserves catalogue copies`, { timeout: 60_000 }, async t => {
    const { page, errors, url } = await setup(t, { init: () => {
      window.summaryMessages = [];
      window.webkit = { messageHandlers: { rrSummary: { postMessage: b => window.summaryMessages.push(b) } } };
    } });
    await page.goto(url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".rr-card-more").first().click();
    await page.getByRole("menuitem", { name: "Summary…", exact: true }).click();
    assert.equal(await page.evaluate(() => window.summaryMessages[0].copies[0].id), row.id);
    await page.locator(".rr-card-menu").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  });
  test(`${engine}: malformed MOBI has Retry and Close`, { timeout: 60_000 }, async t => {
    const { page, errors, url } = await setup(t, { row: { ...row, format: "MOBI" } });
    await page.route("**/api/book/**", r => r.fulfill({ status: 200, contentType: "application/x-mobipocket-ebook", body: "broken archive" }));
    await page.goto(url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book .cover").click();
    const retry = page.getByRole("button", { name: "Retry opening", exact: true });
    await retry.waitFor({ timeout: 35_000 }); await retry.click(); await retry.waitFor({ timeout: 35_000 });
    await page.getByRole("button", { name: "Close book", exact: true }).last().click();
    await page.locator(".reader-shell").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  });
  for (const format of ["PDF", "CBZ", "CBR"]) test(`${engine}: malformed ${format} has Retry and independent Close`, { timeout: 60_000 }, async t => {
    const { page, errors, url } = await setup(t, { row: { ...row, format } });
    await page.route("**/api/book/**", r => r.fulfill({ status: 200, contentType: "application/octet-stream", body: "broken archive" }));
    await page.goto(url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book .cover").click();
    const retry = page.getByRole("button", { name: "Retry opening", exact: true });
    await retry.waitFor({ timeout: 35_000 }); await retry.click(); await retry.waitFor({ timeout: 35_000 });
    await page.getByRole("button", { name: "Close book", exact: true }).last().click();
    await page.locator(".reader-shell").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  });
  for (const emptyMiddle of [false, true]) test(`${engine}: chapter boundaries${emptyMiddle ? " skip furniture-only sections" : ""}; audio retry and mode-switch highlighting`, { timeout: 60_000 }, async t => {
    const { page, errors, url } = await setup(t, { init: () => {
      window.sentences = []; window.failAudio = false;
      Object.defineProperty(HTMLMediaElement.prototype, "src", { configurable: true, get() { return this.fixtureSrc || ""; }, set(v) { this.fixtureSrc = v; } });
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.play = function () {
        clearTimeout(this.fixtureTimer);
        this.onplaying?.();
        if (window.failAudio) this.fixtureTimer = setTimeout(() => this.onerror?.(), 30);
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () { clearTimeout(this.fixtureTimer); };
      window.addEventListener("rr-narration", event => {
        if (event.detail.kind === "sentence") window.sentences.push({ chapter: event.detail.doc.title, text: event.detail.range.toString() });
      });
    } });
    await page.route("**/api/book/**", r => narrationEpub({ emptyMiddle }).then(body => r.fulfill({ contentType: "application/epub+zip", body })));
    await page.route("**/api/tts?**", r => r.fulfill({ body: "fixture" }));
    await page.goto(url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book .cover").click();
    await page.locator(".epub-viewer iframe").first().waitFor();
    await page.locator(".rr-react-sheet-trigger").click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Contents/ }).click();
    const startChapter = emptyMiddle ? "Chapter 3" : "Chapter 2";
    await page.locator('[data-view="contents"] button').filter({ hasText: new RegExp(`^${startChapter}$`) }).click();
    await page.locator('[data-view="contents"]').waitFor({ state: "detached" });
    await page.locator(".rr-react-sheet-trigger").click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
    await page.getByRole("button", { name: "Start reading", exact: true }).click();
    await page.waitForFunction(() => window.sentences.length > 0);
    assert.equal(await page.evaluate(() => window.sentences[0].chapter), startChapter);
    await page.getByRole("button", { name: "Previous sentence", exact: true }).click();
    await page.waitForFunction(() => window.sentences.at(-1)?.chapter === "Chapter 1");
    assert.match(await page.evaluate(() => window.sentences.at(-1).text), /sentence 18/);
    // Rebuilding the iframe for Pages/Scroll must retain this exact sentence.
    await page.getByRole("button", { name: "Pause reading", exact: true }).click();
    const anchor = await page.evaluate(() => window.sentences.at(-1).text);
    await page.locator('[data-view="aloud"]').getByRole("button", { name: "Back to reading menu", exact: true }).click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Text$/ }).click();
    for (const mode of ["Pages", "Scroll"]) {
      await page.getByRole("radio", { name: mode, exact: true }).click();
      await page.waitForFunction(anchor => [...document.querySelectorAll('.epub-viewer iframe')].some(frame => {
        const overlay = frame.contentDocument?.querySelector('.rr-reading-highlight-overlay');
        return overlay && frame.contentDocument.body.textContent.includes(anchor.trim());
      }), anchor, { timeout: 8000 });
    }
    await page.locator(".rr-react-sheet-trigger").click();
    await page.getByRole("button", { name: "Resume read aloud", exact: true }).click();
    await page.evaluate(() => window.failAudio = true);
    await page.getByRole("button", { name: "Next sentence", exact: true }).click();
    try { await page.getByRole("button", { name: "Resume read aloud", exact: true }).waitFor({ timeout: 6000 }); }
    catch { throw new Error(JSON.stringify(await page.evaluate(() => ({ sentences: window.sentences.slice(-8), buttons: [...document.querySelectorAll('.rr-read-transport button')].map(b => ({ label: b.getAttribute('aria-label'), title: b.title })), reader: document.querySelector('.reader-message')?.textContent })))); }
    const texts = await page.evaluate(() => window.sentences.slice(-3).map(e => e.text));
    assert.equal(new Set(texts).size, 1, "retry must not advance past the failed sentence");
    assert.deepEqual(errors, []);
    await page.getByRole("button", { name: "Close book", exact: true }).last().click();
  });
}
