import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";
import { summaryPreview } from "./summary-settings-preview.mjs";

test("all home shelf bands fade downwards in light, dark and system themes", {timeout:60000}, async t => {
  const preview = await summaryPreview(); t.after(() => preview.close());
  const browser = await launchBrowser(); t.after(() => browser.close());
  const errors=[]; browser.on("Runtime.exceptionThrown", e=>errors.push(e.exceptionDetails.text));
  await browser.send("Page.addScriptToEvaluateOnNewDocument", {source:`
    const originalFetch=window.fetch;
    window.fetch=(input,init)=>new URL(typeof input==='string'?input:input.url,location.href).pathname==='/api/library-state'
      ? Promise.resolve(new Response(JSON.stringify({states:['test-novel-one','L50519180469731d76804785473fc2fdd03c2d9f9'].map(bookId=>({
          bookId,favorite:true,status:'reading',progressLabel:'Page 1',lastOpened:Date.now(),updatedAt:Date.now()}))}),{headers:{'Content-Type':'application/json'}}))
      :originalFetch(input,init);
  `});
  await browser.goto(process.env.READING_ROOM_BASE_URL || preview.url);
  await browser.waitFor(`document.querySelectorAll('.smart-shelf').length >= 2`);
  await browser.waitFor(`[...document.querySelectorAll('.smart-shelf h2')].some(h=>h.textContent==='Continue')`);
  let geometry;
  for (const [theme, start, end] of [["light","237, 237, 240","255, 255, 255"],["dark","30, 30, 30","0, 0, 0"],["system","30, 30, 30","0, 0, 0"]]) {
    await browser.send("Emulation.setEmulatedMedia", {features:[{name:"prefers-color-scheme",value:"dark"}]});
    await browser.evaluate(`document.documentElement.dataset.rrTheme='${theme}'`);
    const shelves = await browser.evaluate(`[...document.querySelectorAll('.smart-shelf')].map(s => {
      const r=s.getBoundingClientRect(), rail=s.querySelector('.shelf-strip');
      return {gradient:getComputedStyle(s).backgroundImage,width:r.width,height:r.height,overflow:getComputedStyle(rail).overflowX};
    })`);
    for(const shelf of shelves) {
      assert.match(shelf.gradient,/linear-gradient\(/);
      assert.ok(shelf.gradient.indexOf(start) < shelf.gradient.lastIndexOf(end), shelf.gradient);
      assert.equal(shelf.overflow,"auto");
    }
    const current=shelves.map(({width,height})=>({width,height}));
    if(geometry) assert.deepEqual(current,geometry,"theme changes must not change shelf layout"); else geometry=current;
    await browser.screenshot(`shelf-gradient-${theme}.png`);
  }
  await browser.evaluate(`document.querySelector('.rr-library-dock button[data-view="Library"]').click()`);
  await browser.waitFor(`document.documentElement.dataset.rrLibraryView==='library'`);
  await browser.evaluate(`document.querySelector('.rr-card-more').click()`);
  await browser.waitFor(`!!document.querySelector('.rr-card-menu')`);
  await browser.evaluate(`document.querySelector('.rr-card-scrim').click()`);
  await browser.waitFor(`!document.querySelector('.rr-card-menu')`);
  assert.deepEqual(errors,[]);
});
