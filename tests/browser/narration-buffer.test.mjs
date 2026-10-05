import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reliabilityPreview } from './reliability-preview.mjs';
import { narrationEpub } from './epub-fixture.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');

// Real media decoding, not a stubbed play(): a cached sentence must start
// without a second network trip even when HTTP/media caches are separate.
function wav(seconds = 2) {
  const rate = 22050, size = rate * seconds * 2;
  const b = Buffer.alloc(44 + size);
  b.write('RIFF'); b.writeUInt32LE(36 + size, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40);
  for (let i = 0; i < size / 2; i++) b.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 220 / rate)), 44 + i * 2);
  return b;
}

for (const engine of ['chromium', 'webkit']) test(`${engine}: buffered narration avoids repeated media requests and long sentence gaps`, { timeout: 45000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(engine === 'chromium' && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = await narrationEpub({ chapterCount: 3, paragraphCount: 25 });
  await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: 'buffer-fixture', title: 'Buffered narration', format: 'EPUB', source: 'Local' }] }));
  await page.route('**/api/library-state', r => r.fulfill({ json: { states: [] } }));
  await page.route('**/api/book/**', r => r.fulfill({ contentType: 'application/epub+zip', body: fixture }));
  await page.route('**/api/tts/voices', r => r.fulfill({ json: { voices: [{ id: 'en_US-ryan-high', label: 'Ryan' }] } }));
  const requests = [];
  await page.route('**/api/tts?**', async r => {
    requests.push({ url: r.request().url(), warm: r.request().headers()['x-home-books-prefetch'] === '1' });
    await new Promise(resolve => setTimeout(resolve, 650));
    await r.fulfill({ contentType: 'audio/wav', body: wav(), headers: { 'cache-control': 'no-store' } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('reading-room-reader-mode', 'scroll');
    localStorage.setItem('reading-room-voice', 'en_US-ryan-high');
    window.audioAudit = { sources: [], gaps: [], ended: null, revoked: [] };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.audioAudit.revoked.push(url); revoke(url); };
    document.addEventListener('ended', e => { if (e.target.id === 'rr-tts-audio') window.audioAudit.ended = performance.now(); }, true);
    document.addEventListener('playing', e => {
      if (e.target.id !== 'rr-tts-audio') return;
      const audit = window.audioAudit;
      audit.sources.push(e.target.src);
      if (audit.ended !== null) { audit.gaps.push(performance.now() - audit.ended); audit.ended = null; }
    }, true);
  });
  await page.goto(preview.url);
  await page.locator('.rr-library-dock button[data-view="Library"]').click();
  await page.locator('.book .cover').click();
  await page.locator('.epub-viewer iframe').first().waitFor();
  await page.waitForTimeout(2200); // allow first clip and lookahead to finish
  const menu = page.locator('.rr-react-sheet-trigger'); await menu.click();
  await page.locator('[data-view="menu"] button').filter({ hasText: /^Aloud$/ }).click();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await page.waitForFunction(() => window.audioAudit.sources.length >= 4);
  const audit = await page.evaluate(() => window.audioAudit);
  assert.ok(audit.sources.every(src => src.startsWith('blob:')), 'preloaded audio should be handed directly to the player');
  assert.ok(Math.max(...audit.gaps) < 400, `buffered sentence gaps: ${audit.gaps}`);
  assert.equal(requests.filter(r => !r.warm).length, 0, 'no duplicate media loads for warmed sentences');
  await page.getByRole('button', { name: 'Pause reading', exact: true }).click();
  const src = await page.locator('#rr-tts-audio').evaluate(a => a.src);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#rr-tts-audio').evaluate(a => a.paused), true);
  await page.getByRole('button', { name: 'Resume reading', exact: true }).click();
  assert.equal(await page.locator('#rr-tts-audio').evaluate(a => a.src), src, 'resume retains the same buffered clip');
  await page.getByRole('button', { name: 'Stop reading', exact: true }).click();
  assert.ok((await page.evaluate(() => window.audioAudit.revoked)).includes(src), 'stop releases buffered audio');
  assert.deepEqual(errors, []);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
