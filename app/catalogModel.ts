import { reviewBooks, type ShelfBook } from "./homeShelves.ts";

export type RawBook = {
  id: string; title: string; originalTitle?: string; author?: string; series?: string; incomplete?: boolean; workKey?: string;
  titleCorrected?: boolean; authorCorrected?: boolean;
  format: string; source: string; collection?: string; category?: string; collections?: string[];
  path?: string; url: string; size?: number; modified?: string;
};

export type Copy = Pick<RawBook, "id" | "url" | "format" | "path" | "source">;
export type Book = RawBook & { copies: Copy[]; formats: string[]; collections: string[]; searchText: string; normalizedTitle: string; rrShelfLabel?: string; rrEditions?: Book[]; rrGroupTitle?: string; rrGroupAuthor?: string };

export const FORMAT_ORDER = ["EPUB", "PDF", "CBZ", "CBR", "MOBI", "FDX", "DOCX", "DOC", "RTF", "TXT"];

const TITLE_CORRECTIONS: Record<string, string> = {
  "1qe6m2GZIcBbAu_v-GETlYsVbsbgdMp6X": "The System of the World",
  "1Y1aEESMqlVsXwZMUr0Up2KCMfMwTqK0R": "The Emerald Atlas",
  "11XUTNAAeI_GTCeKfmu-jKchwrYkwbB6b": "The Coming of the Third Reich",
};

/** Reference Room ids carry this prefix (see the server's referenceCatalog). */
export const isReference = (id: string) => id.startsWith("ref-");

export function canReadHere(format: string, id = "") {
  // Reference Room files are private on Drive, so its documents can't use the
  // Drive previewer the Reading Room's Word files open in; they download instead.
  if (isReference(id)) return ["EPUB", "MOBI", "AZW", "AZW3", "KF8", "PDF", "CBR", "CBZ"].includes(format.toUpperCase());
  return ["EPUB", "MOBI", "AZW", "AZW3", "KF8", "PDF", "CBR", "CBZ", "DOC", "DOCX", "RTF", "TXT"].includes(format.toUpperCase());
}

