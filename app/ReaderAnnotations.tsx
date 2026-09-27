"use client";

/**
 * Highlights, notes and look-up inside the reader.
 *
 * The book's iframe sits under a transparent page-turn layer on touch devices
 * (see readerChromeBridge.js), so the iframe never sees a long press. The layer
 * hands a long press to `window.__rrLongPress`: this selects the word under the
 * finger, lifts the layer (text mode) so the selection can be adjusted with the
 * system handles, and shows the highlight menu. The selection is polled rather
 * than observed because WebKit does not run listeners inside sandboxed book
 * frames. A plain tap goes to `window.__rrTapAt` first, which opens the menu for
 * a highlight under the finger instead of turning the page.
 *
 * Drawing is left to each engine (epub.js marks, foliate overlays) through the
 * adapter BookReader supplies; this component owns the data and the UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  cleanQuote, colorFill, HIGHLIGHT_COLORS, highlightsMarkdown, newHighlightId,
  type Highlight, type HighlightColor,
} from "./annotations";
import { askAbout, hasNativeLookUp, lookUp, shareText, translate } from "./nativeBridge";
import { haptic } from "./haptics";
import "./reader-annotations.css";

export type AnnotationTarget = { doc: Document; frame: HTMLIFrameElement | null; index?: number };

export type AnnotationAdapter = {
  /** Every book document currently rendered. */
  targets: () => AnnotationTarget[];
  /** The book document under a point in the host page, if any. */
  targetAt: (x: number, y: number) => AnnotationTarget | null;
  cfiFor: (target: AnnotationTarget, range: Range) => string | null;
  /** The highlight's range when its section is on screen now, else null. */
  rangeFor: (cfi: string) => { target: AnnotationTarget; range: Range } | null;
  draw: (highlight: Highlight) => void;
  erase: (highlight: Highlight) => void;
  compare: (a: string, b: string) => number;
  go: (cfi: string) => void;
  chapter: () => string;
};

type Selecting = { target: AnnotationTarget; range: Range; text: string };
type Menu =
  | { kind: "selection"; selection: Selecting; rect: DOMRect }
  | { kind: "highlight"; highlight: Highlight; rect: DOMRect };

type RRWindow = Window & {
  __rrLongPress?: (x: number, y: number) => boolean;
  __rrTapAt?: (x: number, y: number) => boolean;
  __rrTextMode?: (on: boolean) => void;
};

/** A document's client rect in host-page coordinates. */
function hostRect(target: AnnotationTarget, rect: DOMRect) {
  const frame = target.frame;
  if (!frame) return rect;
  const box = frame.getBoundingClientRect();
  const sx = frame.clientWidth ? box.width / frame.clientWidth : 1;
  const sy = frame.clientHeight ? box.height / frame.clientHeight : 1;
  return new DOMRect(box.left + rect.left * sx, box.top + rect.top * sy, rect.width * sx, rect.height * sy);
}

function toDoc(target: AnnotationTarget, x: number, y: number) {
  const frame = target.frame;
  if (!frame) return { x, y };
  const box = frame.getBoundingClientRect();
  const sx = frame.clientWidth ? frame.clientWidth / box.width : 1;
  const sy = frame.clientHeight ? frame.clientHeight / box.height : 1;
  return { x: (x - box.left) * sx, y: (y - box.top) * sy };
}

/** The word under a point, selected in the book's own document. */
function selectWord(doc: Document, x: number, y: number): Range | null {
  const d = doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  let caret: Range | null = null;
  try { caret = d.caretRangeFromPoint ? d.caretRangeFromPoint(x, y) : null; } catch { caret = null; }
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const selection = doc.getSelection();
  if (!selection) return null;
  selection.removeAllRanges();
  selection.addRange(caret);
  const modify = (selection as Selection & { modify?: (a: string, d: string, g: string) => void }).modify;
  if (modify) {
    modify.call(selection, "move", "backward", "word");
    modify.call(selection, "extend", "forward", "word");
  }
  if (!selection.rangeCount || selection.isCollapsed) return null;
  return selection.getRangeAt(0).cloneRange();
}

