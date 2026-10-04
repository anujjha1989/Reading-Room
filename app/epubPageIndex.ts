/** Stable text-based reading pages, independent of EPUB file boundaries/layout. */
export const EPUB_PAGE_CHARACTERS = 1500;

export function createEpubPageIndex(options: {
  linear: boolean[];
  lengths?: Array<number | null>;
  loadLength(index: number): Promise<number>;
  signal: AbortSignal;
}) {
  const lengths = options.linear.map((linear, index) => {
    const cached = options.lengths?.[index];
    return !linear ? 0 : typeof cached === "number" && Number.isSafeInteger(cached) && cached >= 0 ? cached : null;
  });
  const prefix = [0];
  let pending = Promise.resolve();
  return {
    remember(index: number, length: number) {
      if (options.linear[index] && Number.isSafeInteger(length) && length >= 0) lengths[index] = length;
    },
    snapshot: () => [...lengths],
    async pageAt(index: number, offset: number): Promise<number | null> {
      if (!Number.isInteger(index) || index < 0 || index >= lengths.length || !Number.isFinite(offset)) return null;
      // One serial, shared prefix build. Load only preceding sections, never
      // render them or unload the reader's live section documents.
      const task = pending.then(async () => {
        while (prefix.length <= index) {
          options.signal.throwIfAborted();
          const section = prefix.length - 1;
          if (lengths[section] === null) {
            const length = await options.loadLength(section);
            options.signal.throwIfAborted();
            if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid EPUB text length");
            lengths[section] = length;
          }
          prefix.push(prefix[section] + (lengths[section] ?? 0));
          // Yield between detached documents so indexing does not monopolize
          // gestures. Cache is optional; failed sections can be retried.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      });
      pending = task.catch(() => undefined);
      await task;
      options.signal.throwIfAborted();
      return Math.floor((prefix[index] + Math.max(0, offset)) / EPUB_PAGE_CHARACTERS) + 1;
    },
  };
}
