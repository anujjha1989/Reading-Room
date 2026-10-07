/** The reader owns chapter identity/navigation; narration never guesses from frame size. */
export type EpubNarrationTarget = { doc: Document; frame: HTMLIFrameElement; index: number };
export type EpubNarrationAdapter = {
  targets: () => EpubNarrationTarget[];
  navigate: (doc: Document, direction: -1 | 1) => Promise<EpubNarrationTarget | null>;
  canPrevious: (doc: Document) => boolean;
  /** The next readable section's text, loaded without drawing it. A locked
   *  screen draws nothing, so narration cannot wait for a chapter to render. */
  offscreen?: (fromIndex: number, direction: -1 | 1) => Promise<EpubOffscreenSection | null>;
  /** Draw a section that narration reached while the screen was off. */
  show?: (index: number) => Promise<EpubNarrationTarget | null>;
};
export type EpubOffscreenSection = { doc: Document; index: number; cfiFor: (range: Range) => string | null };
let adapter: EpubNarrationAdapter | null = null;
export const getEpubNarrationAdapter = () => adapter;
export function registerEpubNarrationAdapter(next: EpubNarrationAdapter) {
  adapter = next;
  return () => { if (adapter === next) adapter = null; };
}

export function visibleEpubNarrationTarget(targets: EpubNarrationTarget[], top: number, bottom: number) {
  let best: EpubNarrationTarget | null = null, firstLine = Infinity;
  for (const target of targets) {
    if (!target.doc.body?.textContent?.trim()) continue;
    const box = target.frame.getBoundingClientRect();
    if (box.bottom <= top + 20 || box.top >= bottom
      || box.right <= 0 || box.left >= window.innerWidth) continue;
    // Start with the first chapter at the reading edge, not whichever next
    // chapter happens to occupy more of the viewport below it.
    const line = Math.max(top, box.top);
    if (line < firstLine || (line === firstLine && target.index < (best?.index ?? Infinity))) {
      firstLine = line; best = target;
    }
  }
  return best;
}
