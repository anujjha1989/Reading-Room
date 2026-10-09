import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reliabilityPreview } from './reliability-preview.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');

// Shared guarantees with TVNarration/NarrationTests, not identical page or
// clip sizes: web/iPhone keep low-latency clips and publisher layout.
for (const engine of ['chromium', 'webkit']) test(`${engine}: narration transport preserves prose, punctuation and Unicode within the server limit`, { timeout: 45000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(); t.after(() => browser.close());
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.addInitScript(() => { window.__RR_TTS_TEST_ONLY__ = true; });
  await page.goto(preview.url);
  await page.waitForFunction(() => !!window.__RR_TTS_TEST_API__);
  const result = await page.evaluate(() => {
    const split = window.__RR_TTS_TEST_API__.speechChunks;
    const cases = [
      '“Really?” she asked. Dr. Jones paused; then continued, slowly.\nNo words should disappear.',
      'x' + '😀'.repeat(1400) + '.',
      ('A long clause, with its punctuation intact; and another phrase: still reading — never losing words. ').repeat(30),
    ];
    return cases.flatMap(source => [220, 1200, 9000].map(limit => ({ source, chunks: split(source, 'en', limit, true) })));
  });
  for (const { source, chunks } of result) {
    assert.equal(chunks.map(c => c.text).join(''), source, 'nothing lost or repeated');
    for (const chunk of chunks) {
      assert.ok(chunk.text.length > 0 && chunk.text.length <= 1200, '413-safe UTF-16 bound');
      assert.equal(chunk.end - chunk.at, chunk.text.length, 'highlight coordinates retained');
      assert.equal(source.slice(chunk.at, chunk.end), chunk.text);
      assert.doesNotThrow(() => encodeURIComponent(chunk.text), 'no broken surrogate pair');
    }
  }
});
