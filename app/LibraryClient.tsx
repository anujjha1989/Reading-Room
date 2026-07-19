"use client";

import { useEffect, useMemo, useState } from "react";
import catalog from "./books.json";
import newAndScriptsCatalog from "./books-new-scripts.json";
import oldCatalogOne from "./books-old-1.json";
import oldCatalogTwo from "./books-old-2.json";
import oldCatalogThree from "./books-old-3.json";

type RawBook = {
  id: string; title: string; originalTitle?: string; author?: string; workKey?: string;
  format: string; source: string; collection?: string; category?: string;
  path?: string; url: string; size?: number; modified?: string;
};

type Copy = Pick<RawBook, "id" | "url" | "format" | "path" | "source">;
type Book = RawBook & { copies: Copy[]; formats: string[] };

const FORMAT_ORDER = ["EPUB", "PDF", "MOBI", "FDX", "DOCX", "DOC", "RTF", "TXT"];
const palettes = [
  ["#203a32", "#d8c9aa"], ["#773a32", "#e7d9bb"], ["#334f69", "#d7c5a7"],
  ["#59456b", "#dfcfb6"], ["#76532b", "#eadbb9"], ["#315a59", "#d9c8a5"],
];

function cleanTitle(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\.(epub|mobi|pdf|docx?|rtf|txt|fdx)$/i, "")
    .replace(/\s*[\[(]?(retail|converted|fixed|copy|ebook)[\])]?\s*$/i, "")
    .replace(/\s*[\[(]\d+[\])]\s*$/, "")
    .replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalized(value: string) {
  return cleanTitle(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(the|a|an)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function groupBooks(rows: RawBook[]): Book[] {
  const grouped = new Map<string, Book>();
  const titleIndex = new Map<string, string>();
  for (const row of rows) {
    const title = cleanTitle(row.title || row.originalTitle || "Untitled");
    const author = (row.author || "").trim();
    const isScript = /(^|\/)scripts?(\/|$)|screenplay|black list/i.test(`${row.source}/${row.path || ""}`);
    const base = normalized(title).replace(normalized(author), "").trim();
    const exactKey = `${base}|${normalized(author)}`;
    const titleKey = normalized(title);
    const indexedKey = titleIndex.get(titleKey);
    const indexedBook = indexedKey ? grouped.get(indexedKey) : undefined;
    const key = indexedKey && (!author || !indexedBook?.author) ? indexedKey : exactKey;
    const copy: Copy = { id: row.id, url: row.url, format: row.format.toUpperCase(), path: row.path, source: row.source };
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.copies.some((item) => item.id === copy.id)) existing.copies.push(copy);
      if (!existing.formats.includes(copy.format)) existing.formats.push(copy.format);
      if (!existing.author && author) existing.author = author;
      if ((!existing.collection || existing.collection === existing.source) && row.collection) existing.collection = row.collection;
      if ((!existing.category || existing.category === "General") && row.category) existing.category = row.category;
      if (isScript) { existing.category = "Script"; existing.collection = "Scripts"; }
    } else {
      grouped.set(key, { ...row, title, author, category: isScript ? "Script" : row.category, collection: isScript ? "Scripts" : row.collection, copies: [copy], formats: [copy.format] });
      if (!titleIndex.has(titleKey)) titleIndex.set(titleKey, key);
    }
  }
  return [...grouped.values()].map((book) => ({
    ...book,
    copies: [...book.copies].sort((a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)),
    formats: [...book.formats].sort((a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b)),
  })).sort((a, b) => a.title.localeCompare(b.title));
}

