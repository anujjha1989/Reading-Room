import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reliabilityPreview } from './reliability-preview.mjs';
import { narrationEpub } from './epub-fixture.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');

for (const engine of ['chromium', 'webkit']) for (const mode of ['pages','scroll']) {
  test(`${engine} desktop ${mode}: mouse, keyboard and selection share the touch reader controls`, {timeout:60000}, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? {executablePath:process.env.READING_ROOM_CHROME} : {});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport:{width:1728,height:1000},serviceWorkers:'block'});
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const fixture = await narrationEpub({paragraphCount:100});
    await page.route('**/catalog.json', r => r.fulfill({json:[{id:'desktop-input',title:'Desktop reading',format:'EPUB',source:'Local'}]}));
    await page.route('**/api/library-state', r => r.fulfill({json:{states:[]}}));
    await page.route('**/api/book/**', r => r.fulfill({contentType:'application/epub+zip',body:fixture}));
    await page.addInitScript(mode => localStorage.setItem('reading-room-reader-mode',mode),mode);
    await page.goto(preview.url);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator('.book .cover').click();
    await page.locator('.epub-viewer iframe').first().waitFor();
    const centre = page.getByRole('button',{name:'Show or hide reading controls',exact:true});
    await centre.waitFor();
    assert.equal(await page.evaluate(() => navigator.maxTouchPoints),0);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('reader-shell')),true,'opening a book transfers keyboard focus from the library');
    await page.waitForTimeout(900);
    const firstPosition = await page.evaluate(() => localStorage.getItem('reading-room-position-desktop-input'));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(before => localStorage.getItem('reading-room-position-desktop-input') !== before, firstPosition);
    await page.waitForTimeout(700);
    await centre.click();
    await page.waitForFunction(() => document.documentElement.classList.contains('rr-hide-chrome'));
    await page.waitForTimeout(400);
    await centre.click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('rr-hide-chrome'));
    await page.waitForTimeout(700);
    const position = () => page.evaluate(() => localStorage.getItem('reading-room-position-desktop-input'));
    const scrolled = () => page.locator('.epub-container').evaluate(el => el.scrollTop);
    const advance = async action => {
      const before = mode === 'pages' ? await position() : await scrolled();
      await action();
      if (mode === 'pages') await page.waitForFunction(before => localStorage.getItem('reading-room-position-desktop-input') !== before, before);
      else await page.waitForFunction(before => document.querySelector('.epub-container').scrollTop > before+20,before);
      await page.waitForTimeout(700);
    };
    await advance(() => page.getByRole('button',{name:'Next page',exact:true}).click());
    for (const key of ['ArrowRight','PageDown',' ']) await advance(() => page.keyboard.press(key));
    const beforeBack = mode === 'pages' ? await position() : await scrolled();
    await page.keyboard.press('PageUp');
    if (mode === 'pages') await page.waitForFunction(before => localStorage.getItem('reading-room-position-desktop-input') !== before,beforeBack);
    else await page.waitForFunction(before => document.querySelector('.epub-container').scrollTop < before-20,beforeBack);
    await page.waitForTimeout(700);
    // A mouse drag selects real text inside the sandbox rather than turning.
    const points = await page.evaluate(() => {
      for (const frame of document.querySelectorAll('.epub-viewer iframe')) {
        const f = frame.getBoundingClientRect();
        for (const p of frame.contentDocument.querySelectorAll('p')) {
          const r = p.getBoundingClientRect(), y = f.top+r.top+8;
          if (y > 120 && y < innerHeight-120 && f.left+r.left >= 0 && f.left+r.left < innerWidth-150) return {x:f.left+r.left+4,y};
        }
      }
    });
    assert.ok(points);
    await page.mouse.move(points.x,points.y); await page.mouse.down();
    await page.mouse.move(points.x+120,points.y,{steps:5}); await page.mouse.up();
    await page.getByRole('menu',{name:'Selected text',exact:true}).waitFor();
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.epub-viewer iframe')].some(f => String(f.contentDocument.getSelection()).trim().length>3)));
    await page.getByRole('menuitemradio',{name:'Yellow highlight',exact:true}).click();
    await page.getByRole('menu',{name:'Selected text',exact:true}).waitFor({state:'detached'});
    await page.waitForTimeout(700);
    await page.mouse.dblclick(points.x+220,points.y);
    await page.getByRole('menu',{name:'Selected text',exact:true}).waitFor();
    await page.getByRole('menuitemradio',{name:'Yellow highlight',exact:true}).click();
    await page.getByRole('menu',{name:'Selected text',exact:true}).waitFor({state:'detached'});
    assert.doesNotMatch(await page.locator('.epub-viewer iframe').first().getAttribute('sandbox'), /allow-scripts/);
    await page.waitForTimeout(700);
    if (await page.evaluate(() => document.documentElement.classList.contains('rr-hide-chrome'))) {
      await page.locator('.reader-shell').focus(); await page.keyboard.press('Escape');
    }
    await page.locator('.reader-shell').focus();
    await page.keyboard.press('m');
    await page.locator('[data-view="menu"]').waitFor();
    await page.locator('[data-view="menu"] button').filter({hasText:/^Search$/}).focus();
    await page.keyboard.press('Enter');
    const input = page.getByRole('textbox',{name:'Word or phrase',exact:true});
    await input.waitFor(); await input.fill('morning');
    await page.locator('section[role="dialog"][data-view]').waitFor({state:'detached'});
    const whileEditing = await position();
    await input.press('ArrowLeft'); assert.equal(await position(),whileEditing);
    await page.keyboard.press('Escape');
    await page.locator('[data-view="menu"]').waitFor();
    await page.locator('.reader-panel').waitFor({state:'detached'});
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.locator('section[role="dialog"][data-view]').waitFor({state:'detached'});
    await page.screenshot({path:`/tmp/home-books-desktop-reader-${engine}-${mode}.png`});
    await page.locator('.reader-shell').focus(); await page.keyboard.press('Escape');
    await page.locator('.reader-shell').waitFor({state:'detached'});
    assert.deepEqual(errors,[]);
  });
}
