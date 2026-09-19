"use client";

/**
 * Adapter between read-aloud.js and React.
 *
 * read-aloud.js is an override that loads independently of the bundle and owns
 * TTS entirely: the sentence queue, the audio element, the cancellation guards
 * tied to its epoch, the sleep timer. None of that should move into React — it
 * works, it is subtle, and rewriting it would risk the one part of this app that
 * has genuinely hard concurrency in it.
 *
 * What it should not do is make components read its DOM. It already exposes a
 * function API on `window`, so this hook is the single place that touches those
 * globals. Everything downstream receives a typed object.
 *
 * Why polling rather than events: read-aloud.js does not emit state changes, and
 * adding an event bus to it would mean editing the module this refactor is trying
 * to leave alone. Polling at 400ms is imperceptible for a transport UI and costs
 * a property read. It only runs while the sheet is open, so it is idle the rest
 * of the time.
 */

import { useCallback, useEffect, useState } from "react";
import type { ReadAloudApi } from "./ReadingSheet";

type RawState = {
  playing: boolean;
  paused: boolean;
  rate: number;
  sleepMinutes: number;
  canPrevious: boolean;
  canNext: boolean;
};

type Voice = { label: string; value: string; current: boolean };

/** The globals read-aloud.js installs. Declared so TS does not need `any`. */
type ReadAloudGlobals = {
  rrGetReadAloudState?: () => RawState;
  rrToggleReadAloud?: () => void;
  rrStopReadAloud?: () => void;
  rrSkipSentence?: (direction?: number) => void;
  rrAdjustSleepTime?: (minutes: number) => void;
  rrSetReadingRate?: (rate: number | string) => void;
  rrGetReadingRate?: () => number;
  rrGetVoices?: () => Voice[];
  rrSetVoice?: (value: string) => void;
};

const globals = () => (typeof window === "undefined" ? {} : window as unknown as ReadAloudGlobals);

/**
 * Returns a ReadAloudApi, or undefined when TTS is unavailable — either the
 * override has not loaded or the book is not reflowable. The sheet uses that to
 * omit the section entirely rather than showing controls that do nothing, which
 * is what the old version did when its selector lookups failed.
 *
 * @param active poll only while the sheet is open.
 */
export function useReadAloud(active: boolean): ReadAloudApi | undefined {
  const [state, setState] = useState<RawState | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);

  const read = useCallback(() => {
    const api = globals();
    if (typeof api.rrGetReadAloudState !== "function") { setState(null); return; }
    try {
      setState(api.rrGetReadAloudState());
      setVoices(typeof api.rrGetVoices === "function" ? api.rrGetVoices() : []);
    } catch {
      // A throwing override should degrade to "no TTS", not break the sheet.
      setState(null);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const kickoff = window.setTimeout(read, 0);
    const timer = window.setInterval(read, 400);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [active, read]);

  if (!state) return undefined;

  return {
    playing: state.playing,
    paused: state.paused,
    rate: state.rate,
    sleepMinutes: state.sleepMinutes,
    canPrevious: state.canPrevious,
    canNext: state.canNext,
    voices,
    // Each action reads its function fresh rather than closing over it: the
    // override may finish loading after the first render.
    toggle: () => { globals().rrToggleReadAloud?.(); read(); },
    stop: () => { globals().rrStopReadAloud?.(); read(); },
    skip: () => { globals().rrSkipSentence?.(1); read(); },
    previous: () => { globals().rrSkipSentence?.(-1); read(); },
    adjustSleep: (minutes: number) => { globals().rrAdjustSleepTime?.(minutes); read(); },
    setRate: (rate: number) => { globals().rrSetReadingRate?.(rate); read(); },
    setVoice: (value: string) => { globals().rrSetVoice?.(value); read(); },
  } satisfies ReadAloudApi & Record<string, unknown> as ReadAloudApi;
}
