import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const inputs = [
  "books.json",
  "books-old-1.json",
  "books-old-2.json",
  "books-old-3.json",
  "books-new-scripts.json",
  "graphic-novels-comics.json",
  "books-imported-2026-07-22.json",
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

const genericAuthors = new Set([
  "", "Writing", "Extra", "Poems", "Novels", "Books", "Indian", "Funny", "Fantasy",
  "World Classics Novels", "Some books for your Kindle", "The Reading Room",
]);

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
    .toLowerCase().replace(/\.(epub|mobi|pdf|cbr|cbz|docx?|rtf|txt|fdx)$/i, "")
    .replace(/\b(retail|converted|fixed|copy|ebook)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function tidy(value = "") {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_]+/g, " ")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWords(value = "") {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function looksLikePerson(value = "") {
  const cleaned = tidy(value).replace(/[.,]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  if (/\b(a|an|the|of|and|in|for|from|with|novel|book|story|guide|complete|volume|edition|press|publisher|writer)\b/i.test(cleaned)) return false;
  if (/\d|['’]s\b/i.test(cleaned)) return false;
  return words.filter((word) => /^[A-Z][A-Za-z'-]*$/.test(word) || /^[A-Z]\.?$/.test(word)).length >= Math.ceil(words.length * .65);
}

function cleanSeries(value = "") {
  return tidy(value)
    .replace(/\b(?:series|collection)\b/ig, "")
    .replace(/\s*[-–—:]?\s*(?:book|vol(?:ume)?)?\s*#?\d+(?:\.\d+)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayMetadata(row, rawAuthor = "", collections = []) {
  let title = tidy(row.title || row.originalTitle || "Untitled")
    .replace(/\.(epub|mobi|pdf|cbr|cbz|docx?|rtf|txt|fdx)$/i, "")
    .replace(/\s*\((?:v?\d+(?:\.\d+)?|retail|converted|fixed|copy)\)\s*$/i, "")
    .replace(/\s*\((?:BookZZ|Z-Library|eBookBB)[^)]*\)?\s*$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
  let author = tidy(cleanAuthor(rawAuthor));
  let series = "";
  let seriesPosition = "";
  let incomplete = false;

  const historyVolume = title.match(/^\(A History of the English-Speaking Peoples\s+(One|Two|Thr|Fou)/i);
  if (historyVolume) {
    const volume = { one: "One", two: "Two", thr: "Three", fou: "Four" }[historyVolume[1].toLowerCase()];
    title = `A History of the English-Speaking Peoples: Volume ${volume}`;
    author = "Winston S. Churchill";
    series = "A History of the English-Speaking Peoples";
  }
  if (/^\[[^\]]*\d+[^\]]*\]$/.test(author)) {
    const position = author.match(/(\d+(?:\.\d+)?)\s*\]?$/);
    series = cleanSeries(author.replace(/^\[|\]$/g, ""));
    seriesPosition = position?.[1] || "";
    author = "";
  }

  const leadingSquare = title.match(/^\[([^\]]+)\]\s*-?\s*(.+)$/);
  if (leadingSquare) {
    const label = tidy(leadingSquare[1]);
    title = leadingSquare[2].trim();
    if (!/\.(?:com|net|org)\b|free\s*course|ebook/i.test(label)) {
      if (/series|trilogy|saga|cycle|chronicles|mysteries|howdunit|forgotten realms|hackberry/i.test(label)) series = cleanSeries(label);
      else if (!author && looksLikePerson(label)) author = label;
    }
  }

  const leadingRound = title.match(/^\(([^()]+)\)\s*-?\s*(.+)$/);
  if (leadingRound && !/^(?:ruslib|ebook|retail)$/i.test(leadingRound[1].trim())) {
    series = cleanSeries(leadingRound[1]);
    title = leadingRound[2].trim();
  } else {
    title = title.replace(/^\((?:ruslib|ebook|retail)\)\s*/i, "");
    author = author.replace(/^\((?:ruslib|ebook|retail)\)\s*/i, "");
  }

  const structuredSeries = title.match(/^(.+?)\s*[-–—]\s*\[([^\]]*\d+[^\]]*)\]\s*[-–—]\s*(.+)$/);
  if (structuredSeries && looksLikePerson(structuredSeries[1])) {
    author = tidy(structuredSeries[1]);
    const position = structuredSeries[2].match(/(\d+(?:\.\d+)?)\s*$/);
    series = cleanSeries(structuredSeries[2]);
    seriesPosition = position?.[1] || "";
    title = tidy(structuredSeries[3]);
  }

  const inlineSeries = title.match(/\[([^\]]*(?:series|trilogy|saga|cycle|chronicles|mysteries|forgotten realms|hackberry|corfu)[^\]]*)\]/i);
  if (inlineSeries) {
    const position = inlineSeries[1].match(/(?:book|vol(?:ume)?)?\s*#?(\d+)\s*$/i);
    series ||= cleanSeries(inlineSeries[1]);
    seriesPosition ||= position?.[1] || "";
    title = title.replace(inlineSeries[0], " ").replace(/\s*[-–—]\s*[-–—]\s*/g, " - ").trim();
  }

  const leadingNumber = title.match(/^(#?)(\d{1,4})\s*[.:-]\s*(.+)$/);
  if (leadingNumber) {
    const value = Number(leadingNumber[2]);
    const isYear = value >= 1800 && value <= 2099;
    if (!isYear) seriesPosition = leadingNumber[2];
    title = leadingNumber[3].trim();
  } else {
    const hashNumber = title.match(/^#(\d+)\s+(.+)$/);
    if (hashNumber) {
      seriesPosition = hashNumber[1];
      title = hashNumber[2].trim();
    }
  }

  const byline = title.match(/^(.+?)\s+by\s+([^–—-]{3,80})$/i);
  const bylineAuthor = byline?.[2].replace(/\s*\([^)]*$/, "").trim() || "";
  const bylineSeries = byline?.[2].match(/\(([^)]*)\)?$/)?.[1] || "";
  if (byline && looksLikePerson(bylineAuthor)) {
    title = byline[1].trim();
    author = tidy(bylineAuthor);
    if (bylineSeries) series ||= cleanSeries(bylineSeries);
  }

  let parts = title.split(/\s+[-–—]\s+/).map(tidy).filter(Boolean);
  if (parts.length > 1) {
    if (/^(?:18|19|20)\d{2}$/.test(parts[0])) parts = parts.slice(1);
    const first = parts[0] || "";
    const last = parts.at(-1) || "";
    const authorKey = normalize(author);
    const numberedAuthor = first.match(/^\d{1,2}\s+(.+)$/);
    if (numberedAuthor && looksLikePerson(numberedAuthor[1])) {
      author = numberedAuthor[1];
      title = parts.slice(1).join(" — ");
    } else if (/^[^,]{2,30},\s*[^,]{2,30}$/.test(first) && looksLikePerson(first)) {
      author = first;
      title = parts.slice(1).join(" — ");
    } else if (collections.some((item) => /books to read/i.test(item)) && looksLikePerson(last)) {
      author = last;
      title = parts.slice(0, -1).join(" — ");
    } else if (authorKey && normalize(first) === authorKey) {
      if (parts.length === 2 && looksLikePerson(last) && !looksLikePerson(first)) {
        author = last;
        title = first;
      } else title = parts.slice(1).join(" — ");
    } else if (authorKey && (normalize(last) === authorKey || (normalize(last).length > 7 && authorKey.startsWith(normalize(last))))) {
      title = parts.slice(0, -1).join(" — ");
    } else if ((!author || genericAuthors.has(author)) && looksLikePerson(last)) {
      author = last;
      title = parts.slice(0, -1).join(" — ");
    } else if (parts.length >= 3 && looksLikePerson(last)) {
      author = last;
      title = parts.slice(0, -1).join(" — ");
    }
  }

  const tightByline = title.match(/^([A-Z][A-Za-z.,' ]{2,44}[A-Za-z.])-(?!-)(.+)$/);
  if (!author && tightByline && looksLikePerson(tightByline[1])) {
    author = tidy(tightByline[1]);
    title = tidy(tightByline[2]);
  }

  const postSeries = title.match(/^\[([^\]]+)\]\s*[—-]\s*(.+)$/);
  if (postSeries) {
    const position = postSeries[1].match(/(?:book|vol(?:ume)?)?\s*#?(\d+)\s*$/i);
    series ||= cleanSeries(postSeries[1]);
    seriesPosition ||= position?.[1] || "";
    title = postSeries[2].trim();
  }

  const namedSeries = title.match(/^([A-Z][A-Za-z' ]{2,32})\s+(\d{1,3})\s*[—-]\s*(.+)$/);
  if (namedSeries) {
    series ||= namedSeries[1].trim();
    seriesPosition ||= namedSeries[2];
    title = namedSeries[3].trim();
  }

  const finalParts = title.split(/\s+[-–—]\s+/).map(tidy).filter(Boolean);
  if (author && finalParts.length > 1) {
    const authorKey = normalize(author);
    if (normalize(finalParts[0]) === authorKey) title = finalParts.slice(1).join(" — ");
    else if (normalize(finalParts.at(-1) || "") === authorKey) title = finalParts.slice(0, -1).join(" — ");
  }

  const lateNumber = title.match(/^\d{1,2}\s*[—–-]?\s+(.+)$/);
  if (lateNumber) title = lateNumber[1].trim();

  const isbnPrefix = title.match(/^\d{10,13}[Xx]?\s*(.+)$/);
  if (isbnPrefix) title = isbnPrefix[1].trim();

  if (author) {
    const authorSeries = author.match(/^(.+?)\s*\(([^)]*)\)?$/);
    if (authorSeries && looksLikePerson(authorSeries[1])) {
      author = authorSeries[1].trim();
      series ||= cleanSeries(authorSeries[2]);
    }
  }

  if (author && normalize(title) === normalize(author)) author = "";
  title = tidy(title)
    .replace(/^[-–—:]+|[-–—:]+$/g, "")
    .replace(/\s*\((?:\d{4},?\s*)?(?:Penguin|Random House|Harper|Vintage|Arrow|Oxford|Cambridge|G\. P\.|Simon & Schuster)[^)]*\)?\s*$/i, "")
    .replace(/\s*\(?\b(?:Book\s*ZZ|Z-Library|eBookBB)\b.*$/i, "")
    .trim();

  if (/^\d+$/.test(title) && series) title = `Volume ${Number(title)}`;

  if (/^\[/.test(title)) {
    const label = title.replace(/^\[/, "").replace(/\]$/, "").trim();
    const position = label.match(/(?:^|\s)(\d{1,3})\s*$/)?.[1] || "";
    series ||= cleanSeries(label);
    seriesPosition ||= position;
    title = position ? `Book ${Number(position)}` : "Collection volume";
    incomplete = true;
  }

  if (!series && seriesPosition) {
    const candidate = collections.find((item) => !/favorite authors|prize|books to read|classics|complete works/i.test(item));
    if (candidate && /series|trilogy|saga|cycle|mysteries/i.test(candidate)) series = cleanSeries(candidate);
  }
  if (series && seriesPosition && !incomplete) series = `${series} · Book ${seriesPosition}`;
  else if (!series && seriesPosition && row.category === "Script") series = `Script ${seriesPosition}`;

  return {
    title: title || tidy(row.title) || "Untitled",
    author: tidy(author),
    series: titleCaseWords(series),
    incomplete,
  };
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
  const joined = collections.join(" ");
  if (/scripts?|screenplay|black list/i.test(haystack)) return "Script";
  if (/graphic novel|comic|calvin and hobbes|bheriya/i.test(haystack)) return "Graphic Novel";
  if (/poetry|poems?/i.test(row.category || "")) return "Poetry";
  if (/drama/i.test(row.category || "")) return "Drama";
  if (/top 100 science fiction|science fiction|fiction & fantasy/i.test(joined)) return "Fiction";
  if (/non.?fiction/i.test(row.category || "")) return "Non-Fiction";
  if (/fiction/i.test(row.category || "")) return "Fiction";
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
      collections: /^(?:CBR|CBZ)$/i.test(row.format)
        ? [...new Set([collection, "Graphic Novel Collections"].filter(Boolean))]
        : collection ? [collection] : [],
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
  const metadata = displayMetadata(row, row.author, row.collections);
  if (/^(?:CBR|CBZ)$/i.test(row.format) && !metadata.series) {
    metadata.series = row.collections.find((item) => item !== "Graphic Novel Collections") || "";
  }
  row.title = metadata.title;
  row.author = metadata.author;
  row.series = metadata.series;
  row.incomplete = metadata.incomplete;
  row.path = displayPath(row);
  row.workKey = metadata.incomplete
    ? `${normalize(row.title)}|${normalize(row.author)}|${row.id}`
    : /^(?:CBR|CBZ)$/i.test(row.format)
      ? `${normalize(row.title)}|${normalize(row.author)}|${normalize(row.series)}`
      : `${normalize(row.title)}|${normalize(row.author)}`;
}

catalog.sort((a, b) => a.title.localeCompare(b.title) || a.format.localeCompare(b.format));
const output = catalog.map((row) => ({
  id: row.id,
  title: row.title,
  author: row.author,
  series: row.series,
  incomplete: row.incomplete,
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
