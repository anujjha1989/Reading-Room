/**
 * Highlights and notes - the data, the colours and the Markdown export.
 *
 * Stored per book in the library state on the Pi, beside bookmarks, so they
 * follow the reader to every device the way progress does. A highlight is an
 * EPUB CFI range (epub.js for EPUB, foliate for MOBI/AZW3 - both speak CFI),
 * the text it covered when it was made (so the list and the export never need
 * the book open), an optional note and the chapter it sits in.
 */

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "underline";

export type Highlight = {
  id: string;
  cfi: string;
  text: string;
  color: HighlightColor;
  note?: string;
  chapter?: string;
  createdAt: number;
  updatedAt?: number;
};

/** Paper-friendly tints, chosen to sit behind the reader's own ink colours in
 *  light, sepia and dark themes alike (dark uses them at lower opacity). */
export const HIGHLIGHT_COLORS: { value: HighlightColor; label: string; fill: string }[] = [
  { value: "yellow", label: "Yellow", fill: "#f4cf4f" },
  { value: "green", label: "Green", fill: "#7fcf86" },
  { value: "blue", label: "Blue", fill: "#79b4ea" },
  { value: "pink", label: "Pink", fill: "#ef8fb4" },
  { value: "underline", label: "Underline", fill: "#d9534f" },
];

export function colorFill(color: HighlightColor) {
  return HIGHLIGHT_COLORS.find((item) => item.value === color)?.fill ?? HIGHLIGHT_COLORS[0].fill;
}

export function newHighlightId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Whitespace as a reader sees it: one space, no leading or trailing runs. */
export function cleanQuote(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** "Highlights - Wolf Hall" as Markdown: chapters as headings, quotes as block
 *  quotes, notes beneath - pastes cleanly into Notes, Obsidian or an email. */
export function highlightsMarkdown(title: string, author: string | undefined, highlights: Highlight[]) {
  const lines = [`# ${title}`, ""];
  if (author) lines.push(`*${author}*`, "");
  lines.push(`${highlights.length} highlight${highlights.length === 1 ? "" : "s"} from Home Books`, "");
  let chapter: string | undefined = "\u0000";
  for (const item of highlights) {
    if (item.chapter !== chapter) {
      chapter = item.chapter;
      if (chapter) lines.push(`## ${chapter}`, "");
    }
    lines.push(`> ${cleanQuote(item.text)}`, "");
    if (item.note?.trim()) lines.push(item.note.trim(), "");
  }
  return lines.join("\n");
}
