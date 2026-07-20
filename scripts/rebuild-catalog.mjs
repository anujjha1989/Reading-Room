import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const inputs = [
  "books.json",
  "books-old-1.json",
  "books-old-2.json",
  "books-old-3.json",
  "books-new-scripts.json",
];

const favoriteAuthors = new Set([
  "Alice Munro", "Amitav Ghosh", "Anne Tyler", "Ayn Rand", "Carlos Castaneda",
  "Carolyn Keene (Nancy Drew)", "Christopher Hitchens", "Cormac McCarthy",
  "D.H. Lawrence", "Danielle Steel", "David Baldacci", "David Foster Wallace",
  "Dean Koontz", "Don DeLillo", "Doris Lessing", "E.L. Doctorow", "Ellery Queen",
  "Ellis Peters", "Elmore Leonard", "Ernest Hemingway", "F. Scott Fitzgerald",
  "Gabriel Garcia Marquez", "George Bernard Shaw", "George Pelecanos",
  "Hans Christian Andersen", "Haruki Murakami", "Henry James", "Ian McEwan",
  "J.K. Rowling", "James Patterson", "Jane Smiley", "Jeffrey Archer", "Jhumpa Lahiri",
  "Jo Nesbo", "Joan Didion", "John D. MacDonald", "John Grisham", "John Steinbeck",
  "Joseph Conrad", "Julian Barnes", "Ken Follett", "Kenzaburo Oe", "Kurt Vonnegut",
  "Malcolm Gladwell", "Marcel Proust", "Margaret Atwood", "Mario Vargas Llosa",
  "Maya Angelou", "Michael Crichton", "Nadine Gordimer", "Norman Mailer", "Peter Carey",
  "Philip Roth", "R.K. Narayan", "Rabindranath Tagore", "Raymond Chandler",
  "Richard Matheson", "Roald Dahl", "Salman Rushdie", "Stephen King", "Terry Pratchett",
  "Tom Clancy", "Toni Morrison", "V.S. Naipaul", "Virginia Woolf", "Vladimir Nabokov",
  "Will Durant", "William Faulkner", "William Trevor", "Winston Churchill",
]);

const deletedIds = new Set([
  "1J-jhB8d77iojTEr5Hd8lRZPvvnRYldjb",
  "1HTq9sRmWBOEuByXzNCouUpQZV_dffhAS",
  "1wcX8Ozf1fmnhZvcfd3hnygPP8s65k7vN",
  "1qtPVCiN0kyECcPpj16QurMwxaUa5J_GJ",
  "1dnNuYt4aOY-6bQT4hbfhv0V43tZi2CJv",
  "1ZWaqPq_J3_kW4De57mYQ90pPDKzrkG0V",
]);

const genericAuthors = new Set(["", "Writing", "Extra", "Poems", "Novels", "Books"]);

function cleanAuthor(value = "") {
  const cleaned = value.replace(/[-–—]\s*\d+\s*Books?$/i, "").trim();
  return genericAuthors.has(cleaned) ? "" : cleaned;
}

function authorFromPath(row) {
  const parts = (row.path || "").split("/");
  const index = parts.findIndex((part) => /^(authors?|favorite authors)$/i.test(part));
  return index >= 0 ? cleanAuthor(parts[index + 1] || "") : "";
}

