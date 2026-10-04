"use client";
import { useEffect, useState } from "react";
import { prepareCatalog, type Book, type RawBook } from "./catalogModel";

/** Grouping and metadata cleanup run off the UI thread, with one owned fallback. */
export function useCatalogModel(rows: RawBook[]) {
  const [prepared, setPrepared] = useState<{ rows: RawBook[]; books: Book[] } | null>(null);
  useEffect(() => {
    if (!rows.length) { setPrepared({ rows, books: [] }); return; }
    let worker: Worker | undefined;
    let disposed = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fallback = () => {
      if (settled || disposed) return;
      settled = true; clearTimeout(timer);
      worker?.terminate();
      if (!disposed) setPrepared({ rows, books: prepareCatalog(rows) });
    };
    try {
      worker = new Worker(new URL("./catalog.worker.ts", import.meta.url), { type: "module" });
      worker.onerror = fallback;
      worker.onmessage = (event: MessageEvent<{ books?: Book[]; error?: boolean }>) => {
        if (settled || disposed) return;
        if (event.data.error || !event.data.books) { fallback(); return; }
        settled = true; clearTimeout(timer);
        if (!disposed) setPrepared({ rows, books: event.data.books });
        worker?.terminate();
      };
      timer = setTimeout(fallback, 10_000);
      worker.postMessage(rows);
    } catch { fallback(); }
    return () => { disposed = true; clearTimeout(timer); worker?.terminate(); };
  }, [rows]);
  return { books: prepared?.books ?? [], preparing: rows.length > 0 && prepared?.rows !== rows };
}
