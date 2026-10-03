import assert from "node:assert/strict";
import test from "node:test";
import { cardTitle, reviewBooks } from "../app/homeShelves.ts";

test("saved metadata outranks folder inference and shelf labels", () => {
  const raw = { id: "same-book", title: "A Game of Thrones", titleCorrected: true,
    author: "George R. R. Martin", authorCorrected: true,
    path: "Books / 5. A Song of Ice and Fire Series by George R.R. Ma" };
  const book = { ...raw, formats: ["EPUB"], collections: [], searchText: "", rrShelfLabel: "A Song of Ice and Fire" };
  const [reviewed] = reviewBooks([book], [raw]);
  assert.equal(reviewed.title, raw.title);
  assert.equal(reviewed.author, raw.author);
  assert.equal(cardTitle(reviewed), raw.title);
  assert.equal(reviewed.id, raw.id);
  assert.equal(cardTitle(reviewBooks([book], [raw])[0]), raw.title, "Reloaded catalogue preserves corrections");
});

test("uncorrected metadata still uses folder inference", () => {
  const book = { id: "untouched", title: "Scanned title", author: "", path: "Books / Novel by Author Name",
    formats: ["EPUB"], collections: [], searchText: "" };
  assert.equal(reviewBooks([book], [book])[0].title, "Novel");
});
