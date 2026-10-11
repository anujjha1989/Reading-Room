import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile, mkdir } from "node:fs/promises";
import { reliabilityPreview } from "./reliability-preview.mjs";
import { encodedContentsEpub } from "./epub-fixture.mjs";
import { readerDownloadTimeout } from "../../app/readerDeadline.ts";
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");
for (const engine of ["webkit", "chromium"]) for (const real of [false, true]) {
  test(`${engine}: ${real ? "real Dickens collection" : "encoded NCX filenames and fragments"} opens selected works`, {timeout:real?720000:120000}, async t => {
    const preview = process.env.READING_ROOM_TOC_LIVE_ORIGIN ? {url:process.env.READING_ROOM_TOC_LIVE_ORIGIN,close:async()=>{}} : await reliabilityPreview(); t.after(()=>preview.close());
    const browser = await pw[engine].launch({headless:true}); t.after(()=>browser.close());
    const context = await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:"block"});
    if (preview.url.startsWith("https:") && process.env.READING_ROOM_COOKIE_FILE) {
      const {name,value,expires,httpOnly,secure,sameSite}=JSON.parse(await readFile(process.env.READING_ROOM_COOKIE_FILE,"utf8"));
      await context.addCookies([{name,value,expires,httpOnly,secure,sameSite,url:preview.url}]);
    }
    const page = await context.newPage();
    await context.addInitScript(()=>{localStorage.setItem("reading-room-reader-theme","dark");localStorage.setItem("reading-room-reader-theme-set","1");});
    const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    const id=real ? "L28a240771460ca037123d22ebcba7b0110b387b7" : "encoded-toc-fixture";
    await page.route("**/catalog.json*",r=>r.fulfill({json:[{id,title:"The Complete Works of Charles Dickens",author:"Charles Dickens",format:"EPUB",source:"Local",titleCorrected:true,authorCorrected:true}]}));
    await page.route("**/api/library-state*",r=>r.fulfill({json:r.request().method()==="GET"?{states:[]}:{ok:true}}));
    if (!real) { const fixture=await encodedContentsEpub(); await page.route("**/api/book/**",r=>r.fulfill({contentType:"application/epub+zip",body:fixture})); }
    await page.goto(preview.url);
    if (process.env.READING_ROOM_EXPECT_VERSION) assert.equal(await page.locator('meta[name="rr-app-version"]').getAttribute("content"),process.env.READING_ROOM_EXPECT_VERSION);
    await page.locator('.rr-library-dock button[data-view="Library"]').click();
    const started=Date.now();
    const download=page.waitForResponse(r=>r.url().includes(`/api/book/${id}`),{timeout:30000});
    await page.locator(".book .cover").click();
    const response=await download;
    assert.equal(response.status(),200,"book download must succeed, not redirect to login or return a server error");
    const bytes=response.headers()["content-length"];
    const budget=readerDownloadTimeout(bytes??null)+60000;
    t.diagnostic(`book headers: ${bytes??"unknown"} bytes, ${Date.now()-started}ms; body/render allowance ${budget}ms`);
    response.finished().then(error=>t.diagnostic(`book transfer ${error?"failed":"finished"} after ${Date.now()-started}ms${error?`: ${error}`:""}`));
    await page.locator(".epub-viewer iframe").first().waitFor({timeout:budget});
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
    if (real) {
      for (const suffix of ["_1511.html", "_1512.html"]) {
        await page.evaluate(async suffix=>{
          const r=window.tocAuditRendition;
          const section=r.book.spine.spineItems.find(s=>s.href.endsWith(suffix));
          await r.display(section.href);
        },suffix);
        await page.waitForFunction(suffix=>window.tocAuditRendition.getContents().some(c=>window.tocAuditRendition.book.spine.get(c.sectionIndex)?.href.endsWith(suffix)),suffix);
        const colours=await page.evaluate(suffix=>{
          const r=window.tocAuditRendition;
          const c=r.getContents().find(c=>r.book.spine.get(c.sectionIndex)?.href.endsWith(suffix));
          return [...c.document.querySelectorAll("h1,h2,p,span,a[href]")].filter(e=>e.textContent.trim()&&!e.children.length).map(e=>({text:e.textContent.trim().slice(0,80),color:c.window.getComputedStyle(e).color,link:!!e.closest("a[href]")}));
        },suffix);
        assert.ok(colours.length>0,"real contents/chapter text must be present");
        for(const item of colours) assert.equal(item.color,item.link?"rgb(168, 200, 183)":"rgb(232, 228, 216)",`${suffix}: ${item.text}`);
      }
      await page.locator(".rr-react-sheet-trigger").click();
      await page.locator('[data-view="menu"] button').filter({hasText:/^Text$/}).click();
      for (const [theme,ink] of [["Light","rgb(32, 33, 35)"],["Dark","rgb(232, 228, 216)"]]) {
        await page.getByRole("radio",{name:theme,exact:true}).click();
        await page.waitForFunction(ink=>window.tocAuditRendition.getContents().some(c=>{
          const text=[...c.document.querySelectorAll("p,span,h1,h2")].find(e=>e.textContent.trim()&&!e.children.length);
          return text&&c.window.getComputedStyle(text).color===ink;
        }),ink);
      }
      await page.keyboard.press("Escape");
      await page.setViewportSize({width:1280,height:900});
      await page.waitForFunction(()=>window.tocAuditRendition.getContents().some(c=>c.window.getComputedStyle(c.document.body).color==="rgb(232, 228, 216)"));
      await page.setViewportSize({width:393,height:852});
    }
    if (real && process.env.READING_ROOM_E2E_ARTIFACTS) {
      await mkdir(process.env.READING_ROOM_E2E_ARTIFACTS,{recursive:true});
      await page.screenshot({path:`${process.env.READING_ROOM_E2E_ARTIFACTS}/dickens-contents-${engine}.png`});
    }
    await page.getByRole("button",{name:"Close book",exact:true}).last().click();
    await page.locator(".reader-shell").waitFor({state:"detached"});
  });
}
