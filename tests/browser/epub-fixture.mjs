import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// epub.js already owns this zip dependency; no extra production dependency.
const Zip = createRequire(require.resolve("epubjs/package.json"))("jszip");
export async function encodedContentsEpub() {
  const zip = new Zip();
  zip.file("mimetype", "application/epub+zip", {compression:"STORE"});
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const entries = [["start.xhtml", "The Pickwick Papers"], ["CR!history.xhtml", "A Child’s History of England"], ["Café book.xhtml", "Another work"]];
  zip.file("book.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">encoded-contents</dc:identifier><dc:title>Encoded collection</dc:title><dc:language>en</dc:language></metadata><manifest><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${entries.map(([href],i)=>`<item id="c${i}" href="${href}" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine toc="toc">${entries.map((_,i)=>`<itemref idref="c${i}"/>`).join("")}</spine></package>`);
  zip.file("toc.ncx", `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Encoded collection</text></docTitle><navMap>${entries.map(([href,title],i)=>`<navPoint id="n${i}" playOrder="${i+1}"><navLabel><text>${title}</text></navLabel><content src="${encodeURIComponent(href).replace(/!/g,"%21")}#begin"/></navPoint>`).join("")}</navMap></ncx>`);
  for (const [href,title] of entries) zip.file(href, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1 id="begin">${title}</h1>${Array.from({length:24},(_,i)=>`<p>${title}: paragraph ${i+1} remains readable after choosing this work from the contents.</p>`).join("")}</body></html>`);
  return zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"});
}
export async function narrationEpub({ emptyMiddle = false, imageOnlyFirst = false, chapterCount = 3, paragraphCount = 18, stretchCover = false } = {}) {
  const zip = new Zip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const chapters = Array.from({ length: chapterCount }, (_, i) => i + 1);
  zip.file("OEBPS/book.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">home-books-regression</dc:identifier><dc:title>Narration fixture</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-04T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map(n => `<item id="c${n}" href="chapter${n}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map(n => `<itemref idref="c${n}"/>`).join("")}</spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map(n => `<li><a href="chapter${n}.xhtml">Chapter ${n}</a></li>`).join("")}</ol></nav></body></html>`);
  for (const n of chapters) zip.file(`OEBPS/chapter${n}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head><body>${stretchCover && n === 1 ? '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 300 600" preserveAspectRatio="none"><image width="300" height="600" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22600%22%3E%3Crect width=%22300%22 height=%22600%22 fill=%22green%22/%3E%3C/svg%3E"/></svg>' : ''}${imageOnlyFirst && n === 1 ? '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><rect width="300" height="600" fill="#26465a"/></svg>' : emptyMiddle && n === 2 ? '<nav>Contents furniture only</nav>' : `<h1>Chapter ${n}</h1>${Array.from({ length: paragraphCount }, (_, i) => `<p>Chapter ${n} sentence ${i + 1} describes a peaceful morning beside the old house.</p>`).join("")}`}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
