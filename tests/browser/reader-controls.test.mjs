import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { reliabilityPreview } from "./reliability-preview.mjs";
import { narrationEpub } from "./epub-fixture.mjs";
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");

for (const engine of ["chromium", "webkit"]) test(`${engine}: current reader controls retain themes, centre taps and narration volume ownership`, { timeout: 60_000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(engine === "chromium" && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
  t.after(async () => {
    if (process.env.READER_CONTROLS_DEBUG) {
      console.log(await page.evaluate(() => ({ classes: document.documentElement.className, touch: navigator.maxTouchPoints, overlay: document.querySelector('[aria-label="Page tap controls"]')?.outerHTML, textMode: !!document.querySelector('.rr-selection-menu'), view: document.querySelector('section[data-view]')?.getAttribute('data-view') })));
      await page.screenshot({ path: `/tmp/reader-controls-${engine}.png` });
    }
    await browser.close();
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  page.setDefaultTimeout(8000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const fixture = await narrationEpub();
  const title = "The Complete Works of William Trevor — A Very Long Collection Title";
  await page.route("**/catalog.json", r => r.fulfill({ json: [{ id: "controls-fixture", title, format: "EPUB", source: "Local" }] }));
  await page.route("**/api/library-state", r => r.fulfill({ json: { states: [] } }));
  await page.route("**/api/book/**", r => r.fulfill({ contentType: "application/epub+zip", body: fixture }));
  await page.route("**/api/tts?**", r => r.fulfill({ body: "fixture" }));
  await page.route("**/api/tts/voices", r => r.fulfill({ json: { voices: [
    { id: "en_GB-alba-medium", label: "Alba · British English · medium" },
    { id: "kokoro-af_heart", label: "Kokoro · Heart · American English" },
  ] } }));
  await page.addInitScript(() => {
    // Desktop WebKit reports zero despite hasTouch; exercise the iPhone branch.
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 1 });
    localStorage.setItem("reading-room-reader-mode", "pages");
    Object.defineProperty(HTMLMediaElement.prototype, "src", { configurable: true, get() { return this.fixtureSrc || ""; }, set(v) { this.fixtureSrc = v; } });
    HTMLMediaElement.prototype.load = function () {};
    HTMLMediaElement.prototype.play = function () { this.onplaying?.(); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.goto(preview.url);
  await page.locator('.rr-library-dock button[data-view="Library"]').click();
  await page.locator(".book .cover").click();
  await page.locator(".epub-viewer iframe").first().waitFor();
  const menu = page.locator(".rr-react-sheet-trigger");
  for (const theme of ["Light", "Sepia", "Dark"]) {
    await menu.click();
    await page.locator('section[role="dialog"][data-view]').waitFor();
    if (await page.locator('[data-view="menu"]').count()) await page.locator('[data-view="menu"] button').filter({ hasText: /^Text$/ }).click();
    await page.getByRole("radio", { name: theme, exact: true }).click();
    await menu.click();
    await page.locator('section[role="dialog"][data-view]').waitFor({ state: 'detached' });
    await page.waitForTimeout(700);
    const geometry = await page.locator(".rr-close-btn").evaluate(el => {
      const a = el.getBoundingClientRect(), b = el.querySelector("svg").getBoundingClientRect();
      return { width: a.width, height: a.height, dx: b.x + b.width / 2 - a.x - a.width / 2, dy: b.y + b.height / 2 - a.y - a.height / 2, blur: getComputedStyle(el).backdropFilter };
    });
    assert.equal(geometry.width, 46); assert.equal(geometry.height, 46);
    assert.ok(Math.abs(geometry.dx) < 0.6 && Math.abs(geometry.dy) < 0.6);
    assert.match(geometry.blur, /blur\(26px\)/);
    const pageNumber = await page.locator('.rr-page-number').boundingBox();
    const menuBox = await menu.boundingBox();
    assert.ok(pageNumber && Math.abs(pageNumber.x + pageNumber.width / 2 - 196.5) < 1);
    assert.ok(Math.abs(pageNumber.y - menuBox.y) < 1, 'page number shares menu baseline');
    assert.match(await page.locator('.rr-page-number').textContent(), /^\d+$/);
    const titleBox = await page.locator('.rr-title-chip').boundingBox();
    const closeBox = await page.locator('.rr-close-btn').boundingBox();
    assert.ok(Math.abs(titleBox.y - closeBox.y) < 1 && titleBox.x + titleBox.width + 10 <= closeBox.x);
    assert.equal(await page.locator('.rr-title-chip').textContent(), title);
    assert.equal(await page.locator('.rr-title-chip').evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis');
    if (process.env.READER_CONTROLS_DEBUG) await page.screenshot({ path: `/tmp/home-books-controls-${engine}-${theme.toLowerCase()}.png` });
    await page.getByRole('button', { name: 'Show or hide reading controls', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains("rr-hide-chrome"));
    await page.waitForTimeout(450);
    for (const selector of ['.rr-title-chip', '.rr-page-number']) assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).opacity), '0');
    await page.getByRole('button', { name: 'Show or hide reading controls', exact: true }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains("rr-hide-chrome"));
    await page.waitForTimeout(700);
  }
  await menu.click();
  await page.locator('section[role="dialog"][data-view]').waitFor();
  if (await page.locator('[data-view="text"]').count()) await page.getByRole('button', { name: 'Back to reading menu', exact: true }).click();
  for (const action of ['Search', 'Marks']) {
    await page.locator('[data-view="menu"] button').filter({ hasText: new RegExp(`^${action}$`) }).click();
    await page.locator('.rr-reader-panel-portal').getByRole('button', { name: 'Back to reading menu', exact: true }).click();
    await page.locator('[data-view="menu"]').waitFor();
  }
  await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
  await page.locator('[data-view="aloud"] button').filter({ hasText: /^Default voice$/ }).click();
  await page.getByRole("button", { name: "Alba · British English · medium", exact: true }).waitFor();
  await page.getByRole("button", { name: "Kokoro · Heart · American English", exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("reading-room-voice")), "kokoro-af_heart");
  await page.locator('[data-view="aloud"] button').filter({ hasText: /^Kokoro · Heart/ }).waitFor();
  await page.getByRole("button", { name: "Start reading", exact: true }).click();
  assert.match(await page.locator('#rr-tts-audio').evaluate(audio => audio.src), /v=kokoro-af_heart/);
  await page.getByRole('button', { name:'Add 30 minutes', exact:true }).click();
  await page.getByRole("button", { name: "Pause reading", exact: true }).click();
  await menu.click();
  await page.waitForTimeout(700);
  const timer = page.locator('.rr-read-timer');
  assert.equal(await timer.locator('span').textContent(), '30');
  const transportBox = await page.locator('.rr-read-transport').boundingBox();
  const returnBox = await page.getByRole('button', { name:'Return to current reading', exact:true }).boundingBox();
  const timerBox = await timer.boundingBox();
  assert.ok(returnBox.y + returnBox.height < transportBox.y, 'return sits above the transport');
  assert.ok(timerBox.y + timerBox.height < returnBox.y, 'timer sits above return');
  assert.ok(Math.abs(returnBox.x + returnBox.width/2 - transportBox.x - transportBox.width/2) < 1);
  await timer.click();
  assert.equal(await timer.locator('span').textContent(), '60');
  await page.screenshot({path:`/tmp/home-books-narration-controls-${engine}.png`});
  await page.mouse.move(timerBox.x+20,timerBox.y+20);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await timer.dispatchEvent('pointercancel');
  await page.mouse.up();
  assert.equal(await timer.locator('span').textContent(), '60', 'cancelled hold leaves timer intact');
  await page.mouse.down();
  await page.waitForTimeout(3200);
  await page.mouse.up();
  assert.equal(await timer.count(), 0, 'three-second hold removes timer');
  assert.equal(await page.getByRole('button', { name:'Resume read aloud', exact:true }).count(), 1, 'timer cancellation does not stop narration');
  const uncaptured = await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "AudioVolumeDown", bubbles: true, cancelable: true })));
  assert.equal(uncaptured, true, "paused narration must leave volume keys to the device");
  assert.equal(await page.locator(".rr-text-mode").count(), 0, "retired hidden button must not be recreated");
  await page.getByRole("button", { name: "Close book", exact: true }).last().click();
  await page.locator(".reader-shell").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
});
