import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reliabilityPreview } from './reliability-preview.mjs';
import { narrationEpub } from './epub-fixture.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');

function wav(seconds = 0.25) {
  const rate = 8000, size = Math.floor(rate * seconds) * 2, b = Buffer.alloc(44 + size);
  b.write('RIFF', 0); b.writeUInt32LE(36 + size, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40);
  for (let i = 0; i < size / 2; i++) b.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 220 / rate)), 44 + i * 2);
  return b;
}

// A locked iPhone draws no frames: the page is hidden and requestAnimationFrame
// never fires. Narration used to wait for the next chapter to be displayed, so
// it stopped at every chapter end until the phone was unlocked.
for (const engine of ['chromium', 'webkit']) for (const mode of ['scroll', 'pages']) {
  test(`${engine} ${mode}: narration crosses a chapter with the screen off and rejoins the page on wake`, { timeout: 70000 }, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const fixture = await narrationEpub({ chapterCount: 3, paragraphCount: 4 });
    await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: 'locked-fixture', title: 'Locked narration', format: 'EPUB', source: 'Local' }] }));
    await page.route('**/api/library-state', r => r.fulfill({ json: { states: [] } }));
    await page.route('**/api/book/**', r => r.fulfill({ contentType: 'application/epub+zip', body: fixture }));
    await page.route('**/api/tts/voices', r => r.fulfill({ json: { voices: [{ id: 'en_US-ryan-high', label: 'Ryan' }] } }));
    const spoken = [];
    await page.route('**/api/tts?**', async r => {
      spoken.push(new URL(r.request().url()).searchParams.get('t') || '');
      await r.fulfill({ contentType: 'audio/wav', body: wav(), headers: { 'cache-control': 'no-store' } });
    });
    await page.addInitScript(mode => {
      if (window.top !== window) return;
      localStorage.setItem('reading-room-reader-mode', mode);
      localStorage.setItem('reading-room-voice', 'en_US-ryan-high');
      let hidden = false; const held = [];
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => { if (hidden) { held.push(callback); return 0; } return frame(callback); };
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      window.__screen = off => { hidden = off; if (!off) held.splice(0).forEach(callback => frame(callback)); document.dispatchEvent(new Event('visibilitychange')); };
    }, mode);
    await page.goto(preview.url);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator('.book .cover').click();
    await page.locator('.epub-viewer iframe').first().waitFor();
    await page.waitForTimeout(2000);
    await page.locator('.rr-react-sheet-trigger').click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
    await page.getByRole('button', { name: 'Start reading', exact: true }).click();
    const heard = text => spoken.some(item => item.includes(text));
    const until = async (text, ms = 30000) => { for (let waited = 0; waited < ms && !heard(text); waited += 200) await page.waitForTimeout(200); return heard(text); };
    assert.ok(await until('Chapter 1 sentence 2'), 'narration starts in chapter 1');
    assert.equal(heard('Chapter 2 sentence'), false, 'chapter 2 is not requested before chapter 1 ends');
    await page.evaluate(() => window.__screen(true));
    assert.ok(await until('Chapter 2 sentence 3'), `narration carries on into chapter 2 with the screen off: ${spoken.slice(-4).join(' | ')}`);
    const saved = await page.evaluate(() => localStorage.getItem('reading-room-position-locked-fixture'));
    await page.evaluate(() => window.__screen(false));
    await page.waitForFunction(() => [...document.querySelectorAll('.epub-viewer iframe')].some(frame => {
      const doc = frame.contentDocument, box = frame.getBoundingClientRect();
      return doc && /Chapter 2 sentence/.test(doc.body?.textContent || '') && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
    }), null, { timeout: 15000 });
    assert.ok(await until('Chapter 3 sentence 1', 40000), 'narration keeps going on the drawn page after wake');
    assert.equal(await page.locator('#rr-tts-audio').evaluate(a => a.paused && !a.ended && a.currentTime === 0 && !a.src), false);
    assert.notEqual(await page.evaluate(() => localStorage.getItem('reading-room-position-locked-fixture')), null, 'the saved place follows the voice');
    void saved;
    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}
