"use client";

/**
 * Typed adapter between the bundled Read Aloud engine and React.
 *
 * readAloudEngine.js is bundled with the app and owns
 * TTS entirely: the sentence queue, the audio element, the cancellation guards
 * tied to its epoch, the sleep timer. None of that should move into React — it
 * works, it is subtle, and rewriting it would risk the one part of this app that
 * has genuinely hard concurrency in it.
 *
 * The engine registers with a typed controller. React subscribes to that store,
 * so there are no browser globals, injected controls, DOM reads or polling.
 */

import { useSyncExternalStore } from "react";
import type { ReadAloudApi } from "./ReadingSheet";
import {
  getReadAloudSnapshot,
  getReadAloudVoices,
  hasReadAloudEngine,
  readAloudActions,
  subscribeReadAloud,
} from "./readAloudController";

/**
 * Returns a ReadAloudApi, or undefined when TTS is unavailable or the book is
 * not reflowable. The sheet uses that to
 * omit the section entirely rather than showing controls that do nothing, which
 * is what the old version did when its selector lookups failed.
 *
 * @param active subscribe only while a reflowable reader is mounted.
 */
export function useReadAloud(active: boolean): ReadAloudApi | undefined {
  const state = useSyncExternalStore(subscribeReadAloud, getReadAloudSnapshot, getReadAloudSnapshot);
  // State notification also refreshes this stable, content-compared array.
  useSyncExternalStore(subscribeReadAloud, getReadAloudVoices, getReadAloudVoices);
  if (!active || !hasReadAloudEngine()) return undefined;
  return { ...state, voices: getReadAloudVoices(), ...readAloudActions } satisfies ReadAloudApi;
}
