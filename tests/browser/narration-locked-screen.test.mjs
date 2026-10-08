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

// MOBI draws through a different engine, so it gets its own crossing. Real
// locally stored MOBI bytes; catalogue, progress and audio are isolated.
const mobiId = 'L091b7166ee02f38cbf7db2f249d9844a9873077c';
for (const engine of ['chromium', 'webkit']) {
  test(`${engine} MOBI: narration crosses a section with the screen off and rejoins the page on wake`, { timeout: 90000 }, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: mobiId, title: 'Season of the Machete', format: 'MOBI', source: 'Local', url: `/api/book/${mobiId}` }] }));
    await page.route('**/api/library-state', r => r.fulfill({ json: { states: [] } }));
    await page.route('**/api/tts?**', r => r.fulfill({ body: 'fixture' }));
    await page.addInitScript(() => {
      if (window.top !== window) return;
      localStorage.setItem('reading-room-reader-mode', 'scroll');
      window.heard = [];
      // Each clip "plays" for a few milliseconds so a whole section passes quickly.
      Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return this.fixtureSrc || ''; }, set(value) { this.fixtureSrc = value; } });
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.pause = function () { clearTimeout(this.fixtureTimer); };
      HTMLMediaElement.prototype.play = function () {
        clearTimeout(this.fixtureTimer); this.onplaying?.();
        this.fixtureTimer = setTimeout(() => this.onended?.(), 8);
        return Promise.resolve();
      };
      let hidden = false; const held = [];
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => { if (hidden) { held.push(callback); return 0; } return frame(callback); };
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      window.__screen = off => { hidden = off; if (!off) held.splice(0).forEach(callback => frame(callback)); document.dispatchEvent(new Event('visibilitychange')); };
      window.addEventListener('rr-narration', e => {
        if (e.detail.kind !== 'sentence') return;
        const drawn = document.querySelector('foliate-view')?.renderer?.getContents?.().find(item => item.doc === e.detail.doc);
        window.heard.push({ drawn: drawn ? drawn.index : null, offscreen: Boolean(e.detail.cfi), hidden });
      });
    });
    await page.goto(preview.url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator('.book .cover').click();
    await page.waitForFunction(() => document.querySelector('foliate-view')?.renderer?.getContents?.().length);
    await page.locator('.rr-react-sheet-trigger').click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Contents/ }).click();
    await page.locator('[data-view="contents"] button').filter({ hasText: /^CHAPTER TWO$/ }).click();
    await page.locator('[data-view="contents"]').waitFor({ state: 'detached' });
    await page.locator('.rr-react-sheet-trigger').click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
    await page.getByRole('button', { name: 'Start reading', exact: true }).click();
    await page.waitForFunction(() => window.heard.length > 0);
    const start = await page.evaluate(() => window.heard.at(-1).drawn);
    await page.evaluate(() => window.__screen(true));
    try {
      await page.waitForFunction(() => window.heard.filter(item => item.offscreen).length >= 6, null, { timeout: 45000, polling: 200 }); // frames are stopped, so poll on a timer
    } catch (error) {
      throw new Error(JSON.stringify(await page.evaluate(() => ({ count: window.heard.length, tail: window.heard.slice(-5), statuses: [...document.querySelectorAll('[role="status"]')].map(item => item.textContent) }))), { cause: error });
    }
    await page.evaluate(() => window.__screen(false));
    await page.waitForFunction(start => { const last = window.heard.at(-1); return !last.hidden && last.drawn !== null && last.drawn > start; }, start, { timeout: 25000 });
    assert.notEqual(await page.evaluate(id => localStorage.getItem(`reading-room-position-${id}`), mobiId), null, 'the saved place follows the voice');
    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}

