"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import BookReader, { type ReaderBookmark, type ReaderFile, type ReaderLocation } from "./BookReader";
import LibraryChrome, { type LibraryChromeView } from "./LibraryChrome";
import BookDetailsEditor from "./BookDetailsEditor";
import BookSummaryAction from "./BookSummaryAction";
import ModalDialog from "./ModalDialog";
import ShelfRail from "./ShelfRail";
import HomeBooksMark from "./HomeBooksMark";
import type { Highlight } from "./annotations";
import "./library-lists.css";
import { installHaptics } from "./haptics";
import { createStateOutbox, type SyncStatus } from "./libraryStateSync";
import { hasNativeSummary, readSummary } from "./nativeBridge";
import { cardTitle, completeLabel, continueProgress, coverOptions, groupShelf, homeShelves, recentlyOpened, type ShelfBook } from "./homeShelves";
import { normalized, cleanTitle, isReference, canReadHere, type RawBook, type Book, type Copy } from "./catalogModel";
import { useCatalogModel } from "./useCatalogModel";

type LibraryView = "library" | "continue" | "favorites" | "recent";
type DisplayMode = "thumbnails" | "list";
type SortMode = "title" | "author" | "series" | "added" | "opened";
type ReadingStatus = "unread" | "reading" | "finished";
type SavedState = {
  bookId: string; fileId?: string | null; favorite: boolean; lastOpened?: number | null;
  progressLabel?: string | null; progress?: number | null; position?: string | null; status: ReadingStatus; bookmarks?: ReaderBookmark[]; updatedAt: number;
  /** On the Want to Read list; cleared when the book is first opened. */
  wantToRead?: boolean;
  /** The reader's own collections this book is in, by name. */
  lists?: string[];
  highlights?: Highlight[];
};
/** Which of the reader's own shelves My Books shows. */
type MyShelf = "favorites" | "want" | "finished" | `list:${string}`;

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
  try {
  localStorage.setItem("reading-room-state", JSON.stringify(states));
  localStorage.setItem("reading-room-favorites", JSON.stringify(Object.values(states).filter((item) => item.favorite).map((item) => item.bookId)));
  localStorage.setItem("reading-room-recent", JSON.stringify(Object.values(states).filter((item) => item.lastOpened).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)).slice(0, 50).map((item) => item.bookId)));
  return true;
  } catch { return false; }
}

