"use client";

import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import type { Book as EpubBook, Location, Rendition } from "epubjs";
import type { RenditionOptions } from "epubjs/types/rendition";
import PdfReader, { type PdfReaderHandle } from "./PdfReader";
import ComicReader, { type ComicReaderHandle } from "./ComicReader";

export type ReaderFile = {
  id: string;
  url: string;
  format: string;
};

export type ReaderLocation = {
  label: string;
  position?: string;
  status?: "reading" | "finished";
};

export type ReaderBookmark = {
  id: string;
  position: string;
  label: string;
  createdAt: number;
};

type ReaderSearchResult = { target: string; label: string; excerpt: string };

type TocEntry = { href: string; label: string; depth: number };
type ReadingMode = "pages" | "scroll";
type TocItem = { href: string; label: string; subitems?: TocItem[] };
type FoliateSection = { load?: () => Promise<string> };
type FoliateSearchGroup = {
  progress?: number;
  label?: string;
  subitems?: Array<{ cfi: string; excerpt: string | { pre?: string; match?: string; post?: string } }>;
};
type EpubSearchSection = {
  href: string;
  index: number;
  load: (request: (url: string) => Promise<unknown>) => Promise<unknown>;
  find: (query: string) => Array<{ cfi: string; excerpt: string }>;
  unload: () => void;
};
type FoliateView = HTMLElement & {
  book?: { toc?: TocItem[]; sections?: FoliateSection[]; metadata?: { title?: string } };
  renderer?: { setAttribute: (name: string, value: string) => void; setStyles: (styles: string) => void };
  open: (file: File | Blob | string) => Promise<void>;
  init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  goTo: (target: string) => Promise<unknown>;
  search?: (options: { query: string }) => AsyncGenerator<FoliateSearchGroup>;
  clearSearch?: () => void;
  close: () => void;
};

function flattenToc(items: TocItem[], depth = 0): TocEntry[] {
  return items.flatMap((item) => [
    { href: item.href, label: item.label.trim(), depth },
    ...flattenToc(item.subitems || [], depth + 1),
  ]);
}

function driveDownloadUrl(id: string) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

function readerUrl(id: string, format: string) {
  return `/api/book/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}`;
}

function previewUrl(id: string, sourceUrl: string) {
  if (sourceUrl.includes("docs.google.com/document")) return `https://docs.google.com/document/d/${id}/preview`;
  return `https://drive.google.com/file/d/${id}/preview`;
}

type ReaderTheme = "light" | "sepia" | "dark";

function isMobileViewport() {
  return window.innerWidth <= 700 || window.matchMedia("(max-width: 700px)").matches;
}

function themeColors(theme: ReaderTheme) {
  if (theme === "dark") return { ink: "#e8e4d8", paper: "#181b1a", link: "#a8c8b7" };
  if (theme === "sepia") return { ink: "#443a2d", paper: "#f3ead7", link: "#6c5b3f" };
  return { ink: "#26332f", paper: "#fffdf7", link: "#4d6b5d" };
}

function epubStyles(theme: ReaderTheme, lineHeight: number, margin: number) {
  const colors = themeColors(theme);
  return {
    ":root": { color: `${colors.ink} !important`, background: `${colors.paper} !important`, overflow: "hidden auto !important" },
    "html, body": { color: `${colors.ink} !important`, background: `${colors.paper} !important`, margin: "0 !important", "box-sizing": "border-box !important", "overflow-x": "hidden !important" },
    body: { "font-family": "Georgia, serif !important", "line-height": `${lineHeight} !important`, padding: `1.25rem max(16px, ${margin}%) 2.5rem !important`, "word-wrap": "break-word !important" },
    "*, *::before, *::after": { "box-sizing": "border-box !important" },
    "div, section, article, main, header, footer, blockquote, p, li": { "max-width": "100% !important", "min-width": "0 !important" },
    "p, li, blockquote": { "overflow-wrap": "break-word !important" },
    "pre, code": { "white-space": "pre-wrap !important", "overflow-wrap": "anywhere !important" },
    table: { display: "block !important", width: "100% !important", "max-width": "100% !important", "overflow-x": "auto !important" },
    a: { color: `${colors.link} !important` },
    "img, svg, video": { "max-width": "100% !important", height: "auto !important", "max-height": "92vh !important", "object-fit": "contain !important" },
  };
}

