import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { reliabilityPreview } from "./reliability-preview.mjs";
const require = createRequire(import.meta.url);
const Zip = createRequire(require.resolve("epubjs/package.json"))("jszip");
const pw = await import(process.env.HOME_BOOKS_PLAYWRIGHT ? pathToFileURL(process.env.HOME_BOOKS_PLAYWRIGHT).href : "playwright");

// A book whose paragraph text sits in a span drawn at under half the
// paragraph's size: the page shows tiny letters with large-size spacing and
// A+ seems dead. Real superscripts and small print must stay small.
async function shrunkBook() {
  const zip = new Zip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("OEBPS/book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">shrunk</dc:identifier><dc:title>Shrunk</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="css" href="s.css" media-type="text/css"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c"/></spine></package>');
  zip.file("OEBPS/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c.xhtml">One</a></li></ol></nav></body></html>');
  zip.file("OEBPS/s.css", ".tiny{font-size:.4444em}.note{font-size:.7em;vertical-align:super}.sm{font-size:.8em}");
  const body = Array.from({ length: 30 }, (_, i) => `<p id="p${i}"><span class="tiny">Paragraph ${i}. This sentence is long enough to count as real body text, so it must follow the chosen size.</span> Marker<span class="note">1</span> <span class="sm">fine print</span> and <sup>2</sup>.</p>`).join("");
  zip.file("OEBPS/c.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title><link rel="stylesheet" href="s.css"/></head><body><h1>One</h1>${body}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

for (const engine of ["webkit", "chromium"]) test(`${engine}: text drawn far below its paragraph is brought back to the chosen size, small print is not`, { timeout: 90_000 }, async t => {
  const preview = await reliabilityPreview(); t.after(() => preview.close());
  const browser = await pw[engine].launch(engine === "chromium" && process.env.READING_ROOM_CHROME ? { executablePath: process.env.READING_ROOM_CHROME } : {});
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, serviceWorkers: "block" });
  const book = await shrunkBook();
  await page.route("**/catalog.json", r => r.fulfill({ json: [{ id: "shrunk", title: "Shrunk", author: "Home Books", format: "EPUB", source: "Local", collections: [], category: "Fiction", path: "x", workKey: "shrunk|home books", incomplete: false, series: "" }] }));
  await page.route("**/api/library-state", r => r.fulfill({ json: { states: [] } }));
  await page.route("**/api/book/**", r => r.fulfill({ contentType: "application/epub+zip", body: book }));
  await page.addInitScript(() => localStorage.setItem("reading-room-font-size", "160"));
  await page.goto(preview.url);
  await page.locator('.rr-library-dock button[data-view="Library"]').click().catch(() => {});
  await page.locator(".book .cover").first().click();
  await page.locator(".epub-viewer iframe").first().waitFor();
  const measure = () => page.evaluate(() => {
    const doc = document.querySelector(".epub-viewer iframe").contentDocument;
    const fs = (el) => parseFloat(doc.defaultView.getComputedStyle(el).fontSize);
    const p = doc.querySelector("#p3");
    if (!p) return null;
    return { para: fs(p), tiny: fs(p.querySelector(".tiny")), note: fs(p.querySelector(".note")), sm: fs(p.querySelector(".sm")), sup: fs(p.querySelector("sup")) };
  });
  let m = null;
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); m = await measure(); if (m && m.tiny > m.para * 0.9) break; }
  assert.ok(m, "paragraph rendered");
  assert.ok(m.para >= 24, `paragraph follows 160%: ${m.para}`);
  assert.ok(m.tiny >= m.para * 0.95, `shrunk text restored: ${m.tiny} vs ${m.para}`);
  assert.ok(m.note < m.para * 0.8, `superscript note stays small: ${m.note}`);
  assert.ok(m.sup < m.para * 0.9, `sup stays small: ${m.sup}`);
  assert.ok(m.sm >= m.para * 0.7, `ordinary 0.8em text is untouched: ${m.sm}`);
});
