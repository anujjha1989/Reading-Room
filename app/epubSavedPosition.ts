type SavedPositionBook = {
  spine: { get: (target: string) => { href: string; render: (request: (url: string) => Promise<unknown>) => string | Promise<string> } | null };
  load: (url: string) => Promise<unknown>;
};

/** Validate against the HTML parser used by EPUB.js's iframe, not its XML DOM. */
export async function resolveEpubSavedPosition(
  book: SavedPositionBook,
  saved: string | undefined,
  toRange: (cfi: string, doc: Document) => Range | null,
): Promise<string | undefined> {
  if (!saved) return undefined;
  let section;
  try { section = book.spine.get(saved); } catch { return undefined; }
  if (!section) return undefined;
  if (!saved.startsWith("epubcfi(")) return saved;
  try {
    const html = await section.render(book.load.bind(book));
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (toRange(saved, doc)) return saved;
  } catch { /* The edition's chapter still exists, but this text offset does not. */ }
  return section.href;
}