export function cleanTitle(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\.(epub|mobi|pdf|cbr|cbz|docx?|rtf|txt|fdx)$/i, "")
    .replace(/^\s*\d{9,13}[xX]?\s*(?=[A-Za-z])/, "")
    .replace(/\s*[\[(]?(retail|converted|fixed|copy|ebook|nonlocal|team[- ]?dcp)[\])]?\s*/gi, " ")
    .replace(/\s*[\[(](?:v?\d+(?:\.\d+)?|\d+\s*(?:pages?|p))[\])]/gi, " ")
    .replace(/\s+[-–—]\s+(?:scan|digital|webrip|fiche).*$/i, "")
    .replace(/\s*\[(?:hipotter\d*|dcp|empire|minutemen|zone-empire)\]\s*/gi, " ")
    .replace(/\s*\((?:18|19|20)\d{2}\)\s*/g, " ")
    .replace(/\s*\(\s*\d+(?:\s+\d+)*\s*$/g, "")
    .replace(/\s*\(\s*v?\d*(?:\.\d*)?\s*$/i, "")
    .replace(/\s*[-–—]\s*by\s*$/i, "")
    .replace(/[._]+/g, " ").replace(/\s+/g, " ").replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
}

export function normalized(value: string) {
  return cleanTitle(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(the|a|an)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function looksLikePerson(value: string) {
  return !/^(the|a|an)\b/i.test(value) && !/\d/.test(value) && /^(?:[A-Z][\p{L}'-]*\.?\s+){1,4}[A-Z][\p{L}'-]*\.?$/u.test(value.trim());
}

export function metadataFor(row: RawBook) {
  const rawTitle = TITLE_CORRECTIONS[row.id] || row.title || row.originalTitle || "Untitled";
  let title = cleanTitle(rawTitle);
  let author = cleanTitle(row.author || "");
  // Recover clearly reversed scanned fields, but never override an explicit
  // correction. Parenthesised edition text is strong title evidence.
  if (!row.titleCorrected && !row.authorCorrected && looksLikePerson(title) && author && /[()]|^(?:The|A|An)\s/.test(author) && !looksLikePerson(author)) {
    [title, author] = [author, title];
  }
  if (!author) {
    const authorSuffix = title.match(/^(.*?)\s*[-–—]\s*([^–—-]+)$/);
    if (authorSuffix && looksLikePerson(authorSuffix[2])) {
      title = cleanTitle(authorSuffix[1]);
      author = cleanTitle(authorSuffix[2]);
    }
  }
  const parts = title.split(/\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && author) {
    const first = parts[0];
    const last = parts.at(-1)!;
    if (normalized(author) === normalized(first)) {
      if (looksLikePerson(last)) { title = first; author = last; }
      else title = cleanTitle(parts.slice(1).join(" — "));
    } else if (normalized(author) === normalized(last)) {
      title = cleanTitle(parts.slice(0, -1).join(" — "));
    }
  }
  if (author && normalized(title).startsWith(normalized(author)) && title.length > author.length + 4) {
    title = cleanTitle(title.slice(author.length).replace(/^\s*[-–—:,]\s*/, ""));
  }
  const category = /nonfiction/i.test(row.category || "") ? "Non-Fiction" : row.category || "General";
  const series = cleanTitle(row.series || "");
  return { title: row.titleCorrected ? row.title : title || "Untitled", author: row.authorCorrected ? row.author || "" : author, category, series };
}

function authorAliases(authors: string[]) {
  const aliases = new Map<string, string>();
  const unique = [...new Set(authors.filter(Boolean))];
  const keys = new Map(unique.map(author => [author, normalized(author)]));
  for (const author of unique) aliases.set(author, author);
  const byFirst = new Map<string, string[]>();
  for (const author of unique) {
    const first = keys.get(author)!.split(" ")[0];
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first)!.push(author);
  }
  for (const group of byFirst.values()) {
    if (group.length < 2) continue;
    for (const author of group) {
      const key = keys.get(author)!;
      const better = group.filter((candidate) => {
        const ck = keys.get(candidate)!;
        return ck.startsWith(key) && ck.length > key.length && ck.length - key.length <= 2;
      }).sort((a, b) => keys.get(b)!.length - keys.get(a)!.length)[0];
      if (better) aliases.set(author, better);
    }
  }
  return aliases;
}

export function groupBooks(rows: RawBook[]): Book[] {
  const grouped = new Map<string, Book>();
  const titleIndex = new Map<string, string>();
  const prepared = rows.map((row) => ({ row, metadata: metadataFor(row) }));
  const aliases = authorAliases(prepared.map(({ metadata }) => metadata.author));
  for (const { row, metadata: rawMetadata } of prepared) {
    const metadata = { ...rawMetadata, author: row.authorCorrected ? rawMetadata.author : aliases.get(rawMetadata.author) || rawMetadata.author };
    const isScript = /(^|\/)scripts?(\/|$)|screenplay|black list/i.test(`${row.source}/${row.path || ""}`);
    const isComic = /^(?:CBR|CBZ)$/i.test(row.format);
    const titleKey = normalized(metadata.title);
    const authorKey = normalized(metadata.author);
    const seriesKey = normalized(metadata.series || row.collection || "");
    const exactKey = `${titleKey}|${authorKey}|${isComic ? seriesKey : ""}`;
    const indexedKey = titleIndex.get(titleKey);
    const indexedBook = indexedKey ? grouped.get(indexedKey) : undefined;
    const key = !isComic && indexedKey && (!authorKey || !indexedBook?.author || normalized(indexedBook.author) === authorKey) ? indexedKey : exactKey;
    const copy: Copy = { id: row.id, url: row.url, format: row.format.toUpperCase(), path: row.path, source: row.source };
    const rowCollections = row.collections || (row.collection ? [row.collection] : []);
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.copies.some((item) => item.id === copy.id)) existing.copies.push(copy);
      if (!existing.formats.includes(copy.format)) existing.formats.push(copy.format);
      if (!existing.author && metadata.author) existing.author = metadata.author;
      if (!existing.series && metadata.series) existing.series = metadata.series;
      for (const item of rowCollections) if (!existing.collections.includes(item)) existing.collections.push(item);
      if ((!existing.category || existing.category === "General") && metadata.category) existing.category = metadata.category;
      if (isScript) existing.category = "Script";
      if (row.modified && (!existing.modified || row.modified > existing.modified)) existing.modified = row.modified;
    } else {
      grouped.set(key, {
        ...row, ...metadata, category: isScript ? "Script" : metadata.category,
        collections: rowCollections, copies: [copy], formats: [copy.format], searchText: "", normalizedTitle: titleKey,
      });
      if (!titleIndex.has(titleKey)) titleIndex.set(titleKey, key);
    }
  }
  return [...grouped.values()].map((book) => {
    const collections = [...book.collections].sort((a, b) => a.localeCompare(b));
    const normalizedTitle = normalized(book.title);
    return {
      ...book,
      copies: [...book.copies].sort((a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)),
      formats: [...book.formats].sort((a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b)),
      collections,
      searchText: normalized([book.title, book.author, book.series, ...collections, book.category, book.path].filter(Boolean).join(" ")),
      normalizedTitle,
    };
  }).sort((a, b) => Number(Boolean(a.incomplete)) - Number(Boolean(b.incomplete)) || a.normalizedTitle.localeCompare(b.normalizedTitle));
}


export function prepareCatalog(rows: RawBook[]): Book[] {
  return reviewBooks(groupBooks(rows) as ShelfBook[], rows) as Book[];
}
