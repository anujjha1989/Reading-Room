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