function normalize(value = "") {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\.(epub|mobi|pdf|docx?|rtf|txt|fdx)$/i, "")
    .replace(/\b(retail|converted|fixed|copy|ebook)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanCollection(value = "", row) {
  const haystack = `${value} ${row.path || ""}`;
  if (/scripts?/i.test(`${row.source} ${haystack}`)) {
    if (/black list|2019/i.test(`${row.title} ${haystack}`)) return "Black List 2019";
    if (/television|\btv\b/i.test(haystack)) return "Television Scripts";
    if (/plays?|theatre|theater/i.test(haystack)) return "Plays";
    return "Film Scripts";
  }
  if (/^authors?$/i.test(value)) {
    const author = cleanAuthor(row.author) || authorFromPath(row);
    return favoriteAuthors.has(author) ? "Favorite Authors" : "";
  }
  if (/^read$/i.test(value)) return "Graphic Novel Collections";
  if (/pulizer|pulitzer/i.test(value)) {
    if (/biograph/i.test(value)) return "Pulitzer Prize — Biography";
    if (/history/i.test(value)) return "Pulitzer Prize — History";
    if (/non.?fiction/i.test(value)) return "Pulitzer Prize — General Non-Fiction";
    return "Pulitzer Prize — Fiction";
  }
  if (/booker/i.test(value)) return "Booker Prize";
  if (/bky must|before you die/i.test(value)) return "Books to Read Before You Die";
  if (/50 books to read/i.test(value)) return "50 Books to Read Before 50";
  if (/reddit.?s favorite/i.test(value)) return "Reddit’s Favorite Books";
  if (/^#?complete works/i.test(value)) return "Complete Works";
  if (/autobiography/i.test(value)) return "Autobiography Collection";
  if (/history book collection/i.test(value)) return "History Collection";
  if (/self improvement/i.test(value)) return "Self-Improvement Collection";
  if (/science collection/i.test(value)) return "Science Collection";
  if (/true crime/i.test(value)) return "True Crime Collection";
  if (/travel collection/i.test(value)) return "Travel Collection";
  if (/technical books/i.test(value)) return "Technical Books";
  if (/top 100 science fiction/i.test(value)) return "Top 100 Science Fiction & Fantasy";
  if (/top 10.*fiction/i.test(value)) return "Top Fiction by Year (1990–2010)";
  if (/the new classics/i.test(value)) return "The New Classics";
  if (/short stories/i.test(value)) return "Short Stories";
  if (/world classics/i.test(value)) return "World Classics";
  if (/classics/i.test(value)) return "Classics";
  if (/^(old|new|new arrivals|misc books|miscellaneous|ent books|#?kindle collection)$/i.test(value)) return "";
  return value.trim();
}

function categoryFor(row, collections) {
  const haystack = `${row.category || ""} ${row.collection || ""} ${row.path || ""} ${row.source || ""}`;
  if (/scripts?|screenplay|black list/i.test(haystack)) return "Script";
  if (/graphic novel|comic|calvin and hobbes|bheriya/i.test(haystack)) return "Graphic Novel";
  if (/poetry|poems?/i.test(row.category || "")) return "Poetry";
  if (/drama/i.test(row.category || "")) return "Drama";
  if (/non.?fiction/i.test(row.category || "")) return "Non-Fiction";
  if (/fiction/i.test(row.category || "")) return "Fiction";
  const joined = collections.join(" ");
  if (/autobiography|history|science|true crime|self-improvement|travel|technical|biography|non-fiction/i.test(joined)) return "Non-Fiction";
  if (/booker|pulitzer prize — fiction|classics|short stories|fiction|books to read/i.test(joined)) return "Fiction";
  return "General";
}

function displayPath(row) {
  const collection = row.collections[0];
  if (row.category === "Script") return `Scripts / ${collection || "Film Scripts"}`;
  if (collection === "Favorite Authors") return `Books / Favorite Authors${row.author ? ` / ${row.author}` : ""}`;
  if (collection === "Technical Books") return "Books / Technical Books";
  if (row.category === "Graphic Novel") return `Books / Graphic Novels${collection ? ` / ${collection}` : ""}`;
  if (collection) return `Books / Collections / ${collection}`;
  return `Books / ${row.category || "General"}`;
}

const rows = inputs.flatMap((name) => JSON.parse(fs.readFileSync(path.join(root, "app", name), "utf8")));
const byId = new Map();

for (const row of rows) {
  if (deletedIds.has(row.id)) continue;
  const pathAuthor = authorFromPath(row);
  const author = cleanAuthor(row.author) || pathAuthor;
  const collection = cleanCollection(row.collection || "", { ...row, author });
  const current = byId.get(row.id);
  if (!current) {
    byId.set(row.id, {
      ...row,
      author,
      source: /scripts?/i.test(`${row.source} ${row.path}`) ? "Scripts" : "Books",
      path: row.path || row.source,
      collections: collection ? [collection] : [],
    });
  } else {
    if (!current.author && author) current.author = author;
    if (collection && !current.collections.includes(collection)) current.collections.push(collection);
    if ((row.path || "").length > (current.path || "").length) current.path = row.path;
  }
}

let catalog = [...byId.values()];
const epubKeys = new Set(catalog.filter((row) => row.format === "EPUB").map((row) => `${normalize(row.title)}|${normalize(row.author)}`));
catalog = catalog.filter((row) => row.format !== "MOBI" || !epubKeys.has(`${normalize(row.title)}|${normalize(row.author)}`));

const collectionCounts = new Map();
for (const row of catalog) for (const collection of row.collections) collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + 1);
for (const row of catalog) {
  row.collections = row.collections.filter((collection) => (collectionCounts.get(collection) || 0) >= 3 || /scripts|plays/i.test(collection)).sort();
  row.collection = row.collections[0] || "";
  row.category = categoryFor(row, row.collections);
  row.path = displayPath(row);
  row.workKey = `${normalize(row.title)}|${normalize(row.author)}`;
}

catalog.sort((a, b) => a.title.localeCompare(b.title) || a.format.localeCompare(b.format));
const output = catalog.map((row) => ({
  id: row.id,
  title: row.title,
  author: row.author,
  workKey: row.workKey,
  format: row.format,
  source: row.source,
  collections: row.collections,
  category: row.category,
  path: row.path,
  url: row.url,
}));
fs.writeFileSync(path.join(root, "public", "catalog.json"), `${JSON.stringify(output)}\n`);

const summary = catalog.reduce((acc, row) => {
  acc.formats[row.format] = (acc.formats[row.format] || 0) + 1;
  acc.categories[row.category] = (acc.categories[row.category] || 0) + 1;
  return acc;
}, { rows: catalog.length, formats: {}, categories: {} });
console.log(JSON.stringify(summary, null, 2));
