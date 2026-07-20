"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type PdfReaderHandle = { previous: () => void; next: () => void };

type Props = {
  fileId: string;
  format: string;
  mode: "pages" | "scroll";
  onStatus: (status: string) => void;
  onProgress: (progress: string) => void;
};

function readerUrl(id: string, format: string) {
  return `/api/book/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}`;
}

function PdfPage({ pdf, pageNumber, mode, onVisible }: { pdf: PDFDocumentProxy; pageNumber: number; mode: "pages" | "scroll"; onVisible: (page: number) => void }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(mode === "pages");

  useEffect(() => {
    if (mode === "pages" || !holderRef.current) {
      setVisible(true);
      return;
    }
    const node = holderRef.current;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
      }
    }, { rootMargin: "900px 0px", threshold: 0.01 });
    const positionObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onVisible(pageNumber);
    }, { rootMargin: "-42% 0px -42% 0px", threshold: 0 });
    observer.observe(node);
    positionObserver.observe(node);
    return () => {
      observer.disconnect();
      positionObserver.disconnect();
    };
  }, [mode, onVisible, pageNumber]);

  useEffect(() => {
    if (!visible || !holderRef.current || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let renderFrame = 0;
    const holder = holderRef.current;
    const canvas = canvasRef.current;

    async function render() {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, Math.min(mode === "scroll" ? 920 : holder.clientWidth - 32, holder.clientWidth - 16));
      const availableHeight = mode === "pages" ? Math.max(320, holder.clientHeight - 24) : Number.POSITIVE_INFINITY;
      const cssScale = Math.min(availableWidth / base.width, availableHeight / base.height);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: cssScale * pixelRatio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      renderTask = page.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise;
    }

    const observer = new ResizeObserver(() => {
      renderTask?.cancel();
      cancelAnimationFrame(renderFrame);
      renderFrame = requestAnimationFrame(() => render().catch((error) => error?.name === "RenderingCancelledException" || console.warn(error)));
    });
    observer.observe(holder);
    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(renderFrame);
      renderTask?.cancel();
    };
  }, [mode, pageNumber, pdf, visible]);

  return <div className={`pdf-page ${mode === "pages" ? "single" : ""}`} data-page={pageNumber} ref={holderRef}><canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} /></div>;
}

const PdfReader = forwardRef<PdfReaderHandle, Props>(function PdfReader({ fileId, format, mode, onStatus, onProgress }, ref) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = pdf?.numPages || 0;
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
    let disposed = false;
    let document: PDFDocumentProxy | null = null;

    async function openPdf() {
      try {
        onStatus("Loading the book…");
        const response = await fetch(readerUrl(fileId, format), { signal: controller.signal });
        if (!response.ok) throw new Error("The PDF could not be downloaded");
        const data = await response.arrayBuffer();
        const pdfjs = await import("pdfjs-dist/webpack.mjs");
        const task = pdfjs.getDocument({ data });
        document = await task.promise;
        if (disposed) return;
        const saved = Number(localStorage.getItem(`reading-room-pdf-page-${fileId}`)) || 1;
        setPageNumber(Math.min(Math.max(1, saved), document.numPages));
        setPdf(document);
        onStatus("");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        onStatus("This PDF could not be opened here. You can still open it in Drive.");
      }
    }

    openPdf();
    return () => {
      disposed = true;
      controller.abort();
      document?.destroy();
    };
  }, [fileId, format, onStatus]);

  useEffect(() => {
    if (!total) return;
    const lastVisiblePage = Math.min(pageNumber + spreadSize - 1, total);
    onProgress(lastVisiblePage > pageNumber ? `Pages ${pageNumber}–${lastVisiblePage} of ${total}` : `Page ${pageNumber} of ${total}`);
    localStorage.setItem(`reading-room-pdf-page-${fileId}`, String(pageNumber));
  }, [fileId, onProgress, pageNumber, spreadSize, total]);

  useEffect(() => {
    if (mode !== "scroll") return;
    requestAnimationFrame(() => scrollRef.current?.querySelector(`[data-page="${pageNumber}"]`)?.scrollIntoView({ block: "start" }));
  }, [mode]);

  function goTo(page: number) {
    const nextPage = Math.min(Math.max(1, page), total || 1);
    setPageNumber(nextPage);
    if (mode === "scroll") scrollRef.current?.querySelector(`[data-page="${nextPage}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useImperativeHandle(ref, () => ({ previous: () => goTo(pageNumber - spreadSize), next: () => goTo(pageNumber + spreadSize) }), [mode, pageNumber, spreadSize, total]);

  if (!pdf) return null;
  if (mode === "pages") return <div className={`pdf-pages ${spreadSize === 1 ? "single-spread" : ""}`}><PdfPage pdf={pdf} pageNumber={pageNumber} mode="pages" onVisible={() => {}} />{spreadSize === 2 && pageNumber < pdf.numPages && <PdfPage pdf={pdf} pageNumber={pageNumber + 1} mode="pages" onVisible={() => {}} />}</div>;
  return <div className="pdf-scroll" ref={scrollRef}>{Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} mode="scroll" onVisible={setPageNumber} />)}</div>;
});

export default PdfReader;
