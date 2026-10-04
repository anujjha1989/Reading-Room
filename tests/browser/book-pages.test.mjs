import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reliabilityPreview } from './reliability-preview.mjs';
import { narrationEpub } from './epub-fixture.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');

for (const engine of ['chromium', 'webkit']) for (const mode of ['scroll', 'pages']) {
  test(`${engine} ${mode}: book pages cross sections without resetting and survive reopen`, { timeout: 60_000 }, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const fixture = await narrationEpub({ paragraphCount: 100 });
    let states = [];
    await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: 'book-pages', title: 'Book pages', format: 'EPUB', source: 'Local' }] }));
    await page.route('**/api/library-state', r => {
      if (r.request().method() === 'POST') {
        const incoming = r.request().postDataJSON(); states = Array.isArray(incoming) ? incoming : [incoming];
        return r.fulfill({ json: { saved: true } });
      }
      return r.fulfill({ json: { states } });
    });
    await page.route('**/api/book/**', r => r.fulfill({ contentType: 'application/epub+zip', body: fixture }));
    await page.addInitScript(mode => localStorage.setItem('reading-room-reader-mode', mode), mode);
    await page.goto(preview.url);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator('.book .cover').click();
    await page.locator('.rr-page-number').waitFor();
    await page.locator('.epub-viewer').evaluate(el => {
      let fiber = el[Object.keys(el).find(k => k.startsWith('__reactFiber'))];
      for (; fiber; fiber = fiber.return) for (let state = fiber.memoizedState, i = 0; state && i < 100; state = state.next, i++) {
        if (state.memoizedState?.current?.manager) window.pageTestRendition = state.memoizedState.current;
      }
    });
    assert.equal(Number(await page.locator('.rr-page-number').textContent()), 1);
    const go = async href => {
      await page.evaluate(href => window.pageTestRendition.display(href), href);
      await page.waitForTimeout(900);
      return Number(await page.locator('.rr-page-number').textContent());
    };
    const second = await go('chapter2.xhtml');
    assert.ok(second > 1, 'second section must not restart at page one');
    const third = await go('chapter3.xhtml');
    assert.ok(third > second, 'forward section boundary must increase book page');
    assert.equal(await go('chapter2.xhtml'), second, 'backward navigation restores the same book page');
    assert.match(await page.locator('.rr-page-number').getAttribute('aria-label'), /in book$/);
    const anchor = await page.locator('.epub-viewer iframe').first().evaluate(frame => frame.getBoundingClientRect().top);
    await page.waitForTimeout(900);
    assert.ok(Math.abs(await page.locator('.epub-viewer iframe').first().evaluate(frame => frame.getBoundingClientRect().top) - anchor) < 3, 'indexing must not move the reader');
    await page.getByRole('button', { name: 'Close book', exact: true }).last().click();
    await page.locator('.reader-shell').waitFor({ state: 'detached' });
    await page.locator('.book .cover').click();
    await page.locator('.rr-page-number').waitFor();
    await page.waitForTimeout(900);
    assert.equal(Number(await page.locator('.rr-page-number').textContent()), second, 'cached reopen retains the book page');
    assert.deepEqual(errors, []);
  });
}
