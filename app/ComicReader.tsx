"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

export type ComicReaderHandle = { previous: () => void; next: () => void };
type ComicPage = { name: string; url: string };

const IMAGE_PATTERN = /\.(?:avif|bmp|gif|jpe?g|jxl|png|svg|webp)$/i;

function imageType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ avif: "image/avif", bmp: "image/bmp", gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg", jxl: "image/jxl", png: "image/png", svg: "image/svg+xml", webp: "image/webp" } as Record<string, string>)[extension || ""] || "application/octet-stream";
}

function sortPages<T extends { name: string }>(pages: T[]) {
  return pages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function openCbr(data: ArrayBuffer): Promise<ComicPage[]> {
  const [{ createExtractorFromData }, wasmResponse] = await Promise.all([
    import("node-unrar-js/esm/index.esm.js"),
    fetch("/unrar.wasm"),
  ]);
  if (!wasmResponse.ok) throw new Error("The CBR reader could not start");
  const extractor = await createExtractorFromData({ data, wasmBinary: await wasmResponse.arrayBuffer() });
  const headers = [...extractor.getFileList().fileHeaders].filter((header) => !header.flags.directory && IMAGE_PATTERN.test(header.name));
  if (!headers.length) throw new Error("No comic pages were found in this CBR file");
  const extracted = extractor.extract({ files: headers.map((header) => header.name) });
  const pages: ComicPage[] = [];
  for (const file of extracted.files) {
    if (!file.extraction || !IMAGE_PATTERN.test(file.fileHeader.name)) continue;
    const bytes = new Uint8Array(file.extraction.byteLength);
    bytes.set(file.extraction);
    pages.push({ name: file.fileHeader.name, url: URL.createObjectURL(new Blob([bytes], { type: imageType(file.fileHeader.name) })) });
  }
  return sortPages(pages);
}

async function openCbz(data: ArrayBuffer): Promise<ComicPage[]> {
  const { configure, ZipReader, BlobReader, BlobWriter } = await import("foliate-js/vendor/zip.js");
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(new Blob([data])));
  try {
    const entries = await reader.getEntries();
    const images = entries.filter((entry) => !entry.directory && IMAGE_PATTERN.test(entry.filename));
    if (!images.length) throw new Error("No comic pages were found in this CBZ file");
    const pages: ComicPage[] = [];
    for (const entry of images) {
      const blob = await entry.getData(new BlobWriter(imageType(entry.filename)));
      pages.push({ name: entry.filename, url: URL.createObjectURL(blob) });
    }
    return sortPages(pages);
  } finally {
    await reader.close();
  }
}

const ComicReader = forwardRef<ComicReaderHandle, {
  fileId: string;
  format: string;
  mode: "pages" | "scroll";
  onStatus: (status: string) => void;
  onProgress: (progress: string) => void;
}>(function ComicReader({ fileId, format, mode, onStatus, onProgress }, ref) {
  const [pages, setPages] = useState<ComicPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const spreadSize = mode === "pages" && !isMobile ? 2 : 1;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let urls: string[] = [];
    setPages([]);
    setPageIndex(0);
    onStatus("Loading the comic…");
    fetch(`/api/book/${encodeURIComponent(fileId)}?format=${encodeURIComponent(format)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("The comic could not be downloaded");
        return response.arrayBuffer();
      })
      .then((data) => format.toUpperCase() === "CBR" ? openCbr(data) : openCbz(data))
      .then((nextPages) => {
        if (controller.signal.aborted) {
          nextPages.forEach((page) => URL.revokeObjectURL(page.url));
          return;
        }
        urls = nextPages.map((page) => page.url);
        const saved = Math.max(0, Number(localStorage.getItem(`reading-room-comic-page-${fileId}`)) || 0);
        setPageIndex(Math.min(saved, Math.max(0, nextPages.length - 1)));
        setPages(nextPages);
        onStatus("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        onStatus("This comic could not be opened here. It may be encrypted, damaged, or part of a multi-file archive.");
      });
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [fileId, format, onStatus]);

  useEffect(() => {
    if (!pages.length) return;
    localStorage.setItem(`reading-room-comic-page-${fileId}`, String(pageIndex));
    if (mode === "scroll") onProgress(`Page ${pageIndex + 1} of ${pages.length} · Scroll to continue`);
    else {
      const end = Math.min(pages.length, pageIndex + spreadSize);
      onProgress(spreadSize === 2 && end > pageIndex + 1 ? `Pages ${pageIndex + 1}–${end} of ${pages.length}` : `Page ${pageIndex + 1} of ${pages.length}`);
    }
  }, [fileId, mode, onProgress, pageIndex, pages.length, spreadSize]);

  useEffect(() => {
    if (mode !== "scroll" || !scrollRef.current || !pages.length) return;
    scrollRef.current.querySelector(`[data-comic-page="${pageIndex}"]`)?.scrollIntoView({ block: "start" });
  }, [mode]);

  function previous() {
    if (mode === "scroll") scrollRef.current?.scrollBy({ top: -scrollRef.current.clientHeight * .88, behavior: "smooth" });
    else setPageIndex((current) => Math.max(0, current - spreadSize));
  }

  function next() {
    if (mode === "scroll") scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * .88, behavior: "smooth" });
    else setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + spreadSize));
  }

  useImperativeHandle(ref, () => ({ previous, next }));

  const spread = useMemo(() => pages.slice(pageIndex, pageIndex + spreadSize), [pageIndex, pages, spreadSize]);
  if (!pages.length) return null;

  if (mode === "pages") return <div className={`comic-pages ${spreadSize === 1 ? "single-spread" : ""}`}>{spread.map((page, index) => <img key={page.url} src={page.url} alt={`Comic page ${pageIndex + index + 1}`} />)}</div>;
  return <div className="comic-scroll" ref={scrollRef} onScroll={(event) => {
    const container = event.currentTarget;
    const marker = container.scrollTop + container.clientHeight * .25;
    let current = 0;
    container.querySelectorAll<HTMLElement>("[data-comic-page]").forEach((element) => { if (element.offsetTop <= marker) current = Number(element.dataset.comicPage) || 0; });
    setPageIndex(current);
  }}>{pages.map((page, index) => <img key={page.url} data-comic-page={index} src={page.url} loading={index < 3 ? "eager" : "lazy"} alt={`Comic page ${index + 1}`} />)}</div>;
});

export default ComicReader;