function mobiStyles(fontSize: number, theme: ReaderTheme, lineHeight: number, margin: number) {
  const colors = themeColors(theme);
  return `
    :root, html { color: ${colors.ink} !important; background: ${colors.paper} !important;
      overflow-x: hidden !important; box-sizing: border-box !important; }
    body { color: ${colors.ink} !important; background: ${colors.paper} !important; font-family: Georgia, serif !important;
      font-size: ${fontSize}% !important; line-height: ${lineHeight} !important;
      margin: 0 !important; padding: 1.25rem max(16px, ${margin}%) 2.5rem !important; overflow-x: hidden !important; box-sizing: border-box !important; }
    *, *::before, *::after { box-sizing: border-box !important; }
    div, section, article, main, header, footer, blockquote, p, li { max-width: 100% !important; min-width: 0 !important; }
    p, li, blockquote { overflow-wrap: break-word !important; }
    pre, code { white-space: pre-wrap !important; overflow-wrap: anywhere !important; }
    table { display: block !important; width: 100% !important; max-width: 100% !important; overflow-x: auto !important; }
    a { color: ${colors.link} !important; }
    img, svg { max-width: 100% !important; max-height: 92vh !important; object-fit: contain !important; }
  `;
}

async function secureMobiSections(view: FoliateView) {
  const safeUrls = new Set<string>();
  for (const section of view.book?.sections || []) {
    if (!section.load) continue;
    const originalLoad = section.load.bind(section);
    let safeUrl = "";
    section.load = async () => {
      if (safeUrl) return safeUrl;
      const originalUrl = await originalLoad();
      const response = await fetch(originalUrl);
      const source = await response.text();
      const contentType = response.headers.get("content-type") || "";
      const isXhtml = contentType.includes("xhtml") || /^\s*<\?xml/i.test(source);
      const mime = isXhtml ? "application/xhtml+xml" : "text/html";
      let document = new DOMParser().parseFromString(source, mime);
      if (document.querySelector("parsererror")) {
        document = new DOMParser().parseFromString(source, "text/html");
      }

      document.querySelectorAll("script, iframe, object, embed, base, meta[http-equiv='refresh' i]").forEach((node) => node.remove());
      document.querySelectorAll("*").forEach((element) => {
        for (const attribute of Array.from(element.attributes)) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim().toLowerCase();
          if (name.startsWith("on") || name === "srcdoc" || value.startsWith("javascript:")) {
            element.removeAttribute(attribute.name);
          }
        }
      });

      const serialized = document.contentType === "text/html"
        ? `<!doctype html>${document.documentElement.outerHTML}`
        : new XMLSerializer().serializeToString(document);
      safeUrl = URL.createObjectURL(new Blob([serialized], { type: document.contentType || mime }));
      safeUrls.add(safeUrl);
      return safeUrl;
    };
  }
  return () => safeUrls.forEach((url) => URL.revokeObjectURL(url));
}

