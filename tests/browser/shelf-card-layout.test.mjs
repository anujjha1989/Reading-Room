import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { reliabilityPreview } from "./reliability-preview.mjs";
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");
const rows = [
  { id: "bourdain", title: "The Complete Works of Anthony Bourdain", author: "Anthony Bourdain" },
  { id: "long-title", title: "An Exceptionally Long Book Title That Wraps Across More Than Two Lines", author: "An Exceptionally Long Author Name" },
  { id: "short-title", title: "Short", author: "A. Writer" },
].map(row => ({ ...row, format: "EPUB", source: "Local", url: `/api/book/${row.id}`, modified: "2026-10-04" }));
for (const engine of ["chromium", "webkit"]) test(`${engine}: shelf menus never overlap long titles, authors or progress`, { timeout: 60_000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(engine === "chromium" && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
  t.after(() => browser.close());
  for (const width of [320, 393, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 852 }, serviceWorkers: "block" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/catalog.json", route => route.fulfill({ json: rows }));
    await page.route("**/api/library-state", route => route.fulfill({ json: { states: rows.map(row => ({ bookId: row.id, status: "reading", favorite: true, progressLabel: "Page 17 of 302", lastOpened: Date.now(), updatedAt: Date.now() })) } }));
    await page.goto(preview.url); await page.locator(".rr-shelf-cell").first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.smart-shelf h2')].some(heading => heading.textContent === 'Continue'));
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.rrTheme = theme, theme);
      const spacing = await page.locator('.smart-shelf').first().evaluate(shelf => {
        const heading = shelf.querySelector('.shelf-heading').getBoundingClientRect();
        const cover = shelf.querySelector('.shelf-strip').getBoundingClientRect();
        return { top: heading.top - shelf.getBoundingClientRect().top, gap: cover.top - heading.bottom };
      });
      assert.ok(spacing.top >= 27 && spacing.gap >= 23, 'shelf titles need breathing room above and below');
      const geometry = await page.locator(".rr-shelf-cell").evaluateAll(cells => cells.map(cell => {
        const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        return { title: box(cell.querySelector('.shelf-book > strong')), author: box(cell.querySelector('.rr-shelf-author')), menu: box(cell.querySelector('.rr-card-more')), progress: cell.querySelector('.rr-continue-meta') ? box(cell.querySelector('.rr-continue-meta')) : null };
      }));
      for (const { title, author, menu, progress } of geometry) {
        assert.ok(menu.width >= 44 && menu.height >= 44);
        assert.ok(menu.top >= title.bottom - .5, `${engine}/${width}/${theme}: menu hits title`);
        assert.ok(author.right + 5 <= menu.left, 'author has a separate text column');
        assert.ok(Math.abs((author.top + author.bottom) / 2 - (menu.top + menu.bottom) / 2) < 1, 'author and menu are centered on one row');
        if (progress) assert.ok(progress.top >= menu.bottom - .5, 'progress is below the menu');
      }
      const menu = page.locator('.rr-shelf-cell .rr-card-more').first();
      await menu.click(); await page.locator('.rr-card-menu').waitFor();
      // Tap outside the menu, not the center of its full-screen backdrop.
      await page.locator('.rr-card-scrim').click({ position: { x: 5, y: 5 } });
      await page.locator('.rr-card-menu').waitFor({ state: 'detached' });
    }
    assert.deepEqual(errors, []); await page.close();
  }
});
