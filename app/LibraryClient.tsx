"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import BookReader, { type ReaderBookmark, type ReaderFile, type ReaderLocation } from "./BookReader";
import LibraryChrome, { type LibraryChromeView } from "./LibraryChrome";
import ShelfRail from "./ShelfRail";
import { driveDownloadUrl } from "./drive";
import { cardTitle, completeLabel, continueProgress, coverOptions, groupShelf, homeShelves, recentlyOpened, reviewBooks, type ShelfBook } from "./homeShelves";

type RawBook = {
  id: string; title: string; originalTitle?: string; author?: string; series?: string; incomplete?: boolean; workKey?: string;
  format: string; source: string; collection?: string; category?: string; collections?: string[];
  path?: string; url: string; size?: number; modified?: string;
};

type Copy = Pick<RawBook, "id" | "url" | "format" | "path" | "source">;
type Book = RawBook & { copies: Copy[]; formats: string[]; collections: string[]; searchText: string; normalizedTitle: string; rrShelfLabel?: string; rrEditions?: Book[]; rrGroupTitle?: string; rrGroupAuthor?: string };
type LibraryView = "library" | "continue" | "favorites" | "recent";
type DisplayMode = "thumbnails" | "list";
type SortMode = "title" | "author" | "series" | "added" | "opened";
type ReadingStatus = "unread" | "reading" | "finished";
type SavedState = {
  bookId: string; fileId?: string | null; favorite: boolean; lastOpened?: number | null;
  progressLabel?: string | null; position?: string | null; status: ReadingStatus; bookmarks?: ReaderBookmark[]; updatedAt: number;
};

type FilterChoice = { value: string; count: number };
const asShelf = (items: Book[]) => items as ShelfBook[];
const fromShelf = (items: ShelfBook[]) => items as Book[];

const FORMAT_ORDER = ["EPUB", "PDF", "CBZ", "CBR", "MOBI", "FDX", "DOCX", "DOC", "RTF", "TXT"];
/**
 * Drawn covers for books with no artwork.
 *
 * The previous six palettes had well-spread hues (7deg to 272deg) but every one
 * sat at 18-35% lightness and 22-47% saturation. Hue alone does not separate
 * colours at thumbnail size behind a white label, so all six read as the same
 * dark muted card - which is why they looked identical.
 *
 * These twelve vary lightness across roughly 14-58% and saturation across
 * 18-72%, so neighbouring covers differ in weight as well as hue. Ink is chosen
 * per entry for contrast against its own ground rather than assuming a light
 * text colour always works.
 *
 * [ground, ink]
 */
const palettes = [
  ["#1b2b26", "#d8c9aa"],   // deep pine, very dark
  ["#8f3a2e", "#f4e4cb"],   // brick, mid + saturated
  ["#2f4a63", "#d7c5a7"],   // slate blue
  ["#6b4a7d", "#efe2f0"],   // plum, lighter
  ["#8d5f1e", "#fff3d8"],   // ochre
  ["#24544f", "#cfe3dc"],   // teal
  ["#0f1620", "#b9c6d6"],   // near-black ink blue
  ["#a33f2c", "#fff0e4"],   // terracotta
  ["#3a3f2c", "#e3e4c9"],   // olive drab
  ["#55283c", "#f0d6de"],   // maroon
  ["#93a06e", "#191d10"],   // sage, dark ink
  ["#d9c9a3", "#35301f"],   // parchment, DARK ink
];

function hashCode(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return Math.abs(h);
}

const TITLE_CORRECTIONS: Record<string, string> = {
  "1qe6m2GZIcBbAu_v-GETlYsVbsbgdMp6X": "The System of the World",
  "1Y1aEESMqlVsXwZMUr0Up2KCMfMwTqK0R": "The Emerald Atlas",
  "11XUTNAAeI_GTCeKfmu-jKchwrYkwbB6b": "The Coming of the Third Reich",
};

function canReadHere(format: string) {
  return ["EPUB", "MOBI", "AZW", "AZW3", "KF8", "PDF", "CBR", "CBZ", "DOC", "DOCX", "RTF", "TXT"].includes(format.toUpperCase());
}