function unionRect(target: AnnotationTarget, range: Range) {
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return hostRect(target, range.getBoundingClientRect());
  const hosted = rects.map((rect) => hostRect(target, rect));
  const left = Math.min(...hosted.map((r) => r.left)), top = Math.min(...hosted.map((r) => r.top));
  const right = Math.max(...hosted.map((r) => r.right)), bottom = Math.max(...hosted.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function contextBefore(target: AnnotationTarget, range: Range, chars: number) {
  try {
    const before = target.doc.createRange();
    before.setStart(target.doc.body, 0);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().replace(/\s+/g, " ").slice(-chars);
  } catch { return ""; }
}

export default function ReaderAnnotations({ adapter, highlights, onChange, title, author, host }: {
  adapter: AnnotationAdapter | null;
  highlights: Highlight[];
  onChange: (next: Highlight[]) => void;
  title: string;
  author?: string;
  host: HTMLElement | null;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [draft, setDraft] = useState("");
  const selectingRef = useRef<Selecting | null>(null);
  const highlightsRef = useRef(highlights);
  const drawnRef = useRef<Map<string, Highlight>>(new Map());
  const native = hasNativeLookUp();
  highlightsRef.current = highlights;

  // Keep the engine's drawing in step with the list: new ones drawn, deleted
  // ones erased, a changed colour redrawn. Engines re-apply their own marks
  // when a section re-renders, so this runs only on list changes.
  useEffect(() => {
    if (!adapter) return;
    const drawn = drawnRef.current;
    const wanted = new Map(highlights.map((item) => [item.id, item]));
    for (const [id, old] of drawn) {
      const now = wanted.get(id);
      if (!now || now.color !== old.color || now.cfi !== old.cfi) { adapter.erase(old); drawn.delete(id); }
    }
    for (const item of highlights) {
      if (!drawn.has(item.id)) { adapter.draw(item); drawn.set(item.id, item); }
    }
  }, [adapter, highlights]);
  useEffect(() => () => { drawnRef.current.clear(); }, [adapter]);

  const endSelecting = useCallback((clear: boolean) => {
    const current = selectingRef.current;
    selectingRef.current = null;
    if (clear && current) { try { current.target.doc.getSelection()?.removeAllRanges(); } catch { /* frame gone */ } }
    (window as RRWindow).__rrTextMode?.(false);
  }, []);

  const save = useCallback((next: Highlight[]) => {
    onChange(adapter ? [...next].sort((a, b) => adapter.compare(a.cfi, b.cfi)) : next);
  }, [adapter, onChange]);

  // Long press on the page: select the word, lift the tap layer, show the menu.
  useEffect(() => {
    if (!adapter) return;
    const w = window as RRWindow;
    w.__rrLongPress = (x, y) => {
      const target = adapter.targetAt(x, y);
      if (!target) return false;
      const point = toDoc(target, x, y);
      const range = selectWord(target.doc, point.x, point.y);
      if (!range) return false;
      const selection = { target, range, text: range.toString() };
      selectingRef.current = selection;
      w.__rrTextMode?.(true);
      setMenu({ kind: "selection", selection, rect: unionRect(target, range) });
      haptic("firm");
      return true;
    };
    // A tap on a highlight opens it instead of turning the page.
    w.__rrTapAt = (x, y) => {
      for (const item of highlightsRef.current) {
        const found = adapter.rangeFor(item.cfi);
        if (!found) continue;
        const hit = [...found.range.getClientRects()].some((rect) => {
          const r = hostRect(found.target, rect);
          return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
        });
        if (hit) {
          setMenu({ kind: "highlight", highlight: item, rect: unionRect(found.target, found.range) });
          return true;
        }
      }
      return false;
    };
    return () => { delete w.__rrLongPress; delete w.__rrTapAt; };
  }, [adapter]);

  // Follow the selection while it's being adjusted with the system handles;
  // a collapsed selection (a tap elsewhere) ends it.
  useEffect(() => {
    if (menu?.kind !== "selection") return;
    let collapsed = 0;
    const timer = setInterval(() => {
      const current = selectingRef.current;
      if (!current) return;
      const selection = current.target.doc.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) {
        collapsed += 1;
        if (collapsed >= 3) { endSelecting(false); setMenu(null); }
        return;
      }
      collapsed = 0;
      const range = selection.getRangeAt(0);
      const text = range.toString();
      if (text === current.text) return;
      const next = { target: current.target, range: range.cloneRange(), text };
      selectingRef.current = next;
      setMenu({ kind: "selection", selection: next, rect: unionRect(current.target, range) });
    }, 200);
    return () => clearInterval(timer);
  }, [menu?.kind, endSelecting]);

  // A selection made any other way - a mouse drag on a computer, or the system
  // handles once the page layer is lifted - opens the same menu.
  useEffect(() => {
    if (!adapter || menu) return;
    const timer = setInterval(() => {
      for (const target of adapter.targets()) {
        let selection: Selection | null = null;
        try { selection = target.doc.getSelection(); } catch { continue; }
        if (!selection || !selection.rangeCount || selection.isCollapsed) continue;
        const range = selection.getRangeAt(0);
        const text = range.toString();
        if (!text.trim()) continue;
        const next = { target, range: range.cloneRange(), text };
        selectingRef.current = next;
        (window as RRWindow).__rrTextMode?.(true);
        setMenu({ kind: "selection", selection: next, rect: unionRect(target, range) });
        return;
      }
    }, 400);
    return () => clearInterval(timer);
  }, [adapter, menu]);

  const close = useCallback(() => { endSelecting(true); setMenu(null); }, [endSelecting]);

  function create(color: HighlightColor, withNote = false) {
    if (!adapter || menu?.kind !== "selection") return;
    const { selection } = menu;
    const cfi = adapter.cfiFor(selection.target, selection.range);
    if (!cfi || !cleanQuote(selection.text)) { close(); return; }
    const item: Highlight = {
      id: newHighlightId(), cfi, color, text: cleanQuote(selection.text).slice(0, 4000),
      chapter: adapter.chapter() || undefined, createdAt: Date.now(),
    };
    save([...highlightsRef.current, item]);
    close();
    if (withNote) { setEditing(item); setDraft(""); }
  }

  function recolor(item: Highlight, color: HighlightColor) {
    save(highlightsRef.current.map((h) => h.id === item.id ? { ...h, color, updatedAt: Date.now() } : h));
    setMenu(null);
  }

  function remove(item: Highlight) {
    save(highlightsRef.current.filter((h) => h.id !== item.id));
    setMenu(null);
  }

  function saveNote() {
    if (!editing) return;
    const note = draft.trim();
    save(highlightsRef.current.map((h) => h.id === editing.id ? { ...h, note: note || undefined, updatedAt: Date.now() } : h));
    setEditing(null);
  }

  const text = menu?.kind === "selection" ? cleanQuote(menu.selection.text) : menu?.kind === "highlight" ? menu.highlight.text : "";
  const shortName = text.length > 0 && text.length <= 40 && text.split(" ").length <= 4;

  function askWho() {
    if (menu?.kind !== "selection") return;
    askAbout(text, contextBefore(menu.selection.target, menu.selection.range, 16000), title, author);
    close();
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard refused */ }
    close();
  }

  if (!host) return null;
  const position = menu ? (() => {
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.min(Math.max(12, menu.rect.left + menu.rect.width / 2 - width / 2), window.innerWidth - width - 12);
    // Below the text: iOS puts its own Copy / Look Up callout above a selection.
    const below = menu.rect.bottom + 14;
    const top = below + 124 < window.innerHeight - 20 ? below : Math.max(12, menu.rect.top - 136);
    return { left, top, width };
  })() : null;

  return createPortal(<>
    {menu && position && <div className="rr-hl-menu" role="menu" aria-label={menu.kind === "selection" ? "Selected text" : "Highlight"}
      style={{ left: position.left, top: position.top, width: position.width }}
      onPointerDown={(event) => event.stopPropagation()}>
      <div className="rr-hl-swatches">
        {HIGHLIGHT_COLORS.map((color) => {
          const current = menu.kind === "highlight" && menu.highlight.color === color.value;
          return <button key={color.value} type="button" role="menuitemradio" aria-checked={current}
            aria-label={`${color.label}${menu.kind === "selection" ? " highlight" : ""}`}
            className={`rr-hl-swatch rr-hl-${color.value}${current ? " current" : ""}`}
            style={{ "--hl": color.fill } as React.CSSProperties}
            onClick={() => menu.kind === "selection" ? create(color.value) : recolor(menu.highlight, color.value)}>
            {color.value === "underline" ? <span>U</span> : null}
          </button>;
        })}
      </div>
      <div className="rr-hl-actions">
        <button type="button" role="menuitem" onClick={() => {
          if (menu.kind === "selection") create("yellow", true);
          else { setEditing(menu.highlight); setDraft(menu.highlight.note || ""); setMenu(null); }
        }}>{menu.kind === "highlight" && menu.highlight.note ? "Edit Note" : "Note"}</button>
        <button type="button" role="menuitem" onClick={copy}>Copy</button>
        <button type="button" role="menuitem" onClick={() => { lookUp(text); close(); }}>Look Up</button>
        <button type="button" role="menuitem" onClick={() => { translate(text); close(); }}>Translate</button>
        {native && menu.kind === "selection" && shortName && <button type="button" role="menuitem" onClick={askWho}>Who’s This?</button>}
        {menu.kind === "highlight" && <button type="button" role="menuitem" className="danger" onClick={() => remove(menu.highlight)}>Remove</button>}
      </div>
    </div>}
    {menu?.kind === "highlight" && <div className="rr-hl-scrim" aria-hidden="true" onPointerDown={close} />}
    {editing && <div className="rr-note-backdrop" role="presentation" onPointerDown={() => setEditing(null)}>
      <section className="rr-note-sheet" role="dialog" aria-modal="true" aria-label="Note" onPointerDown={(event) => event.stopPropagation()}>
        <blockquote style={{ "--hl": colorFill(editing.color) } as React.CSSProperties}>{editing.text}</blockquote>
        <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a note…" rows={5} />
        <div className="rr-note-actions">
          <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="primary" onClick={saveNote}>Save</button>
        </div>
      </section>
    </div>}
  </>, host);
}

/** The Highlights tab of the Marks panel: every highlight and note, in book
 *  order, with Export. */
export function HighlightsList({ highlights, onGo, onRemove, title, author }: {
  highlights: Highlight[];
  onGo: (highlight: Highlight) => void;
  onRemove: (highlight: Highlight) => void;
  title: string;
  author?: string;
}) {
  if (!highlights.length) return <p className="rr-hl-empty">Press and hold on any word to highlight it or add a note.</p>;
  return <>
    <div className="rr-hl-list">
      {highlights.map((item) => <div key={item.id} className="rr-hl-item" style={{ "--hl": colorFill(item.color) } as React.CSSProperties}>
        <button type="button" onClick={() => onGo(item)}>
          <span className="rr-hl-quote">{item.text}</span>
          {item.note && <span className="rr-hl-note">{item.note}</span>}
          <small>{[item.chapter, new Date(item.createdAt).toLocaleDateString()].filter(Boolean).join(" · ")}</small>
        </button>
        <button type="button" className="rr-hl-remove" onClick={() => onRemove(item)} aria-label={`Remove highlight “${item.text.slice(0, 40)}”`}>×</button>
      </div>)}
    </div>
    <button type="button" className="reader-add-bookmark rr-hl-export"
      onClick={() => shareText(`${title} — highlights`, highlightsMarkdown(title, author, highlights), `${title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80)} highlights.md`)}>
      Export {highlights.length} highlight{highlights.length === 1 ? "" : "s"}
    </button>
  </>;
}
