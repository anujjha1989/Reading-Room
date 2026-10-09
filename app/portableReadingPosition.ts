/** Text anchors shared with native TV. Screen-specific page numbers never cross devices. */
export type PortablePosition = { v: 1; fileId: string; spine: number; wordOffset: number; quote: string };
type Word = { text: string; node: Node; offset: number };
const wordCache = new WeakMap<Document, Word[]>();
const observed = new WeakSet<Document>();
function documentWords(doc: Document): Word[] {
  if (!doc.body) return [];
  const cached = wordCache.get(doc);
  if (cached) return cached;
  if (!observed.has(doc)) {
    observed.add(doc);
    new MutationObserver(() => wordCache.delete(doc)).observe(doc.body, { childList: true, characterData: true, subtree: true });
  }
  const chunks: Array<{ text: string; node: Node; start: number }> = [];
  let text = "";
  const visit = (node: Node) => {
    if (node.nodeType === 3) { chunks.push({ text: node.textContent || "", node, start: text.length }); text += node.textContent || ""; return; }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (["script", "style", "noscript"].includes(tag)) return;
    const block = /^(p|div|h[1-6]|li|blockquote|tr|section|br)$/.test(tag);
    if (block) text += "\n";
    for (const child of Array.from(node.childNodes)) visit(child);
    if (block) text += "\n";
  };
  visit(doc.body);
  const words: Word[] = [];
  let chunk = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    while (chunk < chunks.length && chunks[chunk].start + chunks[chunk].text.length <= match.index!) chunk++;
    const source = chunks[chunk];
    if (source) words.push({ text: match[0], node: source.node, offset: match.index! - source.start });
  }
  wordCache.set(doc, words);
  return words;
}
export function portableFromRange(fileId: string, spine: number, range: Range): string | null {
  const doc = range.startContainer.ownerDocument, body = doc?.body;
  if (!doc || !body || !body.contains(range.startContainer)) return null;
  const words = documentWords(doc);
  const point = range.cloneRange(); point.collapse(true);
  const wordOffset = words.findIndex(word => point.comparePoint(word.node, word.offset) >= 0);
  if (wordOffset < 0) return null;
  const quote = words.slice(wordOffset, wordOffset + 24).map(word => word.text).join(" ").slice(0, 400);
  if (!quote) return null;
  return JSON.stringify({ v: 1, fileId, spine, wordOffset, quote } satisfies PortablePosition);
}
export function parsePortablePosition(saved: string | undefined): PortablePosition | null {
  if (!saved?.startsWith("rrportable:")) return null;
  try {
    const value = JSON.parse(saved.slice(11));
    return value.v === 1 && typeof value.fileId === "string" && Number.isSafeInteger(value.spine) && value.spine >= 0
      && Number.isSafeInteger(value.wordOffset) && value.wordOffset >= 0 && typeof value.quote === "string" && value.quote.length <= 1000 ? value : null;
  } catch { return null; }
}
/** Resolve in a detached document, without touching live scroll geometry. */
export function rangeForPortablePosition(doc: Document, position: PortablePosition): Range | null {
  if (!doc.body) return null;
  const words = documentWords(doc);
  if (!words.length) return null;
  const needle = position.quote.trim().split(/\s+/u).filter(Boolean);
  const matches: number[] = [];
  if (needle.length) for (let i = 0; i <= words.length - needle.length; i++) {
    if (needle.every((word, n) => words[i + n].text === word)) matches.push(i);
  }
  const index = matches.sort((a, b) => Math.abs(a - position.wordOffset) - Math.abs(b - position.wordOffset))[0]
    ?? Math.min(position.wordOffset, words.length - 1);
  const range = doc.createRange(); range.setStart(words[index].node, words[index].offset); range.collapse(true);
  return range;
}
