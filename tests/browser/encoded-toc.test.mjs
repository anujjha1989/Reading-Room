import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile, mkdir } from "node:fs/promises";
import { reliabilityPreview } from "./reliability-preview.mjs";
import { encodedContentsEpub } from "./epub-fixture.mjs";
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");
for (const engine of ["webkit", "chromium"]) for (const real of [false, true]) {
  test(`${engine}: ${real ? "real Dickens collection" : "encoded NCX filenames and fragments"} opens selected works`, {timeout:120000}, async t => {
    const preview = process.env.READING_ROOM_TOC_LIVE_ORIGIN ? {url:process.env.READING_ROOM_TOC_LIVE_ORIGIN,close:async()=>{}} : await reliabilityPreview(); t.after(()=>preview.close());
    const browser = await pw[engine].launch({headless:true}); t.after(()=>browser.close());
    const context = await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:"block"});
    if (preview.url.startsWith("https:") && process.env.READING_ROOM_COOKIE_FILE) {
      const {name,value,expires,httpOnly,secure,sameSite}=JSON.parse(await readFile(process.env.READING_ROOM_COOKIE_FILE,"utf8"));
      await context.addCookies([{name,value,expires,httpOnly,secure,sameSite,url:preview.url}]);
    }
    const page = await context.newPage();
    const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    const id=real ? "L28a240771460ca037123d22ebcba7b0110b387b7" : "encoded-toc-fixture";
    await page.route("**/catalog.json*",r=>r.fulfill({json:[{id,title:"The Complete Works of Charles Dickens",author:"Charles Dickens",format:"EPUB",source:"Local",titleCorrected:true,authorCorrected:true}]}));
    await page.route("**/api/library-state*",r=>r.fulfill({json:r.request().method()==="GET"?{states:[]}:{ok:true}}));
    if (!real) { const fixture=await encodedContentsEpub(); await page.route("**/api/book/**",r=>r.fulfill({contentType:"application/epub+zip",body:fixture})); }
    await page.goto(preview.url);
    if (process.env.READING_ROOM_EXPECT_VERSION) assert.equal(await page.locator('meta[name="rr-app-version"]').getAttribute("content"),process.env.READING_ROOM_EXPECT_VERSION);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    await page.locator(".book .cover").click();
    await page.locator(".epub-viewer iframe").first().waitFor({timeout:60000});
    await page.waitForFunction(()=>!document.querySelector(".reader-message"));
    await page.locator(".epub-viewer").evaluate(node=>{
      let f=node[Object.keys(node).find(k=>k.startsWith("__reactFiber"))];
      for(;f;f=f.return) for(let h=f.memoizedState;h&&typeof h==="object";h=h.next) {
        const v=h.memoizedState?.current; if(v?.getContents&&v?.display){window.tocAuditRendition=v;return;}
      }
    });
    const targets = real ? [["The Pickwick Papers","_011.html"],["A Child’s History of England","_1509.html"]] : [["A Child’s History of England","CR!history.xhtml"],["Another work","Café book.xhtml"],["The Pickwick Papers","start.xhtml"]];
    for (const [title, suffix] of targets) {
      await page.locator(".rr-react-sheet-trigger").click();
      await page.locator('[data-view="menu"], [data-view="contents"]').waitFor();
      if (await page.locator('[data-view="menu"]').count()) await page.locator('[data-view="menu"] button').filter({hasText:/^Contents/}).click();
      const row=page.locator('[data-view="contents"] button').filter({hasText:new RegExp(`^${title}$`)});
      await row.click();
      await page.locator('[data-view="contents"]').waitFor({state:"detached"});
      await page.waitForFunction(s=>window.tocAuditRendition.location?.start?.href?.endsWith(s),suffix,{timeout:15000});
      assert.ok(await page.evaluate(s=>window.tocAuditRendition.getContents().some(c=>window.tocAuditRendition.book.spine.get(c.sectionIndex)?.href.endsWith(s)&&c.document.body.textContent.trim().length>80),suffix));
    }
    assert.deepEqual(errors,[],"contents taps must not reject with No Section Found");
    if (real && process.env.READING_ROOM_E2E_ARTIFACTS) {
      await mkdir(process.env.READING_ROOM_E2E_ARTIFACTS,{recursive:true});
      await page.screenshot({path:`${process.env.READING_ROOM_E2E_ARTIFACTS}/dickens-contents-${engine}.png`});
    }
    await page.getByRole("button",{name:"Close book",exact:true}).last().click();
    await page.locator(".reader-shell").waitFor({state:"detached"});
  });
}
