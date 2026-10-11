/** Allow archive transfers at 128 KiB/s, bounded even for missing/bad headers.
 * This is only the body download budget, never the parser/render deadline. */
export function readerDownloadTimeout(contentLength: string | null): number {
  const bytes = Number(contentLength);
  if (!contentLength || !Number.isFinite(bytes) || bytes <= 0) return 120_000;
  return Math.min(600_000, Math.max(30_000, 30_000 + Math.ceil(bytes / (128 * 1024)) * 1000));
}

/** Bound third-party promises that can otherwise leave a reader loading forever. */
export function readerDeadline<T>(operation: Promise<T>, signal: AbortSignal, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { if (timer) clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Reader closed", "AbortError")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new DOMException("The book took too long to open", "TimeoutError")); }, timeoutMs);
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