export default function BookReader({ title, file, initialPosition, bookmarks = [], onBookmarksChange, onLocationChange, seriesNavigation, onClose }: {
  title: string;
  file: ReaderFile;
  initialPosition?: string;
  bookmarks?: ReaderBookmark[];
  onBookmarksChange?: (bookmarks: ReaderBookmark[]) => void;
  onLocationChange?: (location: ReaderLocation) => void;
  seriesNavigation?: { previous?: string; next?: string; onPrevious?: () => void; onNext?: () => void };
  onClose: () => void;
}) {
  const format = file.format.toUpperCase();
  const isEpub = format === "EPUB";
  const isMobi = ["MOBI", "AZW", "AZW3", "KF8"].includes(format);
  const isPdf = format === "PDF";
  const isComic = format === "CBR" || format === "CBZ";
  const isReflowable = isEpub || isMobi;
  const isBookReader = isReflowable || isPdf || isComic;
  const viewerRef = useRef<HTMLDivElement>(null);
  const onLocationChangeRef = useRef(onLocationChange);
  const pendingLocationRef = useRef<ReaderLocation | null>(null);
  const currentLocationRef = useRef<ReaderLocation>({ label: "Saved place", position: initialPosition });
  const searchRunRef = useRef(0);
  const locationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const mobiViewRef = useRef<FoliateView | null>(null);
  const pdfReaderRef = useRef<PdfReaderHandle>(null);
  const comicReaderRef = useRef<ComicReaderHandle>(null);
  const shellRef = useRef<HTMLElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const fontSizeRef = useRef(100);
  const readingModeRef = useRef<ReadingMode>("pages");
  const themeRef = useRef<ReaderTheme>("light");
  const lineHeightRef = useRef(1.65);
  const marginRef = useRef(4);
  const [status, setStatus] = useState(isBookReader ? "Loading the book…" : "");
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [fontSize, setFontSize] = useState(100);
  const [progress, setProgress] = useState("");
  const [readingMode, setReadingMode] = useState<ReadingMode | null>(null);
  const [displayTitle, setDisplayTitle] = useState(title);
  const [theme, setTheme] = useState<ReaderTheme>("light");
  const [lineHeight, setLineHeight] = useState(1.65);
  const [margin, setMargin] = useState(4);
  const [mangaMode, setMangaMode] = useState(false);
  const [epubRevision, setEpubRevision] = useState(0);
  const [panel, setPanel] = useState<"search" | "bookmarks" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState("");

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  const reportLocation = useCallback((location: ReaderLocation) => {
    currentLocationRef.current = location;
    pendingLocationRef.current = location;
    if (locationTimerRef.current) clearTimeout(locationTimerRef.current);
    locationTimerRef.current = setTimeout(() => {
      locationTimerRef.current = null;
      const pending = pendingLocationRef.current;
      pendingLocationRef.current = null;
      if (pending) onLocationChangeRef.current?.(pending);
    }, 700);
  }, []);

  useEffect(() => () => {
    if (locationTimerRef.current) clearTimeout(locationTimerRef.current);
    const pending = pendingLocationRef.current;
    if (pending) onLocationChangeRef.current?.(pending);
  }, []);
  const readerModeReady = readingMode !== null;

  useEffect(() => {
    setDisplayTitle(title);
    currentLocationRef.current = { label: "Saved place", position: initialPosition };
    searchRunRef.current += 1;
    setPanel(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchStatus("");
  }, [file.id, initialPosition, title]);

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("reading-room-reader-mode") as ReadingMode | null;
    const mode = saved === "pages" || saved === "scroll" ? saved : window.matchMedia("(max-width: 700px)").matches ? "scroll" : "pages";
    const savedTheme = localStorage.getItem("reading-room-reader-theme") as ReaderTheme | null;
    const savedLineHeight = Number(localStorage.getItem("reading-room-line-height")) || 1.65;
    const savedMargin = Number(localStorage.getItem("reading-room-reader-margin")) || 4;
    readingModeRef.current = mode;
    themeRef.current = savedTheme === "dark" || savedTheme === "sepia" ? savedTheme : "light";
    lineHeightRef.current = Math.min(2, Math.max(1.35, savedLineHeight));
    marginRef.current = Math.min(12, Math.max(2, savedMargin));
    setReadingMode(mode);
    setTheme(themeRef.current);
    setLineHeight(lineHeightRef.current);
    setMargin(marginRef.current);
  }, [file.id]);

  useEffect(() => {
    if (!isEpub || !viewerRef.current || !readerModeReady) return;
    const controller = new AbortController();
    let disposed = false;

    async function openEpub() {
      try {
        setStatus("Loading the book…");
        const response = await fetch(readerUrl(file.id, file.format), { signal: controller.signal });
        if (!response.ok) throw new Error("The book could not be downloaded");
        const data = await response.arrayBuffer();
        const { default: ePub } = await import("epubjs");
        if (disposed || !viewerRef.current) return;

        const book = ePub(data);
        bookRef.current = book;
        await book.ready;
        const mode = readingModeRef.current;
        const mobile = isMobileViewport();
        let manager: string | (new (...args: never[]) => unknown) = "default";
        if (mode === "scroll") {
          // Use epub.js's registered manager name instead of importing its
          // private implementation, which is not stable across bundler upgrades.
          manager = "continuous";
        }
        const renditionOptions: RenditionOptions & { offset?: number; offsetDelta?: number } = {
          width: "100%",
          height: "100%",
          manager,
          flow: mode === "scroll" ? "scrolled-continuous" : "paginated",
          offset: mode === "scroll" ? Math.max(1800, window.innerHeight * 3) : undefined,
          offsetDelta: mode === "scroll" ? Math.max(700, window.innerHeight) : undefined,
          spread: mode === "scroll" || mobile ? "none" : "auto",
          minSpreadWidth: 980,
        };
        const rendition = book.renderTo(viewerRef.current, renditionOptions);
        renditionRef.current = rendition;
        rendition.spread(mode === "scroll" || mobile ? "none" : "auto", 980);
        rendition.themes.default(epubStyles(themeRef.current, lineHeightRef.current, marginRef.current));
        rendition.themes.fontSize("100%");

        const saved = localStorage.getItem(`reading-room-position-${file.id}`) || initialPosition || undefined;
        try {
          await rendition.display(saved);
        } catch {
          localStorage.removeItem(`reading-room-position-${file.id}`);
          await rendition.display();
        }
        rendition.on("relocated", (location: Location) => {
          const page = location.start.displayed;
          const label = readingModeRef.current === "scroll" ? "In progress" : page?.total ? `Page ${page.page} of ${page.total}` : "In progress";
          setProgress(label);
          if (location.start.cfi) {
            localStorage.setItem(`reading-room-position-${file.id}`, location.start.cfi);
            reportLocation({ label, position: location.start.cfi, status: "reading" });
          }
        });
        try {
          const navigation = await book.loaded.navigation;
          if (!disposed) setToc(flattenToc(navigation.toc));
        } catch {
          if (!disposed) setToc([]);
        }
        setStatus("");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("This EPUB could not be opened here. You can still download it from Drive.");
      }
    }

    openEpub();
    return () => {
      disposed = true;
      controller.abort();
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [epubRevision, file.format, file.id, initialPosition, isEpub, readerModeReady, reportLocation]);

  useEffect(() => {
    if (!isEpub || !readerModeReady) return;
    const media = window.matchMedia("(max-width: 700px)");
    const updateSpread = () => renditionRef.current?.spread(readingModeRef.current === "scroll" || isMobileViewport() ? "none" : "auto", 980);
    updateSpread();
    media.addEventListener("change", updateSpread);
    window.addEventListener("resize", updateSpread);
    return () => {
      media.removeEventListener("change", updateSpread);
      window.removeEventListener("resize", updateSpread);
    };
  }, [isEpub, readerModeReady]);

  useEffect(() => {
    if (!isMobi || !viewerRef.current || !readerModeReady) return;
    const controller = new AbortController();
    let disposed = false;
    let revokeSafeUrls = () => {};

    async function openMobi() {
      try {
        setStatus("Loading the book…");
        const response = await fetch(readerUrl(file.id, file.format), { signal: controller.signal });
        if (!response.ok) throw new Error("The book could not be downloaded");
        const blob = await response.blob();
        const extension = format === "AZW3" || format === "KF8" ? "azw3" : "mobi";
        const mobiFile = new File([blob], `${title}.${extension}`, { type: "application/x-mobipocket-ebook" });
        await import("foliate-js/view.js");
        if (disposed || !viewerRef.current) return;

        const view = document.createElement("foliate-view") as FoliateView;
        Object.assign(view.style, { display: "block", width: "100%", height: "100%" });
        viewerRef.current.append(view);
        mobiViewRef.current = view;
        await view.open(mobiFile);
        const metadataTitle = view.book?.metadata?.title?.trim();
        if (metadataTitle && metadataTitle.length > title.trim().length) setDisplayTitle(metadataTitle);
        revokeSafeUrls = await secureMobiSections(view);
        view.renderer?.setAttribute("flow", readingModeRef.current === "scroll" ? "scrolled" : "paginated");
        view.renderer?.setAttribute("max-column-count", isMobileViewport() ? "1" : "2");
        view.renderer?.setStyles(mobiStyles(fontSizeRef.current, themeRef.current, lineHeightRef.current, marginRef.current));
        view.addEventListener("load", () => view.renderer?.setStyles(mobiStyles(fontSizeRef.current, themeRef.current, lineHeightRef.current, marginRef.current)));
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<{ fraction?: number; cfi?: string; tocItem?: { label?: string } }>).detail;
          const percent = typeof detail.fraction === "number" ? `${Math.max(1, Math.round(detail.fraction * 100))}%` : "";
          const label = detail.tocItem?.label || percent || "In progress";
          setProgress(label);
          if (detail.cfi) {
            localStorage.setItem(`reading-room-position-${file.id}`, detail.cfi);
            reportLocation({ label, position: detail.cfi, status: "reading" });
          }
        });

        const saved = localStorage.getItem(`reading-room-position-${file.id}`) || initialPosition || undefined;
        await view.init({ lastLocation: saved, showTextStart: true });
        if (!disposed) setToc(flattenToc(view.book?.toc || []));
        setStatus("");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("This MOBI could not be opened here. It may be encrypted or use an unsupported Kindle format.");
      }
    }

    openMobi();
    return () => {
      disposed = true;
      controller.abort();
      revokeSafeUrls();
      mobiViewRef.current?.close();
      mobiViewRef.current?.remove();
      mobiViewRef.current = null;
    };
  }, [file.id, file.format, format, initialPosition, isMobi, readerModeReady, reportLocation, title]);

  useEffect(() => {
    if (!isMobi || !readerModeReady) return;
    const media = window.matchMedia("(max-width: 700px)");
    const updateColumns = () => mobiViewRef.current?.renderer?.setAttribute("max-column-count", isMobileViewport() ? "1" : "2");
    updateColumns();
    media.addEventListener("change", updateColumns);
    window.addEventListener("resize", updateColumns);
    return () => {
      media.removeEventListener("change", updateColumns);
      window.removeEventListener("resize", updateColumns);
    };
  }, [isMobi, readerModeReady]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
    themeRef.current = theme;
    lineHeightRef.current = lineHeight;
    marginRef.current = margin;
    renditionRef.current?.themes.default(epubStyles(theme, lineHeight, margin));
    mobiViewRef.current?.renderer?.setStyles(mobiStyles(fontSize, theme, lineHeight, margin));
    localStorage.setItem("reading-room-reader-theme", theme);
    localStorage.setItem("reading-room-line-height", String(lineHeight));
    localStorage.setItem("reading-room-reader-margin", String(margin));
  }, [fontSize, lineHeight, margin, theme]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") {
        if (panel) setPanel(null);
        else onClose();
      }
      if (isBookReader && event.key === "ArrowLeft") previous();
      if (isBookReader && event.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function chooseReadingMode(mode: ReadingMode) {
    if (mode === readingModeRef.current) return;
    localStorage.setItem("reading-room-reader-mode", mode);
    readingModeRef.current = mode;
    setReadingMode(mode);
    if (isEpub) {
      setEpubRevision((revision) => revision + 1);
      return;
    }
    if (isMobi) {
      mobiViewRef.current?.renderer?.setAttribute("flow", mode === "scroll" ? "scrolled" : "paginated");
      mobiViewRef.current?.renderer?.setAttribute("max-column-count", isMobileViewport() ? "1" : "2");
    }
  }

  function goToChapter(href: string) {
    if (isEpub) renditionRef.current?.display(href);
    else mobiViewRef.current?.goTo(href);
  }

  async function performSearch() {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchStatus("Enter at least two characters.");
      return;
    }
    const run = ++searchRunRef.current;
    setSearchResults([]);
    setSearchStatus("Searching…");
    try {
      let results: ReaderSearchResult[] = [];
      if (isEpub && bookRef.current) {
        const searchable = bookRef.current as unknown as {
          spine: { each: (callback: (section: EpubSearchSection) => void) => void };
          load: (url: string) => Promise<unknown>;
        };
        const sections: EpubSearchSection[] = [];
        searchable.spine.each((section) => sections.push(section));
        for (let index = 0; index < sections.length && results.length < 80; index += 1) {
          if (run !== searchRunRef.current) return;
          const section = sections[index];
          try {
            await section.load(searchable.load.bind(searchable));
            const label = toc.find((item) => item.href.split("#")[0] === section.href.split("#")[0])?.label || `Section ${index + 1}`;
            results.push(...section.find(query).slice(0, 8).map((match) => ({ target: match.cfi, label, excerpt: match.excerpt.replace(/<[^>]+>/g, "") })));
          } finally {
            section.unload();
          }
          if (index % 4 === 0) setSearchStatus(`Searching ${index + 1} of ${sections.length} sections…`);
        }
      } else if (isMobi && mobiViewRef.current?.search) {
        for await (const group of mobiViewRef.current.search({ query })) {
          if (run !== searchRunRef.current) return;
          for (const match of group.subitems || []) {
            const excerpt = typeof match.excerpt === "string" ? match.excerpt : `${match.excerpt.pre || ""}${match.excerpt.match || ""}${match.excerpt.post || ""}`;
            results.push({ target: match.cfi, label: group.label || "Match", excerpt });
            if (results.length >= 80) break;
          }
          if (results.length >= 80) break;
        }
      } else if (isPdf) {
        results = await pdfReaderRef.current?.search(query) || [];
      }
      if (run !== searchRunRef.current) return;
      setSearchResults(results.slice(0, 80));
      setSearchStatus(results.length ? `${Math.min(results.length, 80)} match${results.length === 1 ? "" : "es"}` : "No matches found.");
    } catch {
      if (run === searchRunRef.current) setSearchStatus("Search could not be completed for this book.");
    }
  }

  function goToPosition(position: string) {
    if (isEpub) renditionRef.current?.display(position);
    else if (isMobi) mobiViewRef.current?.goTo(position);
    else if (isPdf) pdfReaderRef.current?.goTo(Number(position));
    else if (isComic) comicReaderRef.current?.goTo(Number(position));
    setPanel(null);
  }

  function addBookmark() {
    const location = currentLocationRef.current;
    if (!location.position || bookmarks.some((bookmark) => bookmark.position === location.position)) return;
    onBookmarksChange?.([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, position: location.position, label: location.label || "Saved place", createdAt: Date.now() }, ...bookmarks].slice(0, 100));
  }

  function removeBookmark(id: string) {
    onBookmarksChange?.(bookmarks.filter((bookmark) => bookmark.id !== id));
  }

  function previous() {
    if (isEpub) renditionRef.current?.prev();
    else if (isMobi) mobiViewRef.current?.prev();
    else if (isPdf) pdfReaderRef.current?.previous();
    else if (isComic) comicReaderRef.current?.previous();
  }

  function next() {
    if (isEpub) renditionRef.current?.next();
    else if (isMobi) mobiViewRef.current?.next();
    else if (isPdf) pdfReaderRef.current?.next();
    else if (isComic) comicReaderRef.current?.next();
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shellRef.current?.requestFullscreen();
  }

  function endSwipe(event: TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || readingModeRef.current !== "pages") return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      if (dx < 0) mangaMode && isComic ? previous() : next();
      else mangaMode && isComic ? next() : previous();
    }
  }

  return (
    <section className={`reader-shell reader-theme-${theme}`} ref={shellRef} aria-label={`Reading ${displayTitle}`}>
      <header className="reader-header">
        <div><span>THE READING ROOM</span><h1>{displayTitle}</h1></div>
        <div className="reader-actions">
          {isReflowable && toc.length > 0 && <label><span>Chapter</span><select defaultValue="" onChange={(event) => event.target.value && goToChapter(event.target.value)}><option value="" disabled>Contents</option>{toc.map((item, index) => <option key={`${item.href}-${index}`} value={item.href}>{`${"— ".repeat(item.depth)}${item.label}`}</option>)}</select></label>}
          {isBookReader && readingMode && <div className="reader-modes" aria-label="Reading mode"><button className={readingMode === "pages" ? "active" : ""} aria-pressed={readingMode === "pages"} onClick={() => chooseReadingMode("pages")}>Pages</button><button className={readingMode === "scroll" ? "active" : ""} aria-pressed={readingMode === "scroll"} onClick={() => chooseReadingMode("scroll")}>Scroll</button></div>}
          {isReflowable && <div className="font-controls" aria-label="Text size"><button onClick={() => setFontSize((size) => Math.max(75, size - 10))} aria-label="Decrease text size">A−</button><button onClick={() => setFontSize((size) => Math.min(160, size + 10))} aria-label="Increase text size">A+</button></div>}
          {isBookReader && <details className="reader-settings"><summary aria-label="Reading appearance">Aa</summary><div><span>Theme</span><div className="theme-options"><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>Light</button><button className={theme === "sepia" ? "active" : ""} onClick={() => setTheme("sepia")}>Sepia</button><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>Dark</button></div>{isReflowable && <><span>Line spacing</span><input type="range" min="1.35" max="2" step="0.05" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} /><span>Margins</span><input type="range" min="2" max="12" step="1" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></>}</div></details>}
          {isComic && <button className={mangaMode ? "active" : ""} onClick={() => setMangaMode((enabled) => !enabled)} aria-pressed={mangaMode}>Manga</button>}
          {(seriesNavigation?.previous || seriesNavigation?.next) && <div className="reader-series-nav"><button disabled={!seriesNavigation.previous} title={seriesNavigation.previous} onClick={seriesNavigation.onPrevious}>Previous issue</button><button disabled={!seriesNavigation.next} title={seriesNavigation.next} onClick={seriesNavigation.onNext}>Next issue</button></div>}
          {(isReflowable || isPdf) && <button className={panel === "search" ? "active" : ""} onClick={() => setPanel((current) => current === "search" ? null : "search")} aria-label="Search inside book">⌕ <span className="reader-action-label">Search</span></button>}
          {isBookReader && <button className={panel === "bookmarks" ? "active" : ""} onClick={() => setPanel((current) => current === "bookmarks" ? null : "bookmarks")} aria-label={`Bookmarks${bookmarks.length ? `, ${bookmarks.length} saved` : ""}`}>▮ <span className="reader-action-label">Bookmarks{bookmarks.length ? ` ${bookmarks.length}` : ""}</span></button>}
          <button onClick={toggleFullscreen} aria-label="Toggle full screen">⛶</button>
          <a href={file.url} target="_blank" rel="noreferrer">Open in Drive ↗</a>
          <button className="reader-close" onClick={onClose} aria-label="Close reader">×</button>
        </div>
      </header>

      {panel === "search" && <aside className="reader-panel" aria-label="Search inside book">
        <div className="reader-panel-heading"><div><span>FIND IN BOOK</span><strong>Search this title</strong></div><button onClick={() => setPanel(null)} aria-label="Close search">×</button></div>
        <form className="reader-search-form" onSubmit={(event) => { event.preventDefault(); performSearch(); }}><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Word or phrase…" aria-label="Word or phrase" /><button type="submit">Search</button></form>
        {searchStatus && <p className="reader-panel-status">{searchStatus}</p>}
        <div className="reader-search-results">{searchResults.map((result, index) => <button key={`${result.target}-${index}`} onClick={() => goToPosition(result.target)}><strong>{result.label}</strong><span>{result.excerpt}</span></button>)}</div>
      </aside>}

      {panel === "bookmarks" && <aside className="reader-panel" aria-label="Bookmarks">
        <div className="reader-panel-heading"><div><span>SAVED PLACES</span><strong>Bookmarks</strong></div><button onClick={() => setPanel(null)} aria-label="Close bookmarks">×</button></div>
        <button className="reader-add-bookmark" onClick={addBookmark}>+ Bookmark current place</button>
        <div className="reader-bookmarks">{bookmarks.length ? bookmarks.map((bookmark) => <div key={bookmark.id}><button onClick={() => goToPosition(bookmark.position)}><strong>{bookmark.label}</strong><span>{new Date(bookmark.createdAt).toLocaleDateString()}</span></button><button onClick={() => removeBookmark(bookmark.id)} aria-label={`Remove bookmark ${bookmark.label}`}>×</button></div>) : <p>No bookmarks yet.</p>}</div>
      </aside>}

      {isBookReader ? <>
        <div className="epub-stage" onTouchStart={(event) => { const touch = event.touches[0]; touchStartRef.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={endSwipe}>{isReflowable && <div className="epub-viewer" ref={viewerRef}></div>}{isPdf && readingMode && <PdfReader ref={pdfReaderRef} fileId={file.id} format={file.format} mode={readingMode} initialPosition={initialPosition} onStatus={setStatus} onProgress={setProgress} onLocationChange={reportLocation} />}{isComic && readingMode && <ComicReader ref={comicReaderRef} fileId={file.id} format={file.format} mode={readingMode} direction={mangaMode ? "rtl" : "ltr"} initialPosition={initialPosition} onStatus={setStatus} onProgress={setProgress} onLocationChange={reportLocation} />}{status && <div className="reader-message"><p>{status}</p>{status.includes("could not") && <a href={driveDownloadUrl(file.id)}>Download {format}</a>}</div>}</div>
        <footer className="reader-footer"><button onClick={previous}>← Previous</button><span>{progress || (readingMode === "scroll" ? "Continuous scroll" : "Use the arrow keys to turn pages")}</span><button onClick={next}>Next →</button></footer>
      </> : <iframe className="document-reader" src={previewUrl(file.id, file.url)} title={`Reader for ${title}`} allow="fullscreen" />}
    </section>
  );
}
