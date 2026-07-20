"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import type { Book as EpubBook, Location, Rendition } from "epubjs";
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

type TocEntry = { href: string; label: string; depth: number };
type ReadingMode = "pages" | "scroll";
type TocItem = { href: string; label: string; subitems?: TocItem[] };
type FoliateSection = { load?: () => Promise<string> };
type FoliateView = HTMLElement & {
  book?: { toc?: TocItem[]; sections?: FoliateSection[]; metadata?: { title?: string } };
  renderer?: { setAttribute: (name: string, value: string) => void; setStyles: (styles: string) => void };
  open: (file: File | Blob | string) => Promise<void>;
  init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  goTo: (target: string) => Promise<unknown>;
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

function themeColors(theme: ReaderTheme) {
  if (theme === "dark") return { ink: "#e8e4d8", paper: "#181b1a", link: "#a8c8b7" };
  if (theme === "sepia") return { ink: "#443a2d", paper: "#f3ead7", link: "#6c5b3f" };
  return { ink: "#26332f", paper: "#fffdf7", link: "#4d6b5d" };
}

function mobiStyles(fontSize: number, theme: ReaderTheme, lineHeight: number, margin: number) {
  const colors = themeColors(theme);
  return `
    :root { color: ${colors.ink} !important; background: ${colors.paper} !important; }
    body { color: ${colors.ink} !important; background: ${colors.paper} !important; font-family: Georgia, serif !important;
      font-size: ${fontSize}% !important; line-height: ${lineHeight} !important; padding-inline: ${margin}% !important; }
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

export default function BookReader({ title, file, initialPosition, onLocationChange, seriesNavigation, onClose }: {
  title: string;
  file: ReaderFile;
  initialPosition?: string;
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

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);
  const readerModeReady = readingMode !== null;

  useEffect(() => {
    setDisplayTitle(title);
  }, [file.id, title]);

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
        const rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          manager: "continuous",
          flow: mode === "scroll" ? "scrolled" : "paginated",
          spread: mode === "scroll" ? "none" : "auto",
          minSpreadWidth: 980,
        });
        renditionRef.current = rendition;
        const colors = themeColors(themeRef.current);
        rendition.themes.default({
          body: { color: colors.ink, background: colors.paper, "font-family": "Georgia, serif", "line-height": String(lineHeightRef.current), padding: `0 ${marginRef.current}%` },
          "p, li": { "font-size": "1em" },
          a: { color: colors.link },
          img: { "max-width": "100%", "max-height": "95vh", "object-fit": "contain" },
        });
        rendition.themes.fontSize("100%");

        const saved = initialPosition || localStorage.getItem(`reading-room-position-${file.id}`) || undefined;
        await rendition.display(saved);
        rendition.on("relocated", (location: Location) => {
          const page = location.start.displayed;
          const label = readingModeRef.current === "scroll" ? "In progress" : page?.total ? `Page ${page.page} of ${page.total}` : "In progress";
          setProgress(label);
          if (location.start.cfi) {
            localStorage.setItem(`reading-room-position-${file.id}`, location.start.cfi);
            onLocationChangeRef.current?.({ label, position: location.start.cfi, status: "reading" });
          }
        });
        const navigation = await book.loaded.navigation;
        if (!disposed) setToc(flattenToc(navigation.toc));
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
  }, [file.format, file.id, initialPosition, isEpub, readerModeReady]);

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
        view.renderer?.setStyles(mobiStyles(fontSizeRef.current, themeRef.current, lineHeightRef.current, marginRef.current));
        view.addEventListener("load", () => view.renderer?.setStyles(mobiStyles(fontSizeRef.current, themeRef.current, lineHeightRef.current, marginRef.current)));
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<{ fraction?: number; cfi?: string; tocItem?: { label?: string } }>).detail;
          const percent = typeof detail.fraction === "number" ? `${Math.max(1, Math.round(detail.fraction * 100))}%` : "";
          const label = detail.tocItem?.label || percent || "In progress";
          setProgress(label);
          if (detail.cfi) {
            localStorage.setItem(`reading-room-position-${file.id}`, detail.cfi);
            onLocationChangeRef.current?.({ label, position: detail.cfi, status: "reading" });
          }
        });

        const saved = initialPosition || localStorage.getItem(`reading-room-position-${file.id}`) || undefined;
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
  }, [file.id, file.format, format, initialPosition, isMobi, readerModeReady, title]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
    themeRef.current = theme;
    lineHeightRef.current = lineHeight;
    marginRef.current = margin;
    const colors = themeColors(theme);
    renditionRef.current?.themes.default({
      body: { color: colors.ink, background: colors.paper, "font-family": "Georgia, serif", "line-height": String(lineHeight), padding: `0 ${margin}%` },
      a: { color: colors.link },
      img: { "max-width": "100%", "max-height": "95vh", "object-fit": "contain" },
    });
    mobiViewRef.current?.renderer?.setStyles(mobiStyles(fontSize, theme, lineHeight, margin));
    localStorage.setItem("reading-room-reader-theme", theme);
    localStorage.setItem("reading-room-line-height", String(lineHeight));
    localStorage.setItem("reading-room-reader-margin", String(margin));
  }, [fontSize, lineHeight, margin, theme]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (isBookReader && event.key === "ArrowLeft") previous();
      if (isBookReader && event.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function chooseReadingMode(mode: ReadingMode) {
    localStorage.setItem("reading-room-reader-mode", mode);
    readingModeRef.current = mode;
    setReadingMode(mode);
    if (isEpub) {
      renditionRef.current?.flow(mode === "scroll" ? "scrolled" : "paginated");
      renditionRef.current?.spread(mode === "scroll" ? "none" : "auto", 980);
    }
    if (isMobi) mobiViewRef.current?.renderer?.setAttribute("flow", mode === "scroll" ? "scrolled" : "paginated");
  }

  function goToChapter(href: string) {
    if (isEpub) renditionRef.current?.display(href);
    else mobiViewRef.current?.goTo(href);
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
          <button onClick={toggleFullscreen} aria-label="Toggle full screen">⛶</button>
          <a href={file.url} target="_blank" rel="noreferrer">Open in Drive ↗</a>
          <button className="reader-close" onClick={onClose} aria-label="Close reader">×</button>
        </div>
      </header>

      {isBookReader ? <>
        <div className="epub-stage" onTouchStart={(event) => { const touch = event.touches[0]; touchStartRef.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={endSwipe}>{isReflowable && <div className="epub-viewer" ref={viewerRef}></div>}{isPdf && readingMode && <PdfReader ref={pdfReaderRef} fileId={file.id} format={file.format} mode={readingMode} initialPosition={initialPosition} onStatus={setStatus} onProgress={setProgress} onLocationChange={onLocationChange} />}{isComic && readingMode && <ComicReader ref={comicReaderRef} fileId={file.id} format={file.format} mode={readingMode} direction={mangaMode ? "rtl" : "ltr"} initialPosition={initialPosition} onStatus={setStatus} onProgress={setProgress} onLocationChange={onLocationChange} />}{status && <div className="reader-message"><p>{status}</p>{status.includes("could not") && <a href={driveDownloadUrl(file.id)}>Download {format}</a>}</div>}</div>
        <footer className="reader-footer"><button onClick={previous}>← {readingMode === "scroll" ? "Previous section" : "Previous"}</button><span>{progress || (readingMode === "scroll" ? "Scroll to continue" : "Use the arrow keys to turn pages")}</span><button onClick={next}>{readingMode === "scroll" ? "Next section" : "Next"} →</button></footer>
      </> : <iframe className="document-reader" src={previewUrl(file.id, file.url)} title={`Reader for ${title}`} allow="fullscreen" />}
    </section>
  );
}
