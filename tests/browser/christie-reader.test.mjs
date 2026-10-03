import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";

const base = process.env.READING_ROOM_BASE_URL || "http://anujrpi.local:4311";
const collections = [
  ["L446ef224a004d731021b9bd66ef84f780d912cb3", "Christie Complete Works A"],
  ["L21f5fc9f61ffc9c2b8b0107ab33083a58460018b", "Christie Complete Collection B"],
];
const chapter = "Text/mesopotamia-05.xhtml";
// Inspect the actual reader, without adding a test-only global to the app.
const findRendition = `(() => {
  const node = document.querySelector('.epub-viewer');
  let fiber = node?.[Object.keys(node).find(key => key.startsWith('__reactFiber'))];
  for (; fiber; fiber = fiber.return) {
    for (let hook = fiber.memoizedState; hook && typeof hook === 'object'; hook = hook.next) {
      const value = hook.memoizedState?.current;
      if (value?.getContents && value?.display) return value;
    }
  }
})()`;

test("Christie EPUB saved-place recovery and continuous scrolling", { timeout: 150000 }, async t => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const errors = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  // Real collection bytes and production bundle; isolated catalogue/state so
  // this regression test never overwrites the user's actual reading progress.
  browser.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const route = new URL(request.url).pathname;
    const payload = route === "/catalog.json" ? collections.map(([id, title]) => ({
      id, title, author: "Agatha Christie", format: "EPUB", source: "Local",
      titleCorrected: true, authorCorrected: true, path: "Books", url: `/api/book/${id}`,
    })) : request.method === "GET" ? { states: [] } : { ok: true };
    await browser.send("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(payload)).toString("base64") });
  });
  await browser.send("Fetch.enable", { patterns: [
    { urlPattern: "*/catalog.json" }, { urlPattern: "*/api/library-state" },
  ] });
  await browser.goto(base);
  await browser.waitFor(`!!document.querySelector('.rr-library-dock')`);
  await browser.evaluate(`document.querySelector('.rr-library-dock button[data-view="Library"]').click()`);
  await browser.waitFor(`document.querySelectorAll('.book').length === 2`);

  for (const mode of ["scroll", "pages"]) {
    for (const [id, title] of collections) {
      await t.test(`${title} recovers a stale CFI in ${mode} mode`, async () => {
        const spineStep = id === collections[0][0] ? 806 : 804;
        await browser.evaluate(`localStorage.setItem('reading-room-reader-mode', '${mode}');localStorage.setItem('reading-room-position-${id}', 'epubcfi(/6/${spineStep}!/4/2:100)');document.querySelector('[aria-label="Open ${title} by Agatha Christie"]').click()`);
        await browser.waitFor(`!!document.querySelector('.epub-viewer iframe') && !document.querySelector('.reader-message')`, { attempts: 300 });
        await browser.evaluate(`void (window.testRendition = ${findRendition})`);
        await browser.waitFor(`testRendition?.location?.start?.href === '${chapter}'`, { attempts: 100 });
        assert.equal(await browser.evaluate(`testRendition.location.start.href`), chapter, "recover within the original chapter");

        if (mode === "scroll") {
          // Put a chapter-1 paragraph at y=100. Scroll back into the preceding
          // title/characters sections, then forward across the same boundary.
          // Compare the paragraph's visual motion, not absolute scrollTop:
          // trimming/prepending is allowed to change scrollTop legitimately.
          await browser.evaluate(`(() => {
            const m = testRendition.manager;
            const frame = [...document.querySelectorAll('.epub-viewer iframe')].find(f => /Tigris Palace/i.test(f.contentDocument?.body.textContent || ''));
            window.testFrame = frame;
            window.testParagraph = [...frame.contentDocument.querySelectorAll('p')].find(p => /hospital nurse/i.test(p.textContent.replace(/\u00ad/g, '')));
            m.container.scrollTop += frame.getBoundingClientRect().top + testParagraph.getBoundingClientRect().top - 100;
          })()`);
          await new Promise(r => setTimeout(r, 800));
          for (const delta of [-160, -160, 160, 160, 160, 160]) {
            const before = await browser.evaluate(`testFrame.getBoundingClientRect().top + testParagraph.getBoundingClientRect().top`);
            await browser.evaluate(`testRendition.manager.container.scrollTop += ${delta}`);
            await new Promise(r => setTimeout(r, 700));
            const after = await browser.evaluate(`testFrame.getBoundingClientRect().top + testParagraph.getBoundingClientRect().top`);
            assert.ok(Math.abs((after - before) + delta) < 8, `scroll ${delta} moved chapter-1 paragraph ${after - before}px, not by the requested amount`);
            assert.ok(await browser.evaluate(`testRendition.location.start.index <= 403`), "must not skip ahead to chapter 9");
          }
          // Height-only resize must retain the reading place.
          const cfi = await browser.evaluate(`testRendition.location.start.cfi`);
          await browser.evaluate(`window.dispatchEvent(new Event('resize'))`);
          await new Promise(r => setTimeout(r, 500));
          assert.equal(await browser.evaluate(`testRendition.location.start.cfi`), cfi);
        } else {
          await browser.evaluate(`testRendition.next()`);
          assert.equal(await browser.evaluate(`testRendition.location.start.href`), chapter);
        }
        await browser.evaluate(`document.querySelector('.rr-react-sheet-trigger').click()`);
        await browser.waitFor(`!!document.querySelector('[data-view="menu"]')`);
        await browser.evaluate(`[...document.querySelectorAll('[data-view="menu"] button')].find(b => b.textContent.startsWith('Contents')).click()`);
        await browser.waitFor(`[...document.querySelectorAll('[data-view="contents"] button')].some(b => b.textContent.trim() === 'MURDER IN MESOPOTAMIA')`);
        const bookList = await browser.evaluate(`[...document.querySelectorAll('[data-view="contents"] button')].map(b => b.textContent.trim())`);
        assert.ok(bookList.length < 110, "collection root must list books, not thousands of chapters");
        assert.ok(!bookList.some(label => /^Chapter\s+\d/i.test(label)), "chapter rows belong inside their book");
        await browser.evaluate(`[...document.querySelectorAll('[data-view="contents"] button')].find(b => b.textContent.trim() === 'MURDER IN MESOPOTAMIA').click()`);
        await browser.waitFor(`document.querySelector('[data-view="contents"] header strong')?.textContent === 'MURDER IN MESOPOTAMIA'`);
        assert.ok(await browser.evaluate(`[...document.querySelectorAll('[data-view="contents"] button')].some(b => /^Chapter 1\\b/.test(b.textContent.trim()))`));
        const fits = await browser.evaluate(`(() => { const panel = document.querySelector('[data-view="contents"]'); const scroll = panel.querySelector('[class*="scroller"]'); return {fits: panel.getBoundingClientRect().top >= 0 && panel.getBoundingClientRect().right <= innerWidth, scrolls: scroll.scrollHeight > scroll.clientHeight}; })()`);
        assert.equal(fits.fits, true, "chapter contents must fit the phone viewport");
        assert.equal(fits.scrolls, true, "long chapter lists remain scrollable");
        for (const theme of ["Light", "Sepia", "Dark"]) {
          await browser.evaluate(`[...document.querySelectorAll('.theme-options button')].find(b => b.textContent === '${theme}').click()`);
          await browser.waitFor(`document.querySelector('[data-view="contents"]')?.dataset.bookTheme === '${theme.toLowerCase()}'`);
          const colors = await browser.evaluate(`(() => {const panel = document.querySelector('[data-view="contents"]'); const s = getComputedStyle(panel); return [s.color, s.backgroundColor]; })()`);
          assert.notEqual(colors[0], colors[1]);
          await browser.screenshot(`christie-toc-${mode}-${id.slice(0, 8)}-${theme}.png`);
        }
        await browser.screenshot(`christie-toc-${mode}-${id.slice(0, 8)}.png`);
        await browser.evaluate(`document.querySelector('[aria-label="Back to books"]').click()`);
        await browser.waitFor(`document.querySelector('[data-view="contents"] header strong')?.textContent === 'Contents'`);
        await browser.evaluate(`[...document.querySelectorAll('[data-view="contents"] button')].find(b => b.textContent.trim() === 'AND THEN THERE WERE NONE').click()`);
        await browser.waitFor(`document.querySelector('[data-view="contents"] header strong')?.textContent === 'AND THEN THERE WERE NONE'`);
        assert.ok(await browser.evaluate(`[...document.querySelectorAll('[data-view="contents"] button')].some(b => b.textContent.trim() === 'Chapter 1')`), "recover chapter links missing from the collection's navigation package");
        await browser.screenshot(`christie-${mode}-${id.slice(0, 8)}.png`);
        await browser.evaluate(`document.querySelector('.rr-close-btn').click()`);
        await browser.waitFor(`!document.querySelector('.reader-shell')`);
      });
    }
  }
  assert.deepEqual(errors, [], "invalid saved positions must not throw or hang EPUB.js");
});
