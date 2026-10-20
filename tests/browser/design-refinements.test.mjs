import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {summaryPreview} from './summary-settings-preview.mjs';
import {narrationEpub} from './epub-fixture.mjs';
import {reliabilityPreview} from './reliability-preview.mjs';
const pw=await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : 'playwright');
const rows=Array.from({length:18},(_,i)=>({id:`design-${i}`,title:i===0?'A Very Long Book Title That Needs Two Lines':`Book ${i}`,author:i===0?'William Trevor':'Jeffrey Archer',format:'EPUB',source:'Local'}));
for(const engine of ['chromium','webkit']) test(`${engine}: comfortable/compact persistence, My Books and bounded Settings`,{timeout:60000},async t=>{
 const preview=await summaryPreview({catalogRows:rows});t.after(()=>preview.close());
 const b=await pw[engine].launch(engine==='chromium'&&process.env.READING_ROOM_CHROME?{executablePath:process.env.READING_ROOM_CHROME}:{});t.after(()=>b.close());
 const p=await b.newPage({viewport:{width:393,height:852},serviceWorkers:'block'});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/api/library-state',r=>r.fulfill({json:{states:[]}}));
 await p.goto(preview.url);await p.locator('.rr-library-dock button[data-view="Library"]').click();await p.locator('.book').first().waitFor();
 const cols=()=>p.locator('.thumbnail-view').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
 assert.equal(await cols(),2);
 await p.locator('#rr-sort-btn').click();await p.getByRole('menuitemradio',{name:'Compact',exact:true}).click();assert.equal(await cols(),3);
 await p.reload();await p.locator('.rr-library-dock button[data-view="Library"]').click();await p.locator('.book').first().waitFor();assert.equal(await cols(),3);
 await p.locator('#rr-sort-btn').click();await p.getByRole('menuitemradio',{name:'Comfortable',exact:true}).click();assert.equal(await cols(),2);
 for(const theme of ['light','dark']){
  await p.evaluate(t=>document.documentElement.dataset.rrTheme=t,theme);
  await p.setViewportSize({width:1440,height:1000});assert.ok(await cols()>=6&&await cols()<=7);
  const g=await p.locator('.book').first().evaluate(e=>{const a=e.querySelector('.rr-byline small').getBoundingClientRect(),m=e.querySelector('.rr-card-more').getBoundingClientRect(),title=e.querySelector('.book-caption strong').getBoundingClientRect();return {titleBottom:title.bottom,menuTop:m.top,authorRight:a.right,menuLeft:m.left,height:m.height};});
  assert.ok(g.titleBottom<=g.menuTop+1);assert.ok(g.authorRight<=g.menuLeft+1);assert.ok(g.height>=44);
  await p.locator('#rr-settings-link').click();await p.waitForTimeout(650);
  const rect=await p.locator('#rr-settings-overlay').boundingBox();assert.equal(rect.width,660);assert.ok(rect.x>0&&rect.y>0);
  await p.getByRole('button',{name:'Appearance',exact:false}).click();await p.getByRole('button',{name:'Back',exact:true}).click();
  await p.locator('#close').click();await p.locator('#rr-settings-overlay').waitFor({state:'detached'});
  await p.waitForFunction(()=>document.activeElement===document.getElementById('rr-settings-link'));
 }
 await p.locator('.rr-library-dock button[data-view="Favorites"]').click();await p.getByRole('heading',{name:'My Books',exact:true}).waitFor();
 assert.equal(await p.locator('.catalog .results').isVisible(),false);
 assert.equal(await p.locator('footer').isVisible(),false);
 await p.getByRole('tab',{name:'Want to Read',exact:false}).click();await p.getByText('Nothing on Want to Read yet',{exact:true}).waitFor();
 await p.getByRole('button',{name:'Browse Library',exact:true}).click();await p.locator('.book').first().waitFor();
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
});
for(const engine of ['chromium','webkit']) test(`${engine}: reader presentation preserves art and wide-scroll measure without changing page inputs`,{timeout:60000},async t=>{
 const preview=await reliabilityPreview();t.after(()=>preview.close());
 const b=await pw[engine].launch(engine==='chromium'&&process.env.READING_ROOM_CHROME?{executablePath:process.env.READING_ROOM_CHROME}:{});t.after(()=>b.close());
 const fixture=await narrationEpub({stretchCover:true,paragraphCount:60});
 for(const mode of ['scroll','pages']){
  const p=await b.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await p.route('**/catalog.json',r=>r.fulfill({json:[{id:'art-test',title:'Art test',format:'EPUB',source:'Local'}]}));
  await p.route('**/api/book/**',r=>r.fulfill({contentType:'application/epub+zip',body:fixture}));
  await p.addInitScript(mode=>localStorage.setItem('reading-room-reader-mode',mode),mode);
  await p.goto(preview.url);await p.locator('.rr-library-dock button[data-view="Library"]').click();await p.locator('.book .cover').click();
  await p.waitForFunction(()=>document.querySelector('.epub-viewer iframe')?.contentDocument?.querySelector('#rr-book-presentation'));
  const geometry=await p.locator('.epub-viewer iframe').first().evaluate(f=>{const d=f.contentDocument;return {aspect:d.querySelector('svg').getAttribute('preserveAspectRatio'),padding:parseFloat(getComputedStyle(d.body).paddingLeft),width:d.body.getBoundingClientRect().width,flow:d.documentElement.dataset.rrReadingFlow};});
  assert.equal(geometry.aspect,'xMidYMid meet');assert.equal(geometry.flow,mode);
  if(mode==='scroll')assert.ok(geometry.width-geometry.padding*2<=802);
  await p.getByRole('button',{name:'Close book',exact:true}).click();await p.locator('.reader-shell').waitFor({state:'detached'});await p.close();
 }
});
