"use client";

import { useEffect, useRef, useState } from "react";
import type { Book as EpubBook, Location, NavItem, Rendition } from "epubjs";

export type ReaderFile = {
  id: string;
  url: string;
  format: string;
};

type TocEntry = { href: string; label: string; depth: number };

function flattenToc(items: NavItem[], depth = 0): TocEntry[] {
  return items.flatMap((item) => [
    { href: item.href, label: item.label.trim(), depth },
    ...flattenToc(item.subitems || [], depth + 1),
  ]);
}

function driveDownloadUrl(id: string) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

function readerUrl(id: string) {
  return `/api/book/${encodeURIComponent(id)}`;
}

function previewUrl(id: string, sourceUrl: string) {
  if (sourceUrl.includes("docs.google.com/document")) return `https://docs.google.com/document/d/${id}/preview`;
  return `https://drive.google.com/file/d/${id}/preview`;
}

export default function BookReader({ title, file, onClose }: { title: string; file: ReaderFile; onClose: () => void }) {
  const isEpub = file.format.toUpperCase() === "EPUB";
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const [status, setStatus] = useState(isEpub ? "Loading the book…" : "");
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [fontSize, setFontSize] = useState(100);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (!isEpub || !viewerRef.current) return;
    const controller = new AbortController();
    let disposed = false;

    async function openEpub() {
      try {
        setStatus("Loading the book…");
        const response = await fetch(readerUrl(file.id), { signal: controller.signal });
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
          flow: "paginated",
          spread: "auto",
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
          setProgress(page?.total ? `Page ${page.page} of ${page.total}` : "");
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
  }, [file.id, isEpub]);

  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (isEpub && event.key === "ArrowLeft") renditionRef.current?.prev();
      if (isEpub && event.key === "ArrowRight") renditionRef.current?.next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEpub, onClose]);

  return (
    <section className="reader-shell" aria-label={`Reading ${title}`}>
      <header className="reader-header">
        <div><span>THE READING ROOM</span><h1>{title}</h1></div>
        <div className="reader-actions">
          {isEpub && toc.length > 0 && <label><span>Chapter</span><select defaultValue="" onChange={(event) => event.target.value && renditionRef.current?.display(event.target.value)}><option value="" disabled>Contents</option>{toc.map((item, index) => <option key={`${item.href}-${index}`} value={item.href}>{`${"— ".repeat(item.depth)}${item.label}`}</option>)}</select></label>}
          {isEpub && <div className="font-controls" aria-label="Text size"><button onClick={() => setFontSize((size) => Math.max(75, size - 10))} aria-label="Decrease text size">A−</button><button onClick={() => setFontSize((size) => Math.min(160, size + 10))} aria-label="Increase text size">A+</button></div>}
          <a href={file.url} target="_blank" rel="noreferrer">Open in Drive ↗</a>
          <button className="reader-close" onClick={onClose} aria-label="Close reader">×</button>
        </div>
      </header>

      {isEpub ? <>
        <div className="epub-stage"><div className="epub-viewer" ref={viewerRef}></div>{status && <div className="reader-message"><p>{status}</p>{status.includes("could not") && <a href={driveDownloadUrl(file.id)}>Download EPUB</a>}</div>}</div>
        <footer className="reader-footer"><button onClick={() => renditionRef.current?.prev()}>← Previous</button><span>{progress || "Use the arrow keys to turn pages"}</span><button onClick={() => renditionRef.current?.next()}>Next →</button></footer>
      </> : <iframe className="document-reader" src={previewUrl(file.id, file.url)} title={`Reader for ${title}`} allow="fullscreen" />}
    </section>
  );
}