function cleanTitle(value: string) {
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

function normalized(value: string) {
  return cleanTitle(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(the|a|an)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function looksLikePerson(value: string) {
  return !/^(the|a|an)\b/i.test(value) && !/\d/.test(value) && /^(?:[A-Z][\p{L}'-]*\.?\s+){1,4}[A-Z][\p{L}'-]*\.?$/u.test(value.trim());
}

function metadataFor(row: RawBook) {
  const rawTitle = TITLE_CORRECTIONS[row.id] || row.title || row.originalTitle || "Untitled";
  let title = cleanTitle(rawTitle);
  let author = cleanTitle(row.author || "");
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
  return { title: title || "Untitled", author, category, series };
}

function authorAliases(authors: string[]) {
  const aliases = new Map<string, string>();
  const unique = [...new Set(authors.filter(Boolean))];
  for (const author of unique) aliases.set(author, author);
  const byFirst = new Map<string, string[]>();
  for (const author of unique) {
    const first = normalized(author).split(" ")[0];
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first)!.push(author);
  }
  for (const group of byFirst.values()) {
    if (group.length < 2) continue;
    for (const author of group) {
      const key = normalized(author);
      const better = group.filter((candidate) => {
        const ck = normalized(candidate);
        return ck.startsWith(key) && ck.length > key.length && ck.length - key.length <= 2;
      }).sort((a, b) => normalized(b).length - normalized(a).length)[0];
      if (better) aliases.set(author, better);
    }
  }
  return aliases;
}

function groupBooks(rows: RawBook[]): Book[] {
  const grouped = new Map<string, Book>();
  const titleIndex = new Map<string, string>();
  const prepared = rows.map((row) => ({ row, metadata: metadataFor(row) }));
  const aliases = authorAliases(prepared.map(({ metadata }) => metadata.author));
  for (const { row, metadata: rawMetadata } of prepared) {
    const metadata = { ...rawMetadata, author: aliases.get(rawMetadata.author) || rawMetadata.author };
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

function countedChoices(items: Book[], read: (book: Book) => string[]) {
  const counts = new Map<string, number>();
  for (const book of items) for (const value of new Set(read(book).filter(Boolean))) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
}

function SearchableFilter({ label, value, allLabel, choices, onChange }: {
  label: string; value: string; allLabel: string; choices: FilterChoice[]; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredChoices = useMemo(() => {
    const term = normalized(query);
    return term ? choices.filter((choice) => normalized(choice.value).includes(term)).slice(0, 120) : choices.slice(0, 120);
  }, [choices, query]);
  const closeIfFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  };
  return <div className="filter-picker" onBlur={closeIfFocusLeaves}>
    <span>{label}</span>
    <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen((current) => !current); setQuery(""); }}>{value}<b aria-hidden="true">⌄</b></button>
    {open && <div className="filter-picker-menu">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label.toLowerCase()}`} />
      <div aria-label={label}>
        <button type="button" className={value === allLabel ? "active" : ""} onClick={() => { onChange(allLabel); setOpen(false); }}>{allLabel}</button>
        {filteredChoices.map((choice) => <button type="button" aria-pressed={value === choice.value} className={value === choice.value ? "active" : ""} key={choice.value} onClick={() => { onChange(choice.value); setOpen(false); }}><span>{choice.value}</span><small>{choice.count.toLocaleString()}</small></button>)}
        {!filteredChoices.length && <p>No matches</p>}
      </div>
    </div>}
  </div>;
}

function values(items: Book[], field: "author" | "category" | "series") {
  return [...new Set(items.map((item) => item[field]?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function coverUrl(book: Book) {
  const copy = book.copies[0];
  const query = new URLSearchParams({ title: book.title, id: copy.id, format: copy.format });
  if (book.author) query.set("author", book.author);
  return `/api/cover?${query}`;
}

function stateFromLegacy() {
  try {
    const favorites = JSON.parse(localStorage.getItem("reading-room-favorites") || "[]") as string[];
    const recent = JSON.parse(localStorage.getItem("reading-room-recent") || "[]") as string[];
    const stored = JSON.parse(localStorage.getItem("reading-room-state") || "{}") as Record<string, SavedState>;
    const now = Date.now();
    for (const id of favorites) {
      const previous = stored[id];
      stored[id] = { ...previous, bookId: id, favorite: true, status: previous?.status || "unread", updatedAt: previous?.updatedAt || now };
    }
    recent.forEach((id, index) => {
      const previous = stored[id];
      stored[id] = { ...previous, bookId: id, favorite: previous?.favorite || false, status: previous?.status === "finished" ? "finished" : "reading", updatedAt: previous?.updatedAt || now - index, lastOpened: previous?.lastOpened || now - index };
    });
    return stored;
  } catch {
    return {};
  }
}

function persistLocal(states: Record<string, SavedState>) {
  localStorage.setItem("reading-room-state", JSON.stringify(states));
  localStorage.setItem("reading-room-favorites", JSON.stringify(Object.values(states).filter((item) => item.favorite).map((item) => item.bookId)));
  localStorage.setItem("reading-room-recent", JSON.stringify(Object.values(states).filter((item) => item.lastOpened).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)).slice(0, 50).map((item) => item.bookId)));
}

export default function LibraryClient() {
  // Keep the server and the first client render identical. The device-specific
  // glyph is filled in after hydration; reading navigator during render made
  // the static Pi document and iPhone disagree before the app even started.
  const [shortcutKey, setShortcutKey] = useState("Ctrl K");
  const [catalogRows, setCatalogRows] = useState<RawBook[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const books = useMemo(() => fromShelf(reviewBooks(asShelf(groupBooks(catalogRows)), catalogRows)), [catalogRows]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [collection, setCollection] = useState("All collections");
  const [author, setAuthor] = useState("All authors");
  const [category, setCategory] = useState("All categories");
  const [series, setSeries] = useState("All series");
  const [format, setFormat] = useState("All formats");
  const [readingStatus, setReadingStatus] = useState("All reading statuses");
  const [readableOnly, setReadableOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("title");
  const [view, setView] = useState<LibraryView>("library");
  const [chromeView, setChromeView] = useState<LibraryChromeView>("home");
  const [savedStates, setSavedStates] = useState<Record<string, SavedState>>({});
  const deferredSavedStates = useDeferredValue(savedStates);
  const savedStatesRef = useRef<Record<string, SavedState>>({});
  const pendingRemoteRef = useRef<Map<string, SavedState>>(new Map());
  const remoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("thumbnails");
  const [selected, setSelected] = useState<Book | null>(null);
  const [seriesFocus, setSeriesFocus] = useState<string | null>(null);
  const [reader, setReader] = useState<{ title: string; file: ReaderFile; bookId: string; initialPosition?: string } | null>(null);
  const [visible, setVisible] = useState(20);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // A shelf opened from the home page narrows the catalogue to its books.
  const [shelfFilter, setShelfFilter] = useState<{ title: string; ids: Set<string> } | null>(null);
  const [editionsFor, setEditionsFor] = useState<Book | null>(null);
  // Which card's ⋯ menu is open. One at a time, so a plain id rather than a set.
  // id plus the ⋯ button's viewport rect. The menu is position:fixed rather
  // than absolute: the shelf strips are horizontal scroll containers, so an
  // absolutely-positioned menu was clipped by its own card.
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);

  // Any change to the query, the filters or the view starts the list again.
  useEffect(() => { setVisible(20); }, [query, collection, author, category, series, format, readingStatus, readableOnly, sort, view, shelfFilter]);

  // The override layer waits for this before it touches the rendered list.
  useEffect(() => {
    document.documentElement.dataset.rrLibraryReady = "1";
    window.dispatchEvent(new Event("rr-library-ready"));
  }, []);

  useEffect(() => {
    setShortcutKey(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "") ? "⌘ K" : "Ctrl K");
  }, []);

  // Match the server's first render, then restore the reader's saved choice.
  // React owns this state, so hydration can no longer undo the default sort.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("reading-room-sort");
      setSort(saved === "title" || saved === "author" || saved === "series" || saved === "added" || saved === "opened" ? saved : "added");
    } catch { setSort("added"); }
  }, []);

  const chooseSort = (next: SortMode) => {
    setSort(next);
    try { localStorage.setItem("reading-room-sort", next); } catch { /* private mode */ }
  };

  useEffect(() => {
    const local = stateFromLegacy();
    savedStatesRef.current = local;
    setSavedStates(local);
    const savedDisplay = localStorage.getItem("reading-room-display-mode");
    if (savedDisplay === "thumbnails" || savedDisplay === "list") setDisplayMode(savedDisplay);
    fetch("/api/library-state").then((response) => response.ok ? response.json() : { states: [] }).then((payload: { states?: SavedState[] }) => {
      if (!payload.states?.length) return;
      setSavedStates((current) => {
        const merged = { ...current };
        for (const item of payload.states || []) if (!merged[item.bookId] || item.updatedAt >= merged[item.bookId].updatedAt) merged[item.bookId] = item;
        savedStatesRef.current = merged;
        persistLocal(merged);
        return merged;
      });
    }).catch(() => {});
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.querySelector<HTMLInputElement>(".search input")?.focus(); }
      if (event.key === "Escape" && !document.querySelector(".reader-shell")) { setSelected(null); setSeriesFocus(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
      flushRemoteState();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/catalog.json", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Catalogue unavailable"); return response.json() as Promise<RawBook[]>; })
      .then((rows) => { setCatalogRows(rows); setCatalogStatus("ready"); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setCatalogStatus("error"); });
    return () => controller.abort();
  }, []);

  const collectionChoices = useMemo(() => countedChoices(books, (book) => book.collections), [books]);
  const authorChoices = useMemo(() => countedChoices(books, (book) => book.author ? [book.author] : []), [books]);
  const categories = useMemo(() => values(books, "category"), [books]);
  const seriesChoices = useMemo(() => countedChoices(books, (book) => book.series ? [book.series] : []), [books]);
  const formats = useMemo(() => [...new Set(books.flatMap((book) => book.formats))].sort((a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b)), [books]);
  const seriesGroups = useMemo(() => {
    const groups = new Map<string, Book[]>();
    for (const book of books) if (book.series) groups.set(book.series, [...(groups.get(book.series) || []), book]);
    for (const list of groups.values()) list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    return groups;
  }, [books]);
  const favorites = useMemo(() => Object.values(savedStates).filter((item) => item.favorite).map((item) => item.bookId), [savedStates]);
  const recent = useMemo(() => Object.values(savedStates).filter((item) => item.lastOpened).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)).map((item) => item.bookId), [savedStates]);

  const filtered = useMemo(() => {
    const term = normalized(deferredQuery);
    let list = books.filter((book) => {
      const state = deferredSavedStates[book.id];
      return (!shelfFilter || shelfFilter.ids.has(book.id))
        && (!term || book.searchText.includes(term))
        && (collection === "All collections" || book.collections.includes(collection))
        && (author === "All authors" || book.author === author)
        && (category === "All categories" || book.category === category)
        && (series === "All series" || book.series === series)
        && (format === "All formats" || book.formats.includes(format))
        && (readingStatus === "All reading statuses" || (state?.status || "unread") === readingStatus)
        && (!readableOnly || book.copies.some((copy) => canReadHere(copy.format)));
    });
    if (view === "favorites") list = list.filter((book) => favorites.includes(book.id));
    if (view === "recent") list = list.filter((book) => recent.includes(book.id));
    if (view === "continue") list = list.filter((book) => deferredSavedStates[book.id]?.status === "reading");
    return [...list].sort((a, b) => {
      if (sort === "opened") return (deferredSavedStates[b.id]?.lastOpened || 0) - (deferredSavedStates[a.id]?.lastOpened || 0);
      if (sort === "added") return (b.modified || "").localeCompare(a.modified || "");
      if (sort === "author") return (a.author || "ZZZ").localeCompare(b.author || "ZZZ") || a.title.localeCompare(b.title, undefined, { numeric: true });
      if (sort === "series") return (a.series || "ZZZ").localeCompare(b.series || "ZZZ", undefined, { numeric: true }) || a.title.localeCompare(b.title, undefined, { numeric: true });
      return a.normalizedTitle.localeCompare(b.normalizedTitle, undefined, { numeric: true });
    });
  }, [author, books, category, collection, deferredQuery, favorites, format, readableOnly, readingStatus, recent, deferredSavedStates, series, shelfFilter, sort, view]);

  const continueBooks = useMemo(() => recent.filter((id) => savedStates[id]?.status === "reading").map((id) => books.find((book) => book.id === id)).filter((book): book is Book => Boolean(book)).slice(0, 10), [books, recent, savedStates]);
  const recentlyAdded = useMemo(() => [...books].filter((book) => book.modified).sort((a, b) => (b.modified || "").localeCompare(a.modified || "")).slice(0, 10), [books]);
  const openedBooks = useMemo(() => fromShelf(recentlyOpened(asShelf(books), savedStates)), [books, savedStates]);
  const shelves = useMemo(
    () => homeShelves(asShelf(books), savedStates, catalogRows).map((shelf) => ({ ...shelf, items: fromShelf(shelf.items) })),
    [books, savedStates, catalogRows],
  );

  function flushRemoteState() {
    const pending = [...pendingRemoteRef.current.values()];
    pendingRemoteRef.current.clear();
    remoteTimerRef.current = null;
    for (const state of pending) {
      fetch("/api/library-state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(state), keepalive: true })
        .catch(() => {
          // Restore to pending on failure so the next save re-syncs this state
          // rather than silently losing bookmarks or reading progress.
          if (!pendingRemoteRef.current.has(state.bookId)) {
            pendingRemoteRef.current.set(state.bookId, state);
          }
        });
    }
  }

  function saveState(bookId: string, patch: Partial<SavedState>) {
    const current = savedStatesRef.current;
    const previous = current[bookId] || { bookId, favorite: false, status: "unread" as ReadingStatus, updatedAt: 0 };
    const nextState: SavedState = { ...previous, ...patch, bookId, updatedAt: Date.now() };
    const next = { ...current, [bookId]: nextState };
    savedStatesRef.current = next;
    setSavedStates(next);
    persistLocal(next);
    pendingRemoteRef.current.set(bookId, nextState);
    if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
    remoteTimerRef.current = setTimeout(flushRemoteState, 650);
  }

  function toggleFavorite(id: string) { saveState(id, { favorite: !savedStates[id]?.favorite }); }
  function toggleFinished(id: string) {
    const current = savedStates[id]?.status || "unread";
    if (current === "finished") {
      saveState(id, { status: "unread", progressLabel: undefined });
    } else {
      saveState(id, { status: "finished", progressLabel: "Finished" });
    }
  }

  function openBook(book: Book) {
    // More than one file: let the reader choose rather than guessing.
    if (book.copies.length > 1) { setSelected(book); return; }
    const readableCopy = book.copies.find((copy) => canReadHere(copy.format));
    saveState(book.id, { lastOpened: Date.now(), status: savedStates[book.id]?.status === "finished" ? "finished" : "reading", fileId: readableCopy?.id || book.copies[0]?.id });
    if (readableCopy) { setSelected(null); setSeriesFocus(null); setReader({ title: book.title, file: readableCopy, bookId: book.id, initialPosition: savedStatesRef.current[book.id]?.position || undefined }); }
    else setSelected(book);
  }

  function openCopy(book: Book, copy: Copy) {
    saveState(book.id, { lastOpened: Date.now(), status: savedStatesRef.current[book.id]?.status === "finished" ? "finished" : "reading", fileId: copy.id });
    setSelected(null);
    setReader({ title: book.title, file: copy, bookId: book.id, initialPosition: savedStatesRef.current[book.id]?.position || undefined });
  }

  // Every per-book action lives here, behind the ⋯ on the card, so the card
  // itself carries nothing but title, author and progress. Previously these
  // were a row of icon buttons under each cover plus a long-press sheet for
  // metadata - two routes to the same actions, neither discoverable.
  function BookMenu({ book }: { book: Book }) {
    const state = savedStates[book.id];
    const finished = state?.status === "finished";
    const editions = book.rrEditions;
    const close = () => setMenuFor(null);
    const act = (fn: () => void) => () => { close(); fn(); };
    // Anchored to the button: right edge aligned with the ⋯, opening downwards,
    // flipping above only when there is genuinely no room. The height is
    // measured from the item count rather than assumed - a fixed 300 estimate
    // pushed short menus far above their button.
    const rows = 2 + (editions && editions.length > 1 ? 1 : 0)
      + (book.copies.length > 1 ? 1 + book.copies.length : 0)
      + (book.series ? 1 : 0) + 2;
    const W = 224, M = 8;
    const H = rows * 40 + 24;
    const ax = menuFor?.x ?? 0, ay = menuFor?.y ?? 0;
    const left = Math.min(Math.max(M, ax - W), window.innerWidth - W - M);
    const top = ay + 6 + H > window.innerHeight - M
      ? Math.max(M, ay - H - 30)
      : ay + 6;
    // Portalled to <body>. position:fixed was not enough: .shelf-strip sets
    // `contain: layout style`, which makes it a containing block for fixed
    // descendants, so the menu was still clipped to the scrolling strip.
    return createPortal(<><div className="rr-card-scrim" onClick={(event) => { event.stopPropagation(); close(); }} /><div className="rr-card-menu" role="menu" style={{ left, top }} onClick={(event) => event.stopPropagation()}>
      <button role="menuitem" onClick={act(() => toggleFinished(book.id))}>
        {finished ? "Mark as Unread" : "Mark as Finished"}
      </button>
      <button role="menuitem" onClick={act(() => toggleFavorite(book.id))}>
        {state?.favorite ? "Remove from Favorites" : "Add to Favorites"}
      </button>
      {editions && editions.length > 1 && <button role="menuitem" onClick={act(() => setEditionsFor(book))}>
        {editions.length} editions…
      </button>}
      {book.copies.length > 1 && <button role="menuitem" onClick={act(() => setSelected(book))}>
        {book.copies.length} copies…
      </button>}
      {book.copies.length > 1 && <hr />}
      {/* One row per format, so "open as EPUB" is a choice rather than a guess. */}
      {book.copies.length > 1 && book.copies.map((copy) => <button key={copy.id} role="menuitem" onClick={act(() => openCopy(book, copy))}>
        Open as {copy.format}
      </button>)}
      {book.series && <button role="menuitem" onClick={act(() => setSeriesFocus(book.series!))}>
        View series
      </button>}
      <hr />
      <button role="menuitem" onClick={act(() => window.dispatchEvent(new CustomEvent("rr-edit-book", { detail: { id: book.id } })))}>
        Update Metadata…
      </button>
      <button role="menuitem" className="danger" onClick={act(() => window.dispatchEvent(new CustomEvent("rr-edit-book", { detail: { id: book.id, focus: "delete" } })))}>
        Delete…
      </button>
    </div></>, document.body);
  }

  // Dismissal is the scrim's job - a document-level click listener let the same
  // tap through to another card's ⋯, which closed one menu and opened the next.
  // Scrolling still closes, since the menu is fixed and would otherwise detach
  // from its button.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener("scroll", close, true);
    return () => document.removeEventListener("scroll", close, true);
  }, [menuFor]);

  function handleReaderLocation(location: ReaderLocation) {
    if (!reader) return;
    saveState(reader.bookId, { fileId: reader.file.id, status: location.status || "reading", progressLabel: location.label, position: location.position });
  }

  function handleBookmarksChange(bookmarks: ReaderBookmark[]) {
    if (!reader) return;
    saveState(reader.bookId, { bookmarks });
  }

  const clearFilters = () => {
    setShelfFilter(null);
    setCollection("All collections"); setAuthor("All authors"); setCategory("All categories");
    setSeries("All series"); setFormat("All formats"); setReadingStatus("All reading statuses"); setReadableOnly(false); setVisible(20);
  };
  // Opening a shelf narrows the catalogue to its books rather than navigating
  // away, so the filters and the sort control still apply.
  function openShelf(title: string, items: Book[]) {
    clearFilters();
    setQuery("");
    setView("library");
    setChromeView("library");
    setDisplayMode("list");
    setShelfFilter({ title, ids: new Set(items.flatMap((book) => (book.rrEditions || [book]).map((edition) => edition.id))) });
    setSort(title === "Recently added" ? "added" : title === "Recently Opened" || title === "Continue" ? "opened" : "title");
  }

  const shelfTitle = (book: Book) => cardTitle(book as ShelfBook);
  const shelfLabel = (book: Book) => completeLabel(book as ShelfBook);
  const shelfCovers = (book: Book) => coverOptions(book as ShelfBook);

  const chooseDisplayMode = (mode: DisplayMode) => { setDisplayMode(mode); localStorage.setItem("reading-room-display-mode", mode); };
  const activeFilters = [
    shelfFilter?.title || "",
    collection !== "All collections" ? collection : "", author !== "All authors" ? author : "", category !== "All categories" ? category : "",
    series !== "All series" ? series : "", format !== "All formats" ? format : "", readingStatus !== "All reading statuses" ? readingStatus : "", readableOnly ? "Readable here" : "",
  ].filter(Boolean);
  const currentReaderBook = reader ? books.find((book) => book.id === reader.bookId) : undefined;
  const readerSeries = currentReaderBook?.series ? seriesGroups.get(currentReaderBook.series) || [] : [];
  const readerSeriesIndex = currentReaderBook ? readerSeries.findIndex((book) => book.id === currentReaderBook.id) : -1;

  const chooseChromeView = (next: LibraryChromeView) => {
    setQuery("");
    clearFilters();
    setChromeView(next);
    setView(next === "favorites" ? "favorites" : "library");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  // One home-page shelf. Cards are grouped for display only — editions keep
  // their own ids — and a card standing for several editions opens a chooser
  // rather than guessing which file to read.
  function renderShelf(title: string, items: Book[], compact?: boolean) {
    const isContinue = title === "Continue";
    const all = title === "Recently added"
      ? books.filter((book) => book.modified)
      : isContinue
        ? books.filter((book) => savedStates[book.id]?.status === "reading")
        : items;
    const grouped = fromShelf(groupShelf(asShelf(items)));
    if (!grouped.length) return null;
    return <section className="smart-shelf" key={title}>
      <div className="shelf-heading">
        <div>
          <span>YOUR LIBRARY</span>
          <h2>{title}</h2>
          <button className="rr-shelf-chevron" onClick={() => openShelf(title, all)} aria-label={`See all ${title}`}>See all</button>
        </div>
      </div>
      <ShelfRail>
        {grouped.slice(0, 8).map((book, index) => <div className="rr-shelf-cell" key={book.id}><button
          className="shelf-book"
          title={`${compact ? shelfLabel(book) : shelfTitle(book)} — ${book.author || "Author unknown"}`}
          onClick={() => book.rrEditions ? setEditionsFor(book) : openBook(book)}
        >
          <span className={compact ? "shelf-cover rr-author-portrait" : "shelf-cover"} style={{ "--cover": palettes[hashCode(book.id) % palettes.length][0], "--ink": palettes[hashCode(book.id) % palettes.length][1] } as React.CSSProperties}>
            <span className="rr-cover-label" aria-hidden="true">
              <small>READING ROOM</small>
              <strong>{shelfTitle(book)}</strong>
              <em>{compact || /complete works/i.test(book.title) ? "Collected works" : book.author || book.category || "Book"}</em>
            </span>
            <img
              src={shelfCovers(book)[0] || coverUrl(book)}
              alt={compact ? shelfLabel(book) : shelfTitle(book)}
              loading="lazy"
              onLoad={(event) => {
                // A 1px placeholder is not artwork; leave the drawn cover showing.
                if (event.currentTarget.naturalWidth > 8) event.currentTarget.parentElement?.classList.add("rr-artwork");
                else event.currentTarget.hidden = true;
              }}
              onError={(event) => {
                const image = event.currentTarget;
                const options = shelfCovers(book);
                const next = Number(image.dataset.attempt || 0) + 1;
                image.dataset.attempt = String(next);
                if (options[next]) { image.src = options[next]; return; }
                image.hidden = true;
                image.parentElement?.classList.remove("rr-artwork");
              }}
            />
          </span>
          <strong>{compact ? shelfLabel(book) : shelfTitle(book)}</strong>
          {/* Always the author. The edition count used to sit here on compact
              shelves, but "1 edition" is noise - the count belongs in the ⋯
              menu, and only when there is more than one. */}
          <small className="rr-shelf-author">{book.author || "Author unknown"}</small>
          {isContinue && <small className="rr-continue-meta">{continueProgress(savedStates[book.id])}</small>}
        </button>
        {/* Sibling, not child: .shelf-book is itself a <button> and nesting one
            inside another is invalid and swallows the inner tap. */}
        <button className="rr-card-more" aria-label={`Options for ${shelfTitle(book)}`} aria-haspopup="menu" aria-expanded={menuFor?.id === book.id} onClick={(event) => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); setMenuFor(menuFor?.id === book.id ? null : { id: book.id, x: r.right, y: r.bottom }); }}>⋯</button>
        {menuFor?.id === book.id && <BookMenu book={book} />}
        </div>)}
      </ShelfRail>
    </section>;
  }

  return <main>
    {editionsFor && <div className="modal-backdrop"><section className="modal rr-editions" role="dialog" aria-modal="true" aria-label={shelfTitle(editionsFor)}>
      <button className="rr-editions-close" autoFocus aria-label="Close editions" onClick={() => setEditionsFor(null)}>×</button>
      <h2>{shelfTitle(editionsFor)}</h2>
      <p>Choose an edition or collection</p>
      <div className="rr-edition-list">
        {(editionsFor.rrEditions || []).map((book, index) => <button key={book.id} onClick={() => { setEditionsFor(null); openBook(book); }}>
          <strong>{book.title}</strong>
          <small>{`${book.author || shelfLabel(book)} · ${book.formats.join(" / ")} · Edition ${index + 1}`}</small>
        </button>)}
      </div>
    </section></div>}

    <header className="topbar">
      <button className="brand" onClick={() => chooseChromeView("home")} aria-label="The Reading Room home"><span className="brand-mark">R</span><span><strong>The Reading Room</strong><small>PRIVATE DIGITAL LIBRARY</small></span></button>
      <nav aria-label="Library views">
        <button className={view === "library" ? "active" : ""} onClick={() => { setView("library"); setShelfFilter(null); }}><span aria-hidden="true">⌂</span>Library</button>
        <button className={view === "continue" ? "active" : ""} onClick={() => { setView("continue"); setSort("opened"); setShelfFilter(null); }}><span aria-hidden="true">▶</span>Continue</button>
        <button className={view === "favorites" ? "active" : ""} onClick={() => { setView("favorites"); setShelfFilter(null); }}><span aria-hidden="true">♡</span>Favorites <b>{favorites.length}</b></button>
        <button className={view === "recent" ? "active" : ""} onClick={() => { setView("recent"); setSort("opened"); setShelfFilter(null); }}><span aria-hidden="true">↺</span>Recent</button>
      </nav>
    </header>

    <section className="hero compact-hero">
      <div><p className="eyebrow">CURATED FROM YOUR COLLECTION</p><h1>{chromeView === "home" ? "Home" : chromeView === "favorites" ? "Favorites" : view === "recent" ? "Recently opened" : view === "continue" ? "Continue reading" : "Library"}</h1></div>
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setVisible(20); }} placeholder="Search title, author, series or collection…" /><kbd>{shortcutKey}</kbd></label>
      <div className="category-chips">
        <button aria-pressed={category === "Fiction"} onClick={() => { setCategory(category === "Fiction" ? "All categories" : "Fiction"); setVisible(20); }}>Fiction</button>
        <button aria-pressed={category === "Non-Fiction"} onClick={() => { setCategory(category === "Non-Fiction" ? "All categories" : "Non-Fiction"); setVisible(20); }}>Non-Fiction</button>
        <button aria-pressed={category === "Graphic Novel"} onClick={() => { setCategory(category === "Graphic Novel" ? "All categories" : "Graphic Novel"); setVisible(20); }}>Graphic Novels</button>
        <button aria-pressed={category === "Script"} onClick={() => { setCategory(category === "Script" ? "All categories" : "Script"); setVisible(20); }}>Scripts</button>
        <button aria-pressed={readableOnly} onClick={() => { setReadableOnly(!readableOnly); setVisible(20); }}>Readable here</button>
      </div>
    </section>

    {view === "library" && !query && !activeFilters.length && <section className="discovery">
      {renderShelf("Continue", continueBooks)}
      {shelves.slice(0, 2).map((shelf) => renderShelf(shelf.title, shelf.items, shelf.compact))}
      {renderShelf("Recently added", recentlyAdded)}
      {renderShelf("Recently Opened", openedBooks)}
      {shelves.slice(2).map((shelf) => renderShelf(shelf.title, shelf.items))}
    </section>}

    <section className="catalog">
      <div className="catalog-toolbar"><button className="mobile-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>Filters {activeFilters.length ? `(${activeFilters.length})` : ""}</button><label className="sort-control"><span>Sort</span><select value={sort} onChange={(event) => chooseSort(event.target.value as SortMode)}><option value="title">Title</option><option value="author">Author</option><option value="series">Series</option><option value="added">Recently added</option><option value="opened">Recently opened</option></select></label></div>
      <div className={`filters expanded-filters ${filtersOpen ? "open" : ""}`}>
        <SearchableFilter label="Collection" value={collection} allLabel="All collections" choices={collectionChoices} onChange={(next) => { setCollection(next); setVisible(20); }} />
        <SearchableFilter label="Author" value={author} allLabel="All authors" choices={authorChoices} onChange={(next) => { setAuthor(next); setVisible(20); }} />
        <label><span>Category</span><select value={category} onChange={(event) => { setCategory(event.target.value); setVisible(20); }}><option>All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <SearchableFilter label="Series" value={series} allLabel="All series" choices={seriesChoices} onChange={(next) => { setSeries(next); setVisible(20); }} />
        <label><span>Format</span><select value={format} onChange={(event) => { setFormat(event.target.value); setVisible(20); }}><option>All formats</option>{formats.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Reading status</span><select value={readingStatus} onChange={(event) => { setReadingStatus(event.target.value); setVisible(20); }}><option>All reading statuses</option><option value="unread">Unread</option><option value="reading">In progress</option><option value="finished">Finished</option></select></label>
        <label className="readable-check"><input type="checkbox" checked={readableOnly} onChange={(event) => setReadableOnly(event.target.checked)} /><span>Readable on this site</span></label>
        <button className="clear" onClick={clearFilters}>Clear filters</button>
      </div>
      {activeFilters.length > 0 && <div className="active-filters">{activeFilters.map((item) => <span key={item}>{item}</span>)}<button onClick={clearFilters}>Clear all</button></div>}
      <div className="results"><p><strong>{filtered.length.toLocaleString()}</strong> unique titles</p><div className="display-switch" role="group" aria-label="Book display"><button className={displayMode === "thumbnails" ? "active" : ""} aria-pressed={displayMode === "thumbnails"} onClick={() => chooseDisplayMode("thumbnails")}><span aria-hidden="true">▦</span> Thumbnails</button><button className={displayMode === "list" ? "active" : ""} aria-pressed={displayMode === "list"} onClick={() => chooseDisplayMode("list")}><span aria-hidden="true">☷</span> List</button></div></div>

      {catalogStatus === "loading" ? <div className="empty"><b>Opening the library…</b><p>Preparing the latest catalogue.</p></div>
      : catalogStatus === "error" ? <div className="empty"><b>The catalogue could not be loaded</b><p>Please refresh the page and try again.</p></div>
      : filtered.length ? <div className={`grid ${displayMode === "list" ? "list-view" : "thumbnail-view"}`} ref={gridRef}>{filtered.slice(0, visible).map((book, index) => {
        const palette = palettes[hashCode(book.id) % palettes.length];
        const state = savedStates[book.id];
        return <article className="book" key={book.id}>
          <button className="cover" aria-label={`Open ${book.title}${book.author ? ` by ${book.author}` : ""}`} style={{ "--cover": palette[0], "--ink": palette[1] } as React.CSSProperties} onClick={() => openBook(book)}><img src={coverUrl(book)} alt="" loading="lazy" onLoad={(event) => event.currentTarget.parentElement?.classList.add("has-cover")} onError={(event) => { event.currentTarget.hidden = true; }} /><span className="cover-copy">{book.series && <small>{book.series}</small>}<strong>{book.title}</strong>{book.author && <em>{book.author}</em>}</span>{state?.progressLabel && <span className="cover-progress">{state.progressLabel}</span>}</button>
          {/* The ⋯ lives in the author row rather than a block below it: that is
              the only way it is guaranteed to sit on the author line whatever
              the title wraps to. The title reserves two lines so the author -
              and therefore the ⋯ - lands at the same height on every card. */}
          <div className="book-caption"><strong>{book.title}</strong><span className="rr-byline"><small>{book.author || "Author unknown"}</small><button className="rr-card-more" aria-label={`Options for ${book.title}`} aria-haspopup="menu" aria-expanded={menuFor?.id === book.id} onClick={(event) => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); setMenuFor(menuFor?.id === book.id ? null : { id: book.id, x: r.right, y: r.bottom }); }}>⋯</button></span></div>
          <div className="list-copy"><button onClick={() => openBook(book)} aria-label={`Open ${book.title}${book.author ? ` by ${book.author}` : ""}`}><small>{book.series || book.category || "Book"}</small><strong>{book.title}</strong><em>{book.author || "Author not listed"}</em>{state?.progressLabel && <span>{state.progressLabel}</span>}</button></div>
          {menuFor?.id === book.id && <BookMenu book={book} />}
        </article>;
      })}</div> : <div className="empty"><b>No books found</b><p>Try clearing one or more filters.</p><button onClick={() => { setQuery(""); clearFilters(); }}>Reset search</button></div>}
      {visible < filtered.length && <button className="load" onClick={() => setVisible((count) => count + 20)}>Show more books</button>}
    </section>

    {seriesFocus && <div className="modal-backdrop" onMouseDown={() => setSeriesFocus(null)} role="presentation"><section className="modal series-modal" role="dialog" aria-modal="true" aria-labelledby="series-title" onMouseDown={(event) => event.stopPropagation()}><button autoFocus className="close" onClick={() => setSeriesFocus(null)} aria-label="Close">×</button><p className="eyebrow">READ IN ORDER</p><h2 id="series-title">{seriesFocus}</h2><p className="modal-author">{seriesGroups.get(seriesFocus)?.length || 0} titles in this series</p><div className="series-list">{(seriesGroups.get(seriesFocus) || []).map((book, index) => <button key={book.id} onClick={() => openBook(book)}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{book.title}</strong><small>{book.author || book.formats.join(" · ")}{savedStates[book.id]?.progressLabel ? ` · ${savedStates[book.id].progressLabel}` : ""}</small></span><em>Read →</em></button>)}</div></section></div>}

    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)} role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="book-title" onMouseDown={(event) => event.stopPropagation()}><button autoFocus className="close" onClick={() => setSelected(null)} aria-label="Close">×</button><p className="eyebrow">{selected.category || "BOOK"} · {selected.collections.join(" · ") || selected.source}</p><h2 id="book-title">{selected.title}</h2><p className="modal-author">{selected.author || "Author not listed"}{selected.series ? ` · ${selected.series}` : ""}</p><div className="availability"><p>Available files</p>{selected.copies.map((copy) => <div className="file-row" key={copy.id}><span><b>{copy.format}</b><small>{copy.path || copy.source}</small></span><div>{canReadHere(copy.format) && <button onClick={() => openCopy(selected, copy)}>Read here</button>}<a href={["MOBI", "AZW", "AZW3", "KF8"].includes(copy.format) ? driveDownloadUrl(copy.id) : copy.url} target="_blank" rel="noreferrer">{["MOBI", "AZW", "AZW3", "KF8"].includes(copy.format) ? "Download" : "Drive"} ↗</a></div></div>)}</div><p className="note">This title combines {selected.copies.length} file{selected.copies.length === 1 ? "" : "s"} into one catalogue entry.</p></section></div>}

    {reader && <BookReader title={reader.title} file={reader.file} initialPosition={reader.initialPosition} bookmarks={savedStates[reader.bookId]?.bookmarks || []} onBookmarksChange={handleBookmarksChange} onLocationChange={handleReaderLocation} seriesNavigation={{ previous: readerSeriesIndex > 0 ? readerSeries[readerSeriesIndex - 1]?.title : undefined, next: readerSeriesIndex >= 0 && readerSeriesIndex < readerSeries.length - 1 ? readerSeries[readerSeriesIndex + 1]?.title : undefined, onPrevious: readerSeriesIndex > 0 ? () => openBook(readerSeries[readerSeriesIndex - 1]) : undefined, onNext: readerSeriesIndex >= 0 && readerSeriesIndex < readerSeries.length - 1 ? () => openBook(readerSeries[readerSeriesIndex + 1]) : undefined }} onClose={() => setReader(null)} />}
    <LibraryChrome view={chromeView} displayMode={displayMode} sort={sort} filtersOpen={filtersOpen} hidden={Boolean(reader || selected || seriesFocus || editionsFor)} onViewChange={chooseChromeView} onDisplayModeChange={chooseDisplayMode} onSortChange={chooseSort} onFiltersOpenChange={setFiltersOpen} />
    <footer><span>The Reading Room</span><p>One clean catalogue for your digital shelves. Covers enriched by <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library</a>.</p></footer>
  </main>;
}