function options(items: Book[], field: "author" | "collection" | "category") {
  return [...new Set(items.map((item) => item[field]?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
}

function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 3).map((word) => word[0]).join("").toUpperCase();
}

export default function LibraryClient() {
  const books = useMemo(() => groupBooks([...(catalog as RawBook[]), ...(newAndScriptsCatalog as RawBook[]), ...(oldCatalogOne as RawBook[]), ...(oldCatalogTwo as RawBook[]), ...(oldCatalogThree as RawBook[])]), []);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("All collections");
  const [author, setAuthor] = useState("All authors");
  const [category, setCategory] = useState("All categories");
  const [view, setView] = useState<"library" | "favorites" | "recent">("library");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [selected, setSelected] = useState<Book | null>(null);
  const [visible, setVisible] = useState(60);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      setFavorites(JSON.parse(localStorage.getItem("reading-room-favorites") || "[]"));
      setRecent(JSON.parse(localStorage.getItem("reading-room-recent") || "[]"));
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); document.querySelector<HTMLInputElement>(".search input")?.focus();
      }
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(restore); window.removeEventListener("keydown", onKey); };
  }, []);

  const collections = useMemo(() => options(books, "collection"), [books]);
  const authors = useMemo(() => options(books, "author"), [books]);
  const categories = useMemo(() => options(books, "category"), [books]);
  const filtered = useMemo(() => {
    const term = normalized(query);
    const list = books.filter((book) => {
      const searchable = normalized([book.title, book.author, book.collection, book.category, book.path].filter(Boolean).join(" "));
      return (!term || searchable.includes(term))
        && (collection === "All collections" || book.collection === collection)
        && (author === "All authors" || book.author === author)
        && (category === "All categories" || book.category === category);
    });
    if (view === "favorites") return list.filter((book) => favorites.includes(book.id));
    if (view === "recent") return [...list].sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)).filter((book) => recent.includes(book.id));
    return list;
  }, [books, query, collection, author, category, view, favorites, recent]);

  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setFavorites(next); localStorage.setItem("reading-room-favorites", JSON.stringify(next));
  }

  function openBook(book: Book) {
    setSelected(book);
    const next = [book.id, ...recent.filter((item) => item !== book.id)].slice(0, 50);
    setRecent(next); localStorage.setItem("reading-room-recent", JSON.stringify(next));
  }

  const clearFilters = () => { setQuery(""); setCollection("All collections"); setAuthor("All authors"); setCategory("All categories"); setVisible(60); };

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => { setView("library"); clearFilters(); }} aria-label="The Reading Room home">
          <span className="brand-mark">R</span><span><strong>The Reading Room</strong><small>PRIVATE DIGITAL LIBRARY</small></span>
        </button>
        <nav aria-label="Library views">
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>Library</button>
          <button className={view === "favorites" ? "active" : ""} onClick={() => setView("favorites")}>Favorites <span>{favorites.length}</span></button>
          <button className={view === "recent" ? "active" : ""} onClick={() => setView("recent")}>Recent</button>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">CURATED FROM YOUR COLLECTION</p>
        <h1>{view === "favorites" ? "Your favorites" : view === "recent" ? "Recently opened" : "Every book, one shelf."}</h1>
        <p className="intro">Search ebooks, graphic novels, and scripts. Duplicate files and alternate formats are consolidated into a single title.</p>
        <label className="search"><span>⌕</span><input value={query} onChange={(e) => { setQuery(e.target.value); setVisible(60); }} placeholder="Search by title, author, collection, or category…" /><kbd>⌘ K</kbd></label>
      </section>

      <section className="catalog">
        <div className="filters">
          <label><span>Collection</span><select value={collection} onChange={(e) => { setCollection(e.target.value); setVisible(60); }}><option>All collections</option>{collections.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Author</span><select value={author} onChange={(e) => { setAuthor(e.target.value); setVisible(60); }}><option>All authors</option>{authors.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Category</span><select value={category} onChange={(e) => { setCategory(e.target.value); setVisible(60); }}><option>All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button className="clear" onClick={clearFilters}>Clear filters</button>
        </div>
        <div className="results"><p><strong>{filtered.length.toLocaleString()}</strong> unique titles</p><p>{collections.length.toLocaleString()} collections · Audiobooks excluded</p></div>

        {filtered.length ? <div className="grid">{filtered.slice(0, visible).map((book, index) => {
          const palette = palettes[Math.abs(book.title.length + index) % palettes.length];
          return <article className="book" key={book.id}>
            <button className="cover" style={{ "--cover": palette[0], "--ink": palette[1] } as React.CSSProperties} onClick={() => openBook(book)}>
              <span className="cover-category">{book.category || "Book"}</span><b>{initials(book.title)}</b><i></i><small>{book.author || book.collection || "The Reading Room"}</small>
            </button>
            <div className="book-meta"><p>{book.category || "General"}</p><button className="heart" onClick={() => toggleFavorite(book.id)} aria-label="Toggle favorite">{favorites.includes(book.id) ? "♥" : "♡"}</button></div>
            <h2><button onClick={() => openBook(book)}>{book.title}</button></h2>
            <p className="author">{book.author || "Author not listed"}</p>
            <div className="chips">{book.formats.map((format) => <span key={format}>{format}</span>)}{book.copies.length > 1 && <span>{book.copies.length} copies</span>}</div>
          </article>;
        })}</div> : <div className="empty"><b>No books found</b><p>Try clearing one or more filters.</p><button onClick={clearFilters}>Reset search</button></div>}
        {visible < filtered.length && <button className="load" onClick={() => setVisible((n) => n + 60)}>Show more books</button>}
      </section>

      {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="book-title" onMouseDown={(e) => e.stopPropagation()}>
          <button className="close" onClick={() => setSelected(null)} aria-label="Close">×</button>
          <p className="eyebrow">{selected.category || "BOOK"} · {selected.collection || selected.source}</p>
          <h2 id="book-title">{selected.title}</h2><p className="modal-author">{selected.author || "Author not listed"}</p>
          <div className="availability"><p>Available files</p>{selected.copies.map((copy, i) => <a key={copy.id} href={copy.url} target="_blank" rel="noreferrer"><span><b>{copy.format}</b><small>{copy.path || copy.source}</small></span><em>{i === 0 ? "Open preferred" : "Open copy"} ↗</em></a>)}</div>
          <p className="note">This title combines {selected.copies.length} file{selected.copies.length === 1 ? "" : "s"} into one catalogue entry.</p>
        </section>
      </div>}
      <footer><span>The Reading Room</span><p>One clean catalogue for your digital shelves.</p></footer>
    </main>
  );
}
