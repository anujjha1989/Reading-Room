import test from "node:test";
import assert from "node:assert/strict";
import { loadReaderToc, resolveReaderTocHref } from "../app/readerToc.ts";

const bookWith = (...hrefs) => ({ spine: { get: href => hrefs.includes(href) ? {href, index: hrefs.indexOf(href)} : null } });
test("contents resolves percent-encoded Dickens filenames to their manifest entry", () => {
  const href = "CR!0J8674JGA1643FXD5HR56JAZBYVK_split_1509.html";
  const book = bookWith(href);
  assert.equal(resolveReaderTocHref(book, href.replace("!", "%21")), href);
  assert.equal(resolveReaderTocHref(book, href.replace("!", "%21") + "#chapter%201"), href + "#chapter%201");
  assert.equal(resolveReaderTocHref(book, href), href);
});
test("contents prefers an exact match and never double-decodes literal percent filenames", () => {
  const book = bookWith("Text/book%21.xhtml", "Text/book!.xhtml", "Text/book%2521.xhtml");
  for (const href of ["Text/book%21.xhtml", "Text/book!.xhtml", "Text/book%2521.xhtml"]) {
    assert.equal(resolveReaderTocHref(book, href + "#part"), href + "#part");
  }
});
test("contents handles spaces and Unicode without decoding fragment delimiters", () => {
  const book = bookWith("Text/Café book.xhtml");
  assert.equal(resolveReaderTocHref(book, "Text/Caf%C3%A9%20book.xhtml#part%23one"), "Text/Café book.xhtml#part%23one");
});
test("missing and malformed optional contents links remain harmless", () => {
  const book = bookWith("valid.xhtml");
  for (const href of ["missing.xhtml", "bad%xx.xhtml", "", "#fragment"]) assert.equal(resolveReaderTocHref(book, href), href);
});
test("both parent and nested contents links are resolved without mutating navigation", async () => {
  const book = bookWith("book!.xhtml", "chapter!.xhtml");
  const navigation = [{href:"book%21.xhtml", label:" Book ", subitems:[{href:"chapter%21.xhtml#start", label:" Chapter "}]}];
  const result = await loadReaderToc(book, navigation, "An ordinary book");
  assert.equal(result[0].href, "book!.xhtml");
  assert.equal(result[0].subitems[0].href, "chapter!.xhtml#start");
  assert.equal(result[0].subitems[0].label, "Chapter");
  assert.equal(navigation[0].href, "book%21.xhtml");
});
