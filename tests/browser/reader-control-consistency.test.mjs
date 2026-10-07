import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reliabilityPreview } from './reliability-preview.mjs';
import { narrationEpub } from './epub-fixture.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');

function wav(seconds = 2) {
  const rate = 8000, size = Math.floor(rate * seconds) * 2, b = Buffer.alloc(44 + size);
  b.write('RIFF', 0); b.writeUInt32LE(36 + size, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40);
  return b;
}
const CONTROLS = ['.rr-title-chip', '.rr-close-btn', '.rr-page-number', '.rr-react-sheet-trigger', '.rr-read-transport', '.rr-read-glass'];
const MOVING = ['.rr-title-chip', '.rr-close-btn', '.rr-page-number', '.rr-react-sheet-trigger', '.rr-read-transport', '.rr-read-extras'];

// The reader's floating controls are one family: same glass, same ink, and
// they leave and return together. Every button in the app answers a press.
for (const engine of ['chromium', 'webkit']) for (const theme of ['light', 'sepia', 'dark']) {
  test(`${engine} ${theme}: reader controls share one surface, move together and flash when pressed`, { timeout: 60000 }, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const fixture = await narrationEpub({ chapterCount: 2, paragraphCount: 30 });
    await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: 'control-fixture', title: 'Controls', format: 'EPUB', source: 'Local' }] }));
    await page.route('**/api/library-state', r => r.fulfill({ json: { states: [] } }));
    await page.route('**/api/book/**', r => r.fulfill({ contentType: 'application/epub+zip', body: fixture }));
    await page.route('**/api/tts/voices', r => r.fulfill({ json: { voices: [{ id: 'en_US-ryan-high', label: 'Ryan' }] } }));
    await page.route('**/api/tts?**', r => r.fulfill({ contentType: 'audio/wav', body: wav() }));
    await page.addInitScript(theme => {
      localStorage.setItem('reading-room-reader-mode', 'scroll'); localStorage.setItem('reading-room-voice', 'en_US-ryan-high');
      localStorage.setItem('reading-room-reader-theme', theme); localStorage.setItem('reading-room-reader-theme-set', '1');
    }, theme);
    await page.goto(preview.url);
    const dock = page.locator('.rr-library-dock button[data-view="Library"]');
    // A plain library button flashes too, and the flash clears itself.
    const box = await dock.boundingBox();
    await dock.dispatchEvent('pointerdown', { clientX: box.x + 10, clientY: box.y + 10, button: 0 });
    await page.waitForFunction(() => document.querySelector('.rr-press-flash'));
    await dock.dispatchEvent('pointerup', { clientX: box.x + 10, clientY: box.y + 10 });
    await page.waitForFunction(() => !document.querySelector('.rr-press-flash'), null, { timeout: 3000 });
    await dock.click();
    // A book cover is a card: opening one does not flash.
    await page.waitForFunction(() => !document.querySelector('.rr-press-flash'), null, { timeout: 3000 });   // the dock's own flash
    const cover = page.locator('.book .cover'), card = await cover.boundingBox();
    await cover.dispatchEvent('pointerdown', { clientX: card.x + 20, clientY: card.y + 20, button: 0 });
    await page.waitForTimeout(160);
    assert.equal(await page.locator('.rr-press-flash').count(), 0, 'covers do not flash');
    await cover.dispatchEvent('pointerup', { clientX: card.x + 20, clientY: card.y + 20 });
    await cover.click();
    await page.locator('.epub-viewer iframe').first().waitFor();
    await page.waitForTimeout(1500);
    await page.locator('.rr-react-sheet-trigger').click();
    // The reading sheet takes the page's theme: warm paper on Sepia, not Light's white.
    const sheet = await page.locator('section[role="dialog"][data-book-theme]').evaluate(el => getComputedStyle(el).backgroundColor);
    const expected = { light: '250, 250, 251', sepia: '247, 239, 222', dark: '38, 38, 40' }[theme];
    assert.ok(sheet.includes(expected), `the reading sheet matches the ${theme} page: ${sheet}`);
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
    await page.getByRole('button', { name: 'Start reading', exact: true }).click();
    await page.locator('.rr-read-transport').waitFor({ state: 'attached' });
    for (let i = 0; i < 3 && await page.locator('section[role="dialog"][data-book-theme][data-motion-state="open"]').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(450); }
    await page.locator('.rr-read-transport').waitFor();

    const looks = await page.evaluate(sels => sels.map(sel => { const s = getComputedStyle(document.querySelector(sel)); return [s.backgroundImage, s.color, s.borderTopColor, s.boxShadow].join(' | '); }), CONTROLS);
    assert.equal(new Set(looks).size, 1, `one surface and ink for every control: ${JSON.stringify(looks)}`);
    const ink = await page.evaluate(() => getComputedStyle(document.querySelector('.rr-close-btn')).color.match(/[\d.]+/g).slice(0, 3).map(Number));
    const light = (0.2126 * ink[0] + 0.7152 * ink[1] + 0.0722 * ink[2]) / 255;
    assert.ok(theme === 'dark' ? light > 0.8 : light < 0.2, `the close button's ink contrasts with a ${theme} page: ${ink}`);

    const samples = await page.evaluate(async sels => {
      const read = () => sels.map(sel => Number(getComputedStyle(document.querySelector(sel)).opacity).toFixed(2));
      const taken = [];
      document.querySelector('[aria-label="Show or hide reading controls"]').click();
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 60)); taken.push(read()); }
      await new Promise(r => setTimeout(r, 400)); taken.push(read());
      document.querySelector('[aria-label="Show or hide reading controls"]').click();
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 60)); taken.push(read()); }
      await new Promise(r => setTimeout(r, 400)); taken.push(read());
      return taken;
    }, MOVING);
    // Read one after another, so allow the sliver a frame boundary can put between two readings.
    for (const sample of samples) assert.ok(Math.max(...sample.map(Number)) - Math.min(...sample.map(Number)) <= 0.06, `controls fade in step: ${JSON.stringify(samples)}`);
    assert.ok(samples.slice(0, 5).some(sample => Number(sample[0]) > 0 && Number(sample[0]) < 1), 'the fade is a transition, not a jump');
    assert.equal(samples[5][0], '0.00'); assert.equal(samples.at(-1)[0], '1.00');

    const close = page.locator('.rr-close-btn'), spot = await close.boundingBox();
    await close.dispatchEvent('pointerdown', { clientX: spot.x + 20, clientY: spot.y + 20, button: 0 });
    const flash = await page.waitForFunction(() => { const f = document.querySelector('.rr-press-flash'); return f && { width: f.style.width, radius: f.style.borderRadius }; });
    assert.deepEqual(await flash.jsonValue(), { width: '46px', radius: '50%' }, 'the flash covers exactly the pressed button');
    await close.dispatchEvent('pointercancel', {});
    await page.waitForFunction(() => !document.querySelector('.rr-press-flash'), null, { timeout: 3000 });
    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}
