"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import ReadingSheet, { type SheetTocItem } from "./ReadingSheet";
import { useReadAloud } from "./useReadAloud";
import "./readAloudEngine";
import { registerEpubNarrationAdapter } from "./epubNarration";
import { mountReaderInteractions } from "./readerChromeBridge.js";
import "./bookFontScale.js";
import ReadAloudTransport from "./ReadAloudTransport";
import type { Book as EpubBook, Location, Rendition } from "epubjs";
import type { RenditionOptions } from "epubjs/types/rendition";
import PdfReader, { type PdfReaderHandle } from "./PdfReader";
import ReaderAnnotations, { HighlightsList, type AnnotationAdapter, type AnnotationTarget } from "./ReaderAnnotations";
import { colorFill, type Highlight } from "./annotations";
import { recordReading, timeLeft, type TimeLeft } from "./readingPace";
import { restartReadAloudFromView } from "./readAloudController";
import ComicReader, { type ComicReaderHandle } from "./ComicReader";
import { resolveEpubSavedPosition } from "./epubSavedPosition";
import { loadReaderToc } from "./readerToc";
import { readerDeadline } from "./readerDeadline";

export type ReaderFile = {
  id: string;
  url: string;
  format: string;
};

export type ReaderLocation = {
  label: string;
  position?: string;
  status?: "reading" | "finished";
};

export type ReaderBookmark = {
  id: string;
  position: string;
  label: string;
  createdAt: number;
};

type ReaderSearchResult = { target: string; label: string; excerpt: string };

type TocEntry = { href: string; label: string; depth: number };
type ReadingMode = "pages" | "scroll";
type PageTurnAnimation = "none" | "slide";
type TocItem = { href: string; label: string; subitems?: TocItem[] };
type FoliateSection = { load?: () => Promise<string>; linear?: string };
type FoliateSearchGroup = {
  progress?: number;
  label?: string;
  subitems?: Array<{ cfi: string; excerpt: string | { pre?: string; match?: string; post?: string } }>;
};
type EpubSearchSection = {
  href: string;
  index: number;
  load: (request: (url: string) => Promise<unknown>) => Promise<unknown>;
  find: (query: string) => Array<{ cfi: string; excerpt: string }>;
  unload: () => void;
};
type FoliateView = HTMLElement & {
  book?: { toc?: TocItem[]; sections?: FoliateSection[]; metadata?: { title?: string } };
  renderer?: { setAttribute: (name: string, value: string) => void; setStyles: (styles: string) => void };
  open: (file: File | Blob | string) => Promise<void>;
  init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  goTo: (target: string | number) => Promise<unknown>;
  search?: (options: { query: string }) => AsyncGenerator<FoliateSearchGroup>;
  clearSearch?: () => void;
  close: () => void;
};

function flattenToc(items: TocItem[], depth = 0): TocEntry[] {
  return items.flatMap((item) => [
    { href: item.href, label: item.label.trim(), depth },
    ...flattenToc(item.subitems || [], depth + 1),
  ]);
}

function readerUrl(id: string, format: string) {
  return `/api/book/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}`;
}

function previewUrl(rawId: string, sourceUrl: string) {
  const id = rawId.replace(/^ref-/, "");   // Reference Room ids are prefixed Drive ids
  if (sourceUrl.includes("docs.google.com/document")) return `https://docs.google.com/document/d/${id}/preview`;
  return `https://drive.google.com/file/d/${id}/preview`;
}

type ReaderTheme = "light" | "sepia" | "dark";

function isMobileViewport() {
  return window.innerWidth <= 700 || window.matchMedia("(max-width: 700px)").matches;
}

function themeColors(theme: ReaderTheme) {
  if (theme === "dark") return { ink: "#e8e4d8", paper: "#181b1a", link: "#a8c8b7" };
  if (theme === "sepia") return { ink: "#443a2d", paper: "#f3ead7", link: "#6c5b3f" };
  return { ink: "#202123", paper: "#ffffff", link: "#0969da" };
}

/**
 * Typography settings that used to live only in fullscreen-bundle.js, which held
 * them in module variables, persisted them to `rr-books-type` and applied them by
 * injecting a <style id="rr-books-type"> into the book's iframe.
 *
 * That injection also set line-height and padding, duplicating what epubStyles
 * already does here — two stylesheets setting the same properties with
 * !important, resolved only by injection order. Moving these in removes the
 * duplication as well as the layer.
 */
export type Typography = {
  /** "" means the book's own font. */
  family: string;
  bold: boolean;
  justify: boolean;
  /** letter-spacing, px */
  charSpacing: number;
  /** word-spacing, px */
  wordSpacing: number;
};

export const DEFAULT_TYPOGRAPHY: Typography = {
  family: "", bold: false, justify: false, charSpacing: 0, wordSpacing: 0,
};

/** Named families the sheet offers. Keys are what the old override used, so a
 *  migrated preference resolves without translation. */
export const FONT_FAMILIES: Record<string, string> = {
  Original: "",
  System: "-apple-system, BlinkMacSystemFont, sans-serif",
  Serif: "Georgia, serif",
  Palatino: 'Palatino, "Palatino Linotype", serif',
  Helvetica: "Helvetica, Arial, sans-serif",
};

function epubStyles(
  theme: ReaderTheme,
  lineHeight: number,
  margin: number,
  paginated = false,
  type: Typography = DEFAULT_TYPOGRAPHY,
) {
  const colors = themeColors(theme);
  const family = type.family || (theme === "light" ? 'ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' : "Georgia, serif");
  return {
    // overflow-y must be hidden when paginated. epub.js lays a paginated
    // section out as CSS columns and moves between them by translating the
    // content; an auto overflow lets the text scroll out of the column box
    // instead, which is why pages mode rendered blank. Scrolled flow does need
    // it, so the value follows the flow rather than being fixed.
    ":root": {
      color: `${colors.ink} !important`,
      background: `${colors.paper} !important`,
      overflow: paginated ? "hidden !important" : "hidden auto !important",
    },
    "html, body": { color: `${colors.ink} !important`, background: `${colors.paper} !important`, margin: "0 !important", "box-sizing": "border-box !important" },
    html: { "overflow-x": "hidden !important" },
    // EPUB.js lays later pages out as columns which deliberately overflow the
    // body's one-page box. Hiding body overflow clips every column after the
    // first: the footer advances while the screen is blank. The root element
    // remains the viewport clip, so allowing body overflow does not expose a
    // horizontal scrollbar or bleed into the reader chrome.
    body: {
      // The chosen family wins; "" falls back to the reader's default serif.
      "font-family": `${family} !important`,
      "font-weight": type.bold ? "700 !important" : "inherit !important",
      "text-align": type.justify ? "justify !important" : "start !important",
      "letter-spacing": `${type.charSpacing}px !important`,
      "word-spacing": `${type.wordSpacing}px !important`,
      "line-height": `${lineHeight} !important`,
      padding: `${theme === "light" ? "12px" : "1.25rem"} max(16px, ${margin}%) ${theme === "light" ? "12px" : "2.5rem"} !important`,
      "word-wrap": "break-word !important",
      ...(paginated ? { overflow: "visible !important" } : { "overflow-x": "hidden !important" }),
    },
    "*, *::before, *::after": { "box-sizing": "border-box !important" },
    "div, section, article, main, header, footer, blockquote, p, li": { "max-width": "100% !important", "min-width": "0 !important" },
    "p, li, blockquote": {
      "overflow-wrap": "break-word !important",
      // Repeated from body deliberately. A book's own stylesheet usually sets
      // these per element, and an inherited body rule would lose to it.
      "font-family": `${family} !important`,
      "font-weight": type.bold ? "700 !important" : "inherit !important",
      "text-align": type.justify ? "justify !important" : "start !important",
      "letter-spacing": `${type.charSpacing}px !important`,
      "word-spacing": `${type.wordSpacing}px !important`,
      "line-height": `${lineHeight} !important`,
    },
    "pre, code": { "white-space": "pre-wrap !important", "overflow-wrap": "anywhere !important" },
    table: { display: "block !important", width: "100% !important", "max-width": "100% !important", "overflow-x": "auto !important" },
    // Only real links. 1Q84 (and many EPUBs) wrap ordinary paragraphs in
    // anchors without href - for footnote targets and ids - so colouring every
    // <a> turned whole pages blue-green. Anchors with an href are links; the
    // rest are structure and must inherit the body colour.
    "a[href]": { color: `${colors.link} !important` },
    "a:not([href])": { color: "inherit !important" },
    "img, svg, video": { "max-width": "100% !important", height: "auto !important", "max-height": "92vh !important", "object-fit": "contain !important" },
  };
}

