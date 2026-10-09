import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { reliabilityPreview } from './reliability-preview.mjs';
import { narrationEpub } from './epub-fixture.mjs';
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');
const utility = ts.transpile(await readFile(new URL('../../app/portableReadingPosition.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }).replace(/export /g, '');

for (const engine of ['chromium', 'webkit']) {
  test(`${engine}: portable anchors round-trip inline formatting and adjacent paragraphs`, { timeout: 45000 }, async t => {
    const browser = await pw[engine].launch(); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<p>First para without trailing space</p><p>Some <em>word</em>s are <b>bold</b>. Target passage is here.</p><p>Next para</p>');
    await page.addScriptTag({ content: utility });
    const result = await page.evaluate(() => {
      const target = document.querySelector('b').nextSibling;
      const range = document.createRange(); range.setStart(target, target.textContent.indexOf('Target')); range.collapse(true);
      const encoded = portableFromRange('epub', 2, range);
      const position = parsePortablePosition('rrportable:' + encoded);
      const restored = rangeForPortablePosition(document, position);
      const after = document.createRange(); after.selectNodeContents(document.body); after.setStart(restored.startContainer, restored.startOffset);
      return { position, restored: after.toString() };
    });
    assert.equal(result.position.wordOffset, 9);
    assert.ok(result.restored.startsWith('Target passage is here.'));
    assert.equal(result.position.spine, 2);
  });
  test(`${engine}: TV bookmark opens correct EPUB chapter and web emits compatible anchors`, { timeout: 60000 }, async t => {
    const preview = await reliabilityPreview(); t.after(() => preview.close());
    const browser = await pw[engine].launch(); t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const fixture = await narrationEpub({ chapterCount: 4, paragraphCount: 40 });
    const portable = JSON.stringify({ v: 1, fileId: 'shared-fixture', spine: 2, wordOffset: 280, quote: 'Chapter 3 sentence 20 describes a peaceful morning beside the old house.' });
    const saved = { bookId: 'shared-fixture', fileId: 'shared-fixture', position: 'rrportable:' + portable, portablePosition: portable, status: 'reading', progress: .6, updatedAt: Date.now(), lastOpened: Date.now() };
    const writes = [];
    await page.route('**/catalog.json', r => r.fulfill({ json: [{ id: 'shared-fixture', title: 'Shared Resume', format: 'EPUB', source: 'Local' }] }));
    await page.route('**/api/library-state', r => {
      if (r.request().method() === 'POST') { writes.push(...r.request().postDataJSON()); return r.fulfill({ json: { saved: true } }); }
      return r.fulfill({ json: { states: [saved] } });
    });
    await page.route('**/api/book/**', r => r.fulfill({ contentType: 'application/epub+zip', body: fixture }));
    await page.addInitScript(() => localStorage.setItem('reading-room-reader-mode', 'scroll'));
    await page.goto(preview.url);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.waitForTimeout(1000);
    await page.locator('.book .cover').click();
    await page.locator('.epub-viewer iframe:visible').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.epub-viewer iframe')].some(f => f.contentDocument?.body.textContent.includes('Chapter 3 sentence 20')));
    await page.waitForTimeout(1500);
    const visible = await page.evaluate(() => {
      const frames = [...document.querySelectorAll('.epub-viewer iframe')];
      return frames.flatMap(f => [...f.contentDocument.querySelectorAll('p')].filter(p => {
        const rect = p.getBoundingClientRect(), frame = f.getBoundingClientRect();
        return rect.bottom + frame.top > 0 && rect.top + frame.top < innerHeight;
      }).map(p => p.textContent));
    });
    assert.ok(visible.some(text => text.includes('Chapter 3 sentence 20')), 'TV passage should be on screen, not the start of the book');
    await page.waitForTimeout(1200);
    const anchors = writes.filter(item => item.portablePosition).map(item => JSON.parse(item.portablePosition));
    assert.ok(anchors.some(item => item.fileId === 'shared-fixture' && item.spine === 2), 'web reader must save a compatible text anchor');
    assert.deepEqual(errors, []);
  });
}
