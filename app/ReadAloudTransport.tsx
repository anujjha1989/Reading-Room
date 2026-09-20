"use client";

import type { ReadAloudApi } from "./ReadingSheet";

function TransportIcon({ name }: { name: "previous" | "play" | "pause" | "next" }) {
  const path = name === "previous"
    ? <><path d="M6 5v14" /><path d="m17 6-7 6 7 6" /></>
    : name === "next"
      ? <><path d="M18 5v14" /><path d="m7 6 7 6-7 6" /></>
      : name === "play"
        ? <path d="M8 5v14l11-7Z" fill="currentColor" stroke="none" />
        : <path d="M8 5v14M16 5v14" />;
  return <svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg>;
}

/** The compact narration transport is ordinary React chrome, not injected DOM. */
export default function ReadAloudTransport({ api }: { api?: ReadAloudApi }) {
  if (!api?.playing) return null;
  return <div className="rr-read-transport rr-visible" role="group" aria-label="Read aloud controls">
    <button type="button" onClick={api.previous} disabled={!api.canPrevious} aria-label="Previous sentence"><TransportIcon name="previous" /></button>
    <button type="button" className="rr-read-toggle" onClick={api.toggle} aria-label={api.paused ? "Resume read aloud" : "Pause read aloud"} aria-pressed={!api.paused}><TransportIcon name={api.paused ? "play" : "pause"} /></button>
    <button type="button" onClick={api.skip} disabled={!api.canNext} aria-label="Next sentence"><TransportIcon name="next" /></button>
  </div>;
}