function mobiStyles(
  fontSize: number,
  theme: ReaderTheme,
  lineHeight: number,
  margin: number,
  type: Typography = DEFAULT_TYPOGRAPHY,
) {
  const colors = themeColors(theme);
  const family = type.family || (theme === "light" ? 'ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' : "Georgia, serif");
  return `
    :root, html { color: ${colors.ink} !important; background: ${colors.paper} !important;
      overflow-x: hidden !important; box-sizing: border-box !important; }
    body, body p, body li, body blockquote {
      font-family: ${family} !important;
      font-weight: ${type.bold ? 700 : "inherit"} !important;
      text-align: ${type.justify ? "justify" : "start"} !important;
      letter-spacing: ${type.charSpacing}px !important;
      word-spacing: ${type.wordSpacing}px !important;
      line-height: ${lineHeight} !important; }
    body { color: ${colors.ink} !important; background: ${colors.paper} !important;
      font-size: ${fontSize}% !important; line-height: ${lineHeight} !important;
      margin: 0 !important; padding: ${theme === "light" ? "12px" : "1.25rem"} max(16px, ${margin}%) ${theme === "light" ? "12px" : "2.5rem"} !important; overflow-x: hidden !important; box-sizing: border-box !important; }
    *, *::before, *::after { box-sizing: border-box !important; }
    div, section, article, main, header, footer, blockquote, p, li { max-width: 100% !important; min-width: 0 !important; }
    p, li, blockquote { overflow-wrap: break-word !important; }
    pre, code { white-space: pre-wrap !important; overflow-wrap: anywhere !important; }
    table { display: block !important; width: 100% !important; max-width: 100% !important; overflow-x: auto !important; }
    a[href] { color: ${colors.link} !important; }
    a:not([href]) { color: inherit !important; }
    img, svg { max-width: 100% !important; max-height: 92vh !important; object-fit: contain !important; }
  `;
}

async function secureMobiSections(view: FoliateView) {
  const safeUrls = new Set<string>();
  for (const section of view.book?.sections || []) {
    if (!section.load) continue;
    const originalLoad = section.load.bind(section);
    let safeUrl = "";
    section.load = async () => {
      if (safeUrl) return safeUrl;
      const originalUrl = await originalLoad();
      const response = await fetch(originalUrl);
      const source = await response.text();
      const contentType = response.headers.get("content-type") || "";
      const isXhtml = contentType.includes("xhtml") || /^\s*<\?xml/i.test(source);
      const mime = isXhtml ? "application/xhtml+xml" : "text/html";
      let document = new DOMParser().parseFromString(source, mime);
      if (document.querySelector("parsererror")) {
        document = new DOMParser().parseFromString(source, "text/html");
      }

      document.querySelectorAll("script, iframe, object, embed, base, meta[http-equiv='refresh' i]").forEach((node) => node.remove());
      document.querySelectorAll("*").forEach((element) => {
        for (const attribute of Array.from(element.attributes)) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim().toLowerCase();
          if (name.startsWith("on") || name === "srcdoc" || value.startsWith("javascript:")) {
            element.removeAttribute(attribute.name);
          }
        }
      });

      const serialized = document.contentType === "text/html"
        ? `<!doctype html>${document.documentElement.outerHTML}`
        : new XMLSerializer().serializeToString(document);
      safeUrl = URL.createObjectURL(new Blob([serialized], { type: document.contentType || mime }));
      safeUrls.add(safeUrl);
      return safeUrl;
    };
  }
  return () => safeUrls.forEach((url) => URL.revokeObjectURL(url));
}

