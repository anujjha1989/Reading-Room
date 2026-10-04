// Required rendered-route check; never writes library state or library settings.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");
const base = process.env.READING_ROOM_BASE_URL;
if (!base) throw new Error("Set the actual release origin");
for (const [engine, type] of [["Chrome", chromium], ["WebKit", webkit]]) {
  const browser = await type.launch(engine === "Chrome" && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME, headless: true } : { headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: "block" });
    if (process.env.READING_ROOM_COOKIE_FILE) {
      const cookie = JSON.parse(await readFile(process.env.READING_ROOM_COOKIE_FILE, "utf8"));
      const { name, value, expires, httpOnly, secure, sameSite } = cookie;
      assert.ok(name && value, "Authenticated release cookie is required");
      await context.addCookies([{ name, value, expires, httpOnly, secure, sameSite, url: base }]);
    }
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/library-state", async route => {
      if (route.request().method() === "GET") await route.continue();
      else await route.abort();
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".shelf-book").first().waitFor({ timeout: 35_000 });
    assert.equal(await page.title(), "Home Books");
    const expected = process.env.READING_ROOM_EXPECT_VERSION;
    if (expected) assert.equal(await page.locator('meta[name="rr-app-version"]').getAttribute("content"), expected);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book").first().waitFor();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.rrTheme = theme, theme);
      await page.locator("#rr-sort-btn").click(); await page.locator("#rr-sort-menu").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("#rr-settings-link").click();
      await page.locator(".rr-settings-row").first().waitFor();
      assert.equal(await page.locator('.rr-settings-footer[role="alert"]').count(), 0);
      await page.locator("#close").click(); await page.locator("#rr-settings-overlay").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(errors, []);
    console.log(`${engine}: actual release route, hydration, menus and Settings passed in both themes`);
  } finally { await browser.close(); }
}
