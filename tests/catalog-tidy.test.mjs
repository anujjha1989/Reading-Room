import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The tidy function lives inside the dependency-free server file (the Pi's
// installer only copies a fixed list of server files), so load it by markers.
const source = readFileSync(new URL("../server/standalone-server.mjs", import.meta.url), "utf8");
const block = source.split("// <catalog-tidy>")[1].split("// </catalog-tidy>")[0];
const tidyCatalog = new Function(`${block}; return tidyCatalog;`)();

const row = (over) => ({ id: over.id, title: "T", author: "A", series: "", incomplete: false, format: "EPUB",
  source: "Books", collections: [], category: "Fiction", path: "Books / Books / Fiction", workKey: "", ...over });
const key = (b) => `${b.title.toLowerCase()}|${b.author.toLowerCase()}`;

test("screenplays imported under Books remain Scripts after category cleanup", () => {
  for (const title of ["The Great Gatsby: First Draft Screenplay", "Never Let Me Go The Screenplay", "Lincoln the Screenplay", "Hamlet A Screenplay Adaptation", "The White Witch Script", "The Walking Dead - Script Book 01"]) {
    assert.equal(tidyCatalog([row({id:title,title,category:"Non-Fiction"})]).rows[0].category,"Script",title);
  }
  assert.equal(tidyCatalog([row({id:"fdx",title:"Untitled Film",format:"FDX"})]).rows[0].category,"Script");
});

test("screenwriting instruction and unrelated manuscript titles are not screenplays", () => {
  for (const title of ["Screenplay", "Four Screenplays", "The Art of Plotting Add Emotion, Suspense, and Depth to Your Screenplay", "Good Scripts, Bad Scripts Learning the Craft of Screenwriting", "The Chancellor Manuscript"]) {
    assert.equal(tidyCatalog([row({id:title,title,category:"Non-Fiction"})]).rows[0].category,"Non-Fiction",title);
  }
});

test("a book saved twice is shown once and keeps every collection", () => {
  const a = row({ id: "a", title: "Life of Pi", author: "Yann Martel", format: "MOBI", collections: ["Booker Prize"] });
  const b = row({ id: "b", title: "Life of Pi", author: "Yann Martel", format: "EPUB", collections: ["Reading Lists"] });
  a.workKey = b.workKey = key(a);
  const { rows } = tidyCatalog([a, b]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "b");
  assert.deepEqual([...rows[0].collections].sort(), ["Booker Prize", "Reading Lists"]);
});

test("a copy whose author came from the folder is still matched to the full copy", () => {
  const a = row({ id: "a", title: "1Q84", author: "Haruki Murakami", incomplete: true, workKey: "1q84||1Q84.epub ", collections: ["Favorite Authors"] });
  const b = row({ id: "b", title: "1Q84", author: "Haruki Murakami", workKey: "1q84|haruki murakami" });
  assert.equal(tidyCatalog([a, b]).rows.length, 1);
});

test("text books inside a Graphic Novels folder are not graphic novels", () => {
  const novel = row({ id: "n", title: "Exile", author: "R. A. Salvatore", format: "EPUB", category: "Graphic Novel",
    collections: ["Graphic Novels", "[HaWk] kindle ebooks", "Top 100 Science Fiction"], path: "Books / Graphic Novels / [HaWk] kindle ebooks / Top 100 Science Fiction" });
  const out = tidyCatalog([novel]).rows[0];
  assert.notEqual(out.category, "Graphic Novel");
  assert.ok(!out.collections.includes("Graphic Novels"));
});

test("comics stay graphic novels, including archives filed elsewhere and known series", () => {
  const cbr = row({ id: "c", title: "Absolute Watchmen", format: "CBR", category: "Fiction", workKey: "absolute watchmen||" });
  const sin = row({ id: "s", title: "The Hard Goodbye", format: "PDF", category: "Graphic Novel", path: "Books / Graphic Novels / Collections / Sin City" });
  const habibi = row({ id: "h", title: "Habibi", format: "MOBI", category: "Graphic Novel", path: "Books / Graphic Novels" });
  for (const b of tidyCatalog([cbr, sin, habibi]).rows) assert.equal(b.category, "Graphic Novel", b.title);
});

test("author and title swapped by an Author - Title file name are put right", () => {
  const rows = [...Array(5)].map((_, i) => row({ id: `d${i}`, title: "Dean Koontz", author: `Book ${i}`, path: "Books / Books / Favorite Authors / Dean Koontz" }));
  const out = tidyCatalog(rows).rows;
  assert.equal(out[0].author, "Dean Koontz");
  assert.equal(out[0].title, "Book 0");
});

test("an author field holding Title (Author) is split", () => {
  const out = tidyCatalog([row({ id: "e", title: "Episode 5", author: "The Empire Strikes Back (Donald Glut)" })]).rows[0];
  assert.equal(out.author, "Donald Glut");
  assert.match(out.title, /Empire Strikes Back/);
});

test("a title ending in 'by Name' with no author gets the author", () => {
  const out = tidyCatalog([row({ id: "l", title: "Collected Short Stories by D H Lawrence", author: "", incomplete: true, format: "TXT" })]).rows[0];
  assert.equal(out.author, "D H Lawrence");
  assert.equal(out.title, "Collected Short Stories");
});
