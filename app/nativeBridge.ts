/**
 * The few things the iPhone app does better than a web page, reached through
 * WKWebView message handlers the app installs. In a browser none of these
 * handlers exist, so every caller has a web fallback or hides the control.
 */

type Handler = { postMessage: (body: unknown) => void };
type WebKitWindow = Window & { webkit?: { messageHandlers?: Record<string, Handler | undefined> } };

function handler(name: string): Handler | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as WebKitWindow).webkit?.messageHandlers?.[name];
}

export const hasNativeSummary = () => Boolean(handler("rrSummary"));

/** Pass stable catalogue identifiers, never infer them from download URLs. */
export function readSummary(book: { title: string; author?: string; category?: string; copies: { id: string; format: string }[] }) {
  const native = handler("rrSummary");
  if (!native || !book.copies.length) return false;
  native.postMessage({ title: book.title, author: book.author || "", category: book.category || "",
    copies: book.copies.map(({ id, format }) => ({ id, format })) });
  return true;
}

/** The iPhone app's native look-up (dictionary, Translate, "who is this?"). */
export const hasNativeLookUp = () => Boolean(handler("rrLookUp"));

/** Dictionary definition. The app shows iOS's own dictionary; a browser gets a
 *  web dictionary in a new tab. */
export function lookUp(text: string) {
  const native = handler("rrLookUp");
  if (native) { native.postMessage({ mode: "define", text }); return; }
  window.open(`https://www.merriam-webster.com/dictionary/${encodeURIComponent(text.trim())}`, "_blank", "noopener");
}

/** Translation. iOS's Translate sheet in the app; Google Translate otherwise. */
export function translate(text: string) {
  const native = handler("rrLookUp");
  if (native) { native.postMessage({ mode: "translate", text }); return; }
  window.open(`https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

/** "Who is this?" - answered by the app's AI from the text read so far only. */
export function askAbout(text: string, context: string, title: string, author?: string) {
  handler("rrLookUp")?.postMessage({ mode: "ask", text, context, title, author: author || "" });
}

/** Share text (the highlights export). The app opens the share sheet with a
 *  Markdown file; a browser uses the Web Share API or downloads the file. */
export async function shareText(title: string, text: string, filename: string) {
  const native = handler("rrShare");
  if (native) { native.postMessage({ title, text, filename }); return; }
  try {
    const file = new File([text], filename, { type: "text/markdown" });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) { await nav.share({ title, files: [file] }); return; }
    if (nav.share) { await nav.share({ title, text }); return; }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
