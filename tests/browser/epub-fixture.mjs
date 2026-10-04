import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// epub.js already owns this zip dependency; no extra production dependency.
const Zip = createRequire(require.resolve("epubjs/package.json"))("jszip");
export async function narrationEpub({ emptyMiddle = false } = {}) {
  const zip = new Zip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const chapters = [1, 2, 3];
  zip.file("OEBPS/book.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">home-books-regression</dc:identifier><dc:title>Narration fixture</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-04T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map(n => `<item id="c${n}" href="chapter${n}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map(n => `<itemref idref="c${n}"/>`).join("")}</spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map(n => `<li><a href="chapter${n}.xhtml">Chapter ${n}</a></li>`).join("")}</ol></nav></body></html>`);
  for (const n of chapters) zip.file(`OEBPS/chapter${n}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head><body>${emptyMiddle && n === 2 ? '<nav>Contents furniture only</nav>' : `<h1>Chapter ${n}</h1>${Array.from({ length: 18 }, (_, i) => `<p>Chapter ${n} sentence ${i + 1} describes a peaceful morning beside the old house.</p>`).join("")}`}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