export default function BookReader({ title, author, coverUrl, file, initialPosition, bookmarks = [], onBookmarksChange, highlights = [], onHighlightsChange, onLocationChange, seriesNavigation, onClose }: {
  title: string;
  author?: string;
  coverUrl?: string;
  file: ReaderFile;
  initialPosition?: string;
  bookmarks?: ReaderBookmark[];
  onBookmarksChange?: (bookmarks: ReaderBookmark[]) => void;
  highlights?: Highlight[];
  onHighlightsChange?: (highlights: Highlight[]) => void;
  onLocationChange?: (location: ReaderLocation) => void;
  seriesNavigation?: { previous?: string; next?: string; onPrevious?: () => void; onNext?: () => void };
  onClose: () => void;
}) {
  useEffect(mountReaderInteractions, []);
  const format = file.format.toUpperCase();
  const isEpub = format === "EPUB";
  const isMobi = ["MOBI", "AZW", "AZW3", "KF8"].includes(format);
  const isPdf = format === "PDF";
  const isComic = format === "CBR" || format === "CBZ";
  const isReflowable = isEpub || isMobi;
  const isBookReader = isReflowable || isPdf || isComic;
  const viewerRef = useRef<HTMLDivElement>(null);
  const onLocationChangeRef = useRef(onLocationChange);
  const pendingLocationRef = useRef<ReaderLocation | null>(null);
  const currentLocationRef = useRef<ReaderLocation>({ label: "Saved place", position: initialPosition });
  const searchRunRef = useRef(0);
  const locationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const mobiViewRef = useRef<FoliateView | null>(null);
  const pdfReaderRef = useRef<PdfReaderHandle>(null);
  const comicReaderRef = useRef<ComicReaderHandle>(null);
  const shellRef = useRef<HTMLElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const menuTouchAtRef = useRef(0);
  const pageTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSizeRef = useRef(100);
  const readingModeRef = useRef<ReadingMode>("pages");
  const themeRef = useRef<ReaderTheme>("light");
  const lineHeightRef = useRef(1.65);
  const marginRef = useRef(4);
  const [status, setStatus] = useState(isBookReader ? "Loading the book…" : "");
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocTree, setTocTree] = useState<TocItem[]>([]);
  // Where the reader is, as the book's own href, so Contents can mark it.
  const [locationHref, setLocationHref] = useState("");
  const [fontSize, setFontSize] = useState(100);
  const [progress, setProgress] = useState("");
  const [readingMode, setReadingMode] = useState<ReadingMode | null>(null);
  const [pageTurnAnimation, setPageTurnAnimation] = useState<PageTurnAnimation>("slide");
  const [displayTitle, setDisplayTitle] = useState(title);
  const [theme, setTheme] = useState<ReaderTheme>("light");
  const [lineHeight, setLineHeight] = useState(1.65);
  const [margin, setMargin] = useState(4);
  const [mangaMode, setMangaMode] = useState(false);
  const [epubRevision, setEpubRevision] = useState(0);
  const [panel, setPanel] = useState<"search" | "bookmarks" | null>(null);
  const [marksTab, setMarksTab] = useState<"bookmarks" | "highlights">("bookmarks");
  // Highlights: the engine-specific adapter (built once the book is open) and a
  // ref so engine callbacks that outlive a render see the current list.
  const [annotationAdapter, setAnnotationAdapter] = useState<AnnotationAdapter | null>(null);
  const highlightsRef = useRef<Highlight[]>(highlights);
  highlightsRef.current = highlights;
  const cfiCompareRef = useRef<(a: string, b: string) => number>((a, b) => a.localeCompare(b));
  const chapterLabelRef = useRef("");
  // Time left: this reader's pace against how much of the book is still ahead.
  const [left, setLeft] = useState<TimeLeft>({});
  const paceRef = useRef<{ at: number; chars: number } | null>(null);
  const sectionSizesRef = useRef<number[] | null>(null);
  const textRatioRef = useRef<Map<number, number>>(new Map());
  // Listening: whether the voice is going (pace is not learned from narrated
  // pages), and what the handoff and Lock Screen controls need to reach.
  const narratingRef = useRef(false);
  const annotationAdapterRef = useRef<AnnotationAdapter | null>(null);
  annotationAdapterRef.current = annotationAdapter;
  const currentTocIndexRef = useRef(-1);
  const tocRef = useRef<TocEntry[]>([]);
  const [reactSheetOpen, setReactSheetOpen] = useState(false);
  const [readingSheetHost, setReadingSheetHost] = useState<HTMLElement | null>(null);

  // The page-turn touch layer is appended directly to body. Keeping the sheet
  // inside .reader-shell trapped it in that element's lower stacking context,
  // so the transparent page layer sat above the visible button on iPhone.
  useEffect(() => {
    setReadingSheetHost(document.body);
    return () => setReadingSheetHost(null);
  }, []);

  // Hide the in-header fallback only while the body-owned floating close
  // control actually exists. If the portal cannot mount, the original button
  // remains available so a reader can always leave the book.
  useEffect(() => {
    if (!readingSheetHost) return;
    document.documentElement.classList.add("rr-has-close");
    return () => document.documentElement.classList.remove("rr-has-close");
  }, [readingSheetHost]);

  // Standalone iOS can lose React's delegated touch event when the EPUB
  // surface has just handled the same gesture. Own this native capture handler
  // beside the button it controls, rather than forwarding through a script
  // loaded outside React. The following click is ignored as the same tap.
  useEffect(() => {
    const handleTouchEnd = (event: globalThis.TouchEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".rr-react-sheet-trigger")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      menuTouchAtRef.current = Date.now();
      setReactSheetOpen((open) => !open);
    };
    const closeReadingSheet = () => setReactSheetOpen(false);
    document.addEventListener("touchend", handleTouchEnd, { capture: true, passive: false });
    window.addEventListener("rr-close-reading-menu", closeReadingSheet);
    return () => {
      document.removeEventListener("touchend", handleTouchEnd, true);
      window.removeEventListener("rr-close-reading-menu", closeReadingSheet);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("rr-react-sheet-open", reactSheetOpen);
    return () => document.documentElement.classList.remove("rr-react-sheet-open");
  }, [reactSheetOpen]);

  // Publish reader-only presentation state from the component that owns it.
  // The retired injected sheet used to set these classes as a side effect.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("rr-books-controls");
    root.classList.toggle("rr-reader-dark", theme === "dark");
    root.classList.toggle("rr-reader-light", theme === "light");
    root.classList.toggle("rr-reader-sepia", theme === "sepia");
    root.classList.toggle("rr-native-panel-open", panel !== null);
    return () => {
      root.classList.remove("rr-books-controls", "rr-reader-dark", "rr-reader-light", "rr-reader-sepia", "rr-native-panel-open");
    };
  }, [panel, theme]);

  // Keep iOS's safe-area colour aligned with the book, independently of the
  // Home theme. This used to live in the removed DOM-injected sheet, which made
  // status-bar correctness depend on an unrelated menu implementation.
  useEffect(() => {
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const meta = metas[0] ?? document.head.appendChild(document.createElement("meta"));
    meta.setAttribute("name", "theme-color");
    meta.removeAttribute("media");
    meta.content = theme === "dark" ? "#181b1a" : theme === "sepia" ? "#f3ead7" : "#fffdf7";
    metas.slice(1).forEach((node) => node.remove());
    document.querySelectorAll<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
      .forEach((node) => { node.content = "black-translucent"; });
    return () => {
      const homeTheme = document.documentElement.getAttribute("data-rr-theme");
      meta.content = homeTheme === "dark" ? "#000000" : "#f7f3ec";
    };
  }, [theme]);

  /**
   * Typography, migrated from the override's `rr-books-type`.
   *
   * fullscreen-bundle.js owned these until step 1c-i: it kept them in module
   * variables, saved them under that key, and injected a stylesheet into the
   * book's iframe. Reading the same key means a preference set in the old sheet
   * survives, so nothing anyone has configured is silently reset.
   *
   * The stored shape is {font,bold,line,chars,words,margins,justify,preset}. Only
   * the five typography fields are taken here: line and margins are already React
   * state, and reading them back would fight the values in use.
   */
  const [typography, setTypography] = useState<Typography>(() => {
    if (typeof window === "undefined") return DEFAULT_TYPOGRAPHY;
    try {
      const raw = JSON.parse(localStorage.getItem("rr-books-type") || "{}");
      const named = typeof raw.font === "string" ? FONT_FAMILIES[raw.font] : undefined;
      return {
        family: named ?? DEFAULT_TYPOGRAPHY.family,
        bold: !!raw.bold,
        justify: !!raw.justify,
        charSpacing: Number.isFinite(Number(raw.chars)) ? Number(raw.chars) : 0,
        wordSpacing: Number.isFinite(Number(raw.words)) ? Number(raw.words) : 0,
      };
    } catch { return DEFAULT_TYPOGRAPHY; }
  });
  const typographyRef = useRef<Typography>(typography);
  /** The family key, kept so the sheet can show "Palatino" rather than a stack. */
  const [fontFamilyKey, setFontFamilyKey] = useState<string>(() => {
    if (typeof window === "undefined") return "Original";
    try {
      const raw = JSON.parse(localStorage.getItem("rr-books-type") || "{}");
      return typeof raw.font === "string" && raw.font in FONT_FAMILIES ? raw.font : "Original";
    } catch { return "Original"; }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState("");

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  const reportLocation = useCallback((location: ReaderLocation) => {
    currentLocationRef.current = location;
    pendingLocationRef.current = location;
    if (locationTimerRef.current) clearTimeout(locationTimerRef.current);
    locationTimerRef.current = setTimeout(() => {
      locationTimerRef.current = null;
      const pending = pendingLocationRef.current;
      pendingLocationRef.current = null;
      if (pending) onLocationChangeRef.current?.(pending);
    }, 700);
  }, []);

  // Remaining reading from where the page is now; a forward page turn also
  // teaches the pace (how many characters the last page held, over how long it
  // stayed open). Narrated pages and jumps are not reading, so they don't count.
  const noteTimeLeft = useCallback((sectionChars: number | undefined, bookChars: number | undefined) => {
    const now = Date.now();
    const before = paceRef.current;
    if (bookChars != null) {
      if (before && !narratingRef.current && document.visibilityState === "visible" && before.chars > bookChars) {
        recordReading(before.chars - bookChars, (now - before.at) / 1000);
      }
      paceRef.current = { at: now, chars: bookChars };
    }
    setLeft(timeLeft(sectionChars, bookChars));
  }, []);

  useEffect(() => () => {
    if (locationTimerRef.current) clearTimeout(locationTimerRef.current);
    const pending = pendingLocationRef.current;
    if (pending) onLocationChangeRef.current?.(pending);
  }, []);
  const readerModeReady = readingMode !== null;

  useEffect(() => {
    setDisplayTitle(title);
    currentLocationRef.current = { label: "Saved place", position: initialPosition };
    sectionSizesRef.current = null;
    textRatioRef.current = new Map();
    paceRef.current = null;
    setLeft({});
    searchRunRef.current += 1;
    setPanel(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchStatus("");
  }, [file.id, initialPosition, title]);

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("reading-room-reader-mode") as ReadingMode | null;
    const mode = saved === "pages" || saved === "scroll" ? saved : window.matchMedia("(max-width: 700px)").matches ? "scroll" : "pages";
    const savedPageTurn = localStorage.getItem("reading-room-page-turn-animation") as PageTurnAnimation | null;
    const savedTheme = localStorage.getItem("reading-room-reader-theme") as ReaderTheme | null;
    const savedLineHeight = Number(localStorage.getItem("reading-room-line-height")) || 1.65;
    const savedMargin = Number(localStorage.getItem("reading-room-reader-margin")) || 4;
    const savedFontSize = Number(localStorage.getItem("reading-room-font-size")) || 100;
    readingModeRef.current = mode;
    // Follow the app's theme unless the reader's own theme was chosen
    // deliberately. The effect below writes reading-room-reader-theme on every
    // run including mount, so its mere presence proves nothing - a separate
    // explicit flag is the only way to tell a real choice from that echo.
    // One-time migration. The flag was added after this app had been used, so
    // every existing device has reading-room-reader-theme set from the effect
    // below (which writes on mount) but no flag - and would have been treated
    // as "chosen", keeping the old light default forever. If the stored theme
    // is light and no deliberate choice was ever recorded, treat it as unset.
    const chosen = localStorage.getItem("reading-room-reader-theme-set") === "1";
    if (!chosen && savedTheme === "light") {
      try { localStorage.removeItem("reading-room-reader-theme"); } catch {}
    }
    const appTheme = localStorage.getItem("reading-room-theme");
    const prefersDark = appTheme === "dark"
      || (appTheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const effectiveSaved = localStorage.getItem("reading-room-reader-theme") as ReaderTheme | null;
    themeRef.current = chosen && (effectiveSaved === "dark" || effectiveSaved === "sepia" || effectiveSaved === "light")
      ? effectiveSaved
      : prefersDark ? "dark" : "light";
    lineHeightRef.current = Math.min(2, Math.max(1.35, savedLineHeight));
    marginRef.current = Math.min(12, Math.max(2, savedMargin));
    fontSizeRef.current = Math.min(160, Math.max(75, savedFontSize));
    setReadingMode(mode);
    setPageTurnAnimation(savedPageTurn === "none" ? "none" : "slide");
    setTheme(themeRef.current);
    setLineHeight(lineHeightRef.current);
    setMargin(marginRef.current);
    setFontSize(fontSizeRef.current);
  }, [file.id]);

  useEffect(() => () => {
    if (pageTurnTimerRef.current) clearTimeout(pageTurnTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isEpub || !viewerRef.current || !readerModeReady) return;
    const controller = new AbortController();
    let disposed = false;
    let unregisterNarration: (() => void) | undefined;

    async function openEpub() {
      try {
        setStatus("Loading the book…");
        const response = await readerDeadline(fetch(readerUrl(file.id, file.format), { signal: controller.signal }), controller.signal);
        if (!response.ok) throw new Error("The book could not be downloaded");
        const data = await readerDeadline(response.arrayBuffer(), controller.signal);
        const { default: ePub, EpubCFI: EpubPosition } = await import("epubjs");
        if (disposed || !viewerRef.current) return;

        // Await the explicit open promise: the constructor swallows archive
        // failures while book.ready may remain unresolved forever.
        const book = ePub();
        bookRef.current = book;
        await readerDeadline(book.open(data), controller.signal);
        await readerDeadline(book.ready, controller.signal);
        if (disposed || !viewerRef.current) return;
        const mode = readingModeRef.current;
        const mobile = isMobileViewport();
        let manager: string | (new (...args: never[]) => unknown) = "default";
        if (mode === "scroll") {
          // Use epub.js's registered manager name instead of importing its
          // private implementation, which is not stable across bundler upgrades.
          manager = "continuous";
        }
        const renditionOptions: RenditionOptions & { offset?: number; offsetDelta?: number; gap?: number } = {
          width: "100%",
          height: "100%",
          manager,
          flow: mode === "scroll" ? "scrolled-continuous" : "paginated",
          offset: mode === "scroll" ? Math.max(1800, window.innerHeight * 3) : undefined,
          offsetDelta: mode === "scroll" ? Math.max(700, window.innerHeight) : undefined,
          gap: mode === "scroll" ? 0 : undefined,
          spread: mode === "scroll" || mobile ? "none" : "auto",
          minSpreadWidth: 980,
        };
        const rendition = book.renderTo(viewerRef.current, renditionOptions);
        renditionRef.current = rendition;
        rendition.spread(mode === "scroll" || mobile ? "none" : "auto", 980);
        rendition.themes.default(epubStyles(themeRef.current, lineHeightRef.current, marginRef.current, mode !== "scroll", typographyRef.current));
        // The saved size, not a hardcoded 100%: this runs after the size has
        // been restored from localStorage, so pinning it to 100 discarded the
        // preference and left the A-/A+ buttons fighting a stale baseline.
        rendition.themes.fontSize(`${fontSizeRef.current}%`);

        const saved = localStorage.getItem(`reading-room-position-${file.id}`) || initialPosition || undefined;
        // EPUB.js leaves display() pending after some invalid-CFI errors. Check
        // the actual HTML first, preserving the chapter if its offset is stale.
        const target = await resolveEpubSavedPosition(book, saved, (cfi, doc) => new EpubPosition(cfi).toRange(doc));
        if (disposed) return;
        if (target !== saved) {
          if (target) localStorage.setItem(`reading-room-position-${file.id}`, target);
          else localStorage.removeItem(`reading-room-position-${file.id}`);
        }
        try {
          await readerDeadline(rendition.display(target), controller.signal);
        } catch (error) {
          if (disposed) return;
          localStorage.removeItem(`reading-room-position-${file.id}`);
          // A stalled initial display can leave epub.js's internal queue busy.
          // Only retry a rejected location; do not queue another display after
          // our timeout or cancellation.
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) throw error;
          await readerDeadline(rendition.display(), controller.signal);
        }
        if (disposed) return;

        // Byte size of each spine file, read once from the archive; with the
        // text-to-markup ratio of the sections actually opened it gives the
        // characters still ahead without loading the rest of the book.
        const sectionSize = (index: number) => {
          if (!sectionSizesRef.current) {
            const archive = (book as unknown as { archive?: { zip?: { files?: Record<string, { _data?: { uncompressedSize?: number } }> } } }).archive;
            const files = archive?.zip?.files ?? {};
            const keys = Object.keys(files);
            const sizes: number[] = [];
            (book.spine as unknown as { each: (callback: (section: { index: number; url?: string; href: string; linear?: boolean }) => void) => void }).each((section) => {
              let path = (section.url || section.href || "").replace(/^\//, "");
              try { path = decodeURIComponent(path); } catch { /* keep as is */ }
              const key = files[path] ? path : keys.find((name) => name.endsWith(section.href));
              sizes[section.index] = section.linear === false ? 0 : (key ? files[key]?._data?.uncompressedSize ?? 0 : 0);
            });
            sectionSizesRef.current = sizes;
          }
          return sectionSizesRef.current[index] ?? 0;
        };
        const measureEpub = (location: Location) => {
          try {
            const index = location.start.index;
            const contents = (rendition.getContents() as unknown as Array<{ sectionIndex: number; document: Document }>)
              .find((item) => item.sectionIndex === index);
            const doc = contents?.document;
            if (!doc?.body) return;
            const total = doc.body.textContent?.length ?? 0;
            const size = sectionSize(index);
            if (size > 0 && total > 0) textRatioRef.current.set(index, total / size);
            const ratios = [...textRatioRef.current.values()];
            const ratio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0.6;
            let read = 0;
            const range = (rendition as unknown as { getRange: (cfi: string) => Range | null }).getRange(location.start.cfi);
            if (range && range.startContainer.ownerDocument === doc) {
              const before = doc.createRange();
              before.setStart(doc.body, 0);
              before.setEnd(range.startContainer, range.startOffset);
              read = before.toString().length;
            }
            const inSection = Math.max(0, total - read);
            const sizes = sectionSizesRef.current ?? [];
            const ahead = sizes.slice(index + 1).reduce((sum, bytes) => sum + (bytes || 0), 0) * ratio;
            noteTimeLeft(inSection, sizes.some((bytes) => bytes > 0) ? inSection + ahead : undefined);
          } catch { /* the section is still rendering */ }
        };

        // Highlights: epub.js draws them as marks over each section and puts
        // them back itself whenever that section renders again.
        const EpubCFI = (ePub as unknown as { CFI: new (cfi?: string) => { spinePos: number; compare: (a: string, b: string) => number; toRange: (doc: Document) => Range | null } }).CFI;
        cfiCompareRef.current = (a, b) => { try { return new EpubCFI().compare(a, b); } catch { return a.localeCompare(b); } };
        type EpubContents = { sectionIndex: number; document: Document; cfiFromRange: (range: Range) => string };
        const epubContents = () => (rendition.getContents() as unknown as EpubContents[]).filter((item) => item?.document?.body);
        const narrationTargets = () => epubContents().flatMap(item => {
          const frame = item.document.defaultView?.frameElement as HTMLIFrameElement | null;
          return frame ? [{ doc: item.document, frame, index: item.sectionIndex }] : [];
        });
        unregisterNarration = registerEpubNarrationAdapter({
          targets: narrationTargets,
          canPrevious: doc => {
            const current = narrationTargets().find(target => target.doc === doc);
            if (!current) return false;
            const spine = book.spine as unknown as { get: (index: number) => { index: number; linear?: boolean } | null };
            for (let index = current.index - 1; index >= 0; index--) {
              const section = spine.get(index);
              if (section && section.linear !== false) return true;
            }
            return false;
          },
          navigate: async (doc, direction) => {
            const current = narrationTargets().find(target => target.doc === doc);
            if (!current || disposed) return null;
            const spine = book.spine as unknown as { get: (index: number) => { index: number; href: string; linear?: boolean } | null };
            let section = current.index + direction < 0 ? null : spine.get(current.index + direction);
            while (section?.linear === false) section = section.index + direction < 0 ? null : spine.get(section.index + direction);
            if (!section) return null;
            await readerDeadline(rendition.display(section.href), controller.signal);
            if (disposed) return null;
            return narrationTargets().find(target => target.index === section!.index) ?? null;
          },
        });
        const epubTarget = (item: EpubContents): AnnotationTarget => ({
          doc: item.document,
          frame: (item.document.defaultView?.frameElement as HTMLIFrameElement | null) ?? null,
          index: item.sectionIndex,
        });
        const marks = rendition.annotations as unknown as {
          highlight: (cfi: string, data: object, cb: undefined, className: string, styles: object) => unknown;
          underline: (cfi: string, data: object, cb: undefined, className: string, styles: object) => unknown;
          remove: (cfi: string, type: string) => void;
        };
        setAnnotationAdapter({
          targets: () => epubContents().map(epubTarget),
          targetAt: (x, y) => epubContents().map(epubTarget).find((target) => {
            const box = target.frame?.getBoundingClientRect();
            return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
          }) ?? null,
          cfiFor: (target, range) => {
            const item = epubContents().find((entry) => entry.document === target.doc);
            try { return item ? item.cfiFromRange(range) : null; } catch { return null; }
          },
          rangeFor: (cfi) => {
            let parsed: InstanceType<typeof EpubCFI>;
            try { parsed = new EpubCFI(cfi); } catch { return null; }
            const item = epubContents().find((entry) => entry.sectionIndex === parsed.spinePos);
            if (!item) return null;
            try {
              const range = parsed.toRange(item.document);
              return range ? { target: epubTarget(item), range } : null;
            } catch { return null; }
          },
          draw: (highlight) => {
            const fill = colorFill(highlight.color);
            try {
              if (highlight.color === "underline") marks.underline(highlight.cfi, { id: highlight.id }, undefined, "rr-ul", { stroke: fill, "stroke-opacity": "0.9", "stroke-width": "2" });
              else marks.highlight(highlight.cfi, { id: highlight.id }, undefined, "rr-hl", { fill, "fill-opacity": "0.32", "mix-blend-mode": "normal" });
            } catch { /* a position this edition no longer has */ }
          },
          erase: (highlight) => { try { marks.remove(highlight.cfi, highlight.color === "underline" ? "underline" : "highlight"); } catch { /* already gone */ } },
          compare: (a, b) => cfiCompareRef.current(a, b),
          go: (cfi) => { try { void rendition.display(cfi).catch(() => undefined); } catch { /* reader closed */ } },
          chapter: () => chapterLabelRef.current,
        });

        rendition.on("relocated", (location: Location) => {
          const page = location.start.displayed;
          const atEnd = (location as Location & { atEnd?: boolean }).atEnd ?? false;
          const label = readingModeRef.current === "scroll" ? "In progress" : page?.total ? `Page ${page.page} of ${page.total}` : "In progress";
          setProgress(label);
          setLocationHref(location.start.href || "");
          if (location.start.cfi) {
            localStorage.setItem(`reading-room-position-${file.id}`, location.start.cfi);
            reportLocation({ label, position: location.start.cfi, status: atEnd ? "finished" : "reading" });
          }
          measureEpub(location);
        });
        // Some otherwise-readable EPUBs omit the optional navigation package.
        // Do not throw merely because they have no table of contents: the book
        // body is already open and can be read normally.
        const navigation = await readerDeadline(Promise.resolve(book.loaded?.navigation), controller.signal, 5_000).catch(() => undefined);
        const entries = navigation ? await loadReaderToc(book, navigation.toc, title) : [];
        if (!disposed) { setTocTree(entries); setToc(flattenToc(entries)); }
        setStatus("");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (disposed) return;
        controller.abort();
        setStatus("This EPUB could not be opened here. You can still download the file from Home Books.");
      }
    }

    openEpub();
    return () => {
      disposed = true;
      controller.abort();
      unregisterNarration?.();
      const rendition = renditionRef.current;
      const book = bookRef.current;
      renditionRef.current = null;
      bookRef.current = null;
      setAnnotationAdapter(null);
      rendition?.destroy();
      // epub.js resolves navigation asynchronously and reads `book.loading` in
      // its own completion callback. Destroying the book before that callback
      // runs clears `loading` and throws outside React's error boundary.
      if (book) {
        void Promise.resolve(book.loaded?.navigation)
          .catch(() => undefined)
          .then(() => book.destroy());
      }
    };
  }, [epubRevision, file.format, file.id, initialPosition, isEpub, noteTimeLeft, readerModeReady, reportLocation]);

  useEffect(() => {
    if (!isEpub || !readerModeReady) return;
    const media = window.matchMedia("(max-width: 700px)");
    const updateSpread = () => {
      // Height-only changes (Safari chrome, keyboard) do not change spreads.
      // Reapplying the same layout resizes every loaded continuous chapter.
      const rendition = renditionRef.current;
      const spread = readingModeRef.current === "scroll" || isMobileViewport() ? "none" : "auto";
      if (rendition && rendition.settings.spread !== spread) rendition.spread(spread, 980);
    };
    updateSpread();
    media.addEventListener("change", updateSpread);
    window.addEventListener("resize", updateSpread);
    // After a screen rotation EPUB.js re-flows the content but can lose the
    // scroll position. Wait for the layout to settle then restore it.
    const handleOrientation = () => {
      setTimeout(() => {
        const saved = localStorage.getItem(`reading-room-position-${file.id}`);
        if (saved && renditionRef.current) renditionRef.current.display(saved).catch(() => {});
      }, 250);
    };
    window.addEventListener("orientationchange", handleOrientation);
    return () => {
      media.removeEventListener("change", updateSpread);
      window.removeEventListener("resize", updateSpread);
      window.removeEventListener("orientationchange", handleOrientation);
    };
  }, [file.id, isEpub, readerModeReady]);

  useEffect(() => {
    if (!isMobi || !viewerRef.current || !readerModeReady) return;
    const controller = new AbortController();
    let disposed = false;
    let revokeSafeUrls = () => {};
    let unregisterNarration: (() => void) | undefined;

    async function openMobi() {
      try {
        setStatus("Loading the book…");
        const response = await readerDeadline(fetch(readerUrl(file.id, file.format), { signal: controller.signal }), controller.signal);
        if (!response.ok) throw new Error("The book could not be downloaded");
        const blob = await readerDeadline(response.blob(), controller.signal);
        const extension = format === "AZW3" || format === "KF8" ? "azw3" : "mobi";
        const mobiFile = new File([blob], `${title}.${extension}`, { type: "application/x-mobipocket-ebook" });
        await import("foliate-js/view.js");
        if (disposed || !viewerRef.current) return;

        const view = document.createElement("foliate-view") as FoliateView;
        Object.assign(view.style, { display: "block", width: "100%", height: "100%" });
        viewerRef.current.append(view);
        mobiViewRef.current = view;
        await readerDeadline(view.open(mobiFile), controller.signal);
        const metadataTitle = view.book?.metadata?.title?.trim();
        if (metadataTitle && metadataTitle.length > title.trim().length) setDisplayTitle(metadataTitle);
        revokeSafeUrls = await readerDeadline(secureMobiSections(view), controller.signal);
        view.renderer?.setAttribute("flow", readingModeRef.current === "scroll" ? "scrolled" : "paginated");
        view.renderer?.setAttribute("max-column-count", isMobileViewport() ? "1" : "2");
        view.renderer?.setStyles(mobiStyles(fontSizeRef.current, themeRef.current, lineHeightRef.current, marginRef.current));
        view.addEventListener("load", () => view.renderer?.setStyles(mobiStyles(fontSizeRef.current, themeRef.current, lineHeightRef.current, marginRef.current)));

        // Highlights: foliate draws annotations on a per-section overlay and asks
        // for them again each time a section's overlay is created.
        const [{ Overlayer }, { compare: compareCFI }] = await Promise.all([
          import("foliate-js/overlayer.js") as Promise<{ Overlayer: { highlight: unknown; underline: unknown } }>,
          import("foliate-js/epubcfi.js") as Promise<{ compare: (a: string, b: string) => number }>,
        ]);
        if (disposed) return;
        type FoliateMore = {
          addAnnotation: (annotation: { value: string; color?: string }) => Promise<unknown>;
          deleteAnnotation: (annotation: { value: string }) => Promise<unknown>;
          getCFI: (index: number, range: Range) => string;
          resolveNavigation: (cfi: string) => { index: number; anchor?: (doc: Document) => Range } | undefined;
          renderer?: { getContents?: () => Array<{ doc: Document; index: number }> };
          book?: { sections?: Array<{ size?: number }> };
        };
        const fv = view as unknown as FoliateMore;
        cfiCompareRef.current = (a, b) => { try { return compareCFI(a, b); } catch { return a.localeCompare(b); } };
        const mobiContents = () => (fv.renderer?.getContents?.() ?? []).filter((item) => item?.doc?.body);
        const narrationTargets = () => mobiContents().flatMap(item => {
          const frame = item.doc.defaultView?.frameElement;
          return frame instanceof HTMLIFrameElement ? [{ doc: item.doc, frame, index: item.index }] : [];
        });
        const adjacentIndex = (doc: Document, direction: -1 | 1) => {
          const current = narrationTargets().find(target => target.doc === doc);
          const sections = view.book?.sections ?? [];
          if (!current) return -1;
          for (let index = current.index + direction; index >= 0 && index < sections.length; index += direction) {
            if (sections[index].linear !== "no") return index;
          }
          return -1;
        };
        unregisterNarration = registerEpubNarrationAdapter({
          targets: narrationTargets,
          canPrevious: doc => adjacentIndex(doc, -1) >= 0,
          navigate: async (doc, direction) => {
            const index = adjacentIndex(doc, direction);
            if (index < 0 || disposed) return null;
            await readerDeadline(view.goTo(index), controller.signal);
            if (disposed) return null;
            const target = narrationTargets().find(target => target.index === index);
            if (!target) throw new Error("The requested chapter did not open");
            return target;
          },
        });
        const mobiTarget = (item: { doc: Document; index: number }): AnnotationTarget => ({
          doc: item.doc,
          frame: (item.doc.defaultView?.frameElement as HTMLIFrameElement | null) ?? null,
          index: item.index,
        });
        view.addEventListener("draw-annotation", (event) => {
          const { draw, annotation } = (event as CustomEvent<{ draw: (fn: unknown, options: object) => void; annotation: { value: string; color?: Highlight["color"] } }>).detail;
          const color = annotation.color ?? highlightsRef.current.find((item) => item.cfi === annotation.value)?.color ?? "yellow";
          if (color === "underline") draw(Overlayer.underline, { color: colorFill("underline"), width: 2 });
          else draw(Overlayer.highlight, { color: colorFill(color) });
        });
        view.addEventListener("create-overlay", (event) => {
          const { index } = (event as CustomEvent<{ index: number }>).detail;
          for (const item of highlightsRef.current) {
            try {
              if (fv.resolveNavigation(item.cfi)?.index === index) void fv.addAnnotation({ value: item.cfi, color: item.color }).catch(() => undefined);
            } catch { /* not in this edition */ }
          }
        });
        setAnnotationAdapter({
          targets: () => mobiContents().map(mobiTarget),
          targetAt: (x, y) => mobiContents().map(mobiTarget).find((target) => {
            const box = target.frame?.getBoundingClientRect();
            return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
          }) ?? null,
          cfiFor: (target, range) => { try { return target.index != null ? fv.getCFI(target.index, range) : null; } catch { return null; } },
          rangeFor: (cfi) => {
            try {
              const resolved = fv.resolveNavigation(cfi);
              const item = mobiContents().find((entry) => entry.index === resolved?.index);
              const range = item && resolved?.anchor ? resolved.anchor(item.doc) : null;
              return item && range ? { target: mobiTarget(item), range } : null;
            } catch { return null; }
          },
          draw: (highlight) => { try { void fv.addAnnotation({ value: highlight.cfi, color: highlight.color }).catch(() => undefined); } catch { /* unresolvable */ } },
          erase: (highlight) => { try { void fv.deleteAnnotation({ value: highlight.cfi }).catch(() => undefined); } catch { /* unresolvable */ } },
          compare: (a, b) => cfiCompareRef.current(a, b),
          go: (cfi) => { try { void Promise.resolve(view.goTo(cfi)).catch(() => undefined); } catch { /* reader closed */ } },
          chapter: () => chapterLabelRef.current,
        });

        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<{ fraction?: number; cfi?: string; tocItem?: { label?: string }; section?: { current?: number }; time?: { section?: number; total?: number } }>).detail;
          // foliate reports what is left in 1,600-byte units of markup.
          const index = detail.section?.current;
          if (typeof index === "number" && detail.time) {
            const item = mobiContents().find((entry) => entry.index === index);
            const size = fv.book?.sections?.[index]?.size ?? 0;
            const length = item?.doc.body.textContent?.length ?? 0;
            if (size > 0 && length > 0) textRatioRef.current.set(index, length / size);
            const ratios = [...textRatioRef.current.values()];
            const ratio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0.6;
            noteTimeLeft(
              typeof detail.time.section === "number" ? detail.time.section * 1600 * ratio : undefined,
              typeof detail.time.total === "number" ? detail.time.total * 1600 * ratio : undefined,
            );
          }
          const percent = typeof detail.fraction === "number" ? `${Math.max(1, Math.round(detail.fraction * 100))}%` : "";
          const label = detail.tocItem?.label || percent || "In progress";
          setProgress(label);
          setLocationHref((detail.tocItem as { href?: string } | undefined)?.href || "");
          if (detail.cfi) {
            localStorage.setItem(`reading-room-position-${file.id}`, detail.cfi);
            reportLocation({ label, position: detail.cfi, status: "reading" });
          }
        });

        const saved = localStorage.getItem(`reading-room-position-${file.id}`) || initialPosition || undefined;
        await readerDeadline(view.init({ lastLocation: saved, showTextStart: true }), controller.signal);
        if (!disposed) { setTocTree(view.book?.toc || []); setToc(flattenToc(view.book?.toc || [])); }
        setStatus("");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (disposed) return;
        controller.abort();
        setStatus("This MOBI could not be opened here. It may be encrypted or use an unsupported Kindle format.");
      }
    }

    openMobi();
    return () => {
      disposed = true;
      controller.abort();
      revokeSafeUrls();
      unregisterNarration?.();
      setAnnotationAdapter(null);
      mobiViewRef.current?.close();
      mobiViewRef.current?.remove();
      mobiViewRef.current = null;
    };
  }, [epubRevision, file.id, file.format, format, initialPosition, isMobi, noteTimeLeft, readerModeReady, reportLocation, title]);

  useEffect(() => {
    if (!isMobi || !readerModeReady) return;
    const media = window.matchMedia("(max-width: 700px)");
    const updateColumns = () => mobiViewRef.current?.renderer?.setAttribute("max-column-count", isMobileViewport() ? "1" : "2");
    updateColumns();
    media.addEventListener("change", updateColumns);
    window.addEventListener("resize", updateColumns);
    return () => {
      media.removeEventListener("change", updateColumns);
      window.removeEventListener("resize", updateColumns);
    };
  }, [isMobi, readerModeReady]);

  // Only a deliberate tap marks the reader theme as chosen; until then the
  // reader follows the app theme on open.
  function chooseTheme(next: ReaderTheme) {
    try { localStorage.setItem("reading-room-reader-theme-set", "1"); } catch {}
    setTheme(next);
  }

  function chooseFontFamily(key: string) {
    if (!(key in FONT_FAMILIES)) return;
    setFontFamilyKey(key);
    setTypography((current) => ({ ...current, family: FONT_FAMILIES[key] }));
  }

  function resetReadingAppearance() {
    setFontFamilyKey("Original");
    setTypography(DEFAULT_TYPOGRAPHY);
    setFontSize(100);
    setLineHeight(1.65);
    setMargin(4);
    try {
      localStorage.removeItem("reading-room-reader-theme-set");
      const appTheme = localStorage.getItem("reading-room-theme");
      const dark = appTheme === "dark"
        || (appTheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      setTheme(dark ? "dark" : "light");
    } catch {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
  }

  async function shareBook() {
    const data = { title: displayTitle || title, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(data.url);
    } catch {
      // Cancelling the native share sheet is not an application error.
    }
  }

  useEffect(() => {
    fontSizeRef.current = fontSize;
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
    themeRef.current = theme;
    lineHeightRef.current = lineHeight;
    marginRef.current = margin;
    typographyRef.current = typography;
    renditionRef.current?.themes.default(epubStyles(theme, lineHeight, margin, readingModeRef.current !== "scroll", typography));
    mobiViewRef.current?.renderer?.setStyles(mobiStyles(fontSize, theme, lineHeight, margin, typography));
    localStorage.setItem("reading-room-reader-theme", theme);
    localStorage.setItem("reading-room-line-height", String(lineHeight));
    localStorage.setItem("reading-room-reader-margin", String(margin));
    localStorage.setItem("reading-room-font-size", String(fontSize));
    // Written back in the override's own shape so the legacy sheet, which is
    // still present until 1c-iii, keeps agreeing with us rather than overwriting.
    try {
      const existing = JSON.parse(localStorage.getItem("rr-books-type") || "{}");
      localStorage.setItem("rr-books-type", JSON.stringify({
        ...existing,
        font: fontFamilyKey,
        bold: typography.bold,
        justify: typography.justify,
        chars: typography.charSpacing,
        words: typography.wordSpacing,
        line: lineHeight,
        margins: margin,
      }));
    } catch { /* storage full or disabled; the session still works */ }
  }, [fontSize, lineHeight, margin, theme, typography, fontFamilyKey]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") {
        if (panel) setPanel(null);
        else onClose();
      }
      if (isBookReader && event.key === "ArrowLeft") previous();
      if (isBookReader && event.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isBookReader, onClose, panel]);

  // Keep keyboard focus inside the reader so Tab cannot reach the frozen library behind it.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const activeShell: HTMLElement = shell;
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    function handleFocusTrap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = [...activeShell.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length < 2) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleFocusTrap);
    return () => document.removeEventListener("keydown", handleFocusTrap);
  }, []);

  function chooseReadingMode(mode: ReadingMode) {
    if (mode === readingModeRef.current) return;
    window.dispatchEvent(new CustomEvent("rr-reading-mode-change", { detail: { mode } }));
    localStorage.setItem("reading-room-reader-mode", mode);
    readingModeRef.current = mode;
    setReadingMode(mode);
    if (isEpub) {
      setEpubRevision((revision) => revision + 1);
      return;
    }
    if (isMobi) {
      mobiViewRef.current?.renderer?.setAttribute("flow", mode === "scroll" ? "scrolled" : "paginated");
      mobiViewRef.current?.renderer?.setAttribute("max-column-count", isMobileViewport() ? "1" : "2");
    }
  }

  function choosePageTurnAnimation(animation: PageTurnAnimation) {
    localStorage.setItem("reading-room-page-turn-animation", animation);
    setPageTurnAnimation(animation);
  }

  function runPageTurn(direction: "previous" | "next", action: () => void) {
    action();
    if (readingModeRef.current !== "pages" || pageTurnAnimation !== "slide"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const shell = shellRef.current;
    if (!shell) return;
    shell.classList.remove("reader-turn-previous", "reader-turn-next");
    void shell.offsetWidth;
    shell.classList.add(direction === "previous" ? "reader-turn-previous" : "reader-turn-next");
    if (pageTurnTimerRef.current) clearTimeout(pageTurnTimerRef.current);
    // Duration comes from --rr-spring-time, the same token the CSS animation
    // uses. This was a hardcoded 230ms, which matched the old .22s ease-out; now
    // that the turn runs on the shared spring the class must survive the whole
    // animation or the page snaps back mid-flight. Reading the token keeps the
    // two in step instead of relying on someone updating both.
    const spring = getComputedStyle(shell).getPropertyValue("--rr-spring-time").trim();
    const seconds = spring.endsWith("ms") ? parseFloat(spring) / 1000 : parseFloat(spring);
    const duration = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 460;
    pageTurnTimerRef.current = setTimeout(() => {
      shell.classList.remove("reader-turn-previous", "reader-turn-next");
      pageTurnTimerRef.current = null;
    }, duration + 40);
  }

  function goToChapter(href: string) {
    if (isEpub) renditionRef.current?.display(href);
    else mobiViewRef.current?.goTo(href);
  }

  async function performSearch() {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchStatus("Enter at least two characters.");
      return;
    }
    const run = ++searchRunRef.current;
    setSearchResults([]);
    setSearchStatus("Searching…");
    try {
      let results: ReaderSearchResult[] = [];
      if (isEpub && bookRef.current) {
        const searchable = bookRef.current as unknown as {
          spine: { each: (callback: (section: EpubSearchSection) => void) => void };
          load: (url: string) => Promise<unknown>;
        };
        const sections: EpubSearchSection[] = [];
        searchable.spine.each((section) => sections.push(section));
        for (let index = 0; index < sections.length && results.length < 80; index += 1) {
          if (run !== searchRunRef.current) return;
          const section = sections[index];
          try {
            await section.load(searchable.load.bind(searchable));
            const label = toc.find((item) => item.href.split("#")[0] === section.href.split("#")[0])?.label || `Section ${index + 1}`;
            results.push(...section.find(query).slice(0, 8).map((match) => ({ target: match.cfi, label, excerpt: match.excerpt.replace(/<[^>]+>/g, "") })));
          } finally {
            section.unload();
          }
          if (index % 4 === 0) setSearchStatus(`Searching ${index + 1} of ${sections.length} sections…`);
        }
      } else if (isMobi && mobiViewRef.current?.search) {
        for await (const group of mobiViewRef.current.search({ query })) {
          if (run !== searchRunRef.current) return;
          for (const match of group.subitems || []) {
            const excerpt = typeof match.excerpt === "string" ? match.excerpt : `${match.excerpt.pre || ""}${match.excerpt.match || ""}${match.excerpt.post || ""}`;
            results.push({ target: match.cfi, label: group.label || "Match", excerpt });
            if (results.length >= 80) break;
          }
          if (results.length >= 80) break;
        }
      } else if (isPdf) {
        results = await pdfReaderRef.current?.search(query) || [];
      }
      if (run !== searchRunRef.current) return;
      setSearchResults(results.slice(0, 80));
      setSearchStatus(results.length ? `${Math.min(results.length, 80)} match${results.length === 1 ? "" : "es"}` : "No matches found.");
    } catch {
      if (run === searchRunRef.current) setSearchStatus("Search could not be completed for this book.");
    }
  }

  function goToPosition(position: string) {
    if (isEpub) renditionRef.current?.display(position);
    else if (isMobi) mobiViewRef.current?.goTo(position);
    else if (isPdf) pdfReaderRef.current?.goTo(Number(position));
    else if (isComic) comicReaderRef.current?.goTo(Number(position));
    setPanel(null);
  }

  function addBookmark() {
    const location = currentLocationRef.current;
    if (!location.position || bookmarks.some((bookmark) => bookmark.position === location.position)) return;
    onBookmarksChange?.([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, position: location.position, label: location.label || "Saved place", createdAt: Date.now() }, ...bookmarks].slice(0, 100));
  }

  function removeBookmark(id: string) {
    onBookmarksChange?.(bookmarks.filter((bookmark) => bookmark.id !== id));
  }

  function previous() {
    runPageTurn("previous", () => {
      if (isEpub) renditionRef.current?.prev();
      else if (isMobi) mobiViewRef.current?.prev();
      else if (isPdf) pdfReaderRef.current?.previous();
      else if (isComic) comicReaderRef.current?.previous();
    });
  }

  function next() {
    runPageTurn("next", () => {
      if (isEpub) renditionRef.current?.next();
      else if (isMobi) mobiViewRef.current?.next();
      else if (isPdf) pdfReaderRef.current?.next();
      else if (isComic) comicReaderRef.current?.next();
    });
  }

  function backToReadingMenu() {
    setPanel(null);
    setReactSheetOpen(true);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shellRef.current?.requestFullscreen();
  }

  function endSwipe(event: TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || readingModeRef.current !== "pages") return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > Math.round(window.innerWidth * 0.12) && Math.abs(dx) > Math.abs(dy) * 1.35) {
      if (dx < 0) mangaMode && isComic ? previous() : next();
      else mangaMode && isComic ? next() : previous();
    }
  }

  // Keep transport state current even while the expanded sheet is closed.
  const readAloud = useReadAloud(isReflowable);

  // The TOC is already state here. The old sheet cloned a <select> to get it,
  // which is why its depth prefixes were baked into the label string.
  // The contents entry for where the reader is: for an EPUB, the last entry at or before the
  // current spine item (so a chapter file with no entry of its own still marks its chapter, and
  // a merged collection whose contents list only books marks the book); for MOBI, foliate names
  // the entry itself. Spine positions are worked out once per contents list, not per page turn.
  const tocSpine = useMemo(() => {
    const book = bookRef.current as { spine?: { get?: (target: string) => { index?: number } | null } } | null;
    if (!isEpub || !book?.spine?.get) return [] as number[];
    return toc.map((item) => {
      try { return book.spine!.get!(item.href.split("#")[0])?.index ?? -1; } catch { return -1; }
    });
  }, [toc, isEpub]);
  const currentTocIndex = useMemo(() => {
    if (!locationHref || toc.length === 0) return -1;
    const base = (href: string) => href.split("#")[0];
    if (!isEpub) return toc.findIndex((item) => item.href === locationHref);
    const book = bookRef.current as { spine?: { get?: (target: string) => { index?: number } | null } } | null;
    let here = -1;
    try { here = book?.spine?.get?.(base(locationHref))?.index ?? -1; } catch { here = -1; }
    if (here < 0) return toc.findIndex((item) => base(item.href) === base(locationHref));
    let best = -1, bestAt = -1;
    tocSpine.forEach((at, index) => { if (at >= 0 && at <= here && at > bestAt) { best = index; bestAt = at; } });
    return best;
  }, [locationHref, toc, tocSpine, isEpub]);
  const toSheetToc = (items: TocItem[]): SheetTocItem[] => items.map(item => {
    const children = toSheetToc(item.subitems || []);
    return { label: item.label, value: item.href, children,
      current: item.href === toc[currentTocIndex]?.href || children.some(child => child.current) };
  });
  const sheetToc = toSheetToc(tocTree);
  const chapterName = currentTocIndex >= 0 ? (toc[currentTocIndex]?.label ?? "").trim() : "";
  chapterLabelRef.current = chapterName;
  currentTocIndexRef.current = currentTocIndex;
  tocRef.current = toc;

  // Lock Screen and CarPlay's Now Playing: the chapter as the track, the author
  // as the artist, the book as the album, with its cover.
  useEffect(() => {
    if (!isReflowable) return;
    const w = window as Window & { __rrNowPlaying?: { title?: string; artist?: string; album?: string; artwork?: string } };
    let artwork: string | undefined;
    try { artwork = coverUrl ? new URL(coverUrl, window.location.href).href : undefined; } catch { artwork = undefined; }
    w.__rrNowPlaying = { title: chapterName || displayTitle, artist: author || undefined, album: displayTitle, artwork };
    return () => { delete w.__rrNowPlaying; };
  }, [isReflowable, chapterName, displayTitle, author, coverUrl]);

  // Reading and listening are one place in the book. While the voice reads, the
  // saved place follows the sentence being spoken; pausing or stopping leaves
  // the page on it, and waking the screen brings the page back to it.
  // Previous/next track on the Lock Screen move by chapter and carry on reading.
  useEffect(() => {
    if (!isReflowable) return;
    let lastCfi: string | null = null;
    let savedAt = 0;
    const save = () => {
      if (!lastCfi) return;
      try { localStorage.setItem(`reading-room-position-${file.id}`, lastCfi); } catch { /* storage off */ }
      reportLocation({ label: currentLocationRef.current.label || "In progress", position: lastCfi, status: "reading" });
    };
    const onNarration = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: string; doc?: Document | null; range?: Range | null }>).detail || { kind: "" };
      if (detail.kind === "sentence") {
        narratingRef.current = true;
        const adapter = annotationAdapterRef.current;
        const target = adapter && detail.doc ? adapter.targets().find((item) => item.doc === detail.doc) : null;
        const cfi = adapter && target && detail.range ? adapter.cfiFor(target, detail.range) : null;
        if (cfi) lastCfi = cfi;
        if (Date.now() - savedAt > 5000) { savedAt = Date.now(); save(); }
      } else if (detail.kind === "paused" || detail.kind === "stopped") {
        const wasNarrating = narratingRef.current;
        narratingRef.current = false;
        paceRef.current = null;
        if (!wasNarrating || !lastCfi) return;
        save();
        annotationAdapterRef.current?.go(lastCfi);
        if (detail.kind === "stopped") lastCfi = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !narratingRef.current || !lastCfi) return;
      annotationAdapterRef.current?.go(lastCfi);
    };
    const onChapter = (event: Event) => {
      const delta = (event as CustomEvent<{ delta?: number }>).detail?.delta ?? 0;
      const list = tocRef.current;
      if (!delta || !list.length) return;
      const here = currentTocIndexRef.current < 0 ? 0 : currentTocIndexRef.current;
      const entry = list[Math.max(0, Math.min(list.length - 1, here + delta))];
      if (!entry) return;
      const moved = isEpub ? renditionRef.current?.display(entry.href) : mobiViewRef.current?.goTo(entry.href);
      void Promise.resolve(moved).catch(() => undefined).then(() => restartReadAloudFromView());
    };
    window.addEventListener("rr-narration", onNarration);
    window.addEventListener("rr-narration-chapter", onChapter);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("rr-narration", onNarration);
      window.removeEventListener("rr-narration-chapter", onChapter);
      document.removeEventListener("visibilitychange", onVisible);
      narratingRef.current = false;
    };
  }, [file.id, isEpub, isReflowable, reportLocation]);

  const footerLabel = left.chapter
    ? (progress && progress !== "In progress" ? `${progress} · ${left.chapter} left in chapter` : `${left.chapter} left in chapter`)
    : progress;
  const sheetProgress = left.book ? `${left.book} left in book` : progress;

  return (
    <section className={`reader-shell reader-theme-${theme}`} ref={shellRef} role="dialog" aria-modal="true" aria-labelledby="reader-title">
      <header className="reader-header">
        <div><h1 id="reader-title">{displayTitle}</h1></div>
        <div className="reader-actions">
          {isReflowable && toc.length > 0 && <label><span>Chapter</span><select defaultValue="" onChange={(event) => event.target.value && goToChapter(event.target.value)}><option value="" disabled>Contents</option>{toc.map((item, index) => <option key={`${item.href}-${index}`} value={item.href}>{`${"— ".repeat(item.depth)}${item.label}`}</option>)}</select></label>}
          {isBookReader && readingMode && <div className="reader-modes" aria-label="Reading mode"><button className={readingMode === "pages" ? "active" : ""} aria-pressed={readingMode === "pages"} onClick={() => chooseReadingMode("pages")}>Pages</button><button className={readingMode === "scroll" ? "active" : ""} aria-pressed={readingMode === "scroll"} onClick={() => chooseReadingMode("scroll")}>Scroll</button></div>}
          {isBookReader && readingMode === "pages" && <div className="reader-modes reader-page-turn" aria-label="Page turn animation"><button className={pageTurnAnimation === "none" ? "active" : ""} aria-pressed={pageTurnAnimation === "none"} onClick={() => choosePageTurnAnimation("none")}>None</button><button className={pageTurnAnimation === "slide" ? "active" : ""} aria-pressed={pageTurnAnimation === "slide"} onClick={() => choosePageTurnAnimation("slide")}>Slide</button></div>}
          {isReflowable && <div className="font-controls" aria-label="Text size"><button onClick={() => setFontSize((size) => Math.max(75, size - 10))} aria-label={`Decrease text size (${fontSize}%)`} title={`${fontSize}%`} disabled={fontSize <= 75}>A−</button><button onClick={() => setFontSize((size) => Math.min(160, size + 10))} aria-label={`Increase text size (${fontSize}%)`} title={`${fontSize}%`} disabled={fontSize >= 160}>A+</button></div>}
          {isBookReader && <details className="reader-settings"><summary aria-label="Reading appearance">Aa</summary><div><span>Theme</span><div className="theme-options"><button className={theme === "light" ? "active" : ""} onClick={() => chooseTheme("light")}>Light</button><button className={theme === "sepia" ? "active" : ""} onClick={() => chooseTheme("sepia")}>Sepia</button><button className={theme === "dark" ? "active" : ""} onClick={() => chooseTheme("dark")}>Dark</button></div>{isReflowable && <><span>Line spacing</span><input type="range" min="1.35" max="2" step="0.05" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} /><span>Margins</span><input type="range" min="2" max="12" step="1" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></>}</div></details>}
          {isComic && <button className={mangaMode ? "active" : ""} onClick={() => setMangaMode((enabled) => !enabled)} aria-pressed={mangaMode}>Manga</button>}
          {(seriesNavigation?.previous || seriesNavigation?.next) && <div className="reader-series-nav"><button disabled={!seriesNavigation.previous} title={seriesNavigation.previous} onClick={seriesNavigation.onPrevious}>Previous issue</button><button disabled={!seriesNavigation.next} title={seriesNavigation.next} onClick={seriesNavigation.onNext}>Next issue</button></div>}
          {(isReflowable || isPdf) && <button className={panel === "search" ? "active" : ""} onClick={() => setPanel((current) => current === "search" ? null : "search")} aria-label="Search inside book">⌕ <span className="reader-action-label">Search</span></button>}
          {isBookReader && <button className={panel === "bookmarks" ? "active" : ""} onClick={() => setPanel((current) => current === "bookmarks" ? null : "bookmarks")} aria-label={`Bookmarks${bookmarks.length ? `, ${bookmarks.length} saved` : ""}`}>▮ <span className="reader-action-label">Bookmarks{bookmarks.length ? ` ${bookmarks.length}` : ""}</span></button>}
          <button onClick={toggleFullscreen} aria-label="Toggle full screen">⛶</button>
          <a href={`${readerUrl(file.id, file.format)}&download=1`} download>Download file ↓</a>
          <button className="reader-close" onClick={onClose} aria-label="Close reader">×</button>
        </div>
      </header>

      {panel === "search" && readingSheetHost ? createPortal(<aside className="reader-panel rr-reader-panel-portal" aria-label="Search inside book">
        <div className="reader-panel-heading"><div><span>FIND IN BOOK</span><strong>Search this title</strong></div><button onClick={backToReadingMenu} aria-label="Back to reading menu">‹</button></div>
        <form className="reader-search-form" onSubmit={(event) => { event.preventDefault(); performSearch(); }}><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Word or phrase…" aria-label="Word or phrase" /><button type="submit">Search</button></form>
        {searchStatus && <p className="reader-panel-status">{searchStatus}</p>}
        <div className="reader-search-results">{searchResults.map((result, index) => <button key={`${result.target}-${index}`} onClick={() => goToPosition(result.target)}><strong>{result.label}</strong><span>{result.excerpt}</span></button>)}</div>
      </aside>, readingSheetHost) : null}

      {panel === "bookmarks" && readingSheetHost ? createPortal(<aside className="reader-panel rr-reader-panel-portal" aria-label="Bookmarks and highlights">
        <div className="reader-panel-heading"><div><span>SAVED PLACES</span><strong>{marksTab === "highlights" && isReflowable ? "Highlights & Notes" : "Bookmarks"}</strong></div><button onClick={backToReadingMenu} aria-label="Back to reading menu">‹</button></div>
        {isReflowable && <div className="rr-marks-tabs" role="tablist" aria-label="Saved places">
          <button type="button" role="tab" aria-selected={marksTab === "bookmarks"} onClick={() => setMarksTab("bookmarks")}>Bookmarks{bookmarks.length ? ` ${bookmarks.length}` : ""}</button>
          <button type="button" role="tab" aria-selected={marksTab === "highlights"} onClick={() => setMarksTab("highlights")}>Highlights{highlights.length ? ` ${highlights.length}` : ""}</button>
        </div>}
        {marksTab === "highlights" && isReflowable
          ? <HighlightsList highlights={highlights} title={displayTitle} author={author}
              onGo={(highlight) => goToPosition(highlight.cfi)}
              onRemove={(highlight) => onHighlightsChange?.(highlights.filter((item) => item.id !== highlight.id))} />
          : <>
            <button className="reader-add-bookmark" onClick={addBookmark}>+ Bookmark current place</button>
            <div className="reader-bookmarks">{bookmarks.length ? bookmarks.map((bookmark) => <div key={bookmark.id}><button onClick={() => goToPosition(bookmark.position)}><strong>{bookmark.label}</strong><span>{new Date(bookmark.createdAt).toLocaleDateString()}</span></button><button onClick={() => removeBookmark(bookmark.id)} aria-label={`Remove bookmark ${bookmark.label}`}>×</button></div>) : <p>No bookmarks yet.</p>}</div>
          </>}
      </aside>, readingSheetHost) : null}

      {isBookReader ? <>
        <div className="epub-stage" onTouchStart={(event) => { const touch = event.touches[0]; touchStartRef.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={endSwipe}>{isReflowable && <div className="epub-viewer" ref={viewerRef}></div>}{isPdf && readingMode && <PdfReader key={epubRevision} ref={pdfReaderRef} fileId={file.id} format={file.format} mode={readingMode} initialPosition={initialPosition} onStatus={setStatus} onProgress={setProgress} onLocationChange={reportLocation} />}{isComic && readingMode && <ComicReader key={epubRevision} ref={comicReaderRef} fileId={file.id} format={file.format} mode={readingMode} direction={mangaMode ? "rtl" : "ltr"} initialPosition={initialPosition} onStatus={setStatus} onProgress={setProgress} onLocationChange={reportLocation} />}{status && <div className="reader-message" role="status"><p>{status}</p>{status.includes("could not") && <><button type="button" onClick={() => setEpubRevision(value => value + 1)}>Retry opening</button><a href={`${readerUrl(file.id, file.format)}&download=1`} download>Download {format}</a></>}</div>}</div>
        <footer className="reader-footer"><button onClick={previous}>{readingMode === "scroll" ? "↑ Up" : "← Previous"}</button><span>{footerLabel || (readingMode === "scroll" ? "Continuous scroll" : "Use the arrow keys to turn pages")}</span><button onClick={next}>{readingMode === "scroll" ? "Down ↓" : "Next →"}</button></footer>
      </> : <iframe className="document-reader" src={previewUrl(file.id, file.url)} title={`Reader for ${title}`} allow="fullscreen" />}

      {readingSheetHost ? createPortal(<>
        <button type="button" className="rr-close-btn" aria-label="Close book" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg></button>
        <ReadAloudTransport api={readAloud} />
        {isReflowable && <ReaderAnnotations adapter={annotationAdapter} highlights={highlights}
          onChange={(next) => onHighlightsChange?.(next)} title={displayTitle} author={author} host={readingSheetHost} />}
        <button type="button" className="rr-react-sheet-trigger"
          aria-label={reactSheetOpen ? "Close reading settings" : "Open reading settings"}
          aria-expanded={reactSheetOpen}
          onClick={(event) => {
            event.stopPropagation();
            if (Date.now() - menuTouchAtRef.current < 700) return;
            setReactSheetOpen((open) => !open);
          }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 6.5h14M5 12h14M5 17.5h14" /></svg></button>
        <ReadingSheet
          open={reactSheetOpen}
          onClose={() => setReactSheetOpen(false)}
          theme={theme}
          onThemeChange={chooseTheme}
          mode={isReflowable ? readingMode ?? undefined : undefined}
          onModeChange={chooseReadingMode}
          pageTurn={isReflowable ? pageTurnAnimation : undefined}
          onPageTurnChange={choosePageTurnAnimation}
          fontSize={isReflowable ? fontSize : undefined}
          onFontSizeChange={setFontSize}
          lineHeight={isReflowable ? lineHeight : undefined}
          onLineHeightChange={setLineHeight}
          margin={isReflowable ? margin : undefined}
          onMarginChange={setMargin}
          toc={sheetToc.length > 0 ? sheetToc : undefined}
          onTocSelect={goToChapter}
          progressLabel={sheetProgress || undefined}
          onSearch={(isReflowable || isPdf) ? () => { setReactSheetOpen(false); setPanel("search"); } : undefined}
          onBookmarks={() => { setReactSheetOpen(false); setPanel("bookmarks"); }}
          onShare={shareBook}
          fontFamily={isReflowable ? fontFamilyKey : undefined}
          fontFamilies={isReflowable ? Object.keys(FONT_FAMILIES) : undefined}
          onFontFamilyChange={chooseFontFamily}
          bold={isReflowable ? typography.bold : undefined}
          onBoldChange={(bold) => setTypography((current) => ({ ...current, bold }))}
          justify={isReflowable ? typography.justify : undefined}
          onJustifyChange={(justify) => setTypography((current) => ({ ...current, justify }))}
          charSpacing={isReflowable ? typography.charSpacing : undefined}
          onCharSpacingChange={(charSpacing) => setTypography((current) => ({ ...current, charSpacing }))}
          wordSpacing={isReflowable ? typography.wordSpacing : undefined}
          onWordSpacingChange={(wordSpacing) => setTypography((current) => ({ ...current, wordSpacing }))}
          onReset={isReflowable ? resetReadingAppearance : undefined}
          readAloud={isReflowable ? readAloud : undefined}
        />
      </>, readingSheetHost) : null}
    </section>
  );
}
