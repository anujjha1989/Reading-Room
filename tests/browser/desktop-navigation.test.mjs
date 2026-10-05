import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reliabilityPreview } from './reliability-preview.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');
const rows = [
  { id: 'trevor', title: 'The Complete Works of William Trevor', author: 'William Trevor' },
  { id: 'rain', title: 'After Rain', author: 'William Trevor' },
].map(row => ({ ...row, format: 'EPUB', source: 'Local', modified: '2026-10-05' }));

for (const engine of ['chromium', 'webkit']) test(`${engine}: desktop sidebar rows and header align without changing the mobile dock`, { timeout: 60000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const errors = [], resizeWarnings = [];
  page.on('pageerror', e => {
    // WebKit can defer one ResizeObserver delivery while the test repeatedly
    // resizes its viewport. Every settled layout is asserted below; do not
    // confuse that browser notification with an application exception.
    if (e.message === 'ResizeObserver loop completed with undelivered notifications.') resizeWarnings.push(e.message);
    else errors.push(e.message);
  });
  await page.route('**/catalog.json', r => r.fulfill({ json: rows }));
  await page.route('**/api/library-state', r => r.fulfill({ json: { states: rows.map(row => ({ bookId: row.id, status: 'reading', favorite: true, progress: .25 })) } }));
  await page.route('**/api/cover?**', r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#183544"/></svg>' }));
  await page.goto(preview.url); assert.equal(await page.title(), 'Home Books');
  await page.locator('.smart-shelf').first().waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.rrTheme = theme, theme);
    for (const width of [1200, 1440, 1728, 2048]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(120); // settle responsive rail observers between sizes
      const layout = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
        const nav = document.querySelector('.rr-library-dock');
        return { nav: rect(nav), tint: getComputedStyle(nav, '::before').backgroundColor,
          title: rect(document.querySelector('.hero h1')), heading: rect(document.querySelector('.smart-shelf .shelf-heading')),
          gear: rect(document.querySelector('#rr-settings-link')), shelf: rect(document.querySelector('.smart-shelf')),
          overflow: document.documentElement.scrollWidth > innerWidth,
          rows: [...nav.querySelectorAll('button')].map(b => ({ button: rect(b), icon: rect(b.querySelector('svg')), label: rect(b.querySelector('span')), direction: getComputedStyle(b).flexDirection })) };
      });
      assert.equal(layout.nav.left, 0); assert.equal(layout.nav.right, 220);
      assert.equal(layout.overflow, false, `${theme} ${width}: no horizontal overflow`);
      assert.ok(Math.abs(layout.title.left - layout.heading.left) < 1, `${theme} ${width}: header and shelf alignment ${JSON.stringify(layout)}`);
      assert.ok(Math.abs(layout.gear.right - (layout.shelf.right - 20)) < 1, `${theme} ${width}: gear aligns with shelf inset`);
      for (const row of layout.rows) {
        assert.equal(row.direction, 'row'); assert.equal(row.button.height, 44);
        assert.ok(row.icon.right < row.label.left, 'icon and label must not overlap');
        assert.ok(Math.abs((row.icon.top + row.icon.bottom) / 2 - (row.label.top + row.label.bottom) / 2) < 1, 'icon and label centres align');
        assert.ok(row.label.bottom <= row.button.bottom && row.label.top >= row.button.top);
      }
      for (let i = 1; i < layout.rows.length; i++) assert.ok(layout.rows[i].button.top - layout.rows[i - 1].button.bottom >= 6);
    }
    const nav = page.locator('.rr-library-dock');
    await nav.getByRole('button', { name: 'Browse full library', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.rrLibraryView === 'library');
    assert.equal(await nav.getByRole('button', { name: 'Browse full library', exact: true }).getAttribute('aria-current'), 'page');
    await nav.getByRole('button', { name: 'My Books', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.dataset.rrLibraryView === 'favorites');
    await nav.getByRole('button', { name: 'Home', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.rrLibraryView === 'home');
    await page.waitForTimeout(250);
    if (engine === 'webkit') await page.screenshot({ path: `/tmp/home-books-desktop-sidebar-${theme}.png` });
  }
  for (const width of [393, 1199]) {
    await page.setViewportSize({ width, height: 852 });
    await page.waitForTimeout(120);
    const dock = await page.locator('.rr-library-dock').evaluate(el => ({ direction: getComputedStyle(el).flexDirection, buttonDirection: getComputedStyle(el.querySelector('button')).flexDirection, bottom: el.getBoundingClientRect().bottom }));
    assert.equal(dock.direction, 'row'); assert.equal(dock.buttonDirection, 'column');
    assert.ok(dock.bottom <= 852 && dock.bottom > 750, 'mobile/tablet dock remains at the bottom');
  }
  assert.deepEqual(errors, []);
  assert.ok(resizeWarnings.length <= 2, 'responsive observers must settle, not continuously loop');
  if (resizeWarnings.length) t.diagnostic(`${resizeWarnings.length} transient WebKit viewport-resize notification; settled geometry passed`);
});
