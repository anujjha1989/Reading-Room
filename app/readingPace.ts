/**
 * Time left in the chapter and the book, from this reader's own pace.
 *
 * Pace is characters of book text per minute, learned on this device from real
 * page turns (a turn after 4 s to 4 min counts; anything faster is skimming or
 * flicking, anything slower is a pause). It starts at 1,150 - about 230 words a
 * minute - and moves a little with each page, so a few chapters in it is yours.
 */

const KEY = "rr-reading-cpm";
const DEFAULT_CPM = 1150;

export function readingPace(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value >= 300 && value <= 5000 ? value : DEFAULT_CPM;
  } catch { return DEFAULT_CPM; }
}

/** Fold one stretch of reading into the pace. */
export function recordReading(chars: number, seconds: number) {
  if (!(chars > 150) || seconds < 4 || seconds > 240) return;
  const sample = chars / (seconds / 60);
  if (sample < 250 || sample > 6000) return;
  const next = readingPace() * 0.88 + sample * 0.12;
  try { localStorage.setItem(KEY, String(Math.round(next))); } catch { /* private mode */ }
}

/** "under a minute", "12 min", "1 h 5 min", "6 h". */
export function formatMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes < 1) return "under a minute";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60), rest = rounded % 60;
  if (hours >= 10 || rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

export type TimeLeft = { chapter?: string; book?: string };

export function timeLeft(chapterChars: number | undefined, bookChars: number | undefined): TimeLeft {
  const pace = readingPace();
  return {
    chapter: chapterChars != null && chapterChars >= 0 ? formatMinutes(chapterChars / pace) : undefined,
    book: bookChars != null && bookChars >= 0 ? formatMinutes(bookChars / pace) : undefined,
  };
}
