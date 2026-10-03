/** The reader owns chapter identity/navigation; narration never guesses from frame size. */
export type EpubNarrationTarget = { doc: Document; frame: HTMLIFrameElement; index: number };
export type EpubNarrationAdapter = {
  targets: () => EpubNarrationTarget[];
  advance: (doc: Document) => Promise<EpubNarrationTarget | null>;
};
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