// Inside the iPhone app the page's visibility flag can stay "hidden" on a
// screen that is plainly on. Following the voice must rely on frames actually
// being drawn, or the highlight runs off the bottom and the page never moves.
for (const engine of ['chromium', 'webkit']) {
  test(`${engine}: scroll mode keeps following the voice when the visibility flag is stuck hidden`, { timeout: 70000 }, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const fixture = await narrationEpub({ chapterCount: 2, paragraphCount: 30 });
    await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: 'stuck-fixture', title: 'Stuck flag', format: 'EPUB', source: 'Local' }] }));
    await page.route('**/api/library-state', r => r.fulfill({ json: { states: [] } }));
    await page.route('**/api/book/**', r => r.fulfill({ contentType: 'application/epub+zip', body: fixture }));
    await page.route('**/api/tts/voices', r => r.fulfill({ json: { voices: [{ id: 'en_US-ryan-high', label: 'Ryan' }] } }));
    await page.route('**/api/tts?**', r => r.fulfill({ body: 'fixture' }));
    await page.addInitScript(() => {
      if (window.top !== window) return;
      localStorage.setItem('reading-room-reader-mode', 'scroll'); localStorage.setItem('reading-room-voice', 'en_US-ryan-high');
      window.heard = [];
      Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return this.fixtureSrc || ''; }, set(value) { this.fixtureSrc = value; } });
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.pause = function () { clearTimeout(this.fixtureTimer); };
      HTMLMediaElement.prototype.play = function () { clearTimeout(this.fixtureTimer); this.onplaying?.(); this.fixtureTimer = setTimeout(() => this.onended?.(), 110); return Promise.resolve(); };
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      window.__stickHidden = () => { hidden = true; };          // frames keep flowing
      window.addEventListener('rr-narration', e => {
        if (e.detail.kind !== 'sentence' || !e.detail.range) return;
        const range = e.detail.range;
        setTimeout(() => { try {
          const frame = range.startContainer.ownerDocument.defaultView.frameElement.getBoundingClientRect(), box = range.getBoundingClientRect();
          window.heard.push({ top: Math.round(frame.top + box.top), bottom: Math.round(frame.top + box.bottom) });
        } catch { window.heard.push({ top: NaN, bottom: NaN }); } }, 80);
      });
    });
    await page.goto(preview.url);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator('.book .cover').click();
    await page.locator('.epub-viewer iframe').first().waitFor();
    await page.waitForTimeout(1500);
    await page.locator('.rr-react-sheet-trigger').click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
    await page.getByRole('button', { name: 'Start reading', exact: true }).click();
    await page.waitForFunction(() => window.heard.length >= 2);
    await page.evaluate(() => window.__stickHidden());
    await page.waitForFunction(() => window.heard.length >= 28, null, { timeout: 40000 });
    const heard = (await page.evaluate(() => window.heard)).slice(2);
    assert.ok(heard.every(item => item.bottom <= 852 && item.top >= 0), `every spoken sentence is on screen: ${JSON.stringify(heard)}`);
    assert.ok(heard.some((item, index) => index > 0 && item.top < heard[index - 1].top), 'the page moved on at least once');
    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}

// MOBI in scroll mode: the chapter is one tall frame inside foliate's own
// scroller, so "on screen" has to be judged against the window. Judged from
// inside the frame, nothing ever needed revealing and the page never moved.
for (const engine of ['chromium', 'webkit']) {
  test(`${engine} MOBI: scroll mode keeps the spoken sentence on screen`, { timeout: 70000 }, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: mobiId, title: 'Season of the Machete', format: 'MOBI', source: 'Local', url: `/api/book/${mobiId}` }] }));
    await page.route('**/api/library-state', r => r.fulfill({ json: { states: [] } }));
    await page.route('**/api/tts?**', r => r.fulfill({ body: 'fixture' }));
    await page.addInitScript(() => {
      if (window.top !== window) return;
      localStorage.setItem('reading-room-reader-mode', 'scroll');
      window.heard = [];
      Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return this.fixtureSrc || ''; }, set(value) { this.fixtureSrc = value; } });
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.pause = function () { clearTimeout(this.fixtureTimer); };
      HTMLMediaElement.prototype.play = function () { clearTimeout(this.fixtureTimer); this.onplaying?.(); this.fixtureTimer = setTimeout(() => this.onended?.(), 130); return Promise.resolve(); };
      window.addEventListener('rr-narration', e => {
        if (e.detail.kind !== 'sentence' || !e.detail.range) return;
        const range = e.detail.range;
        setTimeout(() => { try {
          const frame = range.startContainer.ownerDocument.defaultView.frameElement.getBoundingClientRect(), box = range.getBoundingClientRect();
          window.heard.push({ top: Math.round(frame.top + box.top), bottom: Math.round(frame.top + box.bottom) });
        } catch { window.heard.push({ top: NaN, bottom: NaN }); } }, 100);
      });
    });
    await page.goto(preview.url); await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator('.book .cover').click();
    await page.waitForFunction(() => document.querySelector('foliate-view')?.renderer?.getContents?.().length);
    await page.locator('.rr-react-sheet-trigger').click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Contents/ }).click();
    await page.locator('[data-view="contents"] button').filter({ hasText: /^CHAPTER TWO$/ }).click();
    await page.locator('[data-view="contents"]').waitFor({ state: 'detached' });
    await page.locator('.rr-react-sheet-trigger').click();
    await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
    await page.getByRole('button', { name: 'Start reading', exact: true }).click();
    await page.waitForFunction(() => window.heard.length >= 40, null, { timeout: 45000 });
    const heard = (await page.evaluate(() => window.heard)).slice(1);
    const off = heard.filter(item => !(item.top >= 0 && item.top < 852 - 24));
    assert.ok(off.length <= 1, `spoken sentences start on screen: ${JSON.stringify(heard)}`);
    assert.ok(heard.some((item, index) => index > 0 && item.top < heard[index - 1].top), 'the page moved on at least once');
    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}
