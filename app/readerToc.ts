import type { Book } from "epubjs";

export type ReaderTocItem = { href: string; label: string; subitems?: ReaderTocItem[] };
const clean = (text: string) => text.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
const isFurniture = (label: string) => /^(contents|table of contents|books included here|copyright|title page)$/i.test(clean(label));
const relativeHref = (base: string, href: string) => {
  if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) return "";
  const url = new URL(href, new URL(base, "https://epub.invalid/"));
  return decodeURI(url.pathname.slice(1)) + url.hash;
};

function listItems(list: Element, base: string): ReaderTocItem[] {
  return [...list.children].filter(node => node.tagName === "LI").flatMap(node => {
    const link = node.querySelector(":scope > a[href]");
    const href = relativeHref(base, link?.getAttribute("href") || "");
    if (!link || !href || isFurniture(link.textContent || "")) return [];
    const nested = node.querySelector(":scope > ol, :scope > ul");
    return [{ href, label: clean(link.textContent || ""), subitems: nested ? listItems(nested, base) : [] }];
  });
}

/** Keep navigation hierarchical. Collection group pages are release-generated
 * EPUB navigation documents, not book content to be guessed from headings. */
export async function loadReaderToc(book: Book, navigation: ReaderTocItem[], title: string): Promise<ReaderTocItem[]> {
  const collection = /complete (?:works|collection)|collected works|omnibus/i.test(title);
  const read = async (href: string) => {
    const section = book.spine.get(href.split("#")[0]);
    if (!section) return null;
    const html = await section.render(book.load.bind(book));
    return new DOMParser().parseFromString(html, "text/html");
  };
  let expanded = false;
  let roots = await Promise.all(navigation.map(async item => {
    if (!/(?:^|\/)cw_book_toc_\d+\.xhtml$/i.test(item.href)) return item;
    try {
      const doc = await read(item.href);
      const list = doc?.querySelector("body > ol");
      const children = list ? listItems(list, item.href) : [];
      if (children.length) { expanded = true; return { ...item, subitems: children }; }
    } catch { /* retain the EPUB's original navigation if a group is unreadable */ }
    return item;
  }));
  // Some merged EPUBs put series/character groups above their individual books.
  // Ordinary books with parts retain their hierarchy instead.
  if ((collection || expanded) && roots.length > 1 && roots.every(item => item.subitems?.length)
      && (expanded || roots.some(item => item.subitems?.some(child => child.subitems?.length)))) {
    roots = roots.flatMap(item => item.subitems || []);
  }
  const filter = (items: ReaderTocItem[]): ReaderTocItem[] => items.filter(item => !isFurniture(item.label))
    .map(item => ({ ...item, label: clean(item.label), subitems: filter(item.subitems || []) }));
  roots = filter(roots);
  if (!expanded && !(collection && roots.some(item => item.subitems?.length))) return roots;

  // Generated collection TOCs sometimes name a book but omit its chapters.
  // Recover only explicit contents links near that book's start, bounded by
  // the next book. Never scan chapter prose or infer books from chapter names.
  const starts = roots.map(item => book.spine.get(item.href.split("#")[0])?.index ?? -1);
  return Promise.all(roots.map(async (item, index) => {
    if (item.subitems?.length || starts[index] < 0) return item;
    const next = starts.slice(index + 1).find(at => at > starts[index]) ?? book.spine.last().index + 1;
    const chapters = new Map<string, ReaderTocItem>();
    for (let at = starts[index]; at < Math.min(next, starts[index] + 8); at++) {
      const section = book.spine.get(at);
      if (!section) continue;
      try {
        const doc = await read(section.href);
        if (!doc || ![...doc.querySelectorAll("h1,h2,h3,p.chaph")].some(node => /^(?:table of )?contents$/i.test(clean(node.textContent || "")))) continue;
        for (const link of doc.querySelectorAll("a[href]")) {
          const href = relativeHref(section.href, link.getAttribute("href") || "");
          const target = href ? book.spine.get(href.split("#")[0]) : null;
          const label = clean(link.textContent || "");
          if (target && target.index >= starts[index] && target.index < next && label && !isFurniture(label)) chapters.set(href, { href, label });
        }
      } catch { /* an optional contents page must not prevent opening the book */ }
    }
    return { ...item, subitems: [...chapters.values()] };
  }));
}
