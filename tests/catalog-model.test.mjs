import test from "node:test";
import assert from "node:assert/strict";
import { groupBooks, metadataFor, prepareCatalog } from "../app/catalogModel.ts";
const row = (extra = {}) => ({ id: "local-book", title: "A Book", author: "An Author", format: "EPUB", source: "Local", url: "/api/book/local-book", ...extra });
test("catalogue preprocessing preserves IDs, copies, formats and explicit corrections", () => {
  const rows = [row({ title: "A Game of Thrones", titleCorrected: true, authorCorrected: true }), row({ id: "local-mobi", title: "A Game of Thrones", format: "MOBI", titleCorrected: true, authorCorrected: true })];
  const [book] = groupBooks(rows);
  assert.equal(book.id, "local-book"); assert.equal(book.title, "A Game of Thrones");
  assert.deepEqual(book.copies.map(copy => copy.id), ["local-book", "local-mobi"]);
  assert.deepEqual(book.formats, ["EPUB", "MOBI"]);
  assert.equal(prepareCatalog(rows)[0].id, book.id);
});
test("clearly reversed scan fields are repaired without rewriting corrections", () => {
  const reversed = row({ title: "Arthur C Clarke", author: "Cradle (Arthur C Clarke Collection)" });
  assert.deepEqual(metadataFor(reversed), { title: "Cradle (Arthur C Clarke Collection)", author: "Arthur C Clarke", category: "General", series: "" });
  const corrected = metadataFor({ ...reversed, titleCorrected: true, authorCorrected: true });
  assert.equal(corrected.title, reversed.title); assert.equal(corrected.author, reversed.author);
});
test("reference-library identity remains separate from the main library", () => {
  const books = prepareCatalog([row({ id: "ref-local", title: "Research Paper", author: "" })]);
  assert.equal(books[0].id, "ref-local");
});