export default function LibraryClient() {
  // Keep the server and the first client render identical. The device-specific
  // glyph is filled in after hydration; reading navigator during render made
  // the static Pi document and iPhone disagree before the app even started.
  const [shortcutKey, setShortcutKey] = useState("Ctrl K");
  const [nativeSummaries, setNativeSummaries] = useState(false);
  const [catalogRows, setCatalogRows] = useState<RawBook[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const { books, preparing: catalogPreparing } = useCatalogModel(catalogRows);
  // The Reference Room: a second library, fetched only when it's chosen or when
  // a book from it is on the Continue shelf. Reading Room is the default on
  // every launch, so the library opens exactly as it always has.
  const [library, setLibrary] = useState<"reading" | "reference">("reading");
  const [referenceRows, setReferenceRows] = useState<RawBook[]>([]);
  const [referenceStatus, setReferenceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const { books: referenceBooks, preparing: referencePreparing } = useCatalogModel(referenceRows);
  const allBooks = useMemo(() => referenceBooks.length ? [...books, ...referenceBooks] : books, [books, referenceBooks]);
  const libraryBooks = library === "reference" ? referenceBooks : books;
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
  const outboxRef = useRef<ReturnType<typeof createStateOutbox<SavedState>> | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ pending: 0, error: false, storageUnavailable: false });
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
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
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number; where?: string } | null>(null);
  const [detailsFor, setDetailsFor] = useState<{ book: Book; focusDelete: boolean } | null>(null);
  const [myShelf, setMyShelf] = useState<MyShelf>("favorites");
  // The "Add to Collection" sheet: which book, and the name being typed.
  const [listsFor, setListsFor] = useState<Book | null>(null);
  const [newListName, setNewListName] = useState("");

  // Any change to the query, the filters or the view starts the list again.
  const moreRef = useRef<HTMLDivElement>(null);
  // Watches whichever sentinel is currently rendered (it comes and goes with
  // the filters), so there is one observer however often the list re-renders.
  const moreWatch = useRef<{ node: Element | null; observer: IntersectionObserver | null }>({ node: null, observer: null });
  useEffect(() => {
    const watch = moreWatch.current, node = moreRef.current;
    if (watch.node === node) return;
    watch.observer?.disconnect(); watch.observer = null; watch.node = node;
    if (!node || typeof IntersectionObserver === "undefined") return;
    watch.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible((count) => count + 40);
    }, { rootMargin: "900px 0px" });
    watch.observer.observe(node);
  });
  useEffect(() => () => { moreWatch.current.observer?.disconnect(); }, []);
  useEffect(() => { setVisible(20); }, [query, collection, author, category, series, format, readingStatus, readableOnly, sort, view, shelfFilter]);

  // The override layer waits for this before it touches the rendered list.
  useEffect(() => {
    document.documentElement.dataset.rrLibraryReady = "1";
    installHaptics();
    window.dispatchEvent(new Event("rr-library-ready"));
  }, []);

  useEffect(() => {
    setShortcutKey(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "") ? "⌘ K" : "Ctrl K");
    setNativeSummaries(hasNativeSummary());
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
    const outbox = createStateOutbox<SavedState>({
      storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
      send: (records, signal) => {
        const body = JSON.stringify(records);
        // Large highlight records exceed the browser's keepalive budget. They
        // remain durable locally and use an ordinary request while open.
        return fetch("/api/library-state", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: new TextEncoder().encode(body).length < 48_000, signal });
      },
      onStatus: setSyncStatus,
    });
    outboxRef.current = outbox;
    const local = stateFromLegacy();
    for (const item of outbox.records()) if (!local[item.bookId] || local[item.bookId].updatedAt <= item.updatedAt) local[item.bookId] = item;
    savedStatesRef.current = local;
    setSavedStates(local);
    try {
      const savedDisplay = localStorage.getItem("reading-room-display-mode");
      if (savedDisplay === "thumbnails" || savedDisplay === "list") setDisplayMode(savedDisplay);
    } catch { /* Saves must still reach the server when device storage is unavailable. */ }
    outbox.start();
    fetch("/api/library-state").then((response) => response.ok ? response.json() : { states: [] }).then((payload: { states?: SavedState[] }) => {
      if (!payload.states?.length) return;
      setSavedStates((current) => {
        const merged = { ...current };
        for (const item of payload.states || []) if (!merged[item.bookId] || item.updatedAt >= merged[item.bookId].updatedAt) merged[item.bookId] = item;
        savedStatesRef.current = merged;
        setLocalSaveFailed(!persistLocal(merged));
        return merged;
      });
    }).catch(() => {});
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.querySelector<HTMLInputElement>(".search input")?.focus(); }
      if (event.key === "Escape" && !document.querySelector(".reader-shell")) { setSelected(null); setSeriesFocus(null); }
    };
    window.addEventListener("keydown", onKey);
    const retrySync = () => { void outbox.flush(); };
    window.addEventListener("online", retrySync);
    window.addEventListener("pagehide", retrySync);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("online", retrySync);
      window.removeEventListener("pagehide", retrySync);
      outbox.stop();
      void outbox.flush();
      if (outboxRef.current === outbox) outboxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogStatus("loading");
    fetch("/catalog.json", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Catalogue unavailable"); return response.json() as Promise<RawBook[]>; })
      .then((rows) => { setCatalogRows(rows); setCatalogStatus("ready"); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setCatalogStatus("error"); });
    return () => controller.abort();
  }, [catalogRevision]);

  const needsReference = library === "reference" || Object.keys(savedStates).some(isReference);
  useEffect(() => {
    if (!needsReference || referenceStatus !== "idle") return;
    setReferenceStatus("loading");
    fetch("/reference-catalog.json")
      .then((response) => { if (!response.ok) throw new Error("Reference Room unavailable"); return response.json() as Promise<RawBook[]>; })
      .then((rows) => { setReferenceRows(rows); setReferenceStatus("ready"); })
      .catch(() => setReferenceStatus("error"));
  }, [needsReference, referenceStatus]);

  const authorChoices = useMemo(() => countedChoices(libraryBooks, (book) => book.author ? [book.author] : []), [libraryBooks]);
  const categories = useMemo(() => values(libraryBooks, "category"), [libraryBooks]);
  const seriesChoices = useMemo(() => countedChoices(libraryBooks, (book) => book.series ? [book.series] : []), [libraryBooks]);
  const formats = useMemo(() => [...new Set(libraryBooks.flatMap((book) => book.formats))].sort((a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b)), [libraryBooks]);
  const seriesGroups = useMemo(() => {
    const groups = new Map<string, Book[]>();
    for (const book of books) if (book.series) groups.set(book.series, [...(groups.get(book.series) || []), book]);
    for (const list of groups.values()) list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    return groups;
  }, [books]);
  const favorites = useMemo(() => Object.values(savedStates).filter((item) => item.favorite).map((item) => item.bookId), [savedStates]);
  // Collections exist while a book is in one; names sorted as a reader expects.
  const userLists = useMemo(() => [...new Set(Object.values(savedStates).flatMap((item) => item.lists || []))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })), [savedStates]);
  const wantToRead = useMemo(() => Object.values(savedStates).filter((item) => item.wantToRead)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((item) => item.bookId), [savedStates]);
  const recent = useMemo(() => Object.values(savedStates).filter((item) => item.lastOpened).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)).map((item) => item.bookId), [savedStates]);

  const filtered = useMemo(() => {
    const term = normalized(deferredQuery);
    // Search and filters follow the chosen library; the personal views (My Books,
    // Continue, Recent) span both.
    let list = (view === "library" ? libraryBooks : allBooks).filter((book) => {
      const state = deferredSavedStates[book.id];
      return (!shelfFilter || shelfFilter.ids.has(book.id))
        && (!term || book.searchText.includes(term))
        && (collection === "All collections" || book.collections.includes(collection))
        && (author === "All authors" || book.author === author)
        && (category === "All categories" || book.category === category)
        && (series === "All series" || book.series === series)
        && (format === "All formats" || book.formats.includes(format))
        && (readingStatus === "All reading statuses" || (readingStatus === "want" ? !!state?.wantToRead : (state?.status || "unread") === readingStatus))
        && (!readableOnly || book.copies.some((copy) => canReadHere(copy.format, copy.id)));
    });
    if (view === "favorites") {
      list = list.filter((book) => {
        const state = deferredSavedStates[book.id];
        if (myShelf === "favorites") return favorites.includes(book.id);
        if (myShelf === "want") return !!state?.wantToRead;
        if (myShelf === "finished") return state?.status === "finished";
        return !!state?.lists?.includes(myShelf.slice(5));
      });
    }
    if (view === "recent") list = list.filter((book) => recent.includes(book.id));
    if (view === "continue") list = list.filter((book) => deferredSavedStates[book.id]?.status === "reading");
    return [...list].sort((a, b) => {
      if (sort === "opened") return (deferredSavedStates[b.id]?.lastOpened || 0) - (deferredSavedStates[a.id]?.lastOpened || 0);
      if (sort === "added") return (b.modified || "").localeCompare(a.modified || "");
      if (sort === "author") return (a.author || "ZZZ").localeCompare(b.author || "ZZZ") || a.title.localeCompare(b.title, undefined, { numeric: true });
      if (sort === "series") return (a.series || "ZZZ").localeCompare(b.series || "ZZZ", undefined, { numeric: true }) || a.title.localeCompare(b.title, undefined, { numeric: true });
      return a.normalizedTitle.localeCompare(b.normalizedTitle, undefined, { numeric: true });
    });
  }, [allBooks, author, category, collection, deferredQuery, favorites, format, libraryBooks, myShelf, readableOnly, readingStatus, recent, deferredSavedStates, series, shelfFilter, sort, view]);
  // My Books shelves on Home: what's next, the reader's own collections, and
  // what's been read, most recently touched first.
  const bookById = useMemo(() => new Map(allBooks.map((book) => [book.id, book])), [allBooks]);
  const wantBooks = useMemo(() => wantToRead.map((id) => bookById.get(id)).filter((book): book is Book => Boolean(book)), [bookById, wantToRead]);
  const finishedBooks = useMemo(() => Object.values(savedStates).filter((item) => item.status === "finished")
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((item) => bookById.get(item.bookId))
    .filter((book): book is Book => Boolean(book)), [bookById, savedStates]);
  const listShelves = useMemo(() => userLists.map((name) => ({
    name,
    items: Object.values(savedStates).filter((item) => item.lists?.includes(name))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((item) => bookById.get(item.bookId))
      .filter((book): book is Book => Boolean(book)),
  })), [bookById, savedStates, userLists]);

  const continueBooks = useMemo(() => recent.filter((id) => savedStates[id]?.status === "reading").map((id) => bookById.get(id)).filter((book): book is Book => Boolean(book)).slice(0, 10), [bookById, recent, savedStates]);
  const recentlyAdded = useMemo(() => [...books].filter((book) => book.modified).sort((a, b) => (b.modified || "").localeCompare(a.modified || "")).slice(0, 10), [books]);
  const openedBooks = useMemo(() => fromShelf(recentlyOpened(asShelf(books), savedStates)), [books, savedStates]);
  const shelves = useMemo(
    () => homeShelves(asShelf(books), savedStates, catalogRows).map((shelf) => ({ ...shelf, items: fromShelf(shelf.items) })),
    [books, savedStates, catalogRows],
  );

  function saveState(bookId: string, patch: Partial<SavedState>) {
    const current = savedStatesRef.current;
    const previous = current[bookId] || { bookId, favorite: false, status: "unread" as ReadingStatus, updatedAt: 0 };
    const nextState: SavedState = { ...previous, ...patch, bookId, updatedAt: Date.now() };
    const next = { ...current, [bookId]: nextState };
    savedStatesRef.current = next;
    setSavedStates(next);
    setLocalSaveFailed(!persistLocal(next));
    outboxRef.current?.enqueue(nextState);
  }

  function toggleFavorite(id: string) { saveState(id, { favorite: !savedStates[id]?.favorite }); }
  function toggleWantToRead(id: string) { saveState(id, { wantToRead: !savedStates[id]?.wantToRead }); }
  function toggleInList(id: string, name: string) {
    const lists = savedStatesRef.current[id]?.lists || [];
    saveState(id, { lists: lists.includes(name) ? lists.filter((item) => item !== name) : [...lists, name] });
  }
  function toggleFinished(id: string) {
    const current = savedStates[id]?.status || "unread";
    if (current === "finished") {
      saveState(id, { status: "unread", progressLabel: undefined, progress: null });
    } else {
      saveState(id, { status: "finished", progressLabel: "Finished", progress: 1 });
    }
  }

  function openBook(book: Book) {
    // More than one file: let the reader choose rather than guessing.
    if (book.copies.length > 1) { setSelected(book); return; }
    const readableCopy = book.copies.find((copy) => canReadHere(copy.format, copy.id));
    saveState(book.id, { lastOpened: Date.now(), status: savedStates[book.id]?.status === "finished" ? "finished" : "reading", fileId: readableCopy?.id || book.copies[0]?.id, ...(readableCopy ? { wantToRead: false } : {}) });
    if (readableCopy) { setSelected(null); setSeriesFocus(null); setReader({ title: book.title, file: readableCopy, bookId: book.id, initialPosition: savedStatesRef.current[book.id]?.position || undefined }); }
    else setSelected(book);
  }

  function openCopy(book: Book, copy: Copy) {
    saveState(book.id, { lastOpened: Date.now(), status: savedStatesRef.current[book.id]?.status === "finished" ? "finished" : "reading", fileId: copy.id, wantToRead: false });
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
    const rows = 4 + (nativeSummaries ? 1 : 0) + (editions && editions.length > 1 ? 1 : 0)
      + (book.copies.length > 1 ? 1 + book.copies.length : 0)
      + (book.series ? 1 : 0) + (isReference(book.id) ? 0 : 2);
    const W = 224, M = 8;
    const H = rows * 44 + 24;
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
      {nativeSummaries && <button role="menuitem" className="rr-summary-item" onClick={act(() => { readSummary(book); })}>Summary…</button>}
      {!finished && <button role="menuitem" onClick={act(() => toggleWantToRead(book.id))}>
        {state?.wantToRead ? "Remove from Want to Read" : "Add to Want to Read"}
      </button>}
      <button role="menuitem" onClick={act(() => { setNewListName(""); setListsFor(book); })}>
        {state?.lists?.length ? `In ${state.lists.length === 1 ? state.lists[0] : `${state.lists.length} collections`}…` : "Add to Collection…"}
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
      {/* Metadata fixes and deletion edit the Reading Room catalogue only. */}
      {!isReference(book.id) && <>
        <hr />
        <button role="menuitem" onClick={act(() => setDetailsFor({ book, focusDelete: false }))}>
          Update Metadata…
        </button>
        <button role="menuitem" className="danger" onClick={act(() => setDetailsFor({ book, focusDelete: true }))}>
          Delete…
        </button>
      </>}
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
    saveState(reader.bookId, { fileId: reader.file.id, status: location.status || "reading", progressLabel: location.label, ...(location.progress !== undefined ? { progress: location.progress } : {}), position: location.position });
  }

  function handleBookmarksChange(bookmarks: ReaderBookmark[]) {
    if (!reader) return;
    saveState(reader.bookId, { bookmarks });
  }

  function handleHighlightsChange(highlights: Highlight[]) {
    if (!reader) return;
    saveState(reader.bookId, { highlights: highlights.slice(0, 2000) });
  }

  const clearFilters = () => {
    setShelfFilter(null);
    setCollection("All collections"); setAuthor("All authors"); setCategory("All categories");
    setSeries("All series"); setFormat("All formats"); setReadingStatus("All reading statuses"); setReadableOnly(false); setVisible(20);
    setLibrary("reading");
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
    library === "reference" ? "Reference Room" : "",
    shelfFilter?.title || "",
    collection !== "All collections" ? collection : "", author !== "All authors" ? author : "", category !== "All categories" ? category : "",
    series !== "All series" ? series : "", format !== "All formats" ? format : "", readingStatus !== "All reading statuses" ? ({ unread: "Unread", want: "Want to Read", reading: "In progress", finished: "Finished" } as Record<string, string>)[readingStatus] || readingStatus : "", readableOnly ? "Readable here" : "",
  ].filter(Boolean);
  const myShelfTitle = myShelf === "favorites" ? "Favorites" : myShelf === "want" ? "Want to Read" : myShelf === "finished" ? "Finished" : myShelf.slice(5);
  const currentReaderBook = reader ? bookById.get(reader.bookId) : undefined;
  const readerSeries = currentReaderBook?.series ? seriesGroups.get(currentReaderBook.series) || [] : [];
  const readerSeriesIndex = currentReaderBook ? readerSeries.findIndex((book) => book.id === currentReaderBook.id) : -1;

  // Each library has its own authors, categories and formats, so a filter set
  // in one means nothing in the other.
  const chooseLibrary = (next: "reading" | "reference") => {
    setLibrary(next);
    setCollection("All collections"); setAuthor("All authors"); setCategory("All categories");
    setSeries("All series"); setFormat("All formats"); setShelfFilter(null); setVisible(20);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const chooseChromeView = (next: LibraryChromeView) => {
    setQuery("");
    clearFilters();
    setChromeView(next);
    setView(next === "favorites" ? "favorites" : "library");
    if (next === "favorites") setMyShelf("favorites");
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
        ? allBooks.filter((book) => savedStates[book.id]?.status === "reading")
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
              <small>HOME BOOKS</small>
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
        <button className="rr-card-more" aria-label={`Options for ${shelfTitle(book)}`} aria-haspopup="menu" aria-expanded={menuFor?.id === book.id && menuFor.where === title} onClick={(event) => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); setMenuFor(menuFor?.id === book.id && menuFor.where === title ? null : { id: book.id, x: r.right, y: r.bottom, where: title }); }}>⋯</button>
        {/* A book can sit on several shelves; only the one whose ⋯ was tapped opens. */}
        {menuFor?.id === book.id && menuFor.where === title && <BookMenu book={book} />}
        </div>)}
      </ShelfRail>
    </section>;
  }

  return <main>
    {(syncStatus.error || syncStatus.storageUnavailable || localSaveFailed) && <aside className="rr-sync-notice" role="status" aria-live="polite">
      <span>{syncStatus.error ? (syncStatus.storageUnavailable || localSaveFailed ? "Save pending. Keep Home Books open until it reconnects." : "Saved on this device. Sync will retry automatically.") : syncStatus.pending ? "Device storage is unavailable. Your changes are being sent to the server." : "Synced to the server. Device storage is unavailable."}</span>
      {syncStatus.pending > 0 && <button type="button" onClick={() => void outboxRef.current?.flush()}>Retry sync</button>}
    </aside>}
    {detailsFor && createPortal(<BookDetailsEditor
      book={detailsFor.book}
      focusDelete={detailsFor.focusDelete}
      onClose={() => setDetailsFor(null)}
      onSaved={(updated) => setCatalogRows((rows) => rows.map((row) => row.id === updated.id ? { ...row, ...updated } : row))}
      onDeleted={(id) => setCatalogRows((rows) => rows.filter((row) => row.id !== id))}
    />, document.body)}
    {editionsFor && <div className="modal-backdrop"><ModalDialog className="modal rr-editions" role="dialog" aria-modal="true" aria-label={shelfTitle(editionsFor)}>
      <button className="rr-editions-close" autoFocus aria-label="Close editions" onClick={() => setEditionsFor(null)}>×</button>
      <h2>{shelfTitle(editionsFor)}</h2>
      <p>Choose an edition or collection</p>
      <div className="rr-edition-list">
        {(editionsFor.rrEditions || []).map((book, index) => <button key={book.id} onClick={() => { setEditionsFor(null); openBook(book); }}>
          <strong>{book.title}</strong>
          <small>{`${book.author || shelfLabel(book)} · ${book.formats.join(" / ")} · Edition ${index + 1}`}</small>
        </button>)}
      </div>
    </ModalDialog></div>}

    {listsFor && <div className="modal-backdrop" onClick={() => setListsFor(null)}><ModalDialog className="modal rr-editions rr-lists" role="dialog" aria-modal="true" aria-label="Add to Collection" onClick={(event) => event.stopPropagation()}>
      <button className="rr-editions-close" aria-label="Close collections" onClick={() => setListsFor(null)}>×</button>
      <h2>Add to Collection</h2>
      <p>{shelfTitle(listsFor)}</p>
      <div className="rr-list-choices">
        {userLists.map((name) => {
          const inList = !!savedStates[listsFor.id]?.lists?.includes(name);
          return <button key={name} type="button" role="menuitemcheckbox" aria-checked={inList} onClick={() => toggleInList(listsFor.id, name)}>
            <span className="rr-list-check" aria-hidden="true">{inList ? "✓" : ""}</span>
            <strong>{name}</strong>
            <small>{listShelves.find((shelf) => shelf.name === name)?.items.length || 0}</small>
          </button>;
        })}
        {!userLists.length && <p className="rr-list-empty">Collections are your own shelves — a reading plan, a book club, books to lend.</p>}
      </div>
      <form className="rr-list-new" onSubmit={(event) => {
        event.preventDefault();
        const name = newListName.replace(/\s+/g, " ").trim().slice(0, 60);
        if (!name) return;
        if (!savedStates[listsFor.id]?.lists?.includes(name)) toggleInList(listsFor.id, name);
        setNewListName("");
      }}>
        <input value={newListName} onChange={(event) => setNewListName(event.target.value)} placeholder="New collection" aria-label="New collection name" maxLength={60} />
        <button type="submit" disabled={!newListName.trim()}>Add</button>
      </form>
    </ModalDialog></div>}

    <header className="topbar">
      <button className="brand" onClick={() => chooseChromeView("home")} aria-label="Home Books home"><span className="brand-mark">⌂</span><span><strong>Home Books</strong><small>PRIVATE DIGITAL LIBRARY</small></span></button>
      <nav aria-label="Library views">
        <button className={view === "library" ? "active" : ""} onClick={() => { setView("library"); setShelfFilter(null); }}><span aria-hidden="true">⌂</span>Library</button>
        <button className={view === "continue" ? "active" : ""} onClick={() => { setView("continue"); setSort("opened"); setShelfFilter(null); }}><span aria-hidden="true">▶</span>Continue</button>
        <button className={view === "favorites" ? "active" : ""} onClick={() => { setView("favorites"); setShelfFilter(null); }}><span aria-hidden="true">♡</span>My Books <b>{favorites.length}</b></button>
        <button className={view === "recent" ? "active" : ""} onClick={() => { setView("recent"); setSort("opened"); setShelfFilter(null); }}><span aria-hidden="true">↺</span>Recent</button>
      </nav>
    </header>

    <section className="hero compact-hero">
      <div><p className="eyebrow">CURATED FROM YOUR COLLECTION</p><h1>{chromeView === "home" && <HomeBooksMark />}{chromeView === "home" ? "Books" : chromeView === "favorites" || view === "favorites" ? myShelfTitle : view === "recent" ? "Recently opened" : view === "continue" ? "Continue reading" : "Library"}</h1></div>
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setVisible(20); }} placeholder="Search title, author, series or collection…" /><kbd>{shortcutKey}</kbd></label>
      {view === "favorites" && <div className="category-chips rr-my-shelves" role="tablist" aria-label="My Books">
        {([["favorites", "Favorites", favorites.length], ["want", "Want to Read", wantToRead.length], ["finished", "Finished", finishedBooks.length]] as const)
          .map(([key, label, count]) => <button key={key} role="tab" aria-selected={myShelf === key} aria-pressed={myShelf === key} onClick={() => { setMyShelf(key); setVisible(20); }}>{label}{count ? <b>{count}</b> : null}</button>)}
        {listShelves.map((shelf) => <button key={shelf.name} role="tab" aria-selected={myShelf === `list:${shelf.name}`} aria-pressed={myShelf === `list:${shelf.name}`} onClick={() => { setMyShelf(`list:${shelf.name}`); setVisible(20); }}>{shelf.name}<b>{shelf.items.length}</b></button>)}
      </div>}
      {library === "reference" ? <div className="category-chips">
        {categories.map((item) => <button key={item} aria-pressed={category === item} onClick={() => { setCategory(category === item ? "All categories" : item); setVisible(20); }}>{item}</button>)}
        <button aria-pressed={readableOnly} onClick={() => { setReadableOnly(!readableOnly); setVisible(20); }}>Readable here</button>
      </div> : <div className="category-chips">
        <button aria-pressed={category === "Fiction"} onClick={() => { setCategory(category === "Fiction" ? "All categories" : "Fiction"); setVisible(20); }}>Fiction</button>
        <button aria-pressed={category === "Non-Fiction"} onClick={() => { setCategory(category === "Non-Fiction" ? "All categories" : "Non-Fiction"); setVisible(20); }}>Non-Fiction</button>
        <button aria-pressed={category === "Graphic Novel"} onClick={() => { setCategory(category === "Graphic Novel" ? "All categories" : "Graphic Novel"); setVisible(20); }}>Graphic Novels</button>
        <button aria-pressed={category === "Script"} onClick={() => { setCategory(category === "Script" ? "All categories" : "Script"); setVisible(20); }}>Scripts</button>
        <button aria-pressed={readableOnly} onClick={() => { setReadableOnly(!readableOnly); setVisible(20); }}>Readable here</button>
      </div>}
    </section>

    {view === "library" && !query && !activeFilters.length && <section className="discovery">
      {renderShelf("Continue", continueBooks)}
      {renderShelf("Want to Read", wantBooks)}
      {listShelves.map((shelf) => renderShelf(shelf.name, shelf.items))}
      {shelves.slice(0, 2).map((shelf) => renderShelf(shelf.title, shelf.items, shelf.compact))}
      {renderShelf("Recently added", recentlyAdded)}
      {renderShelf("Recently Opened", openedBooks)}
      {shelves.slice(2).map((shelf) => renderShelf(shelf.title, shelf.items))}
      {renderShelf("Finished", finishedBooks)}
    </section>}

    <section className="catalog">
      <div className="catalog-toolbar"><button className="mobile-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>Filters {activeFilters.length ? `(${activeFilters.length})` : ""}</button><label className="sort-control"><span>Sort</span><select value={sort} onChange={(event) => chooseSort(event.target.value as SortMode)}><option value="title">Title</option><option value="author">Author</option><option value="series">Series</option><option value="added">Recently added</option><option value="opened">Recently opened</option></select></label></div>
      <div className={`filters expanded-filters ${filtersOpen ? "open" : ""}`}>
        <label><span>Library</span><select value={library} onChange={(event) => chooseLibrary(event.target.value === "reference" ? "reference" : "reading")}><option value="reading">Reading Room</option><option value="reference">Reference Room</option></select></label>
        <SearchableFilter label="Author" value={author} allLabel="All authors" choices={authorChoices} onChange={(next) => { setAuthor(next); setVisible(20); }} />
        <label><span>Category</span><select value={category} onChange={(event) => { setCategory(event.target.value); setVisible(20); }}><option>All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <SearchableFilter label="Series" value={series} allLabel="All series" choices={seriesChoices} onChange={(next) => { setSeries(next); setVisible(20); }} />
        <label><span>Format</span><select value={format} onChange={(event) => { setFormat(event.target.value); setVisible(20); }}><option>All formats</option>{formats.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Reading status</span><select value={readingStatus} onChange={(event) => { setReadingStatus(event.target.value); setVisible(20); }}><option>All reading statuses</option><option value="unread">Unread</option><option value="want">Want to Read</option><option value="reading">In progress</option><option value="finished">Finished</option></select></label>
        <label className="readable-check"><input type="checkbox" checked={readableOnly} onChange={(event) => setReadableOnly(event.target.checked)} /><span>Readable on this site</span></label>
        <button className="clear" onClick={clearFilters}>Clear filters</button>
      </div>
      {activeFilters.length > 0 && <div className="active-filters">{activeFilters.map((item) => <span key={item}>{item}</span>)}<button onClick={clearFilters}>Clear all</button></div>}
      <div className="results"><p><strong>{filtered.length.toLocaleString()}</strong> unique titles</p><div className="display-switch" role="group" aria-label="Book display"><button className={displayMode === "thumbnails" ? "active" : ""} aria-pressed={displayMode === "thumbnails"} onClick={() => chooseDisplayMode("thumbnails")}><span aria-hidden="true">▦</span> Thumbnails</button><button className={displayMode === "list" ? "active" : ""} aria-pressed={displayMode === "list"} onClick={() => chooseDisplayMode("list")}><span aria-hidden="true">☷</span> List</button></div></div>

      {view === "library" && library === "reference" && (referenceStatus !== "ready" || referencePreparing) ? (referenceStatus === "error"
        ? <div className="empty"><b>The Reference Room could not be loaded</b><p>Check the Pi is on, then choose it again.</p><button onClick={() => setReferenceStatus("idle")}>Try again</button></div>
        : <div className="empty"><b>Opening the Reference Room…</b><p>Preparing its catalogue.</p></div>)
      : catalogStatus === "loading" || catalogPreparing ? <div className="empty"><b>Opening the library…</b><p>Preparing the latest catalogue.</p></div>
      : catalogStatus === "error" ? <div className="empty"><b>The catalogue could not be loaded</b><p>Check your connection to Home Books, then try again.</p><button type="button" onClick={() => setCatalogRevision(value => value + 1)}>Retry</button></div>
      : filtered.length ? <div className={`grid ${displayMode === "list" ? "list-view" : "thumbnail-view"}`} ref={gridRef}>{filtered.slice(0, visible).map((book, index) => {
        const palette = palettes[hashCode(book.id) % palettes.length];
        const state = savedStates[book.id];
        const moreButton = <button className="rr-card-more" aria-label={`Options for ${book.title}`} aria-haspopup="menu" aria-expanded={menuFor?.id === book.id} onClick={(event) => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); setMenuFor(menuFor?.id === book.id ? null : { id: book.id, x: r.right, y: r.bottom }); }}>⋯</button>;
        return <article className="book" key={book.id}>
          <button className={isReference(book.id) ? "cover rr-drawn" : "cover"} aria-label={`Open ${book.title}${book.author ? ` by ${book.author}` : ""}`} style={{ "--cover": palette[0], "--ink": palette[1] } as React.CSSProperties} onClick={() => openBook(book)}><img src={coverUrl(book)} alt="" loading="lazy" onLoad={(event) => { if (event.currentTarget.naturalWidth > 8) event.currentTarget.parentElement?.classList.add("has-cover"); else event.currentTarget.hidden = true; }} onError={(event) => { event.currentTarget.hidden = true; }} /><span className="cover-copy">{book.series && <small>{book.series}</small>}<strong>{book.title}</strong>{book.author && <em>{book.author}</em>}</span>{state?.progressLabel && <span className="cover-progress">{state.progressLabel}</span>}</button>
          {/* The ⋯ lives in the author row rather than a block below it: that is
              the only way it is guaranteed to sit on the author line whatever
              the title wraps to. The title reserves two lines so the author -
              and therefore the ⋯ - lands at the same height on every card. */}
          {displayMode === "thumbnails" ? <div className="book-caption"><strong>{book.title}</strong><span className="rr-byline"><small>{book.author || "Author unknown"}</small>{moreButton}</span></div> : <><div className="list-copy"><button onClick={() => openBook(book)} aria-label={`Open ${book.title}${book.author ? ` by ${book.author}` : ""}`}><small>{book.series || book.category || "Book"}</small><strong>{book.title}</strong><em>{book.author || "Author not listed"}</em>{state?.progressLabel && <span>{state.progressLabel}</span>}</button></div>{moreButton}</>}
          {menuFor?.id === book.id && !menuFor.where && <BookMenu book={book} />}
        </article>;
      })}</div> : (view === "favorites" && !query && activeFilters.length === 0
        // An empty shelf of your own is not a failed search.
        ? <div className="empty"><b>{myShelf === "favorites" ? "No favorites yet" : myShelf === "want" ? "Nothing on Want to Read yet" : myShelf === "finished" ? "No finished books yet" : "This collection is empty"}</b><p>Use the ⋯ on any book to add it here.</p></div>
        : <div className="empty"><b>No books found</b><p>Try clearing one or more filters.</p><button onClick={() => { setQuery(""); clearFilters(); }}>Reset search</button></div>)}
      {/* More books arrive as the end of the list comes into view; the button
          stays for keyboards and for browsers without the observer. */}
      {visible < filtered.length && <><div ref={moreRef} aria-hidden="true" style={{ height: 1 }} /><button className="load" onClick={() => setVisible((count) => count + 40)}>Show more books</button></>}
    </section>

    {seriesFocus && <div className="modal-backdrop" onMouseDown={() => setSeriesFocus(null)} role="presentation"><ModalDialog className="modal series-modal" role="dialog" aria-modal="true" aria-labelledby="series-title" onMouseDown={(event) => event.stopPropagation()}><button autoFocus className="close" onClick={() => setSeriesFocus(null)} aria-label="Close">×</button><p className="eyebrow">READ IN ORDER</p><h2 id="series-title">{seriesFocus}</h2><p className="modal-author">{seriesGroups.get(seriesFocus)?.length || 0} titles in this series</p><div className="series-list">{(seriesGroups.get(seriesFocus) || []).map((book, index) => <button key={book.id} onClick={() => openBook(book)}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{book.title}</strong><small>{book.author || book.formats.join(" · ")}{savedStates[book.id]?.progressLabel ? ` · ${savedStates[book.id].progressLabel}` : ""}</small></span><em>Read →</em></button>)}</div></ModalDialog></div>}

    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)} role="presentation"><ModalDialog className="modal" role="dialog" aria-modal="true" aria-labelledby="book-title" onMouseDown={(event) => event.stopPropagation()}><button autoFocus className="close" onClick={() => setSelected(null)} aria-label="Close">×</button><p className="eyebrow">{selected.category || "BOOK"} · {selected.collections.join(" · ") || selected.source}</p><h2 id="book-title">{selected.title}</h2><p className="modal-author">{selected.author || "Author not listed"}{selected.series ? ` · ${selected.series}` : ""}</p><BookSummaryAction book={selected} /><div className="availability"><p>Available files</p>{selected.copies.map((copy) => <div className="file-row" key={copy.id}><span><b>{copy.format}</b><small>{copy.path || copy.source}</small></span><div>{canReadHere(copy.format, copy.id) && <button onClick={() => openCopy(selected, copy)}>Read here</button>}{isReference(copy.id)
            ? <a href={`/api/book/${encodeURIComponent(copy.id)}?format=${encodeURIComponent(copy.format)}&download=1`} download>Download ↓</a>
            : <a href={`/api/book/${encodeURIComponent(copy.id)}?format=${encodeURIComponent(copy.format)}&download=1`} download>Download ↓</a>}</div></div>)}</div><p className="note">This title combines {selected.copies.length} file{selected.copies.length === 1 ? "" : "s"} into one catalogue entry.</p></ModalDialog></div>}

    {reader && <BookReader title={reader.title} file={reader.file} author={currentReaderBook?.author || undefined} coverUrl={currentReaderBook ? coverUrl(currentReaderBook) : undefined} highlights={savedStates[reader.bookId]?.highlights || []} onHighlightsChange={handleHighlightsChange} initialPosition={reader.initialPosition} bookmarks={savedStates[reader.bookId]?.bookmarks || []} onBookmarksChange={handleBookmarksChange} onLocationChange={handleReaderLocation} seriesNavigation={{ previous: readerSeriesIndex > 0 ? readerSeries[readerSeriesIndex - 1]?.title : undefined, next: readerSeriesIndex >= 0 && readerSeriesIndex < readerSeries.length - 1 ? readerSeries[readerSeriesIndex + 1]?.title : undefined, onPrevious: readerSeriesIndex > 0 ? () => openBook(readerSeries[readerSeriesIndex - 1]) : undefined, onNext: readerSeriesIndex >= 0 && readerSeriesIndex < readerSeries.length - 1 ? () => openBook(readerSeries[readerSeriesIndex + 1]) : undefined }} onClose={() => setReader(null)} />}
    <LibraryChrome view={chromeView} displayMode={displayMode} sort={sort} filtersOpen={filtersOpen} hidden={Boolean(reader || selected || seriesFocus || editionsFor)} onViewChange={chooseChromeView} onDisplayModeChange={chooseDisplayMode} onSortChange={chooseSort} onFiltersOpenChange={setFiltersOpen} />
    <footer><span>Home Books</span><p>One calm home for your digital shelves. Covers enriched by <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library</a>.</p></footer>
  </main>;
}
