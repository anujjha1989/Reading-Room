import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";
import { summaryPreview } from "./summary-settings-preview.mjs";

test("multi-file details send catalogue IDs to native summaries and remain dismissible", { timeout: 60000 }, async t => {
  const preview = await summaryPreview(); t.after(() => preview.close());
  const browser = await launchBrowser(); t.after(() => browser.close());
  const errors = [];
  browser.on("Runtime.exceptionThrown", e => errors.push(e.exceptionDetails.text));
  const rows = ["L50519180469731d76804785473fc2fdd03c2d9f9", "1HZBuPVlPjqEpz9DZ0oF4HBwMIgEXztO2"].map(id => ({
    id, title: "East of Eden (Steinbeck Essentials )", author: "John Steinbeck", format: "EPUB", source: "Books", category: "Fiction",
    path: "Books / Fiction", url: `/api/book/${id}`, modified: "2026-10-03", workKey: "east of eden|john steinbeck"
  }));
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.summaryMessages = [];
    window.webkit = { messageHandlers: { rrSummary: { postMessage: b => window.summaryMessages.push(b) } } };
    const originalFetch = window.fetch;
    window.fetch = (input, init) => new URL(typeof input === 'string' ? input : input.url, location.href).pathname === '/catalog.json'
      ? Promise.resolve(new Response(${JSON.stringify(JSON.stringify(rows))}, {headers:{'Content-Type':'application/json'}})) : originalFetch(input, init);
  ` });
  await browser.goto(process.env.READING_ROOM_BASE_URL || preview.url);
  await browser.waitFor(`!!document.querySelector('.rr-library-dock button[data-view="Library"]')`);
  await browser.evaluate(`document.querySelector('.rr-library-dock button[data-view="Library"]').click()`);
  await browser.waitFor(`!!document.querySelector('.book .cover')`);
  for (const theme of ["light", "dark"]) {
    await browser.evaluate(`document.documentElement.dataset.rrTheme = '${theme}'; document.querySelector('.book .cover').click()`);
    await browser.waitFor(`!!document.querySelector('.rr-summary:not([hidden]) button')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.rr-summary').length`), 1);
    await browser.evaluate(`document.querySelector('.rr-summary button').click()`);
    const book = await browser.evaluate(`window.summaryMessages.at(-1)`);
    assert.equal(book.title, rows[0].title); assert.equal(book.author, rows[0].author);
    assert.deepEqual(book.copies.map(c => c.id).sort(), rows.map(c => c.id).sort());
    assert.ok(book.copies.every(c => c.format === "EPUB"));
    const check = await browser.evaluate(`(() => {
      const modal = document.querySelector('section.modal'), close = modal.querySelector('.close');
      modal.style.height = '300px'; modal.scrollTop = modal.scrollHeight;
      const r = close.getBoundingClientRect(), s = getComputedStyle(close);
      return {top:r.top, bottom:r.bottom, width:r.width, height:r.height, color:s.color, background:s.backgroundColor,
        hit: document.elementFromPoint(r.left+r.width/2,r.top+r.height/2) === close};
    })()`);
    assert.ok(check.top >= 0 && check.bottom < 932 && check.width >= 44 && check.height >= 44 && check.hit, JSON.stringify(check));
    assert.notEqual(check.color, check.background);
    await browser.screenshot(`book-details-summary-${theme}.png`);
    await browser.evaluate(`document.querySelector('section.modal .close').click()`);
    await browser.waitFor(`!document.querySelector('section.modal')`);
  }
  assert.equal(await browser.evaluate(`window.summaryMessages.length`), 2);
  await browser.evaluate(`delete window.webkit; document.querySelector('.book .cover').click()`);
  await browser.waitFor(`!!document.querySelector('.rr-summary[hidden]')`);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.rr-summary')).display`), "none");
  assert.deepEqual(errors, []);
});
