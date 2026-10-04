export type ReadAloudState = {
  playing: boolean;
  paused: boolean;
  rate: number;
  sleepMinutes: number;
  canPrevious: boolean;
  canNext: boolean;
  error?: string;
};

export type ReadAloudVoice = { label: string; value: string; current: boolean };

export type ReadAloudEngine = {
  getState: () => ReadAloudState;
  getVoices: () => ReadAloudVoice[];
  toggle: () => void;
  stop: () => void;
  skip: (direction: -1 | 1) => void;
  restartFromView?: () => void;
  adjustSleep: (minutes: number) => void;
  clearSleep: () => void;
  returnToCurrent: () => void;
  setRate: (rate: number) => void;
  setVoice: (value: string) => void;
};

const EMPTY_STATE: ReadAloudState = {
  playing: false,
  paused: false,
  rate: 1,
  sleepMinutes: 0,
  canPrevious: false,
  canNext: false,
};

let engine: ReadAloudEngine | undefined;
let snapshot = EMPTY_STATE;
let voices: ReadAloudVoice[] = [];
const listeners = new Set<() => void>();

function sameState(a: ReadAloudState, b: ReadAloudState) {
  return a.playing === b.playing && a.paused === b.paused && a.rate === b.rate
    && a.sleepMinutes === b.sleepMinutes && a.canPrevious === b.canPrevious
    && a.canNext === b.canNext && a.error === b.error;
}

function sameVoices(a: ReadAloudVoice[], b: ReadAloudVoice[]) {
  return a.length === b.length && a.every((voice, index) => {
    const other = b[index];
    return voice.label === other.label && voice.value === other.value
      && voice.current === other.current;
  });
}

/** Registers the single narration engine bundled with BookReader. */
export function registerReadAloudEngine(next: ReadAloudEngine) {
  engine = next;
  notifyReadAloudChange();
}

/** Called by the engine after every user-visible state change. */
export function notifyReadAloudChange() {
  if (!engine) return;
  const nextState = engine.getState();
  const nextVoices = engine.getVoices();
  if (!sameState(snapshot, nextState)) snapshot = nextState;
  if (!sameVoices(voices, nextVoices)) voices = nextVoices;
  listeners.forEach((listener) => listener());
}

export function subscribeReadAloud(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getReadAloudSnapshot = () => snapshot;
export const getReadAloudVoices = () => voices;
export const hasReadAloudEngine = () => Boolean(engine);

/** Carry on narrating from what is now on screen (after the reader jumped). */
export const restartReadAloudFromView = () => engine?.restartFromView?.();

export const readAloudActions = {
  toggle: () => engine?.toggle(),
  stop: () => engine?.stop(),
  skip: () => engine?.skip(1),
  previous: () => engine?.skip(-1),
  adjustSleep: (minutes: number) => engine?.adjustSleep(minutes),
  clearSleep: () => engine?.clearSleep(),
  returnToCurrent: () => engine?.returnToCurrent(),
  setRate: (rate: number) => engine?.setRate(rate),
  setVoice: (value: string) => engine?.setVoice(value),
};
