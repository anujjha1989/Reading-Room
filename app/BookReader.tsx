"use client";

import { useEffect, useRef, useState } from "react";
import type { Book as EpubBook, Location, Rendition } from "epubjs";

export type ReaderFile = {
  id: string;
  url: string;
  format: string;
};

type TocEntry = { href: string; label: string; depth: number };
type ReadingMode = "pages" | "scroll";
type TocItem = { href: string; label: string; subitems?: TocItem[] };
type FoliateSection = { load?: () => Promise<string> };
type FoliateView = HTMLElement & {
  book?: { toc?: TocItem[]; sections?: FoliateSection[] };
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

function mobiStyles(fontSize: number) {
  return `
    :root { color: #26332f !important; background: #fffdf7 !important; }
    body { color: #26332f !important; background: #fffdf7 !important; font-family: Georgia, serif !important;
      font-size: ${fontSize}% !important; line-height: 1.65 !important; padding-inline: 4% !important; }
    a { color: #4d6b5d !important; }
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

export default function BookReader({ title, file, onClose }: { title: string; file: ReaderFile; onClose: () => void }) {
  const format = file.format.toUpperCase();
  const isEpub = format === "EPUB";
  const isMobi = ["MOBI", "AZW", "AZW3", "KF8"].includes(format);
  const isReflowable = isEpub || isMobi;
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const mobiViewRef = useRef<FoliateView | null>(null);
  const fontSizeRef = useRef(100);
  const [status, setStatus] = useState(isReflowable ? "Loading the book…" : "");
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [fontSize, setFontSize] = useState(100);
  const [progress, setProgress] = useState("");
  const [readingMode, setReadingMode] = useState<ReadingMode | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("reading-room-reader-mode") as ReadingMode | null;
    if (saved === "pages" || saved === "scroll") setReadingMode(saved);
    else setReadingMode(window.matchMedia("(max-width: 700px)").matches ? "scroll" : "pages");
  }, [file.id]);

  useEffect(() => {
    if (!isEpub || !viewerRef.current || !readingMode) return;
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
        const rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          manager: readingMode === "scroll" ? "continuous" : undefined,
          flow: readingMode === "scroll" ? "scrolled" : "paginated",
          spread: readingMode === "scroll" ? "none" : "auto",
          minSpreadWidth: 980,
        });
        renditionRef.current = rendition;
        rendition.themes.default({
          body: { color: "#26332f", background: "#fffdf7", "font-family": "Georgia, serif", "line-height": "1.65", padding: "0 3%" },
          "p, li": { "font-size": "1em" },
          a: { color: "#4d6b5d" },
          img: { "max-width": "100%", "max-height": "95vh", "object-fit": "contain" },
        });
        rendition.themes.fontSize("100%");

        const saved = localStorage.getItem(`reading-room-position-${file.id}`) || undefined;
        await rendition.display(saved);
        rendition.on("relocated", (location: Location) => {
          const page = location.start.displayed;
          setProgress(readingMode === "scroll" ? "Scroll to continue" : page?.total ? `Page ${page.page} of ${page.total}` : "");
          if (location.start.cfi) localStorage.setItem(`reading-room-position-${file.id}`, location.start.cfi);
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
  }, [file.id, isEpub, readingMode]);

  useEffect(() => {
    if (!isMobi || !viewerRef.current || !readingMode) return;
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
        revokeSafeUrls = await secureMobiSections(view);
        view.renderer?.setAttribute("flow", readingMode === "scroll" ? "scrolled" : "paginated");
        view.renderer?.setStyles(mobiStyles(fontSizeRef.current));
        view.addEventListener("load", () => view.renderer?.setStyles(mobiStyles(fontSizeRef.current)));
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<{ fraction?: number; cfi?: string; tocItem?: { label?: string } }>).detail;
          const percent = typeof detail.fraction === "number" ? `${Math.max(1, Math.round(detail.fraction * 100))}%` : "";
          setProgress(detail.tocItem?.label || (readingMode === "scroll" ? "Scroll to continue" : percent));
          if (detail.cfi) localStorage.setItem(`reading-room-position-${file.id}`, detail.cfi);
        });

        const saved = localStorage.getItem(`reading-room-position-${file.id}`) || undefined;
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
  }, [file.id, file.format, format, isMobi, readingMode, title]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
    mobiViewRef.current?.renderer?.setStyles(mobiStyles(fontSize));
  }, [fontSize]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (isReflowable && event.key === "ArrowLeft") isEpub ? renditionRef.current?.prev() : mobiViewRef.current?.prev();
      if (isReflowable && event.key === "ArrowRight") isEpub ? renditionRef.current?.next() : mobiViewRef.current?.next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEpub, isReflowable, onClose]);

  function chooseReadingMode(mode: ReadingMode) {
    localStorage.setItem("reading-room-reader-mode", mode);
    setReadingMode(mode);
  }

  function goToChapter(href: string) {
    if (isEpub) renditionRef.current?.display(href);
    else mobiViewRef.current?.goTo(href);
  }

  function previous() {
    if (isEpub) renditionRef.current?.prev();
    else mobiViewRef.current?.prev();
  }

  function next() {
    if (isEpub) renditionRef.current?.next();
    else mobiViewRef.current?.next();
  }

  return (
    <section className="reader-shell" aria-label={`Reading ${title}`}>
      <header className="reader-header">
        <div><span>THE READING ROOM</span><h1>{title}</h1></div>
        <div className="reader-actions">
          {isReflowable && toc.length > 0 && <label><span>Chapter</span><select defaultValue="" onChange={(event) => event.target.value && goToChapter(event.target.value)}><option value="" disabled>Contents</option>{toc.map((item, index) => <option key={`${item.href}-${index}`} value={item.href}>{`${"— ".repeat(item.depth)}${item.label}`}</option>)}</select></label>}
          {isReflowable && readingMode && <div className="reader-modes" aria-label="Reading mode"><button className={readingMode === "pages" ? "active" : ""} aria-pressed={readingMode === "pages"} onClick={() => chooseReadingMode("pages")}>Pages</button><button className={readingMode === "scroll" ? "active" : ""} aria-pressed={readingMode === "scroll"} onClick={() => chooseReadingMode("scroll")}>Scroll</button></div>}
          {isReflowable && <div className="font-controls" aria-label="Text size"><button onClick={() => setFontSize((size) => Math.max(75, size - 10))} aria-label="Decrease text size">A−</button><button onClick={() => setFontSize((size) => Math.min(160, size + 10))} aria-label="Increase text size">A+</button></div>}
          <a href={file.url} target="_blank" rel="noreferrer">Open in Drive ↗</a>
          <button className="reader-close" onClick={onClose} aria-label="Close reader">×</button>
        </div>
      </header>

      {isReflowable ? <>
        <div className="epub-stage"><div className="epub-viewer" ref={viewerRef}></div>{status && <div className="reader-message"><p>{status}</p>{status.includes("could not") && <a href={driveDownloadUrl(file.id)}>Download {format}</a>}</div>}</div>
        <footer className="reader-footer"><button onClick={previous}>← {readingMode === "scroll" ? "Previous section" : "Previous"}</button><span>{progress || (readingMode === "scroll" ? "Scroll to continue" : "Use the arrow keys to turn pages")}</span><button onClick={next}>{readingMode === "scroll" ? "Next section" : "Next"} →</button></footer>
      </> : <iframe className="document-reader" src={previewUrl(file.id, file.url)} title={`Reader for ${title}`} allow="fullscreen" />}
    </section>
  );
}
