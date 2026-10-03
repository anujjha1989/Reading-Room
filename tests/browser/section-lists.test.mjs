import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";
import { summaryPreview } from "./summary-settings-preview.mjs";

test("home section lists render one metadata block and a usable menu in both themes", { timeout: 60000 }, async t => {
  const preview = await summaryPreview(); t.after(() => preview.close());
  const browser = await launchBrowser(); t.after(() => browser.close());
  const errors = [];
  browser.on("Runtime.exceptionThrown", e => errors.push(e.exceptionDetails.text));
  await browser.goto(preview.url);
  await browser.waitFor(`!!document.querySelector('button[aria-label="See all Recently added"]')`);
  for (const theme of ["light", "dark"]) {
    await browser.evaluate(`document.documentElement.dataset.rrTheme = '${theme}'; document.querySelector('button[aria-label="See all Recently added"]').click()`);
    await browser.waitFor(`document.querySelectorAll('.grid.list-view .book').length === 2`);
    const cards = await browser.evaluate(`[...document.querySelectorAll('.grid.list-view .book')].map(card => {
      const text = card.querySelector('.list-copy'), menu = card.querySelector('.rr-card-more');
      const a = text.getBoundingClientRect(), b = menu.getBoundingClientRect(), c = card.getBoundingClientRect();
      return { duplicates: card.querySelectorAll('.book-caption').length, titles: text.querySelectorAll('strong').length,
        menus: card.querySelectorAll('.rr-card-more').length, fits: c.right <= innerWidth && a.right <= b.left && b.right <= c.right + 1,
        visible: b.width > 20 && b.height > 20, position: getComputedStyle(menu).position };
    })`);
    for (const card of cards) { assert.equal(card.duplicates, 0); assert.equal(card.titles, 1); assert.equal(card.menus, 1); assert.ok(card.fits && card.visible); assert.equal(card.position, "static"); }
    await browser.screenshot(`section-list-${theme}.png`);
    await browser.evaluate(`document.querySelector('.grid.list-view .rr-card-more').click()`);
    await browser.waitFor(`!!document.querySelector('[role="menu"]')`);
    await browser.evaluate(`document.querySelector('.rr-card-scrim').click(); document.querySelector('#rr-sort-btn').click()`);
    await browser.waitFor(`!!document.querySelector('#rr-sort-menu')`);
    await browser.evaluate(`[...document.querySelectorAll('#rr-sort-menu button')].find(b => b.textContent.includes('Thumbnails')).click()`);
    await browser.waitFor(`document.querySelectorAll('.grid.thumbnail-view .book-caption').length === 2`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.grid.thumbnail-view .list-copy').length`), 0);
    await browser.evaluate(`document.querySelector('.rr-library-dock button[data-view="Home"]').click()`);
    await browser.waitFor(`!!document.querySelector('button[aria-label="See all Recently added"]')`);
  }
  assert.deepEqual(errors, []);
});
